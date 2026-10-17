'use strict';
const http=require('node:http');
const net=require('node:net');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const ROOT=path.join(__dirname,'..');
function health(port){return new Promise(resolve=>{
  const req=http.get({hostname:'127.0.0.1',port,path:'/healthz',timeout:700},res=>{let body='';res.on('data',d=>{body+=d;if(body.length>8192)req.destroy();});res.on('end',()=>{try{resolve(JSON.parse(body));}catch{resolve(null);}});});
  req.on('timeout',()=>req.destroy());req.on('error',()=>resolve(null));
});}
function occupied(port){return new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.setTimeout(700);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(true);});});}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function ensureServer(options={}){
  const port=Number(options.port||8000);if(!Number.isInteger(port)||port<1||port>65535)throw Error('端口不正确');
  const ready=await health(port);
  if(ready&&ready.app==='zhuanzhuan-mahjong')return {port,reused:true};
  if(await occupied(port))throw Error('该端口正在运行其他服务或旧版麻将，请先关闭旧版服务后再打开。');
  const dir=options.directory||path.join(ROOT,'data');fs.mkdirSync(dir,{recursive:true});
  const lock=path.join(dir,'launcher-'+port+'.lock');let fd;
  try{fd=fs.openSync(lock,'wx');}catch(e){
    if(e.code!=='EEXIST')throw e;
    if(Date.now()-fs.statSync(lock).mtimeMs>30000){fs.unlinkSync(lock);return ensureServer(options);}
    for(let i=0;i<60;i++){await pause(200);const h=await health(port);if(h&&h.app==='zhuanzhuan-mahjong')return {port,reused:true};}
    throw Error('启动仍在进行，请稍后再试。');
  }
  try{
    // 持锁后再次检测，防止两次打开入口导致重复启动。
    const again=await health(port);if(again&&again.app==='zhuanzhuan-mahjong')return {port,reused:true};
    const output=fs.openSync(path.join(dir,'server-'+port+'.log'),'a');
    const child=spawn(process.execPath,[path.join(ROOT,'server.js'),String(port)],{cwd:ROOT,detached:true,windowsHide:true,stdio:['ignore',output,output],env:{...process.env,...options.env}});fs.closeSync(output);child.unref();
    let spawnError=null;child.on('error',e=>{spawnError=e;});
    for(let i=0;i<60;i++){if(spawnError)throw spawnError;await pause(200);const h=await health(port);if(h&&h.app==='zhuanzhuan-mahjong')return {port,reused:false,pid:child.pid};if(child.exitCode!=null)break;}
    throw Error('服务未能启动，请查看 data 中对应的服务器日志。');
  }finally{fs.closeSync(fd);try{fs.unlinkSync(lock);}catch{}}
}
function openBrowser(url){const u=new URL(url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('联机入口必须是 HTTP(S) 网址');const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',u.href],{detached:true,windowsHide:true,stdio:'ignore'});child.on('error',()=>{});child.unref();}
if(require.main===module)ensureServer({port:process.argv.slice(2).find(arg=>!arg.startsWith('--'))}).then(result=>{const url=process.env.MAHJONG_PUBLIC_URL||'http://127.0.0.1:'+result.port+'/?online=1';console.log(result.reused?'已连接现有服务。':'已自动启动服务。');if(!process.argv.includes('--no-open'))openBrowser(url);}).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={ensureServer,health};
