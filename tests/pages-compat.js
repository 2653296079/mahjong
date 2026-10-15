'use strict';
/**
 * 模拟 GitHub Pages：只做静态托管，没有 WebSocket 服务器。
 * 验证两件事：单机部分完全正常；点「联机」时优雅失败而不是崩页面。
 * 运行：node tests/pages-compat.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8171);
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
              'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
              '/usr/bin/google-chrome', '/usr/bin/chromium'].filter((p) => fs.existsSync(p))[0];
if (!EDGE) { console.log('没找到 Edge/Chrome，跳过'); process.exit(0); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
               '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let result = null;

// 注意：这里刻意不接联机服务，只有静态文件 + 测试回传通道
const server = http.createServer((req, res) => {
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

server.listen(PORT, '127.0.0.1', () => {
  const base = 'http://127.0.0.1:' + PORT;
  console.log('纯静态服务器（模拟 Pages）: ' + base);
  const child = execFile(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(__dirname, '_edgeprofile'),
    base + '/tests/pages-compat.html'], { timeout: 120000 }, () => {});
  const t0 = Date.now();
  const poll = setInterval(() => {
    if (result) {
      clearInterval(poll);
      console.log('=== Pages 兼容性结果 ===');
      console.log(result);
      let ok = false;
      try { ok = JSON.parse(result).ok === true; } catch (e) {}
      try { child.kill(); } catch (e) {}
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
