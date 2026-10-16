const test=require('node:test');
const assert=require('node:assert/strict');
const Z=require('../server/rooms').loadCore();
const reference=require('./reference-shanten');

test('base lesson answers agree with separate distance/outs enumeration including fixed melds',()=>{
  for(const q of Z.practiceCases.filter(q=>!q.assessment)){
    const H=Z.practiceHand(q.id),p=H.players[0],mc=p.melds.length,pool=Array(27).fill(4);
    p.concealed.forEach((n,k)=>pool[k]-=n);
    H.players.forEach(player=>{
      player.discards.forEach(k=>pool[k]--);
      player.melds.forEach(m=>{pool[m.kind]-=m.type==='gang'?4:3;if(m.from>=0)pool[m.kind]++;});
    });
    assert.ok(pool.every(n=>n>=0),q.id);
    for(const o of Z.practiceChoices(q.id)){
      const c=p.concealed.slice();let melds=mc;
      if(o.kind==='peng'){c[q.claim]-=2;c[o.discard]--;melds++;}
      else if(o.kind!=='pass')c[o.kind]--;
      assert.equal(o.shanten,reference.distance(c,melds),q.id+': '+o.kind);
      assert.equal(o.ukeire,reference.outs(c,melds,pool),q.id+': '+o.kind);
    }
  }
});

test('known open-hand and pung examples have reviewable fixed outcomes',()=>{
  const expected={
    'wide-6':[14,0,10],'open-4':[26,0,8],'open-5':[5,0,6],'open-6':[18,0,3],
    'peng-1':['peng',1,20],'peng-2':['pass',0,3],'peng-4':['pass',0,8],'peng-5':['peng',0,3]
  };
  for(const [id,value]of Object.entries(expected)){
    const best=Z.practiceChoices(id)[0];assert.deepEqual([best.kind,best.shanten,best.ukeire],value,id);
  }
  const equal=Z.practiceChoices('peng-3');assert.ok(Z.sameEfficiency(equal[0],equal[1]));
});
