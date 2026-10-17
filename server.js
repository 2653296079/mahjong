/* 转转麻将 · 手机访问用迷你静态服务器（零依赖，只需 Node）
 * 用法：双击「启动手机服务器.bat」，或 node server.js 8000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const online = require('./server/mjs-server');   // 联机房间（WebSocket）
const { gzip } = require('node:zlib');
const { loadCore } = require('./server/rooms');

const port = Number(process.argv[2] || 8000);
const bindHost=process.env.MAHJONG_HOST||'0.0.0.0';
const root = __dirname;
const GAME = 'index.html';
const PUBLIC_FILES = new Set([GAME, 'sw.js', 'manifest.webmanifest', 'icon-512.png']);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

function localIPs() {
  const out = [];
  const ifs = os.networkInterfaces();
  Object.keys(ifs).forEach((name) => {
    (ifs[name] || []).forEach((info) => {
      if (info.family === 'IPv4' && !info.internal) out.push({ name, ip: info.address });
    });
  });
  return out;
}

function acceptsGzip(header) {
  const choices = String(header || '').split(',').map(item => {
    const parts = item.trim().toLowerCase().split(';'), q = parts.slice(1).find(p => /^\s*q\s*=/.test(p));
    const quality = q == null ? 1 : Number(q.split('=')[1].trim());
    return { coding:parts[0].trim(), quality:Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0 };
  });
  const explicit = choices.find(c => c.coding === 'gzip'), wildcard = choices.find(c => c.coding === '*');
  return (explicit || wildcard || {quality:0}).quality > 0;
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch (e) {
    urlPath = '/';
  }
  if(urlPath==='/healthz' && (req.method==='GET'||req.method==='HEAD')){
    const core=loadCore();
    const body=JSON.stringify({status:'ok',rulesVersion:core.rulesVersion,analysisVersion:core.analysisVersion,questionVersion:core.questionVersion,...hub.stats()});
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Length':Buffer.byteLength(body)});
    res.end(req.method==='HEAD'?undefined:body);return;
  }
  if (urlPath === '/' || urlPath === '/game' || urlPath === '/index.html') urlPath = '/' + GAME;
  const file = path.resolve(root, '.' + urlPath);
  const relative = path.relative(root, file);
  if (!PUBLIC_FILES.has(relative)) {
    res.writeHead(404); res.end('not found'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + urlPath);
      return;
    }
    const extension = path.extname(file).toLowerCase(), compressible = ['.html','.js','.webmanifest'].includes(extension);
    const headers = { 'Content-Type':MIME[extension] || 'application/octet-stream', 'Cache-Control':'no-cache' };
    if (compressible) headers.Vary = 'Accept-Encoding';
    function reply(body, compressed) {
      if (compressed) headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = body.length;
      res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : body);
    }
    if (compressible && data.length >= 1024 && acceptsGzip(req.headers['accept-encoding'])) {
      gzip(data, {level:6}, (error, packed) => reply(!error && packed.length < data.length ? packed : data, !error && packed.length < data.length));
    } else reply(data, false);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('');
    console.log('[ERROR] Port ' + port + ' is busy. Try:  node server.js 8080');
  } else {
    console.log('[ERROR] ' + e.message);
  }
  console.log('');
  process.exit(1);
});

// 联机：同一个端口上同时提供页面和 WebSocket，大家用浏览器打开同一个地址就能一起打
const limits={};
for(const [key,envName]of Object.entries({maxSessions:'MAHJONG_MAX_SESSIONS',maxRooms:'MAHJONG_MAX_ROOMS',messageRate:'MAHJONG_MESSAGE_RATE',messageBurst:'MAHJONG_MESSAGE_BURST'})){
  if(process.env[envName]!==undefined)limits[key]=Number(process.env[envName]);
}
const hub = online.attach(server,{limits});

server.listen(port, bindHost, () => {
  const ips = localIPs();
  console.log('');
  console.log('=========================================================');
  console.log('  Zhuanzhuan Mahjong - phone server is running');
  console.log('=========================================================');
  console.log('');
  console.log('  On your phone (same Wi-Fi), open Safari/Chrome and go to:');
  console.log('');
  if(bindHost==='127.0.0.1'||bindHost==='::1'){
    console.log('      http://'+(bindHost==='::1'?'[::1]':bindHost)+':'+port+'/');
  } else if (ips.length) {
    ips.forEach((i) => console.log('      http://' + i.ip + ':' + port + '/          <- ' + i.name));
    console.log('');
    console.log('  If the phone cannot open it:');
    console.log('    1) make sure phone and PC are on the SAME Wi-Fi');
    console.log('    2) allow this program in the Windows Firewall popup');
    console.log('    3) turn off the PC VPN / proxy if any');
  } else {
    console.log('      (no LAN IP found - check your network connection)');
  }
  console.log('');
  console.log('  Multiplayer: everyone opens the SAME address above,');
  console.log('               then taps 联机 -> 进房间 with the same room number.');
  console.log('               Empty seats are filled by computer players.');
  console.log('');
  console.log('  Tip (iPhone): Safari -> Share -> Add to Home Screen');
  console.log('                then it runs fullscreen like a native app.');
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});

let stopping=false;
function stop() {
  if(stopping)return;stopping=true;
  try { hub.close(); } catch (e) {}
  server.close(()=>process.exit(0));
  const deadline=setTimeout(()=>process.exit(1),5000);deadline.unref();
}
process.on('SIGINT',stop);
process.on('SIGTERM',stop);
