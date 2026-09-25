const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require(process.env.PGLITE_TEST_MODULE||'@electric-sql/pglite');
const {createTeamService,createPlayerEnricher,normalizeTeam}=require('../lib/team-profiles');
const {indexTeams}=require('../lib/team-ranking'),seed=require('../data/hltv-top100.json');
(async()=>{const db=new PGlite();try{
 await db.exec('CREATE TABLE team_profiles(id bigint,data jsonb,synced_at timestamptz);CREATE TABLE team_sync_state(id integer,success_at timestamptz,failed boolean)');
 const names={DENDELE:'DENDELE CS','BET-M':'BET-M 33',EAC:'Esport Academy Copenhagen',CYBERSHOKE:'CYBERSHOKE Esports',LP:'largadosypelados',Fluxo:'Fluxo W7M'};
 const service=createTeamService({query:(...a)=>db.query(...a)},async()=>[],{get:async()=>seed});
 for(const [name,alias] of Object.entries(names)){const entry=seed.teams.find(t=>t.name===name);assert.equal(indexTeams(seed).get(require('../lib/match-priority').teamKey(alias)).hltvId,entry.hltvId);await db.query('INSERT INTO team_profiles VALUES($1,$2,NOW())',[entry.hltvId,JSON.stringify({id:entry.hltvId,name:alias,players:entry.players.slice(0,2).map(nickname=>({nickname}))})]);}
 const listed=await service.list();assert.equal(listed.coverage.profiles,6);
 const referenceTeam=listed.teams.find(t=>t.name==='EAC');assert.deepEqual(referenceTeam.rosterReference.players,seed.teams.find(t=>t.name==='EAC').players);assert.equal(referenceTeam.rosterReference.date,seed.date);assert.equal(referenceTeam.players.length,2);
 const normalized=normalizeTeam({id:123,name:'Fixture',players:[{id:1,name:'Active',active:true,role:'starter',modified_at:'2026-09-20T00:00:00Z'},{id:2,name:'Inactive',active:false,modified_at:'invalid'},{id:3,name:'Unknown'}]});
 assert.deepEqual(normalized.players.map(p=>p.sourceActive),[true,false,null]);assert.equal(normalized.players[0].sourceUpdatedAt,'2026-09-20T00:00:00.000Z');assert.equal(normalized.players[1].sourceUpdatedAt,null);assert.equal(normalized.players[0].role,undefined);
 const eac=seed.teams.find(t=>t.name==='EAC');await db.query('UPDATE team_profiles SET data=$1 WHERE id=$2',[JSON.stringify({id:eac.hltvId,name:names.EAC,players:[{nickname:'Wrong roster'}]}),eac.hltvId]);assert.equal((await service.list()).teams.find(t=>t.name==='EAC').profileAvailable,false);
 let calls=0;const enrich=createPlayerEnricher(async()=>{calls++;return [{id:1,name:'Player',image_url:'https://cdn.pandascore.co/a.png',nationality:'DK'},{id:2,name:'Wrong',image_url:'https://cdn.pandascore.co/b.png'},{id:999,name:'Player',nationality:'US'}]});
 const profiles=[{players:[{id:1,nickname:'Player',imageUrl:null,nationality:''},{id:2,nickname:'Other',imageUrl:null,nationality:'CN'}]}];
 await enrich(profiles);assert.equal(profiles[0].players.length,2);assert.equal(profiles[0].players[0].nationality,'DK');assert.equal(profiles[0].players[0].imageUrl,'https://cdn.pandascore.co/a.png');assert.equal(profiles[0].players[1].imageUrl,null);assert.equal(profiles[0].players[1].nationality,'CN');await enrich(profiles);assert.equal(calls,1);
 const failure=createPlayerEnricher(async()=>{throw Error('fixture unavailable')});await failure(profiles);assert.equal(profiles[0].players[1].nationality,'CN');
 console.log('PASS: six aliases require roster evidence, EAC main team identity, exact player ID and nickname enrichment, no roster changes, metadata cache and source failure');
 }finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
