'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const {PGlite}=require(process.env.PGLITE_TEST_MODULE);
const market=require('../lib/winner-market'),lifecycle=require('../lib/match-lifecycle');
(async()=>{
 const db=new PGlite();let tail=Promise.resolve();
 const query=async(...args)=>{if(process.env.TRACE_TEST)console.log(args[0].slice(0,80));const r=await db.query(...args);return {...r,rowCount:r.affectedRows??r.rows.length}};
 const pool={connect:async()=>{const prev=tail;let release;tail=new Promise(r=>release=r);await prev;return {query,release}}};
 const row=async(sql)=>(await query(sql)).rows[0];
 const input={matchId:1,team:'Alpha',stakePoints:100,expectedOdds:1.8,requestId:'request_0000000001'};
 try{
 await db.exec(fs.readFileSync(path.join(__dirname,'../db/schema.sql'),'utf8'));
 for(let n=2;n<=26;n++)await db.exec(fs.readFileSync(path.join(__dirname,`../db/migration_v${n}.sql`),'utf8'));
 console.log('PASS migrations');
 await db.exec(fs.readFileSync(path.join(__dirname,'../db/migration_v26.sql'),'utf8'));
 await db.exec("INSERT INTO users(id,username,password_hash,points) VALUES(1,'test','x',1000); INSERT INTO matches(id,event_name,team_a,team_b,starts_at) VALUES(1,'test','Alpha','Beta',NOW()+INTERVAL '3 hours')");
 const attempts=await Promise.allSettled([market.place(pool,1,input),market.place(pool,1,input)]); for(const a of attempts)if(a.status==='rejected')throw a.reason;
 assert.equal((await row('SELECT COUNT(*)::int AS n FROM predictions')).n,1);
 assert.deepEqual(await row('SELECT points,locked_points FROM users'),{points:900,locked_points:100});
 await assert.rejects(market.place(pool,1,{...input,stakePoints:200}),/不一致/);
 await db.exec('UPDATE matches SET odds_a=2');
 await market.place(pool,1,input); // Exact retry still works after quote changes.
 await assert.rejects(market.place(pool,1,{...input,requestId:'request_0000000002'}),/赔率已变化/);
 await market.place(pool,1,{...input,expectedOdds:2,requestId:'request_0000000002'});
 assert.deepEqual((await query('SELECT odds_at_prediction FROM predictions ORDER BY id')).rows.map(x=>Number(x.odds_at_prediction)),[1.8,2]);
 const now=Date.now();const live={...await row('SELECT * FROM matches'),status:'running',live_market:{status:'open',connected:true,provider:'fixture',version:'1',matchId:1,teamA:'Alpha',teamB:'Beta',a:2,b:2,observedAt:new Date(now-100).toISOString(),expiresAt:new Date(now+1000).toISOString()}};
 assert.equal(market.quote(live,false,now),null);assert.equal(market.quote(live,true,now).phase,'live');
 for(const change of [{status:'suspended'},{connected:false},{teamA:'Other'},{expiresAt:new Date(now-1).toISOString()},{observedAt:new Date(now-11000).toISOString()},{observedAt:new Date(now+100).toISOString()}])assert.equal(market.quote({...live,live_market:{...live.live_market,...change}},true,now),null);
 await db.exec("UPDATE matches SET status='running'");
 await assert.rejects(market.place(pool,1,{...input,expectedOdds:2,requestId:'request_0000000003'}),/封盘/);
 await market.place(pool,1,input); // Retry after market closure is harmless.
 await lifecycle.refund(pool,1);
 assert.deepEqual(await row('SELECT points,locked_points FROM users'),{points:1000,locked_points:0});
 await lifecycle.refund(pool,1);assert.equal((await row('SELECT points FROM users')).points,1000);
 // Exercise the actual production settlement and undo functions with two tickets.
 const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');const routes={};
 const context=vm.createContext({pool,auditedPool:require('../lib/admin-audit').auditedPool,mapMarket:require('../lib/map-market'),mapSelection:require('../lib/map-selection'),console,auth(){},admin(){},app:{get:(p,...h)=>routes[p]=h.at(-1),post:(p,...h)=>routes[p]=h.at(-1)}});
 vm.runInContext(source.slice(source.indexOf('async function settleMatch('),source.indexOf('async function syncRunning(')),context);
 vm.runInContext(source.slice(source.indexOf("app.get('/api/admin/matches/:id/prediction-audit'"),source.indexOf("app.delete('/api/admin/matches/:id'")),context);
 await db.exec("INSERT INTO matches(id,event_name,team_a,team_b,starts_at) VALUES(2,'test','Alpha','Beta',NOW()+INTERVAL '3 hours')");
 await market.place(pool,1,{...input,matchId:2,requestId:'request_0000000004'});
 const beforeFailure=await row('SELECT points,locked_points FROM users');
 const failingPool={connect:async()=>{const c=await pool.connect();return {...c,query:async(sql,p)=>{if(sql.startsWith('INSERT INTO predictions'))throw new Error('injected insert failure');return c.query(sql,p)}}}};
 await assert.rejects(market.place(failingPool,1,{...input,matchId:2,requestId:'request_failure_01'}),/injected/);
 assert.deepEqual(await row('SELECT points,locked_points FROM users'),beforeFailure);
 await db.exec('UPDATE matches SET odds_a=2 WHERE id=2');
 await market.place(pool,1,{...input,matchId:2,expectedOdds:2,requestId:'request_0000000005'});
 await context.settleMatch(2,'Alpha');await context.settleMatch(2,'Alpha');
 assert.deepEqual(await row('SELECT points,locked_points FROM users'),{points:1180,locked_points:0});
 let status=200;await routes['/api/admin/matches/:id/unsettle']({params:{id:2},user:{id:1}},{status(s){status=s;return this},json(){}});
 assert.equal(status,200);assert.deepEqual(await row('SELECT points,locked_points FROM users'),{points:800,locked_points:200});
 await context.settleMatch(2,'Beta');assert.deepEqual(await row('SELECT points,locked_points FROM users'),{points:800,locked_points:0});
 console.log('PASS multi-ticket settlement, duplicate settlement, audited undo, corrected winner');
 console.log('PASS independent locked odds, concurrent retries, conflicting request rejection, changed odds, live disabled, stale/disconnected/suspended feeds, multi-ticket refund');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
