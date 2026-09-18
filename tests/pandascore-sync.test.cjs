const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');

function feed(id=101,scoreA=0,scoreB=0){
  return {id,status:'finished',winner_id:1,begin_at:'2026-01-01T12:00:00Z',
    opponents:[{opponent:{id:1,name:'Alpha'}},{opponent:{id:2,name:'Beta'}}],
    results:[{team_id:1,score:scoreA},{team_id:2,score:scoreB}],number_of_games:3};
}
function fixture({matches=[{id:1,external_id:'101',source:'pandascore',status:'running',team_a:'Alpha',team_b:'Beta',score_a:null,score_b:null}],predictions=[],users=[],recent=[],history=[],failPayout=false}={}){
  let state=structuredClone({matches,predictions,users});
  const calls=[],requests=[];
  let releases=0;
  async function query(sql,params=[],tx){
    const q=sql.replace(/\s+/g,' ').trim();
    calls.push({q,params});
    if(q==='BEGIN'){tx.snapshot=structuredClone(state);tx.active=true;return {rows:[]}}
    if(q==='COMMIT'){tx.active=false;return {rows:[]}}
    if(q==='ROLLBACK'){state=tx.snapshot;tx.active=false;return {rows:[]}}
    const rows=data=>({rows:structuredClone(data),rowCount:data.length});
    if(q.startsWith('SELECT * FROM matches'))return rows(state.matches.filter(m=>m.id===params[0]));
    if(q.startsWith('SELECT id,external_id,status,score_a'))return rows(state.matches.filter(m=>m.status!=='settled'||m.score_a==null||m.score_b==null||(m.score_a===0&&m.score_b===0)));
    if(q.startsWith('SELECT id,status FROM matches'))return rows(state.matches.filter(m=>m.external_id===params[0]));
    if(q.startsWith('SELECT * FROM predictions'))return rows(state.predictions.filter(p=>p.match_id===params[0]&&p.result==null));
    if(q.startsWith('UPDATE predictions')){
      Object.assign(state.predictions.find(p=>p.id===params[2]),{result:params[0],points_delta:params[1]});return rows([]);
    }
    if(q.startsWith('UPDATE users')){
      if(failPayout)throw new Error('simulated payout failure');
      const u=state.users.find(u=>u.id===params[2]);
      u.locked_points=Math.max(0,u.locked_points-params[0]);u.points+=params[1];return rows([]);
    }
    if(q.startsWith('UPDATE matches SET score_a')){
      Object.assign(state.matches.find(m=>m.id===params[2]),{score_a:params[0],score_b:params[1]});return rows([]);
    }
    if(q.startsWith('UPDATE matches SET stage_name')){
      Object.assign(state.matches.find(m=>m.id===params[1]),{source_status:'finished'});return rows([]);
    }
    if(q.startsWith('UPDATE matches SET winner=')){
      Object.assign(state.matches.find(m=>m.id===params[1]),{winner:params[0],status:'settled',source_status:'finished'});return rows([]);
    }
    if(q.startsWith("UPDATE matches SET status='canceled'")){
      const m=state.matches.find(m=>m.id===params[0]);
      if(m.status!=='settled'&&m.winner==null)Object.assign(m,{status:'canceled',source_status:'canceled'});
      return rows([]);
    }
    if(q.startsWith('INSERT INTO matches')){
      if(q.includes('DO UPDATE SET')){
        const m=state.matches.find(m=>m.external_id===params[4]);
        if(m&&['settled','canceled'].includes(m.status)){
          assert.match(q,/WHERE matches.status NOT IN \('settled','canceled'\)/);
          return rows([]);
        }
        throw new Error('Unexpected non-terminal upsert in test');
      }
      if(!state.matches.some(m=>m.external_id===params[4]))state.matches.push({id:state.matches.length+1,event_name:params[0],team_a:params[1],team_b:params[2],external_id:params[4],status:'running',source:'pandascore',score_a:null,score_b:null});
      return rows([]);
    }
    throw new Error('Unexpected SQL: '+q);
  }
  const pool={query:(sql,p)=>query(sql,p),connect:async()=>{
    const tx={active:false};
    return {query:(sql,p)=>query(sql,p,tx),release:()=>{assert.equal(tx.active,false,'released an open transaction');releases++}};
  }};
  const panda=async url=>{
    requests.push(url);
    if(url.includes('filter[id]=')){
      const ids=url.split('filter[id]=')[1].split(',');
      return history.filter(x=>ids.includes(String(x.id)));
    }
    return recent;
  };
  const context=vm.createContext({pool,panda,Date,console,mapMarket:require('../lib/map-market')});
  // Load the actual functions without starting HTTP, timers, or production DB access.
  vm.runInContext(source.slice(source.indexOf('function oppTeam'),source.indexOf('async function saveSyncStatus')),context);
  return {context,calls,requests,state:()=>state,releases:()=>releases};
}

