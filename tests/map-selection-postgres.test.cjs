'use strict';
// Run against isolated PostgreSQL/WASM, never a production database.
// PGLITE_TEST_MODULE may point to an existing @electric-sql/pglite package.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_TEST_MODULE||'@electric-sql/pglite');
const market=require('../lib/map-selection'),lifecycle=require('../lib/match-lifecycle'),{auditedPool}=require('../lib/admin-audit');
(async()=>{
  const db=new PGlite();
  const c={query:async(...a)=>{const r=await db.query(...a);return {...r,rowCount:r.affectedRows??r.rows.length}},release(){}};
  // Serialize connections as PGlite exposes one connection. Production uses pg row locks.
  let tail=Promise.resolve();
  const pool={connect:async()=>{const previous=tail;let release;tail=new Promise(r=>release=r);await previous;return {...c,release}}};
  const q=async(s,p)=>(await db.query(s,p)).rows;
  const row=async(s,p)=>(await q(s,p))[0];
  const ledger=()=>q('SELECT id,points,locked_points FROM users ORDER BY id');
  const when=new Date(Date.now()+3600000).toISOString();
  const place=(id=1,map='Nuke',stakePoints=100,expectedOdds=2,user=1)=>market.place(pool,user,{matchId:id,map,stakePoints,expectedOdds});
  const finish=id=>db.query("UPDATE matches SET status='settled',winner='Alpha' WHERE id=$1",[id]);
  const result=(id=1,maps=['Nuke','Mirage','Inferno'])=>market.settle(pool,id,{maps,source:'https://example.com/verified-veto'});
  try{
    await db.exec(fs.readFileSync(path.join(__dirname,'../db/schema.sql'),'utf8'));
    for(let n=2;n<=25;n++)await db.exec(fs.readFileSync(path.join(__dirname,`../db/migration_v${n}.sql`),'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname,'../db/migration_v25.sql'),'utf8'));
    await db.exec(`INSERT INTO users(id,username,password_hash,points) VALUES(1,'player','test',1000),(2,'other','test',1000),(3,'admin','test',1000);
      INSERT INTO matches(id,event_name,team_a,team_b,starts_at,number_of_games)
      SELECT n,'Test event','Alpha','Beta',NOW()+INTERVAL '3 hours',3 FROM generate_series(1,15) n;`);
    for(let id=1;id<=15;id++)await market.configure(pool,id,{odds:{Nuke:2,Mirage:2,Inferno:2,Ancient:2},closesAt:when});
    // Odds are not fabricated by the UI; only configured choices can be submitted.
    await assert.rejects(place(1,'Train'),/尚未开放/);
    await assert.rejects(place(1,'Nuke',100,3),/赔率已变化/);
    for(const stake of [0,-1,1.5,'100',1000001])await assert.rejects(place(1,'Nuke',stake));
    await Promise.all([place(),place()]);
    assert.deepEqual((await ledger())[0],{id:1,points:900,locked_points:100});
    assert.equal((await q('SELECT * FROM map_selection_predictions')).length,1);
    await market.configure(pool,1,{odds:{Nuke:3,Mirage:2,Inferno:2,Ancient:2},closesAt:when});
    await place(); // Retry retains original odds.
    assert.equal(Number((await row('SELECT odds_at_prediction FROM map_selection_predictions WHERE match_id=1')).odds_at_prediction),2);
    await place(1,'Mirage',150);await place(1,'Nuke',100,3);
    assert.equal((await ledger())[0].points,900);
    // Select the unplayed decider. A 2:0 result must still pay this selection.
    await place(1,'Inferno',100);await place(1,'Ancient',100,2,2);
    await finish(1);await db.exec('UPDATE matches SET score_a=2,score_b=0 WHERE id=1');
    await assert.rejects(result(1,['Nuke','Mirage']),/完整/);
    await assert.rejects(result(1,['Nuke','Nuke','Inferno']),/完整/);
    await assert.rejects(market.settle(pool,1,{maps:['Nuke','Mirage','Inferno'],source:'javascript:bad'}));
    const audited=auditedPool(pool,3,'map-selection-result','match',1);
    await market.settle(audited,1,{maps:['Nuke','Mirage','Inferno'],source:'https://example.com/verified-veto'});
    assert.equal((await ledger())[0].points,1100);assert.equal((await ledger())[0].locked_points,0);
    assert.equal((await ledger())[1].points,900);assert.equal((await ledger())[1].locked_points,0);
    const log=await row('SELECT * FROM admin_audit_logs ORDER BY id DESC LIMIT 1');
    assert.equal(log.before_state.selections.length,2);assert.equal(log.after_state.selections[0].result,'win');
    const before=await ledger();await result();assert.deepEqual(await ledger(),before);
    await assert.rejects(result(1,['Nuke','Mirage','Ancient']),/撤销/);assert.deepEqual(await ledger(),before);
    await db.exec('UPDATE users SET points=0 WHERE id=1');
    await assert.rejects(market.undo(pool,1),/不足/);assert.equal((await row('SELECT selected_maps FROM matches WHERE id=1')).selected_maps.length,3);
    await db.exec('UPDATE users SET points=1100 WHERE id=1');await market.undo(pool,1);
    assert.deepEqual((await ledger())[0],{id:1,points:900,locked_points:100});
    await result(1,['Nuke','Mirage','Ancient']);assert.equal((await ledger())[0].points,900);
    assert.equal((await ledger())[1].points,1100);
    console.log('PASS: migration twice, exact retry, changed odds/stake, unplayed decider win, excluded map loss, audit, undo/re-settlement');
    // Lifecycle refunds winner, legacy count, and selection in one transaction.
    await place(2);await db.exec(`INSERT INTO predictions(user_id,match_id,predicted_team,stake_points) VALUES(1,2,'Alpha',30);
      INSERT INTO map_predictions(user_id,match_id,predicted_map_count,stake_points) VALUES(1,2,2,20);
      UPDATE users SET points=points-50,locked_points=locked_points+50 WHERE id=1;`);
    const pre=(await ledger())[0].points;
    await lifecycle.postpone(pool,2);await assert.rejects(place(2));
    const refunded=await lifecycle.refund(pool,2,'postponed');assert.equal(refunded.refundedPoints,150);
    assert.equal((await ledger())[0].points,pre+150);assert.equal((await ledger())[0].locked_points,0);
    await lifecycle.refund(pool,2,'postponed');await assert.rejects(place(2));
    await assert.rejects(market.configure(pool,2,{odds:{Nuke:2},closesAt:when}));
    await place(3);await place(3,'Nuke',100,2,2);await finish(3);
    await db.exec('UPDATE users SET locked_points=99 WHERE id=2');const prior=await ledger();
    await assert.rejects(result(3),/冻结积分/);assert.deepEqual(await ledger(),prior);
    assert.equal((await row('SELECT selected_maps FROM matches WHERE id=3')).selected_maps,null);
    assert.equal((await q('SELECT result FROM map_selection_predictions WHERE match_id=3')).every(p=>p.result===null),true);
    await db.exec('UPDATE users SET locked_points=100 WHERE id=2');
    await db.exec("ALTER TABLE matches ADD CONSTRAINT fail_final CHECK(id<>3 OR selected_maps IS NULL)");
    const beforeFailure=await ledger();await assert.rejects(result(3),/fail_final/);assert.deepEqual(await ledger(),beforeFailure);
    await db.exec('ALTER TABLE matches DROP CONSTRAINT fail_final');await result(3);
    await market.lock(pool,4);await assert.rejects(place(4));await assert.rejects(market.configure(pool,4,{odds:{Nuke:2},closesAt:when}));
    await db.exec("UPDATE matches SET map_selection_closes_at=NOW()-INTERVAL '1 second' WHERE id=5");
    await assert.rejects(place(5));await assert.rejects(market.configure(pool,5,{odds:{Nuke:2},closesAt:when}));
    await db.exec("UPDATE matches SET starts_at=NOW()+INTERVAL '9 minutes' WHERE id=6");await assert.rejects(place(6));
    await db.exec("UPDATE matches SET status='running' WHERE id=7");await assert.rejects(place(7));
    await assert.rejects(result(8));
    await assert.rejects(market.configure(pool,8,{odds:{Nuke:2},closesAt:new Date(Date.now()+24*3600000).toISOString()}));
    console.log('PASS: mixed-market refund, postponed pause, no double refund, locked/expired/pre-start cutoff, atomic insufficient-balance and late-write rollback');
    await db.exec('UPDATE matches SET number_of_games=1 WHERE id=9; UPDATE matches SET number_of_games=5 WHERE id=10');
    await place(9);await finish(9);await result(9,['Nuke']);
    await place(10,'Inferno');await finish(10);await result(10,['Nuke','Mirage','Ancient','Inferno','Train']);
    // Same transaction must undo both the result and frozen stake when audit insertion fails.
    await place(11);await finish(11);
    await db.exec("ALTER TABLE admin_audit_logs ADD CONSTRAINT test_audit_fail CHECK(target_id<>11)");
    const preAudit=await ledger();await assert.rejects(market.settle(auditedPool(pool,3,'map-selection-result','match',11),11,{maps:['Nuke','Mirage','Inferno'],source:'https://example.com/veto'}));
    assert.deepEqual(await ledger(),preAudit);assert.equal((await row('SELECT selected_maps FROM matches WHERE id=11')).selected_maps,null);
    console.log('PASS: BO1 / BO5 and audit-failure rollback');
  }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
