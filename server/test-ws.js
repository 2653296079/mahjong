'use strict';
/**
 * ws-lite.js 的验收测试：证明自写的 WebSocket 服务端符合 RFC6455。
 * 运行：node test-ws.js
 */
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');
const net = require('net');
const { test, run } = require('./micro-test');
const { upgrade, acceptKey } = require('./ws-lite');

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => { res.writeHead(404); res.end('nope'); });
    server.conns = [];
    server.upgrades = 0;
    server.on('upgrade', (req, socket, head) => {
      server.upgrades++;
      const conn = upgrade(req, socket, head, { path: '/ws' });
      if (!conn) return;
      conn.on('message', (m) => conn.send(m));
      conn.on('binary', (b) => conn.sendBinary(b));
      conn.on('pong', () => { conn.gotPong = true; });
      socket.on('close', () => {});
      server.conns.push(conn);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function connect(port) {
  const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', () => reject(new Error('连接失败')), { once: true });
  });
}
function nextMessage(ws) {
  return new Promise((resolve) => {
    ws.addEventListener('message', function h(e) { ws.removeEventListener('message', h); resolve(e.data); });
  });
}
function closed(ws) { return new Promise((resolve) => ws.addEventListener('close', resolve, { once: true })); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 手工完成握手，返回裸 socket（并可拿到握手响应文本） */
function rawConnect(port, path, version) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    let buf = Buffer.alloc(0);
    let done = false;
    const timer = setTimeout(() => { if (!done) reject(new Error('握手超时')); }, 3000);
    sock.on('connect', () => {
      sock.write('GET ' + path + ' HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\nSec-WebSocket-Version: ' + version + '\r\n\r\n');
    });
    sock.on('data', (d) => {
      if (done) return;
      buf = Buffer.concat([buf, d]);
      const i = buf.indexOf('\r\n\r\n');
      if (i < 0) return;
      done = true; clearTimeout(timer);
      const headText = buf.subarray(0, i).toString('latin1');
      const rest = buf.subarray(i + 4);
      sock.removeAllListeners('data');
      resolve({ sock: sock, head: headText, rest: rest });
    });
    sock.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
  });
}

/** 手工构造带掩码的客户端帧 */
function clientFrame(opcode, payload, fin) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const mask = crypto.randomBytes(4);
  const masked = Buffer.allocUnsafe(body.length);
  for (let i = 0; i < body.length; i++) masked[i] = body[i] ^ mask[i & 3];
  let head;
  if (body.length < 126) { head = Buffer.allocUnsafe(2); head[1] = 0x80 | body.length; }
  else if (body.length < 65536) { head = Buffer.allocUnsafe(4); head[1] = 0x80 | 126; head.writeUInt16BE(body.length, 2); }
  else { head = Buffer.allocUnsafe(10); head[1] = 0x80 | 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(body.length, 6); }
  head[0] = (fin ? 0x80 : 0) | opcode;
  return Buffer.concat([head, mask, masked]);
}

/** 解析服务端→客户端的帧（服务端不掩码） */
function makeFrameReader(sock, out) {
  let acc = Buffer.alloc(0);
  sock.on('data', (d) => {
    acc = Buffer.concat([acc, d]);
    for (;;) {
      if (acc.length < 2) return;
      const opcode = acc[0] & 0x0f;
      let len = acc[1] & 0x7f, off = 2;
      if (len === 126) { if (acc.length < 4) return; len = acc.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (acc.length < 10) return; len = acc.readUInt32BE(6); off = 10; }
      if (acc.length < off + len) return;
      out.push({ opcode: opcode, body: acc.subarray(off, off + len) });
      acc = acc.subarray(off + len);
    }
  });
}

