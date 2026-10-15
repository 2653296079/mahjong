'use strict';
/**
 * check-public.js —— 从外网确认「朋友能不能连上你」。
 *
 * 它做三件事：
 *   1. 查出你的公网 IP（走国内接口）
 *   2. 请外网的第三方服务扫这个 IP 的指定端口
 *   3. 如果端口开着，再真的拉一次游戏页面，确认返回的是麻将页面
 *
 * 用法：node tests/check-public.js [端口]
 */
const PORT = Number(process.argv[2] || 8000);

function get(url, timeout) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    const mod = url.indexOf('https:') === 0 ? require('https') : require('http');
    const req = mod.get(url, { headers: { 'User-Agent': 'curl/8' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => fin({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(timeout || 15000, () => { try { req.destroy(); } catch (e) {} fin(null); });
    req.on('error', () => fin(null));
  });
}

/** 问外网服务：这个 IP 的这个端口开着吗？返回 true/false，问不到返回 null */
function externalPortOpen(ip, port) {
  return new Promise((resolve) => {
    const body = 'remoteAddress=' + ip + '&portNumber=' + port;
    const post = require('https').request({
      host: 'ports.yougetsignal.com', path: '/check-port.php', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0',
                 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf8');
        if (/is open/i.test(html)) return resolve(true);
        if (/is closed/i.test(html)) return resolve(false);
        resolve(null);
      });
    });
    post.setTimeout(20000, () => { try { post.destroy(); } catch (e) {} resolve(null); });
    post.on('error', () => resolve(null));
    post.write(body);
    post.end();
  });
}

(async () => {
  console.log('=== 公网连通性检查（端口 ' + PORT + '）===');
  let ip = null;
  for (const u of ['http://members.3322.org/dyndns/getip', 'https://ip.3322.net']) {
    const r = await get(u, 8000);
    if (r && r.body) { ip = r.body.trim(); break; }
  }
  if (!ip) { console.log('取不到公网 IP，可能还没联网'); process.exit(1); }
  console.log('1) 你的公网 IP：' + ip);
  const privateLike = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[0-2]\d)\.)/.test(ip);
  console.log('   ' + (privateLike ? '⚠️ 这是内网/运营商大内网地址，端口映射做不了，需要找宽带客服要公网 IP'
                                   : '✅ 是标准公网地址，端口映射可以生效'));

  console.log('2) 请外网服务扫描该端口…');
  const open = await externalPortOpen(ip, PORT);
  if (open === null) {
    console.log('   扫描服务没回应。最简单的替代办法：手机关掉 Wi-Fi 用流量打开 http://' + ip + ':' + PORT + '/');
    process.exit(2);
  }
  console.log('   ' + (open ? '端口已开放' : '端口是关闭的'));

  if (!open) {
    console.log('3) 端口还没通。要做的事：');
    console.log('   - 浏览器打开 http://192.168.1.1 登录你的天翼网关（账号密码通常印在光猫背面）');
    console.log('   - 找到「端口映射 / 端口转发 / NAT」，添加一条：');
    console.log('       外部端口 ' + PORT + ' → 内部地址 192.168.1.3 → 内部端口 ' + PORT + ' → 协议 TCP');
    console.log('   - 保存后重新跑一次本脚本');
    process.exit(3);
  }
  console.log('3) 端口已开放，试着取游戏页面…');
  const page = await get('http://' + ip + ':' + PORT + '/', 15000);
  if (page && /转转麻将/.test(page.body)) {
    console.log('   ✅ 成功！把这个地址发给朋友即可：http://' + ip + ':' + PORT + '/');
    console.log('   （在页面上点「联机」→ 填名字 → 开始对局）');
  } else {
    console.log('   ⚠️ 端口通了但页面不对（' + (page ? 'HTTP ' + page.status : '取不到') + '），确认 node server.js 正在运行');
  }
  process.exit(0);
})();
