'use strict';
// 私有联机进程，由公开入口按需启动；不对外开放第二个端口。
const http = require('node:http');
const path = require('node:path');
const {AccountStore} = require('./account-store');
const {attach} = require('./mjs-server');
const accounts = new AccountStore(process.env.MAHJONG_DB_PATH || path.join(__dirname,'..','data','mahjong.sqlite'));
const server = http.createServer((req,res)=>{res.writeHead(404);res.end();});
const limits={};
for(const [key,envName] of Object.entries({maxSessions:'MAHJONG_MAX_SESSIONS',maxRooms:'MAHJONG_MAX_ROOMS',messageRate:'MAHJONG_MESSAGE_RATE',messageBurst:'MAHJONG_MESSAGE_BURST'}))if(process.env[envName]!==undefined)limits[key]=Number(process.env[envName]);
if(process.env.MAHJONG_SERVICE_LIMITS)Object.assign(limits,JSON.parse(process.env.MAHJONG_SERVICE_LIMITS));
function report(value) { if(process.connected)process.send({t:'stats',value}); }
const hub=attach(server,{accounts,limits,onStats:report});
server.listen(0,'127.0.0.1',()=>{if(process.connected)process.send({t:'ready',port:server.address().port,stats:hub.stats()});});
let stopping=false;
function stop(){if(stopping)return;stopping=true;hub.close();server.close(()=>{accounts.close();process.exit(0);});setTimeout(()=>process.exit(1),4000).unref();}
process.on('message',m=>{if(m&&m.t==='stop')stop();});
process.on('disconnect',stop);process.on('SIGTERM',stop);process.on('SIGINT',stop);
