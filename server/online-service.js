'use strict';
const {fork} = require('node:child_process');
const path = require('node:path');
const net = require('node:net');
const {readLimits} = require('./limits');
const EMPTY = {rooms:0,sessions:0,players:0,online:0,accounts:0,visitors:0};
class OnlineService {
  constructor(options={}) {
    this.options=options;this.limits=readLimits(options.limits);this.child=null;this.starting=null;this.port=0;this.closed=false;this.sockets=new Set();this.launches=0;this.snapshot={...EMPTY};
  }
  stats(){return {...this.snapshot,gameService:this.port?'running':this.starting?'starting':'stopped'};}
  ensure() {
    if(this.closed)return Promise.reject(Error('service closed'));
    if(this.port&&this.child&&!this.child.killed)return Promise.resolve(this.port);
    if(this.starting)return this.starting;
    const child=fork(path.join(__dirname,'game-service.js'),[],{execArgv:[],windowsHide:true,stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,...this.options.env,MAHJONG_SERVICE_LIMITS:JSON.stringify(this.limits)}});
    this.child=child;this.launches++;
    child.stderr.on('data',chunk=>{if(this.options.log)this.options.log(String(chunk));});
    this.starting=new Promise((resolve,reject)=>{
      let ready=false;
      const timeout=setTimeout(()=>{if(!ready){child.kill();reject(Error('service start timeout'));}},10000);timeout.unref();
      child.on('message',m=>{
        if(this.child!==child||!m)return;
        if(m.t==='ready'&&Number.isInteger(m.port)&&m.port>0&&m.port<65536){ready=true;clearTimeout(timeout);this.port=m.port;this.snapshot=m.stats;resolve(m.port);}
        if(m.t==='stats'&&m.value)this.snapshot=m.value;
      });
      const failed=()=>{clearTimeout(timeout);if(this.child===child){this.child=null;this.port=0;this.snapshot={...EMPTY};}if(!ready)reject(Error('service unavailable'));};
      child.once('error',failed);child.once('exit',failed);
    }).finally(()=>{this.starting=null;});
    return this.starting;
  }
  async upgrade(req,socket,head) {
    if(String(req.url||'').split('?')[0]!=='/ws'){socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;}
    if(this.closed||this.sockets.size>=this.limits.maxSessions){socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;}
    this.sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>this.sockets.delete(socket));socket.pause();
    try {
      const port=await this.ensure();if(socket.destroyed)return;
      const upstream=net.connect({host:'127.0.0.1',port});
      socket.once('close',()=>upstream.destroy());upstream.once('close',()=>socket.destroy());
      upstream.on('error',()=>socket.destroy());upstream.setTimeout(10000,()=>upstream.destroy());
      upstream.once('connect',()=>{
        upstream.setTimeout(0);
        let headers=req.method+' '+req.url+' HTTP/'+req.httpVersion+'\r\n';
        for(let i=0;i<req.rawHeaders.length;i+=2)headers+=req.rawHeaders[i]+': '+req.rawHeaders[i+1]+'\r\n';
        upstream.write(headers+'\r\n');if(head.length)upstream.write(head);
        upstream.pipe(socket);socket.pipe(upstream);socket.resume();
      });
    }catch(e){if(!socket.destroyed)socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 2\r\nContent-Length: 0\r\n\r\n');}
  }
  async close() {
    this.closed=true;const child=this.child;
    if(child){await new Promise(resolve=>{const timeout=setTimeout(()=>{child.kill();resolve();},4500);timeout.unref();child.once('exit',()=>{clearTimeout(timeout);resolve();});if(child.connected)child.send({t:'stop'});else{child.kill();resolve();}});}
    for(const socket of this.sockets)socket.destroy();this.sockets.clear();
  }
}
module.exports={OnlineService};
