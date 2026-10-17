'use strict';
// 冒烟测试真正的入口 server.js：HTTP 页面 + /ws 联机是否都能用
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PORT = 8137;
const child = spawn(process.execPath, ['server.js', String(PORT)], { cwd: ROOT, env: {...process.env, MAHJONG_DB_PATH:':memory:'} });
let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function get(url, headers, method) {
  return new Promise((resolve, reject) => {
    http.get(url, {headers, method:method || 'GET'}, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ code: res.statusCode, body: Buffer.concat(chunks), type: res.headers['content-type'], headers:res.headers }));
    }).on('error', reject);
  });
}
(async () => {
  const problems = [];
  try {
    await sleep(1200);
    const page = await get('http://127.0.0.1:' + PORT + '/');
    if (page.code !== 200) problems.push('首页状态码 ' + page.code);
    if (!/转转麻将/.test(page.body.toString('utf8'))) problems.push('首页内容不对');
    const packed=await get('http://127.0.0.1:'+PORT+'/',{'Accept-Encoding':'gzip'});
    if(packed.headers['content-encoding']!=='gzip'||packed.headers.vary!=='Accept-Encoding')problems.push('首页压缩协商头不正确');
    else if(!require('node:zlib').gunzipSync(packed.body).equals(page.body))problems.push('压缩解码后页面内容变化');
    if(packed.body.length>=page.body.length*.4)problems.push('首页压缩后未达到体积预算');
    const noGzip=await get('http://127.0.0.1:'+PORT+'/',{'Accept-Encoding':'gzip;q=0, *;q=1'});
    if(noGzip.headers['content-encoding']||!noGzip.body.equals(page.body))problems.push('显式禁止 gzip 没有被遵守');
    const head=await get('http://127.0.0.1:'+PORT+'/',{'Accept-Encoding':'gzip'},'HEAD');
    if(head.body.length||Number(head.headers['content-length'])!==packed.body.length||head.headers['content-encoding']!=='gzip')problems.push('HEAD 的压缩元数据与 GET 不一致');
    const icon=await get('http://127.0.0.1:'+PORT+'/icon-512.png',{'Accept-Encoding':'gzip'});
    if(icon.headers['content-encoding'])problems.push('已压缩图片不应再次压缩');
    console.log('首页压缩体积：'+page.body.length+' → '+packed.body.length+' 字节');
    const js = await get('http://127.0.0.1:' + PORT + '/server/rooms.js');
    if (js.code !== 404) problems.push('服务端源码不该被公开访问，实际 ' + js.code);
    const db=await get('http://127.0.0.1:'+PORT+'/data/mahjong.sqlite');
    if(db.code!==404)problems.push('账号数据库不该被公开访问');
    const sw = await get('http://127.0.0.1:' + PORT + '/sw.js');
    if (sw.code !== 200) problems.push('sw.js 应该可访问');
    const health=await get('http://127.0.0.1:'+PORT+'/healthz');
    const healthBody=JSON.parse(health.body);
    if(health.code!==200||healthBody.status!=='ok'||healthBody.questionVersion!=='lessons-v3')problems.push('健康检查缺少正确版本');
    if(/token|concealed|birds/.test(health.body.toString()))problems.push('健康检查包含私密字段');

    // 联机：真 WebSocket 客户端
    const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/ws');
    const msgs = [];
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('WebSocket 连不上')), { once: true });
      setTimeout(() => reject(new Error('WebSocket 连接超时')), 5000);
    });
    ws.addEventListener('message', (e) => msgs.push(JSON.parse(e.data)));
    ws.send(JSON.stringify({ t: 'join', room: '4242', name: '冒烟', create: true }));
    await sleep(700);
    const joined = msgs.find((m) => m.t === 'joined');
    if (!joined) problems.push('没能进房间');
    ws.send(JSON.stringify({ t: 'start' }));
    await sleep(900);
    const st = msgs.filter((m) => m.t === 'state').pop();
    if (!st) problems.push('开局后没收到状态');
    else {
      if (!st.hand) problems.push('状态里没有牌局');
      else {
        if (!st.hand.mine) problems.push('没拿到自己的暗牌');
        if (st.hand.players.some((p) => p.concealed !== undefined)) problems.push('对手暗牌字段出现在状态里');
        if (st.room.queue.length !== 2) problems.push('等待区电脑数量不对：' + st.room.queue.length);
      }
    }
    ws.close();
    if (!/联机服务按需自动启动/.test(out)) problems.push('启动提示缺少自动联机说明');
  } catch (e) {
    problems.push('异常：' + e.message);
  }
  console.log(problems.length ? '冒烟测试失败:\n - ' + problems.join('\n - ') : '冒烟测试通过：首页 / 静态资源白名单 / 联机房间 全部正常');
  try { child.kill(); } catch (e) {}
  process.exit(problems.length ? 1 : 0);
})();
