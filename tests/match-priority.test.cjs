const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_TEST_MODULE||'@electric-sql/pglite');
const matchPriority=require('../lib/match-priority');
(async()=>{
 const db=new PGlite();try{
  await db.exec(`CREATE TABLE matches(id INT PRIMARY KEY,event_name TEXT,team_a TEXT,team_b TEXT,status TEXT,winner TEXT,predictions_voided_at TIMESTAMPTZ,starts_at TIMESTAMPTZ);
   CREATE TABLE predictions(match_id INT,user_id INT,predicted_team TEXT,result TEXT,points_delta INT);
   INSERT INTO matches SELECT n,'Local event','Unknown A','Unknown B','open',NULL,NULL,NOW()+n*INTERVAL '1 hour' FROM generate_series(1,120) n;
   INSERT INTO matches VALUES(121,'IEM Championship','Natus Vincere','Vitality','open',NULL,NULL,NOW()+INTERVAL '200 hours');`);
  const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');let route;
  vm.runInNewContext(server.slice(server.indexOf("app.get('/api/matches',"),server.indexOf("app.get('/api/results',")),{pool:db,matchPriority,app:{get:(p,h)=>route=h}});
  const request=async sort=>{let data;await route({headers:{},query:{sort}},{json:r=>data=r});return data.matches};
  let rows=await request('popular');assert.equal(rows.length,100);assert.equal(rows[0].id,121);assert.equal(rows[0].popularity_score,240);
  assert.equal((await request('asc'))[0].id,1);assert.equal((await request('desc'))[0].id,121);
  assert.equal((await request("desc; DROP TABLE matches"))[0].id,121);
  const score=async(event,a,b)=>Number((await db.query(`SELECT ${matchPriority.scoreSql()} AS score FROM (SELECT $1::text AS event_name,$2::text AS team_a,$3::text AS team_b) m`,[event,a,b])).rows[0].score);
  assert.equal(await score('Local event','FaZe Clan','Team Liquid'),140);
  assert.equal(await score('Local event','FAZE CLAN','team-liquid'),140);
  assert.equal(await score('Local event','G2 Ares','MIBR fe'),0);
  assert.equal(await score('Local event','ex-NAVI','NAVI Junior'),0);
  assert.equal(await score('ESL Pro League','Unknown','Unknown'),80);
  assert.equal(await score('European Pro League','Unknown','Unknown'),0);
  assert.equal(await score('Major Closed Qualifier','Unknown','Unknown'),50);
  assert.equal(await score('Major Main Event','Unknown','Unknown'),100);
  assert.equal(await score(null,null,null),0);
  await db.exec("UPDATE matches SET status='postponed' WHERE id=121");assert.equal((await request('popular'))[0].id,1);
  await db.exec("UPDATE matches SET status='settled',winner='NAVI' WHERE id=121");assert.equal((await request('popular')).some(m=>m.id===121),false);
  // Exercise the actual browser comparator, including deterministic ties.
  const app=fs.readFileSync(path.join(__dirname,'../public/js/app.js'),'utf8');
  const sortCode=app.slice(app.indexOf('const sortedMatches=[...visibleMatches]'),app.indexOf('  if(!visibleMatches.length)'));
  const fixtures=[{id:5,popularity_score:200,status:'postponed',starts_at:'2026-01-01'},
   {id:3,popularity_score:80,status:'open',starts_at:'2026-01-03'},
   {id:2,popularity_score:80,status:'open',starts_at:'2026-01-02'},
   {id:1,popularity_score:80,status:'open',starts_at:'2026-01-02'},
   {id:4,popularity_score:0,status:'running',starts_at:'2026-01-01'}];
  const context=vm.createContext({visibleMatches:fixtures,sortDirection:'popular'});vm.runInContext(sortCode,context);
  assert.deepEqual(Array.from(vm.runInContext('sortedMatches',context),m=>m.id),[1,2,3,4,5]);
  console.log('PASS: PostgreSQL sorting before LIMIT 100, time modes, safe sort input, exact team aliases, qualifiers, postponed/terminal handling and browser ordering');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
