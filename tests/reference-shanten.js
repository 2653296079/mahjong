'use strict';
// 慢速参照：将牌与搭子分别搜索，不能调用生产版 shanten/bestBlocks。
function standard(input, melds) {
  const c=input.slice(), need=4-melds;
  let best=8;
  function walk(m,t,head) {
    const k=c.findIndex(n=>n>0);
    if(k<0){best=Math.min(best,2*need-2*m-Math.min(t,need-m)-head);return;}
    if(m<need&&c[k]>=3){c[k]-=3;walk(m+1,t,head);c[k]+=3;}
    if(m<need&&k%9<7&&c[k+1]&&c[k+2]){
      c[k]--;c[k+1]--;c[k+2]--;walk(m+1,t,head);c[k]++;c[k+1]++;c[k+2]++;
    }
    if(c[k]>=2){c[k]-=2;if(!head)walk(m,t,1);walk(m,t+1,head);c[k]+=2;}
    for(const gap of [1,2])if(k%9+gap<9&&c[k+gap]){
      c[k]--;c[k+gap]--;walk(m,t+1,head);c[k]++;c[k+gap]++;
    }
    c[k]--;walk(m,t,head);c[k]++;
  }
  walk(0,0,0);return best;
}
function distance(c,mc) {
  const normal=standard(c,mc);
  return mc?normal:Math.min(normal,6-c.reduce((n,v)=>n+Math.floor(v/2),0));
}
function outs(c,mc,pool) {
  const before=distance(c,mc);let total=0;
  for(let k=0;k<27;k++)if(pool[k]>0&&c[k]<4){c[k]++;if(distance(c,mc)<before)total+=pool[k];c[k]--;}
  return total;
}
module.exports={standard,distance,outs};
