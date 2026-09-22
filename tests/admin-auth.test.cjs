const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'server.js'),'utf8');

// Execute actual route registration and guards without starting the production server.
// JWT verification is a fixture; signature verification code is unchanged by this fix.
function fixture(secret='test-only-private-secret'){
  const routes=[],calls=[],users=new Map([[1,{id:1,username:'admin',role:'admin'}],[2,{id:2,username:'player',role:'user'}]]);
  let unavailable=false,started=false;
  const app={disable(){},use(){},listen(){started=true}};
  for(const method of ['get','post','delete','put','patch'])app[method]=(url,...handlers)=>routes.push({method,url,handlers});
  const express=()=>app;express.json=express.static=()=>()=>{};
  const pool={async query(sql,params){
    calls.push({sql,params});
    assert.equal(sql,'SELECT id,username,role FROM users WHERE id=$1');
    if(unavailable)throw Error('Database unavailable');
    return {rows:users.has(params[0])?[{...users.get(params[0])}]:[]};
  },connect(){throw Error('Business operation must not execute in guard tests')}};
  const tokens={player:{id:2,username:'player',role:'user'},admin:{id:1,username:'admin',role:'admin'}};
  const context=vm.createContext({console,process:{env:{JWT_SECRET:secret}},__dirname:root,AbortSignal,
    setTimeout(){},setInterval(){return {unref(){}}},
    require(name){
      if(name==='dotenv')return {config(){}};
      if(name==='express')return express;
      if(name==='pg')return {Pool:function(){return pool}};
      if(name==='bcryptjs')return {};
      if(name==='jsonwebtoken')return {verify(token){if(!tokens[token])throw Error('Invalid token fixture');return {...tokens[token]}}};
      return require(name.startsWith('.')?path.join(root,name):name);
    }
  });
  vm.runInContext(source,context);
  const adminRoutes=routes.filter(r=>r.url.startsWith('/api/admin/'));
  async function check(route,token){
    const req={headers:token?{authorization:'Bearer '+token}:{},body:{role:'admin',userId:1},params:{id:1},query:{role:'admin'}};
    const res={code:200,status(code){this.code=code;return this},json(body){this.body=body;return this}};
    let authenticated=false,allowed=false;
    await route.handlers[0](req,res,()=>{authenticated=true});
    if(authenticated)await route.handlers[1](req,res,()=>{allowed=true});
    return {status:res.code,allowed,req};
  }
  return {adminRoutes,calls,users,tokens,check,started,setUnavailable(value){unavailable=value}};
}

test('missing, blank and known default secrets fail startup; private value starts',()=>{
  for(const secret of [null,'','  ','change-this-secret',' change-this-secret ']){
    assert.throws(()=>fixture(secret),/JWT_SECRET must be configured/);
  }
  assert.equal(fixture().started,true);
});
test('all admin routes reject missing/invalid tokens and current ordinary users',async()=>{
  const f=fixture();assert.equal(f.adminRoutes.length,24);
  for(const route of f.adminRoutes){
    assert.equal(route.handlers[0].name,'auth');assert.equal(route.handlers[1].name,'admin');
    for(const [token,status] of [[null,401],['invalid',401],['player',403]]){
      const before=f.calls.length,result=await f.check(route,token);
      assert.equal(result.status,status,route.url);assert.equal(result.allowed,false,route.url);
      assert.equal(f.calls.length-before,token==='player'?1:0);
    }
  }
});
test('same admin token stops working after demotion or deletion on every management route',async()=>{
  const f=fixture();
  for(const route of f.adminRoutes){
    f.users.set(1,{id:1,username:'renamed-admin',role:'admin'});
    let result=await f.check(route,'admin');assert.equal(result.allowed,true,route.url);
    assert.equal(result.req.user.username,'renamed-admin');
    f.users.get(1).role='user';result=await f.check(route,'admin');
    assert.equal(result.status,403,route.url);assert.equal(result.allowed,false);
    f.users.delete(1);result=await f.check(route,'admin');
    assert.equal(result.status,401,route.url);assert.equal(result.allowed,false);
  }
});
test('database failure denies all management operations without using cached token role',async()=>{
  const f=fixture();f.setUnavailable(true);
  for(const route of f.adminRoutes){const result=await f.check(route,'admin');assert.equal(result.status,503);assert.equal(result.allowed,false)}
  f.setUnavailable(false);assert.equal((await f.check(f.adminRoutes[0],'admin')).allowed,true);
});
test('current database role is authoritative, including a newly promoted user',async()=>{
  const f=fixture();f.users.get(2).role='admin';
  const result=await f.check(f.adminRoutes[0],'player');
  assert.equal(result.allowed,true);assert.equal(result.req.user.id,2);assert.equal(result.req.user.role,'admin');
});
