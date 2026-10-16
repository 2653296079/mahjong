'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {performance}=require('node:perf_hooks');
const Z=require('../server/rooms').loadCore();
function summary(values){const sorted=values.slice().sort((a,b)=>a-b);return {count:sorted.length,medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*0.95)-1],maxMs:sorted[sorted.length-1]};}
function measure(){
  const bases=Z.practiceCases.filter(q=>!q.assessment),passes=[];
  for(let pass=0;pass<2;pass++){
    const samples=bases.map(q=>{
      const H=Z.practiceHand(q.id),start=performance.now(),choices=Z.practiceChoices(q.id),baseMs=performance.now()-start;
      const deepStart=performance.now();
      if(q.action!=='peng')choices.slice(0,3).forEach(o=>Z.trainingGuide(H,0,o.kind,true));
      return {id:q.id,baseMs,explanationMs:performance.now()-deepStart};
    });
    passes.push({name:pass?'第二次遍历':'首次遍历',base:summary(samples.map(s=>s.baseMs)),explanation:summary(samples.filter(s=>!s.id.startsWith('peng-')).map(s=>s.explanationMs)),samples});
  }
  return {format:'zmj-node-performance',version:1,rulesVersion:Z.rulesVersion,analysisVersion:Z.analysisVersion,questionVersion:Z.questionVersion,
    environment:{node:process.version,platform:process.platform,cpu:os.cpus()[0].model},passes,
    limits:['这是开发电脑上的 Node 基线，不是手机浏览器性能。','首次遍历共享有界向听缓存，不是每道题单独清空缓存后的冷启动。','讲解测量包含前三个弃牌的宽听路径，不包含对手风险采样和页面绘制。','没有以这份结果宣布达到真实手机 P95 目标。']};
}
if(require.main===module){const report=measure(),out=process.argv.indexOf('--out');if(out>=0){const dest=path.resolve(process.argv[out+1]);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(report,null,2)+'\n');}process.stdout.write(JSON.stringify(report.passes.map(({name,base,explanation})=>({name,base,explanation})),null,2)+'\n');}
module.exports={summary,measure};
