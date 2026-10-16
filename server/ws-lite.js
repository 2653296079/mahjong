'use strict';
/**
 * ws-lite.js —— 零依赖 WebSocket 服务端实现（RFC 6455 子集）
 *
 * 为什么自己写：本项目坚持「无构建依赖」，不希望使用者为了联机去 npm install。
 * 只依赖 Node 内置模块（crypto / events）。
 *
 * 支持：握手校验、文本帧、二进制帧、分片续帧、ping/pong、close、掩码解码、8MiB 上限。
 * 客户端直接用浏览器/Node 自带的 WebSocket 即可，无需任何前端库。
 *
 * 用法：
 *   const http = require('http');
 *   const { upgrade } = require('./ws-lite');
 *   const server = http.createServer((req,res)=>{ res.writeHead(404); res.end(); });
 *   server.on('upgrade', (req, socket, head) => {
 *     const conn = upgrade(req, socket, head, { path: '/ws' });
 *     if (!conn) return;                       // 路径不符或握手非法，已自动回绝
 *     conn.on('message', (text) => conn.send('echo:' + text));
 *     conn.on('close', () => console.log('bye'));
 *   });
 *   server.listen(8080);
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 8 * 1024 * 1024;   // 单帧上限，超过则以 1009 关闭
const MAX_BUFFER = 16 * 1024 * 1024; // 累积缓冲上限，防内存耗尽

const OP = { CONT: 0x0, TEXT: 0x1, BIN: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

/** 计算 Sec-WebSocket-Accept */
function acceptKey(key) {
  return crypto.createHash('sha1').update(String(key) + GUID).digest('base64');
}

/**
 * 编成一个服务端→客户端的帧（不分片、不掩码）。
 * @param {number} opcode
 * @param {Buffer|string} payload
 * @returns {Buffer}
 */
function encode(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = body.length;
  let head;
  if (len < 126) {
    head = Buffer.allocUnsafe(2);
    head[1] = len;
  } else if (len < 65536) {
    head = Buffer.allocUnsafe(4);
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.allocUnsafe(10);
    head[1] = 127;
    head.writeUInt32BE(Math.floor(len / 4294967296), 2);
    head.writeUInt32BE(len >>> 0, 6);
  }
  head[0] = 0x80 | opcode;   // FIN=1
  return Buffer.concat([head, body]);
}

/** 增量帧解析器：把 TCP 字节流拆成一个个 WebSocket 帧 */
class FrameParser {
  constructor(onFrame, onError, opts) {
    this.buf = Buffer.alloc(0);
    this.onFrame = onFrame;
    this.onError = onError || (() => {});
    this.dead = false;
    this.maxFrame = opts && opts.maxMessageBytes || MAX_FRAME;
    this.maxBuffer = opts && opts.maxMessageBytes ? Math.max(65536 + this.maxFrame, this.maxFrame * 2) : MAX_BUFFER;
  }
  push(chunk) {
    if (this.dead) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    if (this.buf.length > this.maxBuffer) { this.dead = true; this.onError(1009, 'buffer too large'); return; }
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const rsv = b[0] & 0x70;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (rsv !== 0) { this.dead = true; this.onError(1002, 'RSV must be 0'); return; }
      if (len === 126) {
        if (b.length < off + 2) return;
        len = b.readUInt16BE(off); off += 2;
      } else if (len === 127) {
        if (b.length < off + 8) return;
        const hi = b.readUInt32BE(off), lo = b.readUInt32BE(off + 4);
        if (hi !== 0) { this.dead = true; this.onError(1009, 'frame too large'); return; }
        len = lo; off += 8;
      }
      if (len > this.maxFrame) { this.dead = true; this.onError(1009, 'frame too large'); return; }
      if (opcode >= 8 && (!fin || len > 125)) { this.dead = true; this.onError(1002, 'invalid control frame'); return; }
      // 客户端发来的帧必须掩码（RFC6455 §5.1）
      if (!masked) { this.dead = true; this.onError(1002, 'client frame must be masked'); return; }
      if (b.length < off + 4) return;
      const mask = b.subarray(off, off + 4); off += 4;
      if (b.length < off + len) return;
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = b[off + i] ^ mask[i & 3];
      this.buf = b.subarray(off + len);
      this.onFrame(fin, opcode, payload);
      if (this.dead) return;
    }
  }
}

/** 一条 WebSocket 连接 */
class WSConn extends EventEmitter {
  constructor(socket, opts) {
    super();
    this.socket = socket;
    this.closed = false;
    this.readyState = 1;          // 1=OPEN 2=CLOSING 3=CLOSED
    this.isAlive = true;
    this.fragOp = 0;              // 分片中的原始 opcode
    this.fragChunks = [];
    this.fragLen = 0;
    this.data = {};               // 业务侧挂载点
    this.maxMessageBytes = opts && opts.maxMessageBytes || MAX_FRAME;
    this.maxPendingBytes = opts && opts.maxPendingBytes || MAX_BUFFER;
    this.parser = new FrameParser((fin, opcode, payload) => this._onFrame(fin, opcode, payload),
      (code, why) => this.close(code, why), opts);
    socket.on('data', (chunk) => this.parser.push(chunk));
    socket.on('error', () => this._teardown());
    socket.on('close', () => this._teardown());
    socket.setTimeout(0);
    socket.setNoDelay(true);
  }

