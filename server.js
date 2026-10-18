/* 转转麻将 · 手机访问用迷你静态服务器（零依赖，只需 Node）
 * 用法：双击「启动手机服务器.bat」，或 node server.js 8000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const online = require('./server/mjs-server');   // 联机房间（WebSocket）
const { OnlineService } = require('./server/online-service');
const { gzip } = require('node:zlib');
const { loadCore } = require('./server/rooms');
const { AccountStore } = require('./server/account-store');
const { createAccountAPI } = require('./server/account-api');
const accounts = new AccountStore(process.env.MAHJONG_DB_PATH || path.join(__dirname, 'data', 'mahjong.sqlite'));
const accountAPI = createAccountAPI(accounts);

const port = Number(process.argv[2] || 8000);
const bindHost=process.env.MAHJONG_HOST||'0.0.0.0';
const root = __dirname;
const GAME = 'index.html';
const PUBLIC_FILES = new Set([GAME, 'sw.js', 'manifest.webmanifest', 'icon-512.png']);
PUBLIC_FILES.add('assets/table3d/table3d.js');
for (const file of ['three.module.js','three.core.min.js','GLTFLoader.js','BufferGeometryUtils.js','RoomEnvironment.js']) PUBLIC_FILES.add('assets/vendor/three/'+file);
for (const suit of ['wan','suo','tong']) for(let rank=1;rank<=9;rank++) PUBLIC_FILES.add('assets/mahjong-3d/glb/tiles/'+suit+'-'+String(rank).padStart(2,'0')+'.glb');
for (const file of ['mahjong-table','tile-back','dice','dealer-marker']) PUBLIC_FILES.add('assets/mahjong-3d/glb/'+file+'.glb');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
  , '.glb': 'model/gltf-binary'
};

function acceptsGzip(header) {
  const choices = String(header || '').split(',').map(item => {
    const parts = item.trim().toLowerCase().split(';'), q = parts.slice(1).find(p => /^\s*q\s*=/.test(p));
    const quality = q == null ? 1 : Number(q.split('=')[1].trim());
    return { coding:parts[0].trim(), quality:Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0 };
  });
  const explicit = choices.find(c => c.coding === 'gzip'), wildcard = choices.find(c => c.coding === '*');
  return (explicit || wildcard || {quality:0}).quality > 0;
}

const server = http.createServer(async (req, res) => {
  if (String(req.url||'').split('?')[0]==='/api/lobby' && req.method==='GET') {
    const body=JSON.stringify(hub.stats());res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Length':Buffer.byteLength(body)});res.end(body);return;
  }
  if ((req.url || '').startsWith('/api/')) { await accountAPI(req, res); return; }
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch (e) {
    urlPath = '/';
  }
  if(urlPath==='/healthz' && (req.method==='GET'||req.method==='HEAD')){
    const core=loadCore();
    const body=JSON.stringify({status:'ok',app:'zhuanzhuan-mahjong',build:'v31',rulesVersion:core.rulesVersion,analysisVersion:core.analysisVersion,questionVersion:core.questionVersion,...hub.stats()});
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Length':Buffer.byteLength(body)});
    res.end(req.method==='HEAD'?undefined:body);return;
  }
  if (urlPath === '/' || urlPath === '/game' || urlPath === '/index.html') urlPath = '/' + GAME;
  const file = path.resolve(root, '.' + urlPath);
  const relative = path.relative(root, file).split(path.sep).join('/');
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
// :memory: 仅用于原有单进程测试；正式文件数据库支持独立联机进程按需启动。
const hub = process.env.MAHJONG_DB_PATH===':memory:' ? online.attach(server,{limits,accounts}) : new OnlineService({limits,log:message=>process.stderr.write(message)});
if (hub instanceof OnlineService) server.on('upgrade',(req,socket,head)=>{hub.upgrade(req,socket,head);});

server.listen(port, bindHost, () => {
  console.log('转转麻将服务入口已就绪：http://127.0.0.1:'+port+'/?online=1');
  console.log('联机服务按需自动启动；玩家打开统一网站进入大厅即可。');
  console.log('按 Ctrl+C 停止入口和联机服务。');
});

let stopping=false;
async function stop() {
  if(stopping)return;stopping=true;
  const deadline=setTimeout(()=>process.exit(1),6500);deadline.unref();
  try { await hub.close(); } catch (e) {}
  server.close(()=>{try { accounts.close(); } catch(e) {} process.exit(0);});
}
process.on('SIGINT',stop);
process.on('SIGTERM',stop);
