'use strict';
/**
 * upnp.js —— 零依赖的 UPnP 端口映射（给公网联机用）。
 *
 * 大部分家用路由器都支持 UPnP IGD，能自动把外网端口映射到这台电脑，
 * 这样就不用进路由器后台手动设置了。
 *
 * 用法：
 *   const upnp = require('./upnp');
 *   await upnp.open(8000);            // 把外网 8000 映射到本机 8000
 *   const ip = await upnp.externalIP();  // 查公网 IP
 *   await upnp.close(8000);           // 用完删掉映射
 *
 * 所有操作都带超时，路由器不支持时会在几秒内返回失败，不会卡住。
 */
const dgram = require('dgram');
const http = require('http');
const os = require('os');

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;
const SEARCH_TARGETS = [
  'urn:schemas-upnp-org:device:InternetGatewayDevice:1',
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANPPPConnection:1'
];

function localIPv4() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const info of ifs[name] || []) {
      if (info.family === 'IPv4' && !info.internal && !/^169\.254\./.test(info.address)) return info.address;
    }
  }
  return '127.0.0.1';
}

function httpGet(url, timeout) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    });
    req.setTimeout(timeout || 3000, () => { try { req.destroy(); } catch (e) {} finish(null); });
    req.on('error', () => finish(null));
  });
}

/** 发 SSDP 搜索，收集路由器回的 LOCATION */
function discover(timeout) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      try { sock.close(); } catch (e) {}
      resolve(Array.from(found.values()));
    };
    sock.on('message', (msg) => {
      const text = msg.toString('utf8');
      const m = text.match(/LOCATION:\s*(\S+)/i);
      if (m) found.set(m[1], m[1]);
    });
    sock.on('error', finish);
    sock.bind(() => {
      try {
        for (const st of SEARCH_TARGETS) {
          const req = 'M-SEARCH * HTTP/1.1\r\n' +
            'HOST: ' + SSDP_ADDR + ':' + SSDP_PORT + '\r\n' +
            'MAN: "ssdp:discover"\r\n' +
            'MX: 2\r\n' +
            'ST: ' + st + '\r\n\r\n';
          sock.send(Buffer.from(req), 0, req.length, SSDP_PORT, SSDP_ADDR);
        }
      } catch (e) { finish(); }
    });
    setTimeout(finish, timeout || 3500);
  });
}

/** 从设备描述里找出 WAN 连接服务的控制地址 */
async function findService(descUrls) {
  for (const url of descUrls) {
    const xml = await httpGet(url, 3000);
    if (!xml) continue;
    const base = url.replace(/\/[^/]*$/, '/');
    // 同时兼容 WANIPConnection 和 WANPPPConnection
    const svcRe = /<service>[\s\S]*?<\/service>/g;
    const blocks = xml.match(svcRe) || [];
    for (const b of blocks) {
      if (!/WAN(IP|PPP)Connection/i.test(b)) continue;
      const type = (b.match(/<serviceType>([^<]+)<\/serviceType>/) || [])[1];
      const ctrl = (b.match(/<controlURL>([^<]+)<\/controlURL>/) || [])[1];
      if (!type || !ctrl) continue;
      return { serviceType: type, controlURL: ctrl.indexOf('http') === 0 ? ctrl : base + ctrl.replace(/^\//, ''), descUrl: url };
    }
  }
  return null;
}

function soap(ctrlUrl, serviceType, action, inner, timeout) {
  const body = '<?xml version="1.0"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    '<s:Body><u:' + action + ' xmlns:u="' + serviceType + '">' + inner + '</u:' + action + '></s:Body></s:Envelope>';
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let u;
    try { u = new URL(ctrlUrl); } catch (e) { return finish(null); }
    const req = http.request({
      host: u.hostname, port: u.port || 80, path: u.pathname + (u.search || ''), method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset="utf-8"', 'Content-Length': Buffer.byteLength(body),
                 SOAPAction: '"' + serviceType + '#' + action + '"', Connection: 'close' }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => finish({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(timeout || 4000, () => { try { req.destroy(); } catch (e) {} finish(null); });
    req.on('error', () => finish(null));
    req.write(body);
    req.end();
  });
}

async function gateway() {
  const urls = await discover();
  if (!urls.length) return null;
  return await findService(urls);
}

/** 打开端口映射。返回 {ok, externalIP, message} */
async function open(port, opts) {
  opts = opts || {};
  const gw = await gateway();
  if (!gw) return { ok: false, message: '路由器没有回应 UPnP（可能没开 UPnP，需要手动设置端口映射）' };
  const ipRes = await soap(gw.controlURL, gw.serviceType, 'GetExternalIPAddress', '', 4000);
  let externalIP = null;
  if (ipRes && ipRes.body) {
    const m = ipRes.body.match(/<NewExternalIPAddress>([^<]*)<\/NewExternalIPAddress>/);
    if (m) externalIP = m[1];
  }
  const inner = '<NewRemoteHost></NewRemoteHost>' +
    '<NewExternalPort>' + port + '</NewExternalPort>' +
    '<NewProtocol>TCP</NewProtocol>' +
    '<NewInternalPort>' + port + '</NewInternalPort>' +
    '<NewInternalClient>' + (opts.ip || localIPv4()) + '</NewInternalClient>' +
    '<NewEnabled>1</NewEnabled>' +
    '<NewPortMappingDescription>zhuanzhuan-mahjong</NewPortMappingDescription>' +
    '<NewLeaseDuration>0</NewLeaseDuration>';
  const res = await soap(gw.controlURL, gw.serviceType, 'AddPortMapping', inner, 5000);
  if (res && res.status === 200) return { ok: true, externalIP: externalIP, message: '端口映射已建立' };
  const err = res && res.body ? ((res.body.match(/<errorDescription>([^<]*)</) || [])[1] || res.body.slice(0, 120)) : '没有回应';
  return { ok: false, externalIP: externalIP, message: '映射失败：' + err };
}

async function close(port) {
  const gw = await gateway();
  if (!gw) return false;
  const inner = '<NewRemoteHost></NewRemoteHost><NewExternalPort>' + port +
    '</NewExternalPort><NewProtocol>TCP</NewProtocol>';
  const res = await soap(gw.controlURL, gw.serviceType, 'DeletePortMapping', inner, 4000);
  return !!(res && res.status === 200);
}

module.exports = { open, close, gateway, discover, externalIP: async () => {
  const gw = await gateway();
  if (!gw) return null;
  const r = await soap(gw.controlURL, gw.serviceType, 'GetExternalIPAddress', '', 4000);
  const m = r && r.body ? r.body.match(/<NewExternalIPAddress>([^<]*)<\/NewExternalIPAddress>/) : null;
  return m ? m[1] : null;
} };