test('finished 0:0 settles winner, stake and frozen odds exactly once',async()=>{
  const f=fixture({predictions:[
    {id:1,match_id:1,user_id:1,predicted_team:'Alpha',stake_points:100,odds_at_prediction:'1.8555',result:null},
    {id:2,match_id:1,user_id:2,predicted_team:'Beta',stake_points:50,odds_at_prediction:2,result:null}
  ],users:[{id:1,points:900,locked_points:100},{id:2,points:950,locked_points:50}]});
  await f.context.settleMatch(1,'Alpha',feed());
  const saved=structuredClone(f.state());
  assert.deepEqual(saved.users,[{id:1,points:1085,locked_points:0},{id:2,points:950,locked_points:0}]);
  assert.deepEqual(saved.predictions.map(p=>[p.result,p.points_delta]),[['win',85],['loss',-50]]);
  assert.equal(saved.matches[0].status,'settled');assert.equal(saved.matches[0].score_a,null);
  assert.equal((await f.context.settleMatch(1,'Alpha',feed())).alreadySettled,true);
  assert.deepEqual(f.state(),saved);assert.equal(f.releases(),2);
  assert.equal(f.calls.some(c=>/map_predictions/.test(c.q)),false);
});
test('failed payout rolls back scores, predictions, status and points',async()=>{
  const f=fixture({predictions:[{id:1,match_id:1,user_id:1,predicted_team:'Alpha',stake_points:100,odds_at_prediction:1.8,result:null}],users:[{id:1,points:900,locked_points:100}],failPayout:true});
  const before=structuredClone(f.state());
  await assert.rejects(f.context.settleMatch(1,'Alpha',feed(101,2,1)),/payout failure/);
  assert.deepEqual(f.state(),before);assert.equal(f.releases(),1);
});
test('valid scores follow local team order, including later score backfill',async()=>{
  const f=fixture();
  await f.context.settleMatch(1,'Alpha',feed());
  const x=feed(101,2,1);x.opponents.reverse();
  await f.context.settleMatch(1,'Alpha',x);
  assert.equal(f.state().matches[0].score_a,2);assert.equal(f.state().matches[0].score_b,1);
});
test('missing and malformed scores never overwrite a known score',async()=>{
  for(const values of [[null,0],['',0],[undefined,0],[-1,0],[1.5,0],[0,0],[1,2],[2,2],[true,0]]){
    const f=fixture();f.state().matches[0].score_a=2;f.state().matches[0].score_b=1;
    const x=feed();x.results[0].score=values[0];x.results[1].score=values[1];
    await f.context.settleMatch(1,'Alpha',x);
    assert.equal(f.state().matches[0].status,'settled');
    assert.equal(f.state().matches[0].score_a,2);assert.equal(f.state().matches[0].score_b,1);
  }
});
test('absent results also settle without invented scores',async()=>{
  const x=feed();delete x.results;const f=fixture({recent:[x]});
  await f.context.syncResults();assert.equal(f.state().matches[0].status,'settled');assert.equal(f.state().matches[0].score_a,null);
});
test('unknown winner or unfinished match cannot settle',async()=>{
  for(const change of [{winner_id:999},{winner_id:null},{status:'running'}]){
    const f=fixture({recent:[{...feed(),...change}]});await f.context.syncResults();
    assert.equal(f.state().matches[0].status,'running');
  }
});
test('identity mismatch and corrected winner cannot silently change settled payouts',async()=>{
  const f=fixture();await f.context.settleMatch(1,'Alpha',feed());
  const saved=structuredClone(f.state());
  await assert.rejects(f.context.settleMatch(1,'Beta',{...feed(),winner_id:2}),/已结算结果不一致/);
  await assert.rejects(f.context.settleMatch(1,'Alpha',feed(999)),/本地记录不一致/);
  assert.deepEqual(f.state(),saved);
});
test('new historical 0:0 match is imported and settled',async()=>{
  const f=fixture({matches:[],recent:[feed()]});const result=await f.context.syncResults();
  assert.equal(result.settled,1);assert.equal(f.state().matches[0].status,'settled');assert.equal(f.state().matches[0].score_a,null);
});
test('old running match absent from recent 100 is recovered by external ID',async()=>{
  const f=fixture({recent:[],history:[feed()]});const result=await f.context.syncResults();
  assert.equal(result.settled,1);assert.equal(f.state().matches[0].status,'settled');
  assert.ok(f.requests.some(u=>u.includes('filter[id]=101')));
});
test('more than 100 pending external IDs are split without losing older rows',async()=>{
  const matches=Array.from({length:205},(_,i)=>({id:i+1,external_id:String(1000+i),source:'pandascore',status:'running',team_a:'Alpha',team_b:'Beta'}));
  const f=fixture({matches,history:matches.map(m=>feed(Number(m.external_id)))});
  const result=await f.context.syncResults();assert.equal(result.settled,205);
  assert.deepEqual(f.requests.filter(u=>u.includes('filter[id]')).map(u=>u.split('filter[id]=')[1].split(',').length),[100,100,5]);
});
test('missing upstream match is retained, never guessed canceled',async()=>{
  const f=fixture();f.state().matches[0].status='open';await f.context.syncResults();
  assert.equal(f.state().matches[0].status,'open');
});
test('confirmed cancellation cannot erase a settled winner',async()=>{
  const f=fixture({recent:[{...feed(),status:'canceled'}]});
  await f.context.settleMatch(1,'Alpha',feed());await f.context.syncResults();
  assert.equal(f.state().matches[0].winner,'Alpha');assert.equal(f.state().matches[0].status,'settled');
});
test('running and upcoming upserts protect terminal matches',async()=>{
  const f=fixture({recent:[feed()]});await f.context.settleMatch(1,'Alpha',feed());
  assert.equal((await f.context.syncRunning()).skipped,1);
  assert.equal((await f.context.syncUpcoming()).skipped,1);
  assert.equal(f.state().matches[0].status,'settled');
});
test('legacy manual settlement remains supported and repeat ends transaction',async()=>{
  const f=fixture();await f.context.settleMatch(1,'Alpha');
  assert.equal((await f.context.settleMatch(1,'Alpha')).alreadySettled,true);assert.equal(f.releases(),2);
});
test('numeric string scores are accepted but duplicate team scores are rejected',async()=>{
  const f=fixture();await f.context.settleMatch(1,'Alpha',feed(101,'2','1'));
  assert.equal(f.state().matches[0].score_a,2);assert.equal(f.state().matches[0].score_b,1);
  const g=fixture(),x=feed(101,2,1);x.results.push({team_id:1,score:3});
  await g.context.settleMatch(1,'Alpha',x);assert.equal(g.state().matches[0].score_a,null);
});
test('settled match outside recent page can receive scores without a second payout',async()=>{
  const f=fixture({history:[feed(101,2,1)]});
  await f.context.settleMatch(1,'Alpha',feed());
  assert.equal((await f.context.syncResults()).settled,0);
  assert.equal(f.state().matches[0].score_a,2);assert.equal(f.state().matches[0].score_b,1);
});
test('conflicting historical winner is reported without blocking subsequent settlements',async()=>{
  const f=fixture({recent:[{...feed(),winner_id:2},feed(102)]});
  await f.context.settleMatch(1,'Alpha',feed());
  const result=await f.context.syncResults();
  assert.equal(result.conflicts,1);assert.match(result.warnings[0],/比赛 1 \/ PandaScore 101/);
  assert.equal(f.state().matches[0].winner,'Alpha');
  assert.equal(f.state().matches[1].status,'settled');assert.equal(result.settled,1);
});
test('sync still propagates payout errors rather than treating them as conflicts',async()=>{
  const f=fixture({recent:[feed(101,2,1)],predictions:[{id:1,match_id:1,user_id:1,predicted_team:'Alpha',stake_points:100,odds_at_prediction:1.8,result:null}],users:[{id:1,points:900,locked_points:100}],failPayout:true});
  const before=structuredClone(f.state());
  await assert.rejects(f.context.syncResults(),/payout failure/);assert.deepEqual(f.state(),before);
});