  _onFrame(fin, opcode, payload) {
    if (opcode === OP.CLOSE) {
      let code = 1005;
      if (payload.length >= 2) code = payload.readUInt16BE(0);
      this._sendRaw(OP.CLOSE, payload.length >= 2 ? payload.subarray(0, 2) : Buffer.alloc(0));
      this.closeCode = code;
      this._teardown();
      return;
    }
    if (opcode === OP.PING) { this._sendRaw(OP.PONG, payload); return; }
    if (opcode === OP.PONG) { this.isAlive = true; this.emit('pong', payload); return; }

    if (opcode === OP.CONT) {
      if (!this.fragOp) { this.close(1002, 'unexpected continuation'); return; }
      this.fragChunks.push(payload);
      this.fragLen += payload.length;
      if (this.fragLen > this.maxMessageBytes) { this.close(1009, 'message too large'); return; }
      if (!fin) return;
      const full = Buffer.concat(this.fragChunks, this.fragLen);
      const op = this.fragOp;
      this.fragOp = 0; this.fragChunks = []; this.fragLen = 0;
      this._deliver(op, full);
      return;
    }
    if (opcode === OP.TEXT || opcode === OP.BIN) {
      if (this.fragOp) { this.close(1002, 'already fragmented'); return; }
      if (!fin) { this.fragOp = opcode; this.fragChunks = [payload]; this.fragLen = payload.length; return; }
      this._deliver(opcode, payload);
      return;
    }
    this.close(1002, 'bad opcode ' + opcode);
  }

  _deliver(opcode, buf) {
    if (opcode === OP.TEXT) this.emit('message', buf.toString('utf8'));
    else this.emit('binary', buf);
  }

  _sendRaw(opcode, payload) {
    if (this.closed || !this.socket.writable) return false;
    const frame=encode(opcode,payload);
    if(opcode!==OP.CLOSE && this.socket.writableLength+frame.length>this.maxPendingBytes){this.close(1008,'client too slow');return false;}
    try { this.socket.write(frame); return true; }
    catch (e) { this._teardown(); return false; }
  }

  /** 发一条文本消息（对象会自动 JSON 序列化） */
  send(data) {
    return this._sendRaw(OP.TEXT, typeof data === 'string' ? data : JSON.stringify(data));
  }
  /** 发一条二进制消息 */
  sendBinary(buf) { return this._sendRaw(OP.BIN, buf); }
  /** 发心跳 */
  ping() { return this._sendRaw(OP.PING, Buffer.alloc(0)); }

  /** 主动关闭连接 */
  close(code, reason) {
    if (this.closed) return;
    this.readyState = 2;
    this.closeCode = code || 1000;
    const r = Buffer.from(String(reason || ''), 'utf8').subarray(0,123);
    const body = Buffer.allocUnsafe(2 + r.length);
    body.writeUInt16BE(code || 1000, 0);
    r.copy(body, 2);
    this._sendRaw(OP.CLOSE, body);
    this._teardown();
  }

  _teardown() {
    if (this.closed) return;
    this.closed = true;
    this.parser.dead = true; this.parser.buf = Buffer.alloc(0);
    this.fragChunks = []; this.fragLen = 0;
    this.readyState = 3;
    try { this.socket.destroy(); } catch (e) {}
    this.emit('close', this.closeCode || 1006);
  }
}

/**
 * 处理一次 HTTP Upgrade。
 * @returns {WSConn|null} 握手失败时返回 null（已写好 HTTP 响应并断开）
 */
function upgrade(req, socket, head, opts) {
  opts = opts || {};
  const reject = (code, msg) => {
    try { socket.write('HTTP/1.1 ' + code + ' ' + msg + '\r\nConnection: close\r\n\r\n'); } catch (e) {}
    try { socket.destroy(); } catch (e) {}
    return null;
  };
  if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket') return reject(400, 'Bad Request');
  const key = req.headers['sec-websocket-key'];
  if (!key) return reject(400, 'Bad Request');
  if (String(req.headers['sec-websocket-version'] || '') !== '13') {
    try {
      socket.write('HTTP/1.1 426 Upgrade Required\r\nSec-WebSocket-Version: 13\r\nConnection: close\r\n\r\n');
    } catch (e) {}
    try { socket.destroy(); } catch (e) {}
    return null;
  }
  if (opts.path && String(req.url || '').split('?')[0] !== opts.path) return reject(404, 'Not Found');
  if (typeof opts.verifyClient === 'function' && opts.verifyClient(req) === false) return reject(403, 'Forbidden');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + acceptKey(key) + '\r\n\r\n'
  );
  const conn = new WSConn(socket,opts);
  if (head && head.length) queueMicrotask(()=>conn.parser.push(head));
  return conn;
}

module.exports = { upgrade, WSConn, FrameParser, acceptKey, encode, OP };
