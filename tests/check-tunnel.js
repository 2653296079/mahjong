'use strict';
/**
 * check-tunnel.js —— 验证「朋友能不能连上你」。
 *
 * 用法：node tests/check-tunnel.js cn-xx.natfrp.cloud:12345
 *       node tests/check-tunnel.js            （不给参数就读环境变量 NATFRP_地址）
 *
 * 它会做两件事，和朋友的浏览器做的事完全一样：
 *   1. 拉一次首页，确认返回的是麻将页面
 *   2. 建立 WebSocket 连接、进房间、开局，确认拿到自己的手牌且看不到对手暗牌
 */
const target = (process.argv[2] || process.env.TUNNEL || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
if (!target) {
  console.log('用法：node tests/check-tunnel.js cn-xx.natfrp.cloud:12345');
  process.exit(1);
}
const httpUrl = 'http://' + target + '/';
const wsUrl = 'ws://' + target + '/ws';

function pageCheck() {
  return new Promise((resolve) => {
    const req = require('http').get(httpUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, ok: /转转麻将/.test(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.setTimeout(20000, () => { try { req.destroy(); } catch (e) {} resolve({ status: 0, ok: false }); });
    req.on('error', (e) => resolve({ status: 0, ok: false, err: e.message }));
  });
}

function wsCheck() {
  return new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket(wsUrl); } catch (e) { return resolve({ ok: false, why: e.message }); }
    const timer = setTimeout(() => { try { ws.close(); } catch (e) {} resolve({ ok: false, why: '20 秒没响应' }); }, 20000);
    const done = (v) => { clearTimeout(timer); try { ws.close(); } catch (e) {} resolve(v); };
    ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'join', room: '8888', name: '外网探针', create: true })));
    ws.addEventListener('error', () => done({ ok: false, why: 'WebSocket 连不上' }));
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'err') done({ ok: false, why: '服务器返回错误：' + m.msg });
      if (m.t === 'joined') ws.send(JSON.stringify({ t: 'start' }));
      if (m.t === 'state' && m.hand && m.hand.mine) {
        done({
          ok: true,
          seat: m.you.seat,
          tiles: m.hand.mine.concealed.reduce((a, b) => a + b, 0),
          opponentsHidden: m.hand.players.every((p) => p.concealed === undefined),
          botSeats: m.room.seats.filter((s) => s && !s.isHuman).length,
          queue: m.room.queue.length
        });
      }
    });
  });
}

(async () => {
  console.log('=== 检查 ' + target + ' ===');
  const p = await pageCheck();
  console.log('1) 首页：' + (p.ok ? '正常（HTTP ' + p.status + '）' : '取不到或内容不对（HTTP ' + p.status + (p.err ? ' ' + p.err : '') + '）'));
  if (!p.ok) {
    console.log('   → 隧道没起来，或者游戏服务器没在跑。确认 公网联机-樱花frp.bat 的窗口还开着。');
    process.exit(1);
  }
  const w = await wsCheck();
  console.log('2) 联机：' + (w.ok ? '正常（座位 ' + w.seat + '，手牌 ' + w.tiles + ' 张，电脑 ' + w.botSeats + ' 个，等待区 ' + w.queue + ' 人，对手暗牌隐藏=' + w.opponentsHidden + '）' : '失败：' + w.why));
  if (!w.ok) process.exit(2);
  console.log('');
  console.log('✅ 外网可以正常一起打。把这个地址发给朋友：http://' + target + '/');
})();
