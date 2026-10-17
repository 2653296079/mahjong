'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {OnlineService}=require('../server/online-service'),{AccountStore}=require('../server/account-store'),{attach}=require('../server/mjs-server'),{ensureServer,health}=require('../server/launcher');
const {connect}=require('./raw-ws-client');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<300;i++){if(await fn())return;await pause(20);}throw Error('状态等待超时');}
function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'zmj-online-service-'));}
function cleanup(dir){const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.join(os.tmpdir(),'zmj-online-service-')));fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
async function listen(server){await new Promise(r=>server.listen(0,'127.0.0.1',r));return server.address().port;}
async function socket(t,port,cookie){const client=await connect(port,cookie);t.after(()=>client.close());await until(()=>client.messages.some(m=>m.t==='welcome'));return client;}
test('presence counts unique accounts and visitors, excludes probes, and names cannot be forged',async t=>{
 const accounts=new AccountStore(':memory:'),server=http.createServer(),hub=attach(server,{accounts});
 t.after(()=>{hub.close();server.close();accounts.close();});const port=await listen(server);
 const probe=await socket(t,port);probe.send({t:'ping'});await pause(30);assert.equal(hub.presence().online,0);
 const cookie='zmj_visitor='+'a'.repeat(32),a=await socket(t,port,cookie),b=await socket(t,port,cookie),c=await socket(t,port,'zmj_visitor='+'b'.repeat(32));
 for(const s of [a,b,c])s.send({t:'hello'});await until(()=>hub.presence().online===2);assert.deepEqual(hub.presence(),{online:2,accounts:0,visitors:2});
 a.send({t:'join',room:'7811',name:'冒用注册名'});await until(()=>a.messages.some(m=>m.t==='joined'));assert.equal(a.messages.find(m=>m.t==='joined').you,'访客·AAAAAAAA');
 const user=await accounts.register('真实账号名','online-account-2026'),token=accounts.createSession(user),u=await socket(t,port,'zmj_session='+token),u2=await socket(t,port,'zmj_session='+token);
 u.send({t:'join',room:'7811',name:'伪造名字'});u2.send({t:'hello'});await until(()=>hub.presence().accounts===1&&hub.presence().online===3);
 assert.equal(u.messages.find(m=>m.t==='welcome').identity.name,user.name);await until(()=>u.messages.some(m=>m.t==='joined'));assert.equal(u.messages.find(m=>m.t==='joined').you,user.name);
 a.close();await pause(30);assert.equal(hub.presence().visitors,2);b.close();await until(()=>hub.presence().visitors===1);
});
test('on-demand runtime starts once, proxies authentication, reuses the process and recovers after a crash',async t=>{
 const dir=temp(t),file=path.join(dir,'game.sqlite'),accounts=new AccountStore(file),manager=new OnlineService({limits:{maxMessageBytes:4096},env:{MAHJONG_DB_PATH:file}}),server=http.createServer((req,res)=>{res.end('entry alive');});
 t.after(async()=>{await manager.close();await new Promise(r=>server.close(r));accounts.close();cleanup(dir);});server.on('upgrade',(req,socket,head)=>manager.upgrade(req,socket,head));const port=await listen(server);
 assert.equal(manager.stats().gameService,'stopped');assert.equal(manager.launches,0);
 const user=await accounts.register('按需服务账号','online-account-2026'),token=accounts.createSession(user);
 const [a,b]=await Promise.all([socket(t,port,'zmj_session='+token),socket(t,port,'zmj_visitor='+'c'.repeat(32))]);
 assert.equal(manager.launches,1);assert.equal(a.messages.find(m=>m.t==='welcome').identity.name,user.name);
 a.send({t:'join',room:'7822',name:'伪造名字'});b.send({t:'hello'});await until(()=>manager.stats().online===2);assert.equal(manager.stats().accounts,1);assert.equal(manager.stats().visitors,1);
 a.send({t:'start'});await until(()=>a.messages.some(m=>m.t==='state'&&m.hand));
 const oldInstance=a.messages.find(m=>m.t==='welcome').instance,old=manager.child;old.kill();await until(()=>manager.child===null);
 assert.equal(manager.stats().gameService,'stopped');assert.equal(manager.stats().online,0);
 const c=await socket(t,port,'zmj_session='+token);c.send({t:'hello'});await until(()=>manager.stats().online===1);
 assert.equal(manager.launches,2);assert.notEqual(c.messages.find(m=>m.t==='welcome').instance,oldInstance);assert.equal(c.messages.find(m=>m.t==='welcome').identity.name,user.name);
 const rows=accounts.history(user,'all',0);assert.equal(rows.items[0].status,'interrupted');assert.equal(accounts.dashboard(user).summary.hands,0);
 c.send({t:'chat',text:'x'.repeat(4097)});await until(()=>c.closed);assert.equal(manager.stats().gameService,'running');
});
test('desktop entry starts a stopped gateway and concurrent launches reuse the same server',async t=>{
 const dir=temp(t),reserve=http.createServer(),port=await listen(reserve);await new Promise(r=>reserve.close(r));
 const options={port,directory:dir,env:{MAHJONG_DB_PATH:path.join(dir,'launcher.sqlite'),MAHJONG_HOST:'127.0.0.1'}};
 const results=await Promise.all([ensureServer(options),ensureServer(options)]),started=results.find(r=>!r.reused);
 assert.ok(started&&started.pid);t.after(async()=>{try{process.kill(started.pid);}catch{}await until(async()=>!(await health(port)));cleanup(dir);});
 assert.equal(results.filter(r=>!r.reused).length,1);assert.equal((await health(port)).gameService,'stopped');assert.equal((await ensureServer(options)).reused,true);
 const lobby=await (await fetch('http://127.0.0.1:'+port+'/api/lobby')).json();assert.equal(lobby.online,0);assert.equal(lobby.gameService,'stopped');assert.equal(lobby.accounts+lobby.visitors,lobby.online);
});
test('desktop entry refuses an unrelated listener instead of starting or stopping another service',async t=>{
 const server=http.createServer((req,res)=>res.end('unrelated')),port=await listen(server);t.after(()=>server.close());
 await assert.rejects(ensureServer({port}),/其他服务或旧版麻将/);assert.ok(server.listening);
});
