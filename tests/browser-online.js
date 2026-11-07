'use strict';
/**
 * 联机的真实浏览器测试（可选，需要本机装了 Edge）。
 *
 *   node tests/browser-online.js            跑联机流程，打印结论
 *   node tests/browser-online.js --shot     只截一张单机画面，检查有没有画崩
 *
 * 它会在同一个端口上同时提供页面和联机服务，然后用无头 Edge 打开
 * tests/browser-online.html：那个页面里有两个 iframe，各自是一个真实的游戏客户端，
 * 脚本会替它们点「联机 → 进房间 → 开始对局 → 出牌」，直到打完一局。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8123);
const SHOT = process.argv.indexOf('--shot') >= 0;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'zmj-online-test-'));
// 临时配置目录必须自清理（曾泄漏把 C 盘写满）：启动清超过 1 天的旧目录，退出删本次目录。
const PROFILE_TTL = 24 * 60 * 60 * 1000;
try {
  const tmp = os.tmpdir(), now = Date.now();
  for (const name of fs.readdirSync(tmp)) {
    if (!name.startsWith('zmj-online-test-')) continue;
    const full = path.join(tmp, name);
    if (full === PROFILE) continue;
    try {
      if (now - fs.statSync(full).mtimeMs > PROFILE_TTL) fs.rmSync(full, { recursive: true, force: true });
    } catch (e) {}
  }
} catch (e) {}
// Edge 子进程 kill 后句柄不会立刻释放，删目录要带重试，否则 rmSync 静默失败留下残留。
const dropProfile = () => {
  for (let attempt = 0; attempt < 20; attempt++) {
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
    if (!fs.existsSync(PROFILE)) return;
    try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); } catch (e) {
      const until = Date.now() + 100; while (Date.now() < until) {}
    }
  }
};
process.on('exit', dropProfile);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => { dropProfile(); process.exit(1); });
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium'
];
const EDGE = EDGE_CANDIDATES.filter((p) => fs.existsSync(p))[0];
if (!EDGE) { console.log('没找到 Edge/Chrome，跳过浏览器测试'); process.exit(0); }

const online = require(path.join(ROOT, 'server', 'mjs-server.js'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
               '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

let result = null;
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/__result') {
    result = decodeURIComponent((req.url.split('?d=')[1] || ''));
    res.writeHead(200); res.end('ok');
    return;
  }
  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain; charset=utf-8' });
  res.end(fs.readFileSync(file));
});
online.attach(server);

server.listen(PORT, '127.0.0.1', () => {
  const base = 'http://127.0.0.1:' + PORT;
  const common = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                  '--user-data-dir=' + PROFILE];
  if (SHOT) {
    const shot = path.join(ROOT, 'tests', 'shot-single.png');
    execFile(EDGE, common.concat(['--window-size=460,900', '--screenshot=' + shot, base + '/index.html']),
      { timeout: 60000 }, (err) => {
        console.log(fs.existsSync(shot) ? '截图已保存：' + shot : '截图失败：' + (err && err.message));
        server.close(); process.exit(0);
      });
    return;
  }
  console.log('测试服务器：' + base);
  const child = execFile(EDGE, common.concat([base + '/tests/browser-online.html']),
    { timeout: 120000 }, () => {});
  const t0 = Date.now();
  const poll = setInterval(() => {
    if (result) {
      clearInterval(poll);
      console.log('=== 浏览器联机测试结果 ===');
      console.log(result);
      let ok = false;
      try { ok = JSON.parse(result).ok === true; } catch (e) {}
      try { child.kill(); } catch (e) {}
      server.close();
      process.exit(ok ? 0 : 1);
    }
    if (Date.now() - t0 > 110000) {
      clearInterval(poll);
      console.log('=== 超时：没拿到结果 ===');
      try { child.kill(); } catch (e) {}
      process.exit(1);
    }
  }, 500);
});
