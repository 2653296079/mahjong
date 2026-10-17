'use strict';
// 独立的真实 TCP 测试客户端，允许携带 Cookie；不复用服务端解析器。
const http=require('node:http'),crypto=require('node:crypto');
function connect(port,cookie=''){
  return new Promise((resolve,reject)=>{
    const client={messages:[],socket:null,closed:false,send(value){
      const body=Buffer.from(JSON.stringify(value)),mask=crypto.randomBytes(4),header=Buffer.alloc(body.length<126?2:4);
      header[0]=0x81;header[1]=0x80|(body.length<126?body.length:126);if(body.length>=126)header.writeUInt16BE(body.length,2);
      const coded=Buffer.from(body);for(let i=0;i<coded.length;i++)coded[i]^=mask[i%4];client.socket.write(Buffer.concat([header,mask,coded]));
    },close(){if(client.socket)client.socket.destroy();}};
    let buffer=Buffer.alloc(0);
    function receive(chunk){buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=2){
      let length=buffer[1]&127,start=2;if(length===126){if(buffer.length<4)return;length=buffer.readUInt16BE(2);start=4;}else if(length===127){if(buffer.length<10)return;length=Number(buffer.readBigUInt64BE(2));start=10;}
      if(length>1024*1024){client.close();return;}if(buffer.length<start+length)return;
      const opcode=buffer[0]&15,body=buffer.subarray(start,start+length);buffer=buffer.subarray(start+length);
      if(opcode===1)client.messages.push(JSON.parse(body.toString()));if(opcode===8)client.close();
    }}
    const req=http.request({hostname:'127.0.0.1',port,path:'/ws',headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':crypto.randomBytes(16).toString('base64'),...(cookie?{Cookie:cookie}:{})}});
    req.on('upgrade',(res,socket,head)=>{client.socket=socket;socket.on('error',()=>{});socket.on('close',()=>{client.closed=true;});socket.on('data',receive);if(head.length)receive(head);resolve(client);});
    req.on('response',res=>{res.resume();reject(Error('HTTP '+res.statusCode));});req.on('error',reject);req.setTimeout(12000,()=>req.destroy(Error('handshake timeout')));req.end();
  });
}
module.exports={connect};
