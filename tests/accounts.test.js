'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { AccountStore } = require('../server/account-store');
const { createAccountAPI } = require('../server/account-api');
const { Room, loadCore } = require('../server/rooms');
const { analyze } = require('../server/account-analysis');
const pass = 'Training-Account-2026';
function store(t) { const s = new AccountStore(':memory:'); t.after(() => s.close()); return s; }
function solo() {
  const core = loadCore(), g = core.createGame({ seed: 20261017, rotate: false }); g.startHand();
  let guard = 0; const turns = [];
  while (!g.hand.over && guard++ < 5000) {
    if (g.hasPendingResolve()) g.resolvePending();
    else if (g.awaiting) { const a = g.awaiting; if (a.type === 'turn' && !a.options.canZimo) { turns.push(g.hand.turnCount); g.humanDiscard(g.evaluateDiscards(a.seat)[0].kind, a.seat); } else g.autoPlaySeat(a.seat); }
    else g.aiStep();
  }
  assert.ok(g.hand.over); const record = JSON.parse(JSON.stringify(g.hand.record)); record.result = g.lastResult;
  return { id: 'fixture_round_20261017', status: 'completed', startedAt: Date.now(), record, manualTurns: turns };
}
const full = solo();
test('canonical names are unique, including concurrent registration and fullwidth/case variants', async t => {
  const s = store(t), user = await s.register(' Ａlice_麻将 ', pass);
  assert.equal(user.name, 'Alice_麻将');
  await assert.rejects(s.register('alice_麻将', pass), e => e.status === 409);
  const race = await Promise.allSettled([s.register('同名玩家', pass), s.register('同名玩家', pass)]);
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(race.find(r => r.status === 'rejected').reason.status, 409);
  for (const name of ['x','a b','<script>','a'.repeat(17)]) await assert.rejects(s.register(name, pass), e => e.status === 400);
  const raw = s.db.prepare('SELECT password_hash,salt FROM accounts WHERE id=?').get(user.id);
  assert.notEqual(raw.password_hash, pass); assert.equal(raw.password_hash.length, 128);
});
test('login, logout and password changes preserve identity and revoke sessions', async t => {
  const s = store(t), u = await s.register('账号安全', pass), a = s.createSession(u), b = s.createSession(u);
  assert.equal((await s.login('账号安全', pass)).id, u.id);
  await assert.rejects(s.login('账号安全', 'wrong-password'), e => e.status === 401);
  assert.equal(s.userForToken(a).id, u.id); s.logout(a); assert.equal(s.userForToken(a), null);
  await s.changePassword(u, pass, pass + '-new'); assert.equal(s.userForToken(b), null);
  await assert.rejects(s.login('账号安全', pass), e => e.status === 401);
  assert.equal((await s.login('账号安全', pass + '-new')).id, u.id);
});
test('solo saves are idempotent, complete, private, and cannot regress to an older checkpoint', async t => {
  const s = store(t), u = await s.register('单机玩家', pass), other = await s.register('另一玩家', pass);
  const first = s.saveSolo(u, full); s.saveSolo(u, full);
  assert.equal(s.dashboard(u).summary.hands, 1); assert.equal(s.dashboard(other).summary.hands, 0);
  const detail = s.detail(u, first.id); assert.deepEqual(detail.record.events, full.record.events); assert.deepEqual(detail.record.birds, full.record.birds);
  assert.equal(detail.source, 'local'); assert.equal(detail.record.humanSeat, full.record.humanSeat);
  assert.throws(() => s.detail(other, first.id), e => e.status === 404);
  s.saveSolo(u, { ...full, status: 'unfinished', record: { ...full.record, events: full.record.events.slice(0,1), result: null } });
  assert.equal(s.dashboard(u).summary.hands, 1);
  const bad = JSON.parse(JSON.stringify(full)); bad.record.events[0].s = 8;
  assert.throws(() => s.saveSolo(u, bad), e => e.status === 400);
  const unfinished = { ...full, id: 'unfinished_fixture', status: 'unfinished', record: { ...full.record, events: full.record.events.slice(0,1), result: null } };
  s.saveSolo(u, unfinished); assert.equal(s.dashboard(u).summary.hands, 1); assert.equal(s.dashboard(u).unfinished, 1);
});
test('server archives original seats and all events; a waiting account gets no phantom match or live hidden tiles', async t => {
  const s = store(t), a = await s.register('真人甲', pass), b = await s.register('真人乙', pass);
  const room = new Room('6551', { archive: r => s.syncRoom(r), botStyle: 'v1', queuedBots: 0 });
  const ma = room.join(a.name), mb = room.join(b.name); ma.accountId = a.id; mb.accountId = b.id; ma.conn = {}; mb.conn = {};
  room.start(); const id = room.archiveHand.id;
  assert.throws(() => s.detail(a, id), e => e.status === 409);
  const waiting = room.join('旁观者'); waiting.accountId = (await s.register('候补玩家', pass)).id; waiting.conn = {};
  ma.conn = null; mb.conn = null; room.pump(); assert.ok(room.game.hand.over);
  assert.equal(s.dashboard(a, 'human').summary.hands, 1); assert.equal(s.dashboard(a, 'ai').summary.hands, 0);
  assert.equal(s.dashboard({id:waiting.accountId}).summary.hands, 0);
  assert.deepEqual(s.detail(a,id).record.events, room.game.hand.record.events);
  assert.equal(s.detail(b,id).record.humanSeat, 1); assert.equal(s.detail(a,id).record.humanSeat, 0);
  room.pump(); assert.equal(s.dashboard(a).summary.hands, 1);
});
test('SQLite survives restart and marks live server games interrupted without counting a result', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'zmj-account-')), file = path.join(dir,'test.sqlite');
  t.after(() => { s.close(); assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(dir,{recursive:true,force:true}); });
  let s = new AccountStore(file); const u = await s.register('持久存档',pass), token = s.createSession(u); s.saveSolo(u,full);
  const room = new Room('6552',{archive:r=>s.syncRoom(r)}), m = room.join(u.name); m.accountId=u.id;m.conn={};room.start();const active=room.archiveHand.id;
  s.close();s = new AccountStore(file);
  assert.equal(s.userForToken(token).id,u.id);assert.equal(s.dashboard(u).summary.hands,1);
  assert.equal(s.detail(u,active).status,'interrupted');assert.equal(s.history(u,'all',0).total,2);
});
test('behavior metrics count only manual discards, and ignore future/opponent hidden information', () => {
  const seat=full.record.humanSeat, actions=full.record.events.flatMap((e,i)=>e.t==='x'&&e.s===seat?[{seat,act:'discard',eventIndex:i}]:[]);
  const m=analyze(full.record,seat,actions);
  assert.equal(m.discards,actions.length);assert.ok(m.same<=m.discards);assert.equal(analyze(full.record,seat,[]).discards,0);
  const changed=JSON.parse(JSON.stringify(full.record));changed.birds=Array(6).fill(26);
  assert.deepEqual(analyze(changed,seat,actions),m);
});
test('another live server using the database cannot expose an ongoing match as interrupted', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zmj-live-db-')),file=path.join(dir,'shared.sqlite');
  const first=new AccountStore(file);let second;
  t.after(()=>{first.close();if(second)second.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
  const user=await first.register('共享服务器',pass),room=new Room('6553',{archive:r=>first.syncRoom(r)}),member=room.join(user.name);member.accountId=user.id;member.conn={};room.start();
  second=new AccountStore(file);assert.throws(()=>second.detail(user,room.archiveHand.id),e=>e.status===409);
  first.close();assert.equal(second.detail(user,room.archiveHand.id).status,'interrupted');
});
test('HTTP accounts require same-origin JSON mutations, isolate records, and set protected session cookies', async t => {
  const s=store(t), api=createAccountAPI(s), server=http.createServer((req,res)=>api(req,res));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const base='http://127.0.0.1:'+server.address().port;
  async function call(route,data,cookie,extra={}){const res=await fetch(base+'/api/account/'+route,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json','X-ZMJ-Request':'1'}),...(cookie?{Cookie:cookie}:{}),...extra},body:data===undefined?undefined:JSON.stringify(data)});return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')};}
  const reg=await call('register',{name:'接口玩家',password:pass});assert.equal(reg.status,200);assert.match(reg.cookie,/HttpOnly/);assert.match(reg.cookie,/SameSite=Lax/);
  const cookie=reg.cookie.split(';')[0];assert.equal((await call('me',undefined,cookie)).body.user.name,'接口玩家');
  assert.equal((await call('register',{name:'接口玩家',password:pass})).status,409);
  assert.equal((await call('solo',full,cookie,{Origin:'https://evil.example'})).status,403);
  assert.equal((await call('solo',full,cookie,{'X-ZMJ-Request':'0'})).status,403);
  assert.equal((await call('solo',full)).status,401);
  const saved=await call('solo',{...full,owner:reg.body.user.id},cookie);assert.equal(saved.status,200);
  assert.equal((await call('dashboard',undefined,cookie)).body.summary.hands,1);
  const other=await call('register',{name:'接口乙方',password:pass});assert.equal((await call('matches/'+encodeURIComponent(saved.body.id),undefined,other.cookie.split(';')[0])).status,404);
  assert.equal((await call('solo',{...full,owner:reg.body.user.id},other.cookie.split(';')[0])).status,409);
  assert.equal((await call('logout',{},cookie)).status,200);assert.equal((await call('dashboard',undefined,cookie)).status,401);
  const secure=await call('register',{name:'边缘加密',password:pass},null,{Origin:base.replace('http:','https:')});assert.match(secure.cookie,/; Secure/);
});
test('cross-site WebSockets may play as guests but cannot use account cookies', async t => {
  const s=new AccountStore(':memory:'),user=await s.register('跨站保护',pass),token=s.createSession(user);
  const server=http.createServer((req,res)=>res.end('ok')),hub=require('../server/mjs-server').attach(server,{accounts:s});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{hub.close();server.close();s.close();});
  async function upgrade(cookie){return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/ws',headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':'MDEyMzQ1Njc4OWFiY2RlZg==',Origin:'https://2653296079.github.io',...(cookie?{Cookie:'zmj_session='+cookie}:{})}});
    req.on('upgrade',(res,socket)=>{resolve(res.statusCode);socket.destroy();});req.on('response',res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();
  });}
  assert.equal(await upgrade(),101);assert.equal(await upgrade(token),403);
});
