'use strict';
// Reuse the reviewed, project-native SVG artwork. No generated-image pixels or API calls.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../../..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const start=html.indexOf('  var CN_NUM = '),end=html.indexOf('  function tileEl(',start);
if(start<0||end<0)throw Error('Cannot locate the production tile artwork');
const context={};vm.createContext(context);
vm.runInContext(html.slice(start,end),context,{timeout:2000});
const out=path.join(__dirname,'svg');fs.mkdirSync(out,{recursive:true});
const names=['一','二','三','四','五','六','七','八','九'],suits=['wan','suo','tong'],ch=['万','条','筒'];
const assets=[];
for(let kind=0;kind<27;kind++){
 const suit=Math.floor(kind/9),rank=kind%9+1,id=suits[suit]+'-'+String(rank).padStart(2,'0');
 fs.writeFileSync(path.join(out,id+'.svg'),context.tileFace(kind));
 assets.push({id,kind,rank,suit:suits[suit],name:names[rank-1]+ch[suit]});
}
fs.writeFileSync(path.join(__dirname,'faces.json'),JSON.stringify(assets,null,2));
console.log('Extracted '+assets.length+' production SVG faces.');
