'use strict';
// Optional SQL integration check: install @electric-sql/pglite@0.5.8 locally,
// or set PGLITE_TEST_MODULE to its absolute package directory. No production DB.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require(process.env.PGLITE_TEST_MODULE||'@electric-sql/pglite');
const lifecycle=require('../lib/match-lifecycle');
(async()=>{
 const db=new PGlite();
 const client={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows??r.rows.length}},release(){}};
 const pool={connect:async()=>client};
 const row=async(sql)=>(await db.query(sql)).rows[0];
 try{
  await db.exec(`CREATE TABLE matches(id INTEGER PRIMARY KEY,status VARCHAR(20),source_status VARCHAR(30),source TEXT,external_id TEXT,winner TEXT,actual_map_count INTEGER,starts_at TIMESTAMPTZ,synced_at TIMESTAMPTZ,team_a TEXT,team_b TEXT);
   CREATE TABLE users(id INTEGER PRIMARY KEY,points INTEGER,locked_points INTEGER);
   CREATE TABLE predictions(id INTEGER PRIMARY KEY,match_id INTEGER,user_id INTEGER,stake_points INTEGER,result VARCHAR(20),points_delta INTEGER);
   CREATE TABLE map_predictions(LIKE predictions INCLUDING ALL);`);
  const migration=fs.readFileSync(path.join(__dirname,'../db/migration_v19.sql'),'utf8');
  await db.exec(migration);await db.exec(migration);
  await assert.rejects(db.query('UPDATE matches SET status=$1,source_status=$1,void_reason=$1 WHERE id=$2',['canceled',1]),/inconsistent types/);
  console.log('PASS: reproduces original PostgreSQL parameter error; migration is repeatable');
  await db.exec(`INSERT INTO matches(id,status,source,external_id) VALUES(1,'open','pandascore','101'),(2,'open','manual',NULL),(3,'open','manual',NULL);
   INSERT INTO users VALUES(1,850,150),(2,990,10);
   INSERT INTO predictions(id,match_id,user_id,stake_points) VALUES(1,1,1,100),(2,2,2,10),(3,3,1,20);
   INSERT INTO map_predictions(id,match_id,user_id,stake_points) VALUES(1,1,1,50);`);
  const refund=await lifecycle.refund(pool,1,'canceled',{id:101,status:'canceled'});
  assert.equal(refund.refundedPoints,150);
  assert.deepEqual(await row('SELECT points,locked_points FROM users WHERE id=1'),{points:1000,locked_points:0});
  assert.equal((await row('SELECT refund_points FROM map_predictions WHERE id=1')).refund_points,50);
  assert.equal((await row('SELECT refund_points FROM predictions WHERE id=1')).refund_points,100);
  assert.equal((await row('SELECT status,void_reason FROM matches WHERE id=1')).void_reason,'canceled');
  assert.equal((await lifecycle.refund(pool,1)).alreadyRefunded,true);
  assert.equal((await row('SELECT points FROM users WHERE id=1')).points,1000);
  console.log('PASS: both markets refunded once, with durable match marker');
  await lifecycle.postpone(pool,2);
  assert.deepEqual(await row('SELECT points,locked_points FROM users WHERE id=2'),{points:990,locked_points:10});
  await lifecycle.resume(pool,2,new Date(Date.now()+3600000).toISOString());
  assert.equal((await row('SELECT status FROM matches WHERE id=2')).status,'open');
  await lifecycle.postpone(pool,2);await lifecycle.refund(pool,2,'postponed');
  assert.deepEqual(await row('SELECT points,locked_points FROM users WHERE id=2'),{points:1000,locked_points:0});
  console.log('PASS: postpone retains stakes, resume works, optional refund succeeds');
  await assert.rejects(lifecycle.refund(pool,3),/冻结积分不足/);
  assert.equal((await row('SELECT result FROM predictions WHERE id=3')).result,null);
  assert.equal((await row('SELECT predictions_voided_at FROM matches WHERE id=3')).predictions_voided_at,null);
  await db.exec('UPDATE users SET locked_points=20 WHERE id=1; ALTER TABLE matches ADD CONSTRAINT test_final_write_failure CHECK(id<>3 OR predictions_voided_at IS NULL)');
  await assert.rejects(lifecycle.refund(pool,3),/test_final_write_failure/);
  assert.deepEqual(await row('SELECT points,locked_points FROM users WHERE id=1'),{points:1000,locked_points:20});
  assert.equal((await row('SELECT result FROM predictions WHERE id=3')).result,null);
  console.log('PASS: insufficient balance and late SQL failure roll back the entire transaction');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
