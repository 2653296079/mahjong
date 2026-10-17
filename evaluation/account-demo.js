'use strict';
// 仅生成独立的界面演示数据库，不写入 data/mahjong.sqlite，不包含真人战绩。
// node evaluation/account-demo.js
const path=require('node:path');
const fs=require('node:fs');
const {AccountStore}=require('../server/account-store');
const {Room,loadCore}=require('../server/rooms');
const file=path.join(__dirname,'..','data','account-demo.sqlite');
(async()=>{
 if(fs.existsSync(file)){console.log('演示数据库已存在，未覆盖。');return;}
 const store=new AccountStore(file),user=await store.register('演示_青玉档案','demo-mahjong-2026'),other=await store.register('演示_同桌牌友','demo-mahjong-2026'),core=loadCore();
 for(let i=0;i<8;i++){
  if(i<5){
   const g=core.createGame({seed:20261017+i,rotate:false}),turns=[];g.startHand();
   for(let j=0;j<3000&&!g.hand.over;j++){
    if(g.hasPendingResolve())g.resolvePending();else if(g.awaiting){const a=g.awaiting;if(a.type==='turn'){if(a.options.canZimo)g.humanZimo();else{turns.push(g.hand.turnCount);const choices=g.evaluateDiscards(a.seat);g.humanDiscard(choices[Math.min(choices.length-1,j%7===0?2:0)].kind);}}else g.autoPlaySeat(a.seat);}else g.aiStep();
   }
   const record=JSON.parse(JSON.stringify(g.hand.record));record.result=g.lastResult;
   store.saveSolo(user,{id:'demonstration_round_'+i,status:'completed',record,manualTurns:turns,startedAt:Date.now()-(8-i)*1800000});
  }else{
   const room=new Room(String(6800+i),{seed:20261017+i,archive:r=>store.syncRoom(r),queuedBots:0});
   for(const u of [user,other]){const m=room.join(u.name);m.accountId=u.id;m.conn={};}room.start();
   for(let j=0;j<3000&&!room.game.hand.over;j++){
    const g=room.game,a=g.pendingAwaits()[0];if(!a){room.pump();continue;}const member=room.memberByPid(g.seats[a.seat].id);
    if(a.type==='turn'){if(a.options.canZimo)room.act(member,{act:'zimo'});else{const choices=g.evaluateDiscards(a.seat);room.act(member,{act:'discard',kind:choices[Math.min(choices.length-1,j%5===0?1:0)].kind});}}
    else room.act(member,{act:a.options.hu?'hu':a.options.peng?'peng':'pass',kind:a.options.kind});
   }
  }
 }
 const deadline=Date.now()+10000;while((store.busy||store.jobs.length)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,30));
 console.log('已生成独立演示数据：5 局单机、3 局模拟真人同桌。账号：演示_青玉档案');store.close();
})().catch(e=>{console.error(e.message);process.exitCode=1;});
