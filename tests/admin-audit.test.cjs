const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {auditedPool}=require('../lib/admin-audit');
const {PGlite}=require(process.env.PGLITE_TEST_MODULE||'@electric-sql/pglite');
(async()=>{
 const db=new PGlite();
 const client={query:async(...a)=>{const r=await db.query(...a);return {...r,rowCount:r.affectedRows??r.rows.length}},release:()=>{}};
 const pool={connect:async()=>client};
 try{
  await db.exec(`CREATE TABLE users(id INT PRIMARY KEY,username TEXT,points INT,locked_points INT,password_hash TEXT);
   INSERT INTO users VALUES(1,'admin',1000,0,'secret'),(2,'player',100,50,'secret');
   CREATE TABLE matches(id INT PRIMARY KEY,status TEXT,winner TEXT); INSERT INTO matches VALUES(10,'running',NULL);
   CREATE TABLE predictions(id INT,user_id INT,match_id INT,result TEXT); INSERT INTO predictions VALUES(1,2,10,NULL);
   CREATE TABLE map_predictions(id INT,user_id INT,match_id INT,result TEXT);`);
  await db.exec(fs.readFileSync(path.join(__dirname,'../db/migration_v20.sql'),'utf8'));
  const c=await auditedPool(pool,1,'result','match',10).connect();
  await c.query('BEGIN');await c.query("UPDATE matches SET status='settled',winner='A' WHERE id=10");
  await c.query('UPDATE users SET points=200,locked_points=0 WHERE id=2');await c.query('COMMIT');
  let logs=(await db.query('SELECT * FROM admin_audit_logs')).rows;assert.equal(logs.length,1);
  assert.equal(logs[0].before_state.match.status,'running');assert.equal(logs[0].after_state.match.winner,'A');
  assert.equal(logs[0].before_state.users[0].points,100);assert.equal(logs[0].after_state.users[0].points,200);
  assert.equal(JSON.stringify(logs).includes('secret'),false);
  await c.query('BEGIN');await c.query('COMMIT');assert.equal((await db.query('SELECT * FROM admin_audit_logs')).rows.length,1);
  const grant=await auditedPool(pool,1,'grant-points','user',2).connect();
  await grant.query('BEGIN');await grant.query('UPDATE users SET points=points+25 WHERE id=2');await grant.query('COMMIT');
  logs=(await db.query('SELECT * FROM admin_audit_logs ORDER BY id')).rows;assert.equal(logs.length,2);assert.equal(logs[1].after_state.users[0].points,225);
  await db.exec("ALTER TABLE admin_audit_logs ADD CONSTRAINT reject_new CHECK(action<>'unsettle')");
  const bad=await auditedPool(pool,1,'unsettle','match',10).connect();
  await bad.query('BEGIN');await bad.query("UPDATE matches SET status='running',winner=NULL WHERE id=10");await bad.query('UPDATE users SET points=50 WHERE id=2');
  await assert.rejects(bad.query('COMMIT'));await bad.query('ROLLBACK');
  assert.equal((await db.query('SELECT winner FROM matches WHERE id=10')).rows[0].winner,'A');
  assert.equal((await db.query('SELECT points FROM users WHERE id=2')).rows[0].points,225);
  assert.equal((await db.query('SELECT * FROM admin_audit_logs')).rows.length,2);
  console.log('PASS: atomic audit, before/after states, actor, zero-change retry, user grants, no password capture and audit-failure rollback');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
