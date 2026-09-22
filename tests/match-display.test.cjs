const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/js/app.js'),'utf8');
const c=vm.createContext({state:{lang:'zh'},countdown:()=> 'countdown'});
vm.runInContext(source.slice(source.indexOf('function isLiveMatch('),source.indexOf('function renderMatches(')),c);
const now=new Date(2026,8,18,12).getTime(),date=h=>new Date(2026,8,18,h).toISOString();
const live={status:'running',starts_at:date(10)};
for(const status of ['settled','canceled','postponed','open'])assert.equal(c.isLiveMatch({status,source_status:'running'}),false);
assert.equal(c.isLiveMatch({...live,winner:'Alpha'}),false);
assert.equal(c.isLiveMatch({...live,predictions_voided_at:'now'}),false);
assert.equal(c.matchesFilter(live,'live',now),true);
assert.equal(c.matchesFilter(live,'all',now),true);
assert.equal(c.matchesFilter(live,'today',now),true);
const held={status:'postponed',source_status:'running',starts_at:date(10)};
assert.equal(c.matchesFilter(held,'all',now),true);
assert.equal(c.matchesFilter(held,'today',now),false);
assert.equal(c.matchesFilter({...held,predictions_voided_at:'now'},'all',now),false);
assert.equal(c.matchesFilter({status:'open',starts_at:date(13)},'today',now),true);
assert.equal(c.matchesFilter({status:'open',starts_at:date(11)},'all',now),false);
assert.equal(c.matchesFilter({status:'open',starts_at:date(24)},'today',now),false);
assert.equal(c.matchesFilter({status:'open',starts_at:date(24)},'tomorrow',now),true);
assert.equal(c.matchesFilter({status:'settled',winner:'Alpha'},'finished',now),true);
assert.equal(c.matchesFilter({status:'canceled',winner:'Alpha'},'finished',now),false);
assert.match(c.matchTimeLabel(live),/进行中/);
assert.match(c.matchTimeLabel(held),/延期/);
console.log('PASS: live/terminal precedence, held schedules, all/today counts, day boundaries and labels');
// Optional real SQL check, same local engine used by lifecycle regression tests.
if(process.env.PGLITE_TEST_MODULE)(async()=>{
 const {PGlite}=require(process.env.PGLITE_TEST_MODULE),db=new PGlite();
 try{
  await db.exec(`CREATE TABLE matches(id INT,status TEXT,source_status TEXT,winner TEXT,predictions_voided_at TIMESTAMPTZ,starts_at TIMESTAMPTZ);
  CREATE TABLE predictions(match_id INT,user_id INT,predicted_team TEXT,result TEXT,points_delta INT);
  INSERT INTO matches VALUES(1,'running','running',NULL,NULL,NOW()-INTERVAL '2 hours'),(2,'postponed','running',NULL,NULL,NOW()-INTERVAL '1 day'),(3,'canceled','running',NULL,NULL,NOW()),(4,'settled','running','A',NULL,NOW()),(5,'postponed','running',NULL,NOW(),NOW()),(6,'open','running',NULL,NULL,NOW()-INTERVAL '1 hour'),(7,'open','not_started',NULL,NULL,NOW()+INTERVAL '1 day');`);
  await db.exec('ALTER TABLE matches ADD COLUMN event_name TEXT, ADD COLUMN team_a TEXT, ADD COLUMN team_b TEXT');
  const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');let route;
  const ctx=vm.createContext({pool:db,matchPriority:require('../lib/match-priority'),app:{get:(p,h)=>route=h}});
  vm.runInContext(server.slice(server.indexOf("app.get('/api/matches',"),server.indexOf("app.get('/api/results',")),ctx);
  let data;await route({headers:{}},{json:r=>data=r});
  assert.deepEqual(data.matches.map(m=>m.id),[1,7,2]);
  console.log('PASS: PostgreSQL active list excludes terminal/voided/stale-source rows and prioritizes live');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
