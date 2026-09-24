const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require(process.env.PGLITE_TEST_MODULE||'@electric-sql/pglite');
const {createTeamService}=require('../lib/team-profiles');
(async()=>{const db=new PGlite();try{
 await db.exec(`CREATE TABLE matches(id INT PRIMARY KEY,team_a TEXT,team_b TEXT,source TEXT,status TEXT,starts_at TIMESTAMPTZ,winner TEXT,predictions_voided_at TIMESTAMPTZ,event_name TEXT,score_a INT,score_b INT);`);
 await db.exec(fs.readFileSync(require('node:path').join(__dirname,'../db/migration_v22.sql'),'utf8'));
 const ranking={sync:async()=>{},get:async()=>({date:'2026-09-21',teams:[{hltvId:7020,name:'Spirit',rank:1,players:['donk','sh1ro']} ]})};
 const service=createTeamService({query:(...a)=>db.query(...a)},async()=>{throw Error('Detail must not fetch')},ranking);
 await db.query('INSERT INTO team_profiles(id,data) VALUES(124523,$1)',[JSON.stringify({id:124523,name:'Spirit',players:[{nickname:'donk'}]})]);
 await db.exec(`INSERT INTO matches(id,team_a,team_b,source,status,starts_at,winner) VALUES
 (1,'Spirit','G2','pandascore','open',NOW()+INTERVAL '2 days',NULL),
 (2,'G2','Team Spirit','pandascore','running',NOW()-INTERVAL '1 hour',NULL),
 (3,'Spirit Academy','G2','pandascore','open',NOW()+INTERVAL '1 day',NULL),
 (4,'Spirit','G2','manual','settled',NOW(),'Spirit'),
 (5,'Spirit','G2','pandascore','settled',NOW(),'Spirit'),
 (6,'Spirit','G2','pandascore','postponed',NOW()-INTERVAL '1 day',NULL),
 (7,'Spirit','G2','pandascore','open',NOW()+INTERVAL '1 day',NULL),
 (8,'Spirit','G2','pandascore','settled',NOW(),'G2');
 UPDATE matches SET predictions_voided_at=NOW() WHERE id=8;
 INSERT INTO match_team_links(match_id,team_a_id,team_b_id,team_a_name,team_b_name) VALUES(7,999,22,'Spirit','G2');`);
 const d=await service.detail(7020);assert.deepEqual(d.upcoming.map(m=>m.id),[2,1,6]);assert.deepEqual(d.results.map(m=>m.id),[5]);assert.equal(d.results[0].score_a,null);assert.equal(await service.detail(1),null);
 await db.exec(`INSERT INTO matches(id,team_a,team_b,source,status,starts_at,winner) SELECT n,'Spirit','G2','pandascore','settled',NOW()-n*INTERVAL '1 day','Spirit' FROM generate_series(10,25)n;`);
 assert.equal((await service.detail(7020)).results.length,10);
 console.log('PASS: exact main team aliases, opponent-ID precedence, academy/manual/void exclusion, live/upcoming/postponed order, score absence and ten-result limit');
 }finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
