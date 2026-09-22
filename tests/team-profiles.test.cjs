const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_TEST_MODULE||'@electric-sql/pglite');
const {createTeamService,normalizeTeam,imageUrl}=require('../lib/team-profiles');
(async()=>{
 const db=new PGlite();try{
  await db.exec(`CREATE TABLE matches(id INT PRIMARY KEY,external_id TEXT,event_name TEXT,team_a TEXT,team_b TEXT,source TEXT,status TEXT,starts_at TIMESTAMPTZ,winner TEXT,predictions_voided_at TIMESTAMPTZ);
   INSERT INTO matches VALUES(1,'101','IEM','Vitality','G2','pandascore','open',NOW()+INTERVAL '1 day',NULL,NULL);`);
  await db.exec(fs.readFileSync(path.join(__dirname,'../db/migration_v22.sql'),'utf8'));
  const pool={query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
  let requests=[],fail=false,players=[{id:10,name:'PlayerOne',nationality:'CN',image_url:'https://cdn.pandascore.co/player.png'}],wrong=false;
  const panda=async url=>{
   requests.push(url);if(fail)throw Error('fixture outage');
   if(url.includes('filter[name]='))return [{id:900,name:'Natus Vincere',players:[{id:901,name:'FeaturedPlayer'}]},{id:902,name:'NAVI Junior',players:[]}];
   const ids=url.split('filter[id]=')[1].split(',').map(Number);
   if(url.startsWith('/matches?'))return ids.map(id=>({id,opponents:[{opponent:{id:2,name:'G2'}},{opponent:{id:1,name:wrong?'Unrelated':'Vitality'}}]}));
   return [{id:1,name:'Vitality',location:'CN',players},{id:2,name:'G2',players:[]}].filter(t=>ids.includes(t.id));
  };
  const service=createTeamService(pool,panda);
  await Promise.all([service.sync(),service.sync()]);assert.equal(requests.length,3);
  let result=await service.forMatch(1);assert.equal(result.teams[0].profile.name,'Vitality');assert.equal(result.teams[0].profile.players[0].nickname,'PlayerOne');assert.equal(result.teams[1].profile.players.length,0);
  assert.equal(result.sync.stale,false);await service.sync();assert.equal(requests.length,3);
  const due=()=>db.exec("UPDATE team_sync_state SET checked_at=NOW()-INTERVAL '16 minutes'");
  await due();players=[{id:11,name:'NewPlayer',nationality:null}];await service.sync();
  result=await service.forMatch(1);assert.deepEqual(result.teams[0].profile.players.map(p=>p.id),[11]);
  await due();fail=true;await service.sync();result=await service.forMatch(1);assert.equal(result.sync.stale,true);assert.equal(result.teams[0].profile.players[0].id,11);
  fail=false;await due();players=[];await service.sync();assert.equal((await service.forMatch(1)).teams[0].profile.players.length,0);
  await db.exec("UPDATE matches SET team_a='New opponent' WHERE id=1");assert.equal((await service.forMatch(1)).teams[0].profile,null);
  await db.exec("UPDATE matches SET team_a='Vitality' WHERE id=1; DELETE FROM match_team_links");
  await due();wrong=true;await service.sync();assert.equal((await service.forMatch(1)).teams[0].profile,null);wrong=false;
  // Atomic writes: a failed link insert must not publish a partially updated roster.
  await db.exec('ALTER TABLE match_team_links ADD CONSTRAINT reject_link CHECK(match_id<0)');
  await due();players=[{id:12,name:'MustRollback'}];await service.sync();assert.equal((await service.list()).teams.find(t=>t.id===1).players.length,0);
  await db.exec('ALTER TABLE match_team_links DROP CONSTRAINT reject_link');
  await db.exec("INSERT INTO matches SELECT n,(100+n)::text,'IEM','Vitality','G2','pandascore','open',NOW()+INTERVAL '1 day',NULL,NULL FROM generate_series(2,105)n");
  await due();requests=[];await service.sync();assert.equal(requests.filter(u=>u.startsWith('/matches?')).length,2);assert.equal((await service.forMatch(105)).teams[0].profile.players[0].id,12);
  assert.equal(imageUrl('javascript:alert(1)'),null);assert.equal(imageUrl('https://pandascore.co.evil.test/x'),null);
  assert.equal(normalizeTeam({id:1,name:'Vitality'}).rosterKnown,false);
  assert.equal(normalizeTeam({id:1,name:'Vitality',players:[{id:1,name:'A'},{id:1,name:'A'},{id:0,name:'Invalid'}]}).players.length,1);
  assert.equal(await service.forMatch(9999),null);
  await db.query('INSERT INTO team_profiles(id,data) VALUES($1,$2)',[903,JSON.stringify({id:903,name:'G2 Ares',players:[]})]);
  let directory=await service.list();assert.equal(directory.teams[0].name,'G2');assert.ok(directory.teams.some(t=>t.id===900));assert.ok(!directory.teams.some(t=>[902,903].includes(t.id)));
  await db.exec('DELETE FROM matches');await due();requests=[];await service.sync();
  assert.equal(requests.length,1);assert.ok(requests[0].includes('filter[name]='));assert.equal((await service.list()).sync.stale,false);
  assert.equal((await service.list()).teams.find(t=>t.id===900).players[0].nickname,'FeaturedPlayer');
  // Follow featured pagination, and retain previous profiles if that source later fails.
  await due();let pages=[];
  const paged=createTeamService(pool,async url=>{const page=Number(new URL(url,'https://example.test').searchParams.get('page'));pages.push(page);return page===1?Array.from({length:100},(_,n)=>({id:2000+n,name:'NAVI Junior',players:[]})):[{id:9010,name:'Team Spirit',players:[]}];});
  await paged.sync();assert.deepEqual(pages,[1,2]);assert.ok((await paged.list()).teams.some(t=>t.name==='Team Spirit'));assert.ok(!(await paged.list()).teams.some(t=>t.name==='NAVI Junior'));
  await due();await createTeamService(pool,async()=>{throw Error('featured outage')}).sync();assert.equal((await paged.list()).sync.stale,true);assert.ok((await paged.list()).teams.some(t=>t.name==='Team Spirit'));
  let forced=0;const startup=createTeamService(pool,async()=>{forced++;return [{id:9100,name:'Falcons',players:[]},{id:9101,name:'Team Falcons',players:Array.from({length:5},(_,n)=>({id:9200+n,name:'P'+n}))},{id:9300,name:'The Mongolz',players:[{id:9301,name:'M'}]}]});
  await startup.sync();assert.equal(forced,0);await startup.sync({force:true});assert.equal(forced,1);
  const finalTeams=(await startup.list()).teams;assert.equal(finalTeams.filter(t=>/falcons/i.test(t.name)).length,1);assert.equal(finalTeams.find(t=>/falcons/i.test(t.name)).id,9101);assert.ok(finalTeams.some(t=>t.name==='The Mongolz'));
  console.log('PASS: real SQL, ID matching with reversed opponents, refresh interval, single-flight, roster replacement, cache on failure, identity mismatch, atomic rollback, 100-ID batches, missing data and safe image URLs');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
