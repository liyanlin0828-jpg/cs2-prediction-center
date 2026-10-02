'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(require('path').join(__dirname,'../public/js/app.js'),'utf8');
const code=source.slice(source.indexOf('let winnerSubmitting=false;'),source.indexOf('window.predict=predict;'));
function page(store,send){
 const confirmations=[];
 const c=vm.createContext({state:{me:{id:1},matches:[{id:1,team_a:'A',team_b:'B',odds_a:2,odds_b:3}]},$:()=>({value:'100'}),sessionStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},crypto:{randomUUID:()=>require('crypto').randomUUID()},window:{confirm:t=>{confirmations.push(t);return true}},toast(){},openAuth(){},loadAll:async()=>{},api:async(p,o)=>send(JSON.parse(o.body))});
 vm.runInContext(code,c);return {c,confirmations};
}
test('lost response survives reload and odds changes without creating a second request',async()=>{
 const store=new Map(),received=[];
 const first=page(store,async r=>{received.push(r);throw new Error('network')});await first.c.predict(1,'A');
 assert.equal(store.size,1);
 const second=page(store,async r=>{received.push(r);return {user:{id:1},duplicate:true}});
 second.c.state.matches[0].odds_a=1.5;await second.c.predict(1,'B');
 assert.deepEqual(received[1],received[0]);assert.equal(store.size,0);
 assert.match(second.confirmations[0],/结果尚未确认/);
 await second.c.predict(1,'B');assert.notEqual(received[2].requestId,received[0].requestId);
});
test('explicit price rejection clears pending request; storage failure sends nothing',async()=>{
 const store=new Map();let calls=0;const p=page(store,async()=>{calls++;throw Object.assign(new Error('price'),{status:409})});
 await p.c.predict(1,'A');assert.equal(store.size,0);
 p.c.sessionStorage.setItem=()=>{throw Error('unavailable')};await p.c.predict(1,'A');assert.equal(calls,1);
});
test('double click while a request is pending sends only once',async()=>{
 const store=new Map();let finish,calls=0;const p=page(store,()=>{calls++;return new Promise(r=>finish=r)});
 const first=p.c.predict(1,'A');await p.c.predict(1,'A');assert.equal(calls,1);finish({user:{id:1}});await first;
});
