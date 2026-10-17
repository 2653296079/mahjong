const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {EventEmitter}=require('node:events');
const {attach}=require('../server/mjs-server');
const {readLimits,TokenBucket}=require('../server/limits');
const {WSConn,FrameParser,OP}=require('../server/ws-lite');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<150;i++){if(fn())return;await sleep(10);}throw new Error('等待网络状态超时');}
async function start(t,opts){
  const server=http.createServer((req,res)=>res.end('ok')),hub=attach(server,opts);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{hub.close();server.close();});
  return {hub,url:'ws://127.0.0.1:'+server.address().port+'/ws'};
}
function connect(url){
  const ws=new WebSocket(url),c={ws,messages:[],closed:null,send:m=>ws.send(JSON.stringify(m))};
  ws.addEventListener('message',e=>c.messages.push(JSON.parse(e.data)));
  ws.addEventListener('close',e=>c.closed=e.code);
  return new Promise((resolve,reject)=>{ws.addEventListener('open',()=>resolve(c),{once:true});ws.addEventListener('error',reject,{once:true});});
}

test('limits reject bad configuration; token bucket refills without rewarding clock reversal',()=>{
  assert.equal(readLimits().maxSessions,128);
  for(const bad of [{maxRooms:0},{messageRate:NaN},{maxSessions:'20'},{typo:5},{toString:5}])assert.throws(()=>readLimits(bad));
  const budget=new TokenBucket(2,3,1000);
  assert.ok(budget.take(1000));assert.ok(budget.take(1000));assert.ok(budget.take(1000));
  assert.equal(budget.take(900),false);assert.equal(budget.take(1400),false);assert.ok(budget.take(1500));
});

test('connection capacity is enforced and a released slot can reconnect',async t=>{
  const s=await start(t,{limits:{maxSessions:1}}),a=await connect(s.url);
  await assert.rejects(connect(s.url));
  assert.equal(s.hub.stats().sessions,1);
  a.ws.close();await until(()=>s.hub.stats().sessions===0);
  const b=await connect(s.url);assert.equal(b.ws.readyState,1);
});

test('room cap and failed room switch preserve the original membership',async t=>{
  const s=await start(t,{limits:{maxRooms:2},room:{maxMembers:1}}),a=await connect(s.url),b=await connect(s.url);
  a.send({t:'join',room:'3001',name:'甲'});b.send({t:'join',room:'3002',name:'乙'});
  await until(()=>a.messages.some(m=>m.t==='joined')&&b.messages.some(m=>m.t==='joined'));
  const original=s.hub.store.get('3001').members[0];
  a.send({t:'join',room:'3003',name:'甲'});
  await until(()=>a.messages.some(m=>m.t==='err'&&/数量已达上限/.test(m.msg)));
  a.send({t:'join',room:'3002',name:'甲'});
  await until(()=>a.messages.some(m=>m.t==='err'&&/房间满了/.test(m.msg)));
  assert.equal(s.hub.store.get('3001').members[0],original);
  assert.ok(original.conn);assert.equal(s.hub.stats().players,2);
  a.send({t:'join',room:'<bad>',name:'甲'});
  await until(()=>a.messages.some(m=>m.t==='err'&&/4–8/.test(m.msg)));
  assert.equal(s.hub.store.rooms.size,2);
});

test('message flood closes the offender while another client remains usable',async t=>{
  const s=await start(t,{limits:{messageBurst:3,messageRate:1}}),a=await connect(s.url),b=await connect(s.url);
  for(let i=0;i<4;i++)a.send({t:'ping'});
  await until(()=>a.closed!==null);assert.equal(a.closed,1008);
  b.send({t:'rooms'});await until(()=>b.messages.some(m=>m.t==='rooms'));
  assert.equal(b.closed,null);
});

test('game rejects oversized frames and binary input before handling commands',async t=>{
  const s=await start(t,{limits:{maxMessageBytes:128}}),a=await connect(s.url);
  a.ws.send('x'.repeat(129));await until(()=>a.closed!==null);assert.equal(a.closed,1009);
  const b=await connect(s.url);b.ws.send(new Uint8Array([1,2,3]));await until(()=>b.closed!==null);assert.equal(b.closed,1003);
  assert.equal(s.hub.store.rooms.size,0);
});

function socket(){const s=new EventEmitter();return Object.assign(s,{writable:true,writableLength:0,write:()=>true,destroy:()=>{},setTimeout:()=>{},setNoDelay:()=>{}});}
test('fragmented messages and slow-client output have independent memory bounds',()=>{
  const c=new WSConn(socket(),{maxMessageBytes:16,maxPendingBytes:100});
  c._onFrame(false,OP.TEXT,Buffer.alloc(10));c._onFrame(true,OP.CONT,Buffer.alloc(10));
  assert.equal(c.closeCode,1009);assert.equal(c.fragLen,0);assert.equal(c.parser.buf.length,0);
  const slow=socket();slow.writableLength=100;
  const d=new WSConn(slow,{maxPendingBytes:100});assert.equal(d.send({t:'state'}),false);assert.equal(d.closeCode,1008);
  const pong=new WSConn(slow,{maxPendingBytes:100});pong._onFrame(true,OP.PING,Buffer.from('x'));assert.equal(pong.closeCode,1008);
  let error;const parser=new FrameParser(()=>assert.fail('invalid ping delivered'),code=>error=code);
  parser.push(Buffer.from([0x09,0x80,0,0,0,0]));assert.equal(error,1002);
});
