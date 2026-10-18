'use strict';
/**
 * 模拟 GitHub Pages：只做静态托管，没有 WebSocket 服务器。
 * 验证两件事：单机部分完全正常；点「联机」时优雅失败而不是崩页面。
 * 运行：node tests/pages-compat.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8171);
// 可指定要跑的测试页：node tests/pages-compat.js coach-advice
const ARGS = process.argv.slice(2);
const PAGE = (ARGS.filter((a) => a.indexOf('--') !== 0)[0] || 'pages-compat').replace(/\.html$/, '');
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'zmj-pages-test-'));
const WITH_HUB = ARGS.indexOf('--hub') >= 0;   // 需要联机时才接上 WebSocket 服务
const ACCOUNTS = ARGS.includes('--accounts') ? new (require('../server/account-store').AccountStore)(':memory:') : null;
const accountAPI = ACCOUNTS ? require('../server/account-api').createAccountAPI(ACCOUNTS) : null;
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
              'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
              '/usr/bin/google-chrome', '/usr/bin/chromium'].filter((p) => fs.existsSync(p))[0];
if (!EDGE) { console.log('没找到 Edge/Chrome，跳过'); process.exit(0); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
               '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let result = null;

// 注意：这里刻意不接联机服务，只有静态文件 + 测试回传通道
const server = http.createServer(async (req, res) => {
  if (accountAPI && req.url.startsWith('/api/')) { await accountAPI(req,res); return; }
  const url = req.url.split('?')[0];
  if (url === '/__result') {
    result = decodeURIComponent((req.url.split('?d=')[1] || ''));
    res.writeHead(200); res.end('ok'); return;
  }
  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

let hub = null;
if (WITH_HUB || ACCOUNTS) hub = require(path.join(ROOT, 'server', 'mjs-server.js')).attach(server,{accounts:ACCOUNTS});

server.listen(PORT, '127.0.0.1', () => {
  const base = 'http://127.0.0.1:' + PORT;
  console.log((WITH_HUB || ACCOUNTS ? '带联机服务的服务器' : '纯静态服务器') + ': ' + base + '  测试页: tests/' + PAGE + '.html');
  if (hub) {
    // 造一个「开局后人都走光」的废弃房，验证它不会出现在房间里列表
    const ghost = hub.store.create('9999');
    const g = ghost.join('幽灵');
    g.conn = { send() {} };
    ghost.start();
    g.conn = null;
    console.log('已造废弃房 9999（开局后无人）');
  }
  const child = execFile(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    ...(PAGE==='table-3d-ui'?['--enable-unsafe-swiftshader','--use-angle=swiftshader']:[]),
    ...(['selection-ui','river-hover-ui'].includes(PAGE) ? ['--touch-events=enabled'] : []),
    '--user-data-dir=' + PROFILE,
    base + '/tests/' + PAGE + '.html'], { timeout: 120000 }, () => {});
  const t0 = Date.now();
  const poll = setInterval(() => {
    if (result) {
      clearInterval(poll);
      console.log('=== Pages 兼容性结果 ===');
      console.log(result);
      let ok = false;
      try { ok = JSON.parse(result).ok === true; } catch (e) {}
      try { child.kill(); } catch (e) {}
      if (hub) hub.close(); if (ACCOUNTS) ACCOUNTS.close();
      server.close();
      process.exit(ok ? 0 : 1);
    }
    if (Date.now() - t0 > 100000) {
      clearInterval(poll);
      console.log('=== 超时 ===');
      try { child.kill(); } catch (e) {}
      process.exit(1);
    }
  }, 500);
});
