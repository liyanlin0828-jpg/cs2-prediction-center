const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/js/admin.js'),'utf8');
let responses=[],calls=[];
const c=vm.createContext({api:async p=>{calls.push(p);return responses.shift()}});
vm.runInContext(source.slice(source.indexOf('async function loadAdminMatches('),source.indexOf('function resetMatchFilters(')),c);
const date=new Date(2026,8,18,12).toISOString();
const rows=[{id:422,external_id:'1664536',team_a:'Drama eSports',team_b:'ZOTIX',event_name:'ESEA',starts_at:date,status:'settled',winner:'ZOTIX',number_of_games:3,actual_map_count:3},
{id:423,team_a:'Alpha',team_b:'Beta',event_name:'Other',starts_at:date,status:'settled',winner:'Alpha',number_of_games:5,actual_map_count:null},
{id:424,starts_at:date,status:'postponed'},{id:425,starts_at:date,status:'postponed',predictions_voided_at:date}];
const ids=o=>Array.from(c.filterAdminMatches(rows,o),m=>m.id);
assert.deepEqual(ids({search:'422'}),[422]);
assert.deepEqual(ids({search:'1664536'}),[422]);
assert.deepEqual(ids({search:'drama'}),[422]);
assert.deepEqual(ids({search:'esea'}),[422]);
assert.deepEqual(ids({search:'42'}),[]);
assert.deepEqual(ids({attention:'maps'}),[423]);
assert.deepEqual(ids({attention:'postponed'}),[424]);
assert.deepEqual(ids({status:'refunded'}),[425]);
assert.deepEqual(ids({attention:'conflicts',conflicts:new Set([422])}),[422]);
assert.deepEqual(ids({status:'settled',from:'2026-09-18',to:'2026-09-18'}),[423,422]);
assert.deepEqual(ids({from:'2026-09-19'}),[]);
assert.deepEqual(Array.from(c.conflictIds('比赛 422 / PandaScore 1664536: conflict; 比赛 422 / PandaScore 1664536')), [422]);
assert.equal(c.needsMaps({...rows[1],predictions_voided_at:date}),false);
assert.equal(c.needsMaps({...rows[1],number_of_games:1}),false);
(async()=>{
 responses=[{matches:Array.from({length:500},(_,i)=>({id:501-i})),nextCursor:2},{matches:[{id:1}],nextCursor:null}];
 const all=await c.loadAdminMatches();assert.equal(all.matches.length,501);assert.equal(calls[1],'/admin/matches?before=2');
 responses=[{matches:[],nextCursor:2},{matches:[],nextCursor:2}];await assert.rejects(c.loadAdminMatches(),/分页异常/);
 responses=[{matches:[],nextCursor:null}];assert.equal((await c.loadAdminMatches()).matches.length,0);
 console.log('PASS: admin ID/team/event/date/status filters, attention groups and multi-page loading');
 if(process.env.PGLITE_TEST_MODULE){
  const {PGlite}=require(process.env.PGLITE_TEST_MODULE),db=new PGlite();
  try{
   await db.exec('CREATE TABLE matches(id BIGINT PRIMARY KEY); INSERT INTO matches SELECT generate_series(1,1001);');
   const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');let handler;
   const ctx=vm.createContext({pool:db,auth:()=>{},admin:()=>{},app:{get:(p,...handlers)=>handler=handlers.at(-1)}});
   vm.runInContext(server.slice(server.indexOf("app.get('/api/admin/matches',"),server.indexOf("app.post('/api/admin/matches',")),ctx);
   const results=[];let cursor,code=200;
   do{let result;await handler({query:cursor?{before:cursor}:{}},{json:r=>result=r});results.push(...result.matches);cursor=result.nextCursor}while(cursor);
   assert.equal(results.length,1001);assert.equal(new Set(results.map(r=>String(r.id))).size,1001);assert.equal(Number(results.at(-1).id),1);
   for(const before of ['0','-1','abc','1.5','9007199254740992']){await handler({query:{before}},{status:s=>{code=s;return {json:()=>{}}}});assert.equal(code,400)}
   console.log('PASS: actual PostgreSQL cursor query returns all 1001 rows exactly once and rejects invalid cursors');
  }finally{await db.close()}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
