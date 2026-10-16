'use strict';
const BIN_EDGES=[0,0.02,0.05,0.1,0.2,1.00000001];
function probabilityMetrics(samples){
  const bins=BIN_EDGES.slice(0,-1).map((lower,i)=>({lower,upper:Math.min(1,BIN_EDGES[i+1]),count:0,predictedSum:0,hits:0}));
  let squared=0,predicted=0,hits=0;
  for(const {p,y}of samples){
    if(!Number.isFinite(p)||p<0||p>1||(y!==0&&y!==1))throw new Error('invalid probability sample');
    squared+=(p-y)**2;predicted+=p;hits+=y;
    const bin=bins.find((b,i)=>p>=b.lower&&p<BIN_EDGES[i+1]);
    bin.count++;bin.predictedSum+=p;bin.hits+=y;
  }
  const n=samples.length;
  const summaries=bins.map(b=>({lower:b.lower,upper:b.upper,count:b.count,hits:b.hits,
    predicted:b.count?b.predictedSum/b.count:null,observed:b.count?b.hits/b.count:null}));
  return {count:n,hits,brier:n?squared/n:null,meanPredicted:n?predicted/n:null,observedRate:n?hits/n:null,
    alwaysZeroBrier:n?hits/n:null,
    expectedCalibrationError:n?summaries.reduce((sum,b)=>sum+(b.count?b.count*Math.abs(b.predicted-b.observed):0),0)/n:null,bins:summaries};
}
// 评估器可读取完整模拟状态，预测器只接触公开投影；访问隐藏暗牌会立即失败。
function publicProjection(hand,seat){
  return {turn:hand.turn,turnCount:hand.turnCount,wall:new Array(hand.wall.length),
    players:hand.players.map((p,s)=>{
      const q={melds:p.melds.map(m=>({...m})),discards:p.discards.slice(),passedWin:s===seat?!!p.passedWin:false};
      if(s===seat)q.concealed=p.concealed.slice();
      else Object.defineProperty(q,'concealed',{get(){throw new Error('prediction accessed hidden tiles');}});
      return q;
    })};
}
module.exports={probabilityMetrics,publicProjection};
