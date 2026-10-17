'use strict';
// 只读探针：不加入房间、不发送游戏操作，不读取或保存访问密钥。
const http = require('node:http'), https = require('node:https');
const fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const round = n => Math.round(n * 100) / 100;
function summarize(values) {
  const ordered = values.slice().sort((a, b) => a - b);
  return ordered.length ? { count: ordered.length, minMs: ordered[0], medianMs: ordered[Math.floor(ordered.length / 2)],
    p95Ms: ordered[Math.ceil(ordered.length * .95) - 1], maxMs: ordered.at(-1) } : { count: 0 };
}
function request(url, agent) {
  return new Promise(resolve => {
    const started = performance.now(), times = {}, chunks = []; let bytes = 0;
    const req = (url.protocol === 'https:' ? https : http).get(url, { agent }, res => {
      times.headersMs = round(performance.now() - started);
      res.on('data', chunk => { bytes += chunk.length; if (bytes > 2097152) req.destroy(new Error('response exceeds 2 MiB')); else chunks.push(chunk); });
      res.on('end', () => {
        clearTimeout(deadline);
        const body = Buffer.concat(chunks); let health;
        if (url.pathname === '/healthz' && res.statusCode === 200) {
          try {
            const data = JSON.parse(body.toString('utf8'));
            health = Object.fromEntries(['status','rulesVersion','analysisVersion','questionVersion','rooms','sessions','players']
              .filter(k => Object.hasOwn(data, k)).map(k => [k, data[k]]));
          } catch (_) {}
        }
        resolve({ status: res.statusCode, ...times, totalMs: round(performance.now() - started), bytes: body.length,
          reusedSocket: req.reusedSocket, sha256: createHash('sha256').update(body).digest('hex'), health });
      });
      res.on('error', e => { clearTimeout(deadline); resolve({ error: e.code || e.message }); });
    });
    req.on('socket', socket => {
      socket.once('lookup', () => { times.dnsMs = round(performance.now() - started); });
      socket.once('connect', () => { times.connectedMs = round(performance.now() - started); });
      socket.once('secureConnect', () => { times.tlsReadyMs = round(performance.now() - started); });
    });
    const deadline = setTimeout(() => req.destroy(new Error('HTTP timeout')), 8000);
    req.on('error', e => { clearTimeout(deadline); resolve({ totalMs: round(performance.now() - started), error: e.code || e.message }); });
  });
}
function measureWebSocket(url, samples, interval) {
  return new Promise(resolve => {
    const started = performance.now(), rows = [], ws = new WebSocket(url);
    let openedMs, pending = null, sequence = 0, finished = false, timer, nextTimer;
    function finish(error) {
      if (finished) return;
      finished = true; clearTimeout(timer); clearTimeout(nextTimer);
      try { ws.close(); } catch (_) {}
      resolve({ openedMs, summary: summarize(rows.filter(r => r.rttMs != null).map(r => r.rttMs)), rows, error });
    }
    function send() {
      if (sequence >= samples) return finish();
      if (ws.readyState !== WebSocket.OPEN) return finish('WebSocket closed before probe');
      pending = { probe: ++sequence, at: performance.now() };
      ws.send(JSON.stringify({ t: 'ping', probe: pending.probe }));
      timer = setTimeout(() => { rows.push({ probe: pending.probe, error: 'timeout' }); finish('pong timeout'); }, 5000);
    }
    timer = setTimeout(() => finish('WebSocket open timeout'), 8000);
    ws.addEventListener('open', () => { clearTimeout(timer); openedMs = round(performance.now() - started); send(); });
    ws.addEventListener('message', e => {
      let m; try { m = JSON.parse(e.data); } catch (_) { return; }
      if (m.t !== 'pong' || !pending || (m.probe != null && m.probe !== pending.probe)) return;
      clearTimeout(timer);
      rows.push({ probe: pending.probe, rttMs: round(performance.now() - pending.at), echoedProbe: m.probe === pending.probe });
      pending = null; nextTimer = setTimeout(send, interval);
    });
    ws.addEventListener('error', () => finish('WebSocket connection error (check TLS and /ws)'));
    ws.addEventListener('close', () => { if (!finished) finish('WebSocket closed early'); });
  });
}
async function checkConnection(options) {
  const { url: value, samples = 16, interval = 250 } = options;
  if (!Number.isInteger(samples) || samples < 1 || samples > 60 || !Number.isInteger(interval) || interval < 0 || interval > 10000) throw new Error('invalid probe limits');
  const base = new URL(/^[a-z]+:\/\//i.test(value) ? value : 'http://' + value);
  if (!['http:','https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('use an http(s) address without credentials or query');
  const agent = base.protocol === 'https:' ? new https.Agent({ keepAlive: true }) : new http.Agent({ keepAlive: true });
  const report = { url: base.origin, sampledAt: new Date().toISOString(), extraTrustProvided: !!process.env.NODE_EXTRA_CA_CERTS, http: [] };
  try {
    for (let i = 0; i < 3; i++) report.http.push(await request(new URL('/healthz', base), agent));
    report.page = await request(new URL('/', base), agent);
    const socket = new URL('/ws', base); socket.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    report.websocket = await measureWebSocket(socket, samples, interval);
    return report;
  } finally { agent.destroy(); }
}
async function main(args) {
  try {
    const url = args[0] || process.env.TUNNEL;
    if (!url) throw new Error('用法：node evaluation/check-connection.js https://域名:端口 [--out 报告.json]');
    const report = await checkConnection({ url });
    const outputIndex = args.indexOf('--out');
    if (outputIndex >= 0) {
      if (!args[outputIndex + 1]) throw new Error('missing output path');
      const dest = path.resolve(args[outputIndex + 1]); fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, JSON.stringify(report, null, 2) + '\n');
    }
    console.log(JSON.stringify({ url: report.url, extraTrustProvided: report.extraTrustProvided, http: report.http,
      page: report.page, websocket: { openedMs: report.websocket.openedMs, ...report.websocket.summary, error: report.websocket.error } }, null, 2));
    if (report.page.status !== 200 || report.websocket.error) process.exitCode = 1;
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
if (require.main === module) main(process.argv.slice(2));
module.exports = { summarize, checkConnection, main };
