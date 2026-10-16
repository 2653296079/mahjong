'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Z=require('../server/rooms').loadCore();
const {probabilityMetrics,publicProjection}=require('./metrics');

function canWin(c,mc,k){if(c[k]>=4)return false;const copy=c.slice();copy[k]++;return Z.isWin(copy,mc);}
function runRisk(options){
  const opts=Object.assign({hands:18,worlds:150,seed:20261016,stride:4},options);
  for(const key of ['hands','worlds','stride'])if(!Number.isSafeInteger(opts[key])||opts[key]<1)throw new Error('invalid '+key);
  const samples=[],readySamples=[],handResults=[];
  const styles=['v1','v2','v3'];let decisions=0;
  for(let h=0;h<opts.hands;h++){
    const style=styles[h%styles.length],seed=(opts.seed+h*7919)>>>0;
    const roster=Array.from({length:4},(_,s)=>({id:'s'+s,name:'模拟'+s,isHuman:true,style}));
    const G=Z.createGame({seed,rotate:false,roster,aiStyle:'greedy'});G.startHand();
    let turns=0,measured=0,steps=0;
    while(!G.hand.over&&steps++<2000){
      if(G.hasPendingResolve()){G.resolvePending();continue;}
      const a=G.pendingAwaits()[0];
      if(!a){if(!G.aiStep())throw new Error('simulation stalled: '+seed);continue;}
      if(a.type==='turn' && !a.options.canZimo && turns++%opts.stride===0){
        const H=G.hand,seat=a.seat,view=publicProjection(H,seat),before=JSON.stringify(H);
        const report=Z.analyzeSituation(view,seat,{worlds:opts.worlds,seed:((seed^0xa5a5a5a5)+measured*131)>>>0});
        const candidates=Z.evaluateDiscards(view,seat);
        // 每个局面评估所有可打的种类；不按真实暗牌筛选样本。
        for(const candidate of candidates){
          const k=candidate.kind;
          const hit=H.players.some((p,s)=>s!==seat&&!p.passedWin&&canWin(p.concealed,p.melds.length,k));
          samples.push({hand:h,seed,style,turn:H.turnCount,seat,kind:k,p:report.dealIn(k).prob,y:hit?1:0});
        }
        for(const opponent of report.opponents){
          const p=H.players[opponent.seat];let ready=false;
          for(let k=0;k<27;k++)if(canWin(p.concealed,p.melds.length,k)){ready=true;break;}
          readySamples.push({hand:h,style,p:opponent.tenpaiProb,y:ready?1:0});
        }
        if(JSON.stringify(H)!==before)throw new Error('evaluation mutated state: '+seed);
        measured++;decisions++;
      }
      if(!G.autoPlaySeat(a.seat))throw new Error('autoplay rejected: '+seed);
    }
    if(!G.hand.over)throw new Error('simulation did not finish: '+seed);
    handResults.push({seed,style,decisions:measured,result:G.hand.result.type});
  }
  const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1].replace(/\r\n/g,'\n');
  return {format:'zmj-risk-evaluation',version:1,rulesVersion:Z.rulesVersion,analysisVersion:Z.analysisVersion,
    engineSha256:crypto.createHash('sha256').update(source).digest('hex'),options:opts,decisions,
    dealIn:probabilityMetrics(samples),tenpai:probabilityMetrics(readySamples),
    byStyle:styles.map(style=>({style,dealIn:probabilityMetrics(samples.filter(s=>s.style===style)),tenpai:probabilityMetrics(readySamples.filter(s=>s.style===style))})),
    hands:handResults,
    limits:['模拟对手不是实际玩家；三个风格使用同一引擎规则。','同一手牌中的多个候选和多个决策相关，样本数不能当作独立牌局数。','这是固定种子保留评估，没有根据结果拟合或调整模型。','Brier 与分箱误差只描述本次样本；空箱与少量命中不能证明已校准。','全预测不放铳的 Brier 是参照指标，不是推荐弃牌策略。']};
}
if(require.main===module){
  const args=process.argv.slice(2),opts={};let output;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--out')output=args[++i];
    else if(['--hands','--worlds','--seed','--stride'].includes(args[i]))opts[args[i].slice(2)]=Number(args[++i]);
    else throw new Error('unknown option: '+args[i]);
  }
  const report=runRisk(opts),json=JSON.stringify(report,null,2);
  if(output){const dest=path.resolve(output);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,json+'\n');}
  process.stdout.write(JSON.stringify({decisions:report.decisions,hands:report.hands.length,dealIn:report.dealIn,tenpai:report.tenpai},null,2)+'\n');
}
module.exports={runRisk,canWin};