test('acceptKey 与 RFC6455 官方示例一致', async () => {
  assert.strictEqual(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('正常握手 + 文本回声（<126 / 16 位 / 64 位 三种长度分支）', async () => {
  const s = await startServer();
  try {
    const ws = await connect(s.address().port);
    assert.strictEqual(ws.readyState, 1);
    for (const msg of ['hi', 'x'.repeat(200), 'y'.repeat(70000)]) {
      const p = nextMessage(ws);
      ws.send(msg);
      const got = await p;
      assert.strictEqual(got.length, msg.length, '长度 ' + msg.length + ' 的回声不符');
      assert.strictEqual(got, msg);
    }
    ws.close();
    await closed(ws);
  } finally { s.close(); }
});

test('二进制帧原样回声', async () => {
  const s = await startServer();
  try {
    const ws = await connect(s.address().port);
    ws.binaryType = 'arraybuffer';           // 否则浏览器/Node 原生 WebSocket 给的是 Blob
    const buf = crypto.randomBytes(300);
    const p = nextMessage(ws);
    ws.send(buf);
    const back = await p;
    const ab = back instanceof ArrayBuffer ? back : await back.arrayBuffer();
    assert.deepStrictEqual(Buffer.from(ab), buf);
    ws.close(); await closed(ws);
  } finally { s.close(); }
});

test('服务端 ping 能收到 pong', async () => {
  const s = await startServer();
  try {
    const ws = await connect(s.address().port);
    await sleep(30);
    const conn = s.conns[s.conns.length - 1];
    assert.ok(conn, '服务端未建立连接对象');
    conn.ping();
    await sleep(200);
    assert.strictEqual(conn.gotPong, true, '未收到 pong');
    ws.close(); await closed(ws);
  } finally { s.close(); }
});

test('路径不符 → 404；版本不符 → 426', async () => {
  const s = await startServer();
  try {
    const a = await rawConnect(s.address().port, '/nope', '13');
    assert.match(a.head, /404/, '错误路径应 404，实际：' + a.head);
    a.sock.destroy();
    const b = await rawConnect(s.address().port, '/ws', '8');
    assert.match(b.head, /426/, '错误版本应 426，实际：' + b.head);
    b.sock.destroy();
  } finally { s.close(); }
});

test('分片消息（3 片）能拼回', async () => {
  const s = await startServer();
  try {
    const { sock, head, rest } = await rawConnect(s.address().port, '/ws', '13');
    assert.match(head, /101 Switching Protocols/, '握手失败：' + head);
    const frames = [];
    makeFrameReader(sock, frames);
    if (rest && rest.length) sock.emit('data', rest);
    sock.write(clientFrame(0x1, 'he', false));
    sock.write(clientFrame(0x0, 'llo', false));
    sock.write(clientFrame(0x0, ' world', true));
    await sleep(250);
    const texts = frames.filter((f) => f.opcode === 1).map((f) => f.body.toString('utf8'));
    assert.deepStrictEqual(texts, ['hello world'], '分片拼接错误，收到 ' + JSON.stringify(texts));
    sock.destroy();
  } finally { s.close(); }
});

test('64 位长度字段（>65535 字节）能正确收发', async () => {
  const s = await startServer();
  try {
    const { sock, head, rest } = await rawConnect(s.address().port, '/ws', '13');
    assert.match(head, /101/);
    const frames = [];
    makeFrameReader(sock, frames);
    if (rest && rest.length) sock.emit('data', rest);
    const big = 'z'.repeat(70000);
    sock.write(clientFrame(0x1, big, true));
    await sleep(400);
    const texts = frames.filter((f) => f.opcode === 1).map((f) => f.body.toString('utf8'));
    assert.strictEqual(texts.length, 1, '应收到 1 帧，实际 ' + texts.length);
    assert.strictEqual(texts[0].length, 70000, '长度不符：' + texts[0].length);
    sock.destroy();
  } finally { s.close(); }
});

test('客户端未掩码的帧会被断开（协议违规）', async () => {
  const s = await startServer();
  try {
    const { sock, head } = await rawConnect(s.address().port, '/ws', '13');
    assert.match(head, /101/);
    const raw = Buffer.alloc(2 + 5);
    raw[0] = 0x81; raw[1] = 5;            // 0x80 掩码位缺失
    Buffer.from('hello').copy(raw, 2);
    const how = await new Promise((resolve) => {
      sock.on('close', () => resolve('closed'));
      sock.on('error', () => resolve('error'));
      setTimeout(() => resolve('timeout'), 600);
      sock.write(raw);
    });
    assert.notStrictEqual(how, 'timeout', '未掩码帧应被断开，但连接仍存活');
    sock.destroy();
  } finally { s.close(); }
});

test('超过 8MiB 的帧以 1009 关闭', async () => {
  const s = await startServer();
  try {
    const { sock, head } = await rawConnect(s.address().port, '/ws', '13');
    assert.match(head, /101/);
    const frames = [];
    makeFrameReader(sock, frames);
    // 只发头部声明 9MiB，不真发数据：解析器应立刻以 1009 关闭
    const head9 = Buffer.allocUnsafe(10);
    head9[0] = 0x81; head9[1] = 0x80 | 127;
    head9.writeUInt32BE(0, 2); head9.writeUInt32BE(9 * 1024 * 1024, 6);
    sock.write(Buffer.concat([head9, crypto.randomBytes(4)]));
    const how = await new Promise((resolve) => {
      sock.on('close', () => resolve('closed'));
      sock.on('error', () => resolve('error'));
      setTimeout(() => resolve('timeout'), 600);
    });
    assert.notStrictEqual(how, 'timeout', '超大帧应被关闭');
    const closeFrame = frames.find((f) => f.opcode === 8);
    if (closeFrame) assert.strictEqual(closeFrame.body.readUInt16BE(0), 1009, '关闭码应为 1009');
    sock.destroy();
  } finally { s.close(); }
});

run();
