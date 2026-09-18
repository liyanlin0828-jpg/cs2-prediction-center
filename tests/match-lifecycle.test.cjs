const {test}=require('node:test');
const assert=require('node:assert/strict');
const lifecycle=require('../lib/match-lifecycle');
function fixture(){
  let state={match:{id:1,status:'open',source:'pandascore',external_id:'101',team_a:'A',team_b:'B',winner:null},users:[{id:1,points:700,locked_points:300},{id:2,points:950,locked_points:50}],predictions:[{id:1,user_id:1,stake_points:100,result:null},{id:2,user_id:2,stake_points:50,result:null}],map_predictions:[{id:1,user_id:1,stake_points:200,result:null}]};
  let failAt=0,updates=0;const locks=[];
  const pool={connect:async()=>{
    let before,active=false;
    return {release(){assert.equal(active,false)},async query(sql,p=[]){
      const q=sql.replace(/\s+/g,' ').trim(),rows=a=>({rows:structuredClone(a),rowCount:a.length});
      if(q==='BEGIN'){before=structuredClone(state);active=true;return rows([])}
      if(q==='COMMIT'){active=false;return rows([])}
      if(q==='ROLLBACK'){state=before;active=false;return rows([])}
      if(q.startsWith('SELECT * FROM matches'))return rows(state.match?[state.match]:[]);
      if(q.startsWith('SELECT * FROM predictions'))return rows(state.predictions);
      if(q.startsWith('SELECT * FROM map_predictions'))return rows(state.map_predictions);
      if(q.startsWith('UPDATE users')){
        if(++updates===failAt)throw Error('write failed');
        locks.push(p[1]);const u=state.users.find(u=>u.id===p[1]);
        if(!u||u.locked_points<p[0]||u.points>p[2])return rows([]);
        u.points+=p[0];u.locked_points-=p[0];return rows([u]);
      }
      if(q.startsWith('UPDATE predictions')||q.startsWith('UPDATE map_predictions')){
        if(++updates===failAt)throw Error('write failed');
        const table=q.split(' ')[1];Object.assign(state[table].find(x=>x.id===p[1]),{result:'refunded',points_delta:0,refund_points:p[0],refunded_at:'now'});return rows([]);
      }
      if(q.startsWith('UPDATE matches SET status=$1'))Object.assign(state.match,{status:p[0],source_status:p[0],predictions_voided_at:'now',void_reason:p[0]});
      else if(q.startsWith("UPDATE matches SET status='postponed'"))Object.assign(state.match,{status:'postponed',source_status:'postponed'});
      else if(q.startsWith("UPDATE matches SET status='open'"))Object.assign(state.match,{status:'open',source_status:'not_started',starts_at:p[0]});
      else throw Error('Unexpected SQL '+q);
      return rows([]);
    }};
  }};
  return {pool,state:()=>state,locks,fail(n){failAt=n}};
}
test('cancellation returns both markets principal exactly once and preserves history',async()=>{
  const f=fixture();const r=await lifecycle.refund(f.pool,1);
  assert.equal(r.refundedPoints,350);assert.equal(r.refundedPredictions,3);
  assert.deepEqual(f.state().users.map(u=>[u.points,u.locked_points]),[[1000,0],[1000,0]]);
  assert.deepEqual(f.locks,[1,2]);
  assert.equal(f.state().map_predictions[0].refund_points,200);
  assert.equal(f.state().predictions[0].stake_points,100);
  assert.equal(f.state().predictions[0].points_delta,0);
  const before=structuredClone(f.state());assert.equal((await lifecycle.refund(f.pool,1)).alreadyRefunded,true);assert.deepEqual(f.state(),before);
});
test('zero-stake legacy picks are refunded without invented credit',async()=>{
  const f=fixture();f.state().predictions[0].stake_points=0;f.state().users[0].locked_points=200;
  await lifecycle.refund(f.pool,1);assert.equal(f.state().predictions[0].refund_points,0);assert.equal(f.state().users[0].points,900);
});
test('insufficient frozen points rolls back earlier users and every result',async()=>{
  const f=fixture();f.state().users[1].locked_points=49;const before=structuredClone(f.state());
  await assert.rejects(lifecycle.refund(f.pool,1),/冻结积分/);assert.deepEqual(f.state(),before);
});
test('database failure during either balance or history writes rolls back all changes',async()=>{
  for(const n of [1,2,3,4,5]){const f=fixture(),before=structuredClone(f.state());f.fail(n);await assert.rejects(lifecycle.refund(f.pool,1),/write failed/);assert.deepEqual(f.state(),before)}
});
test('settled match or any settled prediction refuses cancellation',async()=>{
  for(const change of [s=>s.match.status='settled',s=>s.match.winner='A',s=>s.match.actual_map_count=2,s=>s.predictions[0].result='loss',s=>s.map_predictions[0].result='win']){
    const f=fixture();change(f.state());const before=structuredClone(f.state());await assert.rejects(lifecycle.refund(f.pool,1));assert.deepEqual(f.state(),before);
  }
});
test('wrong upstream id/status/source and invalid refund reasons cannot change points',async()=>{
  for(const x of [{id:999,status:'canceled'},{id:101,status:'finished'}]){const f=fixture();await assert.rejects(lifecycle.refund(f.pool,1,'canceled',x));assert.equal(f.state().users[0].points,700)}
  const f=fixture();f.state().match.source='manual';await assert.rejects(lifecycle.refund(f.pool,1,'canceled',{id:101,status:'canceled'}));await assert.rejects(lifecycle.refund(f.pool,1,'unknown'));
});
test('postponement pauses predictions but preserves every stake and locked odds',async()=>{
  const f=fixture(),before=structuredClone(f.state());await lifecycle.postpone(f.pool,1,{id:101,status:'postponed'});
  assert.equal(f.state().match.status,'postponed');assert.deepEqual(f.state().users,before.users);assert.deepEqual(f.state().predictions,before.predictions);assert.deepEqual(f.state().map_predictions,before.map_predictions);
});
test('admin may refund held postponed match; retry or future updates never reserve again',async()=>{
  const f=fixture();await assert.rejects(lifecycle.refund(f.pool,1,'postponed'));
  await lifecycle.postpone(f.pool,1);await lifecycle.refund(f.pool,1,'postponed');
  const before=structuredClone(f.state());await lifecycle.postpone(f.pool,1);await lifecycle.refund(f.pool,1,'postponed');
  await lifecycle.resumeFromSource(f.pool,1,{id:101,status:'not_started',begin_at:'2099-01-01',opponents:[{opponent:{name:'A'}},{opponent:{name:'B'}}]});assert.deepEqual(f.state(),before);
});
test('confirmed new date restores postponed source match without changing stakes',async()=>{
  const f=fixture();await lifecycle.postpone(f.pool,1);const before=structuredClone(f.state());
  await lifecycle.resumeFromSource(f.pool,1,{id:101,status:'not_started',begin_at:'2099-01-01',opponents:[{opponent:{name:'B'}},{opponent:{name:'A'}}]});
  assert.equal(f.state().match.status,'open');assert.deepEqual(f.state().users,before.users);assert.deepEqual(f.state().predictions,before.predictions);
});
test('reschedule without date or matching teams does not reopen held match',async()=>{
  for(const extra of [{begin_at:null},{begin_at:'2000-01-01'},{begin_at:'2099-01-01',opponents:[]}]){
    const f=fixture();await lifecycle.postpone(f.pool,1);await lifecycle.resumeFromSource(f.pool,1,{id:101,status:'not_started',...extra});assert.equal(f.state().match.status,'postponed');
  }
});
test('unchanged future schedule does not override an explicit postponement',async()=>{
  const f=fixture();f.state().match.starts_at='2099-01-01';await lifecycle.postpone(f.pool,1);
  await lifecycle.resumeFromSource(f.pool,1,{id:101,status:'not_started',begin_at:'2099-01-01',opponents:[{opponent:{name:'A'}},{opponent:{name:'B'}}]});
  assert.equal(f.state().match.status,'postponed');
});
test('manual resume validates source, held status, refund marker and future date',async()=>{
  const f=fixture();await lifecycle.postpone(f.pool,1);await assert.rejects(lifecycle.resume(f.pool,1,'2099-01-01'));
  f.state().match.source='manual';await assert.rejects(lifecycle.resume(f.pool,1,'invalid'));await assert.rejects(lifecycle.resume(f.pool,1,'2000-01-01'));
  await lifecycle.resume(f.pool,1,'2099-01-01');assert.equal(f.state().match.status,'open');assert.equal(f.state().users[0].locked_points,300);
});
test('overflow, missing user and malformed stakes fail atomically',async()=>{
  for(const change of [s=>s.users[0].points=2147483647,s=>s.users=[],s=>s.predictions[0].stake_points=-1,s=>s.map_predictions[0].stake_points=1.5]){
    const f=fixture();change(f.state());const before=structuredClone(f.state());await assert.rejects(lifecycle.refund(f.pool,1));assert.deepEqual(f.state(),before);
  }
});
test('postponement cannot overwrite finished or refunded terminal records',async()=>{
  for(const status of ['settled','canceled']){const f=fixture();f.state().match.status=status;const before=structuredClone(f.state());await lifecycle.postpone(f.pool,1);assert.deepEqual(f.state(),before)}
});
