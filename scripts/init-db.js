require('dotenv').config();
const fs=require('fs');
const path=require('path');
const bcrypt=require('bcryptjs');
const {Pool}=require('pg');

const pool=new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:false
});

async function runSql(client,file){
  const p=path.join(__dirname,'..','db',file);
  if(fs.existsSync(p)) await client.query(fs.readFileSync(p,'utf8'));
}

(async()=>{
  const client=await pool.connect();
  try{
    await runSql(client,'schema.sql');
    await runSql(client,'migration_v2.sql');
    await runSql(client,'migration_v3.sql');
    await runSql(client,'migration_v4.sql');
    await runSql(client,'migration_v5.sql');
    await runSql(client,'migration_v6.sql');
    await runSql(client,'migration_v7.sql');
    await runSql(client,'migration_v8.sql');
    await runSql(client,'migration_v9.sql');
    await runSql(client,'migration_v10.sql');
    await runSql(client,'migration_v11.sql');
    await runSql(client,'migration_v12.sql');
    await runSql(client,'migration_v13.sql');
    await runSql(client,'seed.sql');

    const adminPassword=process.env.ADMIN_PASSWORD || (process.env.NODE_ENV==='production'?null:'Admin123!');
    if(!adminPassword) throw new Error('ADMIN_PASSWORD must be set in production');

    const hash=await bcrypt.hash(adminPassword,12);
    await client.query(`
      INSERT INTO users(username,password_hash,role,points)
      VALUES('admin',$1,'admin',1000)
      ON CONFLICT(username)
      DO UPDATE SET password_hash=EXCLUDED.password_hash, role='admin'
    `,[hash]);

    console.log('Database initialized. Admin username: admin');
    console.log(process.env.PANDASCORE_TOKEN
      ? 'PandaScore integration enabled'
      : 'PandaScore token not configured');
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e=>{console.error(e);process.exit(1)});
