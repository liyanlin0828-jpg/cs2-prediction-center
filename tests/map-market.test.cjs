const {test}=require('node:test');
const assert=require('node:assert/strict');
const market=require('../lib/map-market');
function fixture({points=1000,locked=0,picks=[],failUpdate=false}={}){
  let state={match:{id:1,status:'open',winner:null,team_a:'Alpha',team_b:'Beta',number_of_games:3,source:'pandascore',external_id:'101',map_odds_2:'1.8555',map_odds_3:'2.1',actual_map_count:null},user:{id:1,username:'test',points,locked_points:locked},picks:structuredClone(picks)};
  const calls=[];let releases=0;
  const pool={connect:async()=>{
    let snapshot,active=false;
    return {release(){assert.equal(active,false);releases++},async query(sql,p=[]){
      const q=sql.replace(/\s+/g,' ').trim();calls.push(q);
      const rows=a=>({rows:structuredClone(a),rowCount:a.length});
      if(q==='BEGIN'){snapshot=structuredClone(state);active=true;return rows([])}
      if(q==='COMMIT'){active=false;return rows([])}
      if(q==='ROLLBACK'){state=snapshot;active=false;return rows([])}
      const m=state.match,u=state.user;
      if(q.startsWith('SELECT * FROM matches')||q.startsWith('SELECT id FROM matches'))return rows(q.includes("status='open'")&&(m.status!=='open'||m.winner||m.locked)?[]:[m]);
      if(q.startsWith('SELECT id,username'))return rows([u]);
      if(q.startsWith('SELECT * FROM map_predictions WHERE user_id'))return rows(state.picks.filter(x=>x.user_id===p[0]&&x.match_id===p[1]));
      if(q.startsWith('SELECT * FROM map_predictions WHERE match_id'))return rows(state.picks.filter(x=>x.match_id===p[0]&&(q.includes('IS NOT NULL')?x.result!=null:x.result==null)));
      if(q.startsWith('UPDATE users')){
        if(failUpdate)throw Error('database failed');
        if(q.includes('locked_points>=$1')){
          if(u.locked_points<p[0]||u.points>p[3])return rows([]);
          u.locked_points-=p[0];u.points+=p[1];
        }else if(q.includes('points>=$1')){
          if(u.points<p[0]||u.locked_points>p[3])return rows([]);
          u.points-=p[0];u.locked_points+=p[1];
        }else{u.points-=p[0];u.locked_points+=p[0]}
        return rows([u]);
      }
      if(q.startsWith('INSERT INTO map_predictions')){
        state.picks.push({id:state.picks.length+1,user_id:p[0],match_id:p[1],predicted_map_count:p[2],stake_points:p[3],odds_at_prediction:p[4],result:null,payout_points:0,points_delta:0});return rows([]);
      }
      if(q.startsWith('UPDATE map_predictions SET predicted_map_count')){
        Object.assign(state.picks.find(x=>x.id===p[3]),{predicted_map_count:p[0],stake_points:p[1],odds_at_prediction:p[2]});return rows([]);
      }
      if(q.startsWith('UPDATE map_predictions SET result=NULL')){
        Object.assign(state.picks.find(x=>x.id===p[0]),{result:null,points_delta:0,payout_points:0});return rows([]);
      }
      if(q.startsWith('UPDATE map_predictions SET result=')){
        Object.assign(state.picks.find(x=>x.id===p[3]),{result:p[0],points_delta:p[1],payout_points:p[2]});return rows([]);
      }
      if(q.startsWith('UPDATE matches SET map_odds')){
        [2,3,4,5].forEach((n,i)=>m['map_odds_'+n]=p[i]);return rows([]);
      }
      if(q.startsWith('UPDATE matches SET actual_map_count=NULL')){Object.assign(m,{actual_map_count:null,map_result_source:null,maps_manual_review:true});return rows([])}
      if(q.startsWith('UPDATE matches SET actual_map_count=')){Object.assign(m,{actual_map_count:p[0],map_result_source:p[1],maps_manual_review:false});return rows([])}
      throw Error('Unexpected SQL '+q);
    }};
  }};
  return {pool,state:()=>state,calls,releases:()=>releases,finished(){Object.assign(state.match,{status:'settled',winner:'Alpha'})}};
}
const place=(f,stakePoints=100,mapCount=2)=>market.place(f.pool,1,{matchId:1,mapCount,stakePoints});
function feed(){return {id:101,status:'finished',forfeit:false,number_of_games:3,winner_id:1,opponents:[{opponent:{id:1,name:'Alpha'}},{opponent:{id:2,name:'Beta'}}],games:[1,2].map(n=>({id:n,position:n,status:'finished',forfeit:false,begin_at:'2026-01-01T12:00:00Z',end_at:'2026-01-01T13:00:00Z',winner:{id:1,type:'Team'}}))}}
test('new map bet reserves stake and records server odds',async()=>{
  const f=fixture();const r=await place(f);
  assert.equal(r.user.points,900);assert.equal(r.user.locked_points,100);assert.equal(Number(r.odds_at_prediction),1.8555);
});
test('stale confirmed odds reject atomically',async()=>{
  const f=fixture();await assert.rejects(market.place(f.pool,1,{matchId:1,mapCount:2,stakePoints:100,expectedOdds:2}));
  assert.equal(f.state().user.points,1000);assert.equal(f.state().picks.length,0);
});
test('exact retry does not double reserve or change locked odds',async()=>{
  const f=fixture();await place(f);f.state().match.map_odds_2=3;
  await place(f);assert.equal(f.state().user.points,900);assert.equal(Number(f.state().picks[0].odds_at_prediction),1.8555);
});
test('changing stake refunds or reserves only difference and takes current odds',async()=>{
  const f=fixture();await place(f);f.state().match.map_odds_3=2.4;
  await place(f,160,3);assert.equal(f.state().user.points,840);assert.equal(f.state().user.locked_points,160);
  await place(f,50,3);assert.equal(f.state().user.points,950);assert.equal(f.state().user.locked_points,50);assert.equal(f.state().picks[0].odds_at_prediction,2.4);
});
test('insufficient balance or invalid stake makes no changes',async()=>{
  for(const stake of [1001,0,-1,1.5,Infinity,1000001,'100',true]){
    const f=fixture(),before=structuredClone(f.state());await assert.rejects(place(f,stake));assert.deepEqual(f.state(),before);
  }
});
test('BO1, invalid map selections, and locked matches reject bets',async()=>{
  for(const mutate of [m=>m.number_of_games=1,m=>m.status='running',m=>m.winner='Alpha',m=>m.locked=true]){
    const f=fixture();mutate(f.state().match);await assert.rejects(place(f));assert.equal(f.state().user.points,1000);
  }
  const f=fixture();await assert.rejects(place(f,100,4));
});
test('closed odds reject bets and odds validation rejects coercion and excess precision',async()=>{
  for(const odds of [null,'',true,0,0.5,101,'abc','2e0','1.00001']){
    const f=fixture();f.state().match.map_odds_2=odds;await assert.rejects(place(f));
  }
});
test('admin odds updates preserve existing bets and close empty choices',async()=>{
  const f=fixture();await place(f);await market.setOdds(f.pool,1,{2:'2.5',3:null});
  assert.equal(f.state().match.map_odds_2,2.5);assert.equal(f.state().match.map_odds_3,null);
  assert.equal(Number(f.state().picks[0].odds_at_prediction),1.8555);
  f.finished();await assert.rejects(market.setOdds(f.pool,1,{2:2,3:2}));
});
test('win settles once using locked odds and correct net profit',async()=>{
  const f=fixture();await place(f);f.finished();await market.settle(f.pool,1,2);
  assert.equal(f.state().user.points,1085);assert.equal(f.state().user.locked_points,0);
  assert.equal(f.state().picks[0].payout_points,185);assert.equal(f.state().picks[0].points_delta,85);
  const before=structuredClone(f.state());assert.equal((await market.settle(f.pool,1,2)).alreadySettled,true);assert.deepEqual(f.state(),before);
  await assert.rejects(market.settle(f.pool,1,3));assert.deepEqual(f.state(),before);
});
test('loss releases frozen stake without additional deduction',async()=>{
  const f=fixture();await place(f);f.finished();await market.settle(f.pool,1,3);
  assert.equal(f.state().user.points,900);assert.equal(f.state().user.locked_points,0);assert.equal(f.state().picks[0].points_delta,-100);
});
test('unfinished match cannot settle and legacy picks never invent payout',async()=>{
  const f=fixture({picks:[{id:1,match_id:1,user_id:1,predicted_map_count:2,stake_points:0,result:null}]});
  await assert.rejects(market.settle(f.pool,1,2));f.finished();await market.settle(f.pool,1,2);assert.equal(f.state().user.points,1000);assert.equal(f.state().picks[0].points_delta,0);
});
test('legacy pick can upgrade to a staked prediction before lock',async()=>{
  const f=fixture({picks:[{id:1,match_id:1,user_id:1,predicted_map_count:2,stake_points:0,result:null}]});
  await place(f);assert.equal(f.state().user.points,900);assert.equal(f.state().picks.length,1);
});
test('write failure and incorrect frozen balance roll back whole map settlement',async()=>{
  const p={id:1,match_id:1,user_id:1,predicted_map_count:2,stake_points:100,odds_at_prediction:2,result:null};
  for(const args of [{locked:100,failUpdate:true},{locked:0}]){
    const f=fixture({...args,picks:[p]});f.finished();const before=structuredClone(f.state());
    await assert.rejects(market.settle(f.pool,1,2));assert.deepEqual(f.state(),before);assert.equal(f.releases(),1);
  }
});
test('undo restores original frozen stake and replay is idempotent',async()=>{
  const f=fixture();await place(f);f.finished();await market.settle(f.pool,1,2);await market.undo(f.pool,1);
  assert.equal(f.state().user.points,900);assert.equal(f.state().user.locked_points,100);assert.equal(f.state().picks[0].result,null);
  assert.equal(f.state().match.winner,'Alpha');assert.equal(f.state().match.maps_manual_review,true);
  const before=structuredClone(f.state());await market.undo(f.pool,1);assert.deepEqual(f.state(),before);
  await market.settle(f.pool,1,3);assert.equal(f.state().user.points,900);assert.equal(f.state().user.locked_points,0);
});
test('undo with spent payout rolls back all results',async()=>{
  const f=fixture();await place(f);f.finished();await market.settle(f.pool,1,2);f.state().user.points=0;
  const before=structuredClone(f.state());await assert.rejects(market.undo(f.pool,1));assert.deepEqual(f.state(),before);
});
test('BO5 supports only 3/4/5 maps and rounds decimal payouts exactly',async()=>{
  const f=fixture();Object.assign(f.state().match,{number_of_games:5,map_odds_4:'1.1'});
  await place(f,50,4);f.finished();await market.settle(f.pool,1,4);assert.equal(f.state().user.points,1005);
  assert.equal(market.payout(50,1.1),55);
});
test('verified maps require all played games and reject missing/forfeit/incomplete evidence',()=>{
  assert.equal(market.verifiedMapCount(feed()),2);
  for(const mutate of [x=>delete x.games,x=>x.games=[],x=>x.forfeit=true,x=>x.games[0].forfeit=true,x=>delete x.games[0].forfeit,x=>x.games[0].winner.id=2,x=>x.games[0].position=2,x=>x.games[0].begin_at=null,x=>x.games[1].id=1,x=>x.games.push({status:'running'}),x=>x.status='running']){
    const x=feed();mutate(x);assert.equal(market.verifiedMapCount(x),null);
  }
  const x=feed();delete x.games;x.results=[{score:2},{score:0}];assert.equal(market.verifiedMapCount(x),null);
});
test('automatic map settlement validates identity and honors manual review',async()=>{
  const f=fixture();await place(f);f.finished();const bad=feed();bad.id=999;
  await assert.rejects(market.settle(f.pool,1,2,bad));assert.equal(f.state().user.locked_points,100);
  await market.settle(f.pool,1,2,feed());assert.equal(f.state().match.map_result_source,'pandascore_games');
  await market.undo(f.pool,1);await market.settle(f.pool,1,2,feed());assert.equal(f.state().match.actual_map_count,null);assert.equal(f.state().user.locked_points,100);
});
