require('dotenv').config();
const fs=require('fs');
const path=require('path');
const bcrypt=require('bcryptjs');
const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{
  const client=await pool.connect();
  try{
    await client.query(fs.readFileSync(path.join(__dirname,'..','db','schema.sql'),'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname,'..','db','seed.sql'),'utf8'));
    const adminPassword = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? null : 'Admin123!');
    if(!adminPassword) throw new Error('ADMIN_PASSWORD must be set in production');
    const hash=await bcrypt.hash(adminPassword,12);
    await client.query(`INSERT INTO users(username,password_hash,role,points) VALUES('admin',$1,'admin',1000)
      ON CONFLICT(username) DO NOTHING`,[hash]);
    console.log('Database initialized. Admin username: admin');
    console.log('For PandaScore sync, set PANDASCORE_TOKEN in .env');
  } finally {client.release(); await pool.end();}
})().catch(e=>{console.error(e);process.exit(1);});
