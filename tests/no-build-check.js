'use strict';
/**
 * no-build-check.js —— 守住两条底线：
 *   1. 页面自包含：不加载任何外部资源（离线可用、GitHub Pages 直接能跑）
 *   2. 零依赖：不 require 任何非 Node 内置模块，没有 package.json / node_modules
 * 运行：node tests/no-build-check.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const problems = [];

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 1) 会真的发起网络请求的属性（<a href> 是超链接，不算）
const loaders = html.match(/<(?:script|link|img|iframe|source|audio|video)\b[^>]*\b(?:src|href)\s*=\s*["'](?:https?:)?\/\/[^"']+/gi) || [];
if (loaders.length) problems.push('页面会从外部加载资源：' + loaders.slice(0, 3).join(' | '));
if (/@import\s/i.test(html)) problems.push('样式里有 @import');
const cssUrl = html.match(/url\(\s*["']?(?:https?:)?\/\//gi) || [];
if (cssUrl.length) problems.push('样式里有外部 url()：' + cssUrl.length + ' 处');

// 2) 所有 script 必须内联
const tags = html.match(/<script\b[^>]*>/gi) || [];
const external = tags.filter((t) => /\bsrc=/i.test(t));
if (external.length) problems.push('存在外链 script：' + external.join(', '));

// 3) 页面里不能出现 require / import
if (/\brequire\s*\(/.test(html)) problems.push('页面里出现 require()');
if (/^\s*import\s+[\w{*]/m.test(html)) problems.push('页面里出现 import 语句');

// 4) 不能有 package.json / node_modules
if (fs.existsSync(path.join(ROOT, 'package.json'))) problems.push('出现了 package.json（项目不该有构建步骤）');
if (fs.existsSync(path.join(ROOT, 'node_modules'))) problems.push('出现了 node_modules');

// 5) 服务端只能用 Node 内置模块
const BUILTIN = new Set(['http', 'https', 'fs', 'path', 'os', 'crypto', 'events', 'dgram', 'net', 'url',
  'child_process', 'assert', 'vm', 'readline', 'util', 'stream', 'zlib', 'buffer', 'worker_threads', 'test']);
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    if (f === '.git' || f === '_edgeprofile' || f === 'node_modules') continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { walk(p); continue; }
    if (/\.js$/.test(f)) files.push(p);
  }
})(ROOT);
for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(txt))) {
    const name = m[1];
    if (name.startsWith('.') || name.startsWith('node:')) continue;
    if (BUILTIN.has(name)) continue;
    problems.push(path.relative(ROOT, f) + ' 依赖了非内置模块：' + name);
  }
}

// 6) sw.js 列的资源都要存在
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const list = (((sw.match(/var ASSETS = \[([^\]]+)\]/) || [])[1]) || '')
  .split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
for (const a of list) {
  if (a === './') continue;
  if (!fs.existsSync(path.join(ROOT, a.replace(/^\.\//, '')))) problems.push('sw.js 列了不存在的文件：' + a);
}

console.log('内联 script：' + tags.length + ' 个，外链：' + external.length + ' 个');
console.log('检查了 ' + files.length + ' 个 js 文件的依赖');
console.log('sw 缓存：' + ((sw.match(/var CACHE = '([^']+)'/) || [])[1] || '?') + '，资源 ' + list.length + ' 项');
console.log('');
if (problems.length) {
  console.log('未通过：');
  problems.forEach((p) => console.log(' - ' + p));
  process.exit(1);
}
console.log('通过：页面自包含、零依赖、无构建步骤、离线资源齐全');
