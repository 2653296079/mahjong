/* 转转麻将 · 手机访问用迷你静态服务器（零依赖，只需 Node）
 * 用法：双击「启动手机服务器.bat」，或 node server.js 8000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const online = require('./server/mjs-server');   // 联机房间（WebSocket）

const port = Number(process.argv[2] || 8000);
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

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch (e) {
    urlPath = '/';
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
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache'
    });
    res.end(req.method === 'HEAD' ? undefined : data);
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
const hub = online.attach(server);

server.listen(port, '0.0.0.0', () => {
  const ips = localIPs();
  console.log('');
  console.log('=========================================================');
  console.log('  Zhuanzhuan Mahjong - phone server is running');
  console.log('=========================================================');
  console.log('');
  console.log('  On your phone (same Wi-Fi), open Safari/Chrome and go to:');
  console.log('');
  if (ips.length) {
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

process.on('SIGINT', () => {
  try { hub.close(); } catch (e) {}
  process.exit(0);
});
