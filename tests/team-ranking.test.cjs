const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_TEST_MODULE||'@electric-sql/pglite');
const {createRankingService,validate,parseRanking,indexTeams}=require('../lib/team-ranking');
const {createTeamService}=require('../lib/team-profiles');
const seed=require('../data/hltv-top100.json');
(async()=>{
 assert.equal(validate(seed).teams.length,100);
 assert.throws(()=>validate({...seed,teams:seed.teams.slice(0,99)}));
 assert.throws(()=>validate({...seed,date:'2026-09-20'}));
 const duplicate=structuredClone(seed);duplicate.teams[99].hltvId=duplicate.teams[0].hltvId;assert.throws(()=>validate(duplicate));
 const html=seed.teams.map(t=>`<div class="ranking-header"><span class="position wide-position">#${t.rank}</span><span class="name">${t.name.replaceAll('&','&amp;')}</span>${t.players.map(p=>`<div class="rankingNicknames"><span>${p}</span></div>`).join('')}</div><a href="/team/${t.hltvId}/team">Profile</a>`).join('');
 assert.deepEqual(parseRanking(html,seed.sourceUrl),seed);assert.throws(()=>parseRanking('<html>Blocked</html>',seed.sourceUrl));
 assert.equal(indexTeams(seed).get('spirit').rank,1);assert.equal(indexTeams(seed).get('teamspirit'),undefined);
 const academy=structuredClone(seed);academy.teams[99].name='NAVI Junior';assert.equal(indexTeams(academy).has('navijunior'),false);
 const db=new PGlite();try{
  await db.exec(fs.readFileSync(path.join(__dirname,'../db/migration_v23.sql'),'utf8'));
  await db.exec('CREATE TABLE team_profiles(id BIGINT PRIMARY KEY,data JSONB,synced_at TIMESTAMPTZ); CREATE TABLE team_sync_state(id INT,success_at TIMESTAMPTZ,failed BOOLEAN);');
  const pool={query:(...a)=>db.query(...a)};let count=0,broken=false;
  const ranking=createRankingService(pool,async()=>{count++;if(broken)throw Error('fixture 403');return seed});
  await Promise.all([ranking.sync(),ranking.sync()]);assert.equal(count,1);assert.equal((await ranking.get()).failed,false);
  await ranking.sync();assert.equal(count,1);
  await db.exec("UPDATE team_ranking_cache SET checked_at=NOW()-INTERVAL '25 hours'");broken=true;await ranking.sync();assert.equal(count,2);assert.equal((await ranking.get()).failed,true);assert.equal((await ranking.get()).teams.length,100);
  const service=createTeamService(pool,async()=>{throw Error('List must never fetch Panda')},ranking);
  const result=await service.list();assert.equal(result.teams.length,100);assert.deepEqual(result.teams.map(t=>t.rank),Array.from({length:100},(_,i)=>i+1));assert.equal(result.coverage.profiles,0);assert.ok(result.teams[0].aliases.includes('Team Spirit'));
  await db.query('INSERT INTO team_profiles VALUES(1,$1,NOW())',[JSON.stringify({id:1,name:'Spirit',players:[{nickname:'donk'},{nickname:'sh1ro'}]})]);
  const filled=await service.list();assert.equal(filled.coverage.profiles,1);assert.equal(filled.teams[0].id,1);assert.equal(filled.teams[99].name,'UNiTY');
  console.log('PASS: complete top100, ranking parser, invalid/duplicate/date rejection, daily single-flight cache, source outage, ordered placeholders, Spirit alias and profile coverage');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
