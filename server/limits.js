'use strict';
const DEFAULT_LIMITS = Object.freeze({
  maxSessions: 128, maxRooms: 64,
  messageRate: 20, messageBurst: 60,
  maxMessageBytes: 16384, maxPendingBytes: 1048576
});
function readLimits(overrides) {
  const limits={...DEFAULT_LIMITS};
  for(const key of Object.keys(overrides||{})){
    if(!Object.prototype.hasOwnProperty.call(DEFAULT_LIMITS,key))throw new Error('未知联机限制：'+key);
    const value=overrides[key];
    if(!Number.isSafeInteger(value)||value<1||value>16777216)throw new Error('联机限制 '+key+' 必须是 1–16777216 的整数');
    limits[key]=value;
  }
  return Object.freeze(limits);
}
class TokenBucket {
  constructor(rate,capacity,now){this.rate=rate;this.capacity=capacity;this.tokens=capacity;this.at=now;}
  take(now){
    this.tokens=Math.min(this.capacity,this.tokens+Math.max(0,now-this.at)*this.rate/1000);
    this.at=Math.max(this.at,now);
    if(this.tokens<1)return false;
    this.tokens--;return true;
  }
}
module.exports={DEFAULT_LIMITS,readLimits,TokenBucket};
