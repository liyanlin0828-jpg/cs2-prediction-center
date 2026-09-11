require('dotenv').config();
const express=require('express');
const path=require('path');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const {Pool}=require('pg');

const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'128kb'}));
app.use(express.static(path.join(__dirname,'public')));

const pool=new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:false
});
const PORT=process.env.PORT||3000;
const JWT_SECRET=process.env.JWT_SECRET||'change-this-secret';
const PANDA_TOKEN=process.env.PANDASCORE_TOKEN||'';

function sign(user){return jwt.sign({id:user.id,username:user.username,role:user.role},JWT_SECRET,{expiresIn:'7d'})}
function auth(req,res,next){
  try{
    const h=req.headers.authorization||'';
    if(!h.startsWith('Bearer '))return res.status(401).json({message:'请先登录'});
    req.user=jwt.verify(h.slice(7),JWT_SECRET);next();
  }catch{return res.status(401).json({message:'登录已过期，请重新登录'})}
}
function admin(req,res,next){if(req.user.role!=='admin')return res.status(403).json({message:'需要管理员权限'});next()}
const validUsername=s=>/^[A-Za-z0-9_]{3,24}$/.test(s||'');

app.get('/api/health',async(req,res)=>{
  try{await pool.query('SELECT 1');res.json({ok:true,version:'2.0.0',pandascoreConfigured:!!PANDA_TOKEN})}
  catch{res.status(503).json({ok:false})}
});

app.post('/api/auth/register',async(req,res)=>{
  const {username,password}=req.body||{};
  if(!validUsername(username))return res.status(400).json({message:'用户名需为3-24位字母、数字或下划线'});
  if(!password||password.length<8)return res.status(400).json({message:'密码至少8位'});
  try{
    const hash=await bcrypt.hash(password,12);
    const r=await pool.query('INSERT INTO users(username,password_hash) VALUES($1,$2) RETURNING id,username,role,points',[username,hash]);
    res.status(201).json({token:sign(r.rows[0]),user:r.rows[0],message:'注册成功'});
  }catch(e){
    if(e.code==='23505')return res.status(409).json({message:'用户名已存在'});
    console.error(e);res.status(500).json({message:'注册失败'});
  }
});
app.post('/api/auth/login',async(req,res)=>{
  const {username,password}=req.body||{};
  const r=await pool.query('SELECT id,username,password_hash,role,points FROM users WHERE username=$1',[username]);
  if(!r.rowCount||!(await bcrypt.compare(password||'',r.rows[0].password_hash)))return res.status(401).json({message:'用户名或密码错误'});
  const u=r.rows[0];delete u.password_hash;res.json({token:sign(u),user:u,message:'登录成功'});
});
app.get('/api/auth/me',auth,async(req,res)=>{
  const r=await pool.query(`SELECT u.id,u.username,u.role,u.points,
    COALESCE(ROUND(100.0*COUNT(p.id) FILTER(WHERE p.result='win')/NULLIF(COUNT(p.id) FILTER(WHERE p.result IS NOT NULL),0),1),0) AS win_rate
    FROM users u LEFT JOIN predictions p ON p.user_id=u.id WHERE u.id=$1 GROUP BY u.id`,[req.user.id]);
  if(!r.rowCount)return res.status(404).json({message:'用户不存在'});
  res.json({user:r.rows[0]});
});

app.get('/api/matches',async(req,res)=>{
  let userId=null;
  const h=req.headers.authorization||'';
  if(h.startsWith('Bearer ')){try{userId=jwt.verify(h.slice(7),JWT_SECRET).id}catch{}}
  const r=await pool.query(`SELECT m.*,
    (SELECT p.predicted_team FROM predictions p WHERE p.match_id=m.id AND p.user_id=$1) AS user_prediction
    FROM matches m WHERE m.status='open' AND m.starts_at>NOW() ORDER BY m.starts_at LIMIT 100`,[userId]);
  res.json({matches:r.rows});
});
app.get('/api/leaderboard',async(req,res)=>{
  const r=await pool.query(`SELECT u.username,u.points,COUNT(p.id)::int AS predictions,
    COALESCE(ROUND(100.0*COUNT(p.id) FILTER(WHERE p.result='win')/NULLIF(COUNT(p.id) FILTER(WHERE p.result IS NOT NULL),0),1),0) AS win_rate
    FROM users u LEFT JOIN predictions p ON p.user_id=u.id
    GROUP BY u.id ORDER BY u.points DESC,u.created_at ASC LIMIT 100`);
  res.json({users:r.rows});
});

app.post('/api/predictions',auth,async(req,res)=>{
  const {matchId,team}=req.body||{};
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const m=(await client.query("SELECT * FROM matches WHERE id=$1 AND status='open' AND starts_at>NOW() FOR UPDATE",[matchId])).rows[0];
    if(!m)throw Object.assign(new Error('比赛不存在、已关闭或已开始'),{status:400});
    if(team!==m.team_a&&team!==m.team_b)throw Object.assign(new Error('无效的预测队伍'),{status:400});
    if((await client.query('SELECT 1 FROM predictions WHERE user_id=$1 AND match_id=$2',[req.user.id,matchId])).rowCount)
      throw Object.assign(new Error('这场比赛已经预测过了'),{status:409});
    await client.query('INSERT INTO predictions(user_id,match_id,predicted_team) VALUES($1,$2,$3)',[req.user.id,matchId,team]);
    const u=(await client.query('UPDATE users SET points=points+50 WHERE id=$1 RETURNING id,username,role,points',[req.user.id])).rows[0];
    await client.query('COMMIT');res.status(201).json({user:u,message:`预测 ${team} 成功，+50 积分`});
  }catch(e){await client.query('ROLLBACK');res.status(e.status||500).json({message:e.status?e.message:'预测失败'})}
  finally{client.release()}
});
app.get('/api/predictions/me',auth,async(req,res)=>{
  const r=await pool.query(`SELECT p.id,p.predicted_team,p.result,p.points_delta,p.created_at,
    m.event_name,m.team_a,m.team_b,m.starts_at,m.winner
    FROM predictions p JOIN matches m ON m.id=p.match_id WHERE p.user_id=$1 ORDER BY p.created_at DESC`,[req.user.id]);
  res.json({predictions:r.rows});
});

/* ---------- Admin ---------- */
app.get('/api/admin/stats',auth,admin,async(req,res)=>{
  const r=await pool.query(`SELECT
    (SELECT COUNT(*)::int FROM users) users,
    (SELECT COUNT(*)::int FROM matches) matches,
    (SELECT COUNT(*)::int FROM matches WHERE status='open') open_matches,
    (SELECT COUNT(*)::int FROM predictions) predictions`);
  res.json(r.rows[0]);
});
app.get('/api/admin/users',auth,admin,async(req,res)=>{
  const r=await pool.query(`SELECT u.id,u.username,u.role,u.points,u.created_at,COUNT(p.id)::int predictions
    FROM users u LEFT JOIN predictions p ON p.user_id=u.id GROUP BY u.id ORDER BY u.created_at DESC LIMIT 500`);
  res.json({users:r.rows});
});
app.get('/api/admin/matches',auth,admin,async(req,res)=>{
  const r=await pool.query('SELECT * FROM matches ORDER BY starts_at DESC LIMIT 500');res.json({matches:r.rows});
});
app.post('/api/admin/matches',auth,admin,async(req,res)=>{
  const {eventName,teamA,teamB,oddsA=1.8,oddsB=1.8,startsAt}=req.body||{};
  if(!eventName||!teamA||!teamB||!startsAt)return res.status(400).json({message:'缺少比赛字段'});
  if(teamA===teamB)return res.status(400).json({message:'两支队伍不能相同'});
  const r=await pool.query(`INSERT INTO matches(event_name,team_a,team_b,odds_a,odds_b,starts_at,source)
    VALUES($1,$2,$3,$4,$5,$6,'manual') RETURNING *`,[eventName,teamA,teamB,oddsA,oddsB,startsAt]);
  res.status(201).json({match:r.rows[0]});
});

async function settleMatch(matchId,winner){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const m=(await client.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE',[matchId])).rows[0];
    if(!m)throw Object.assign(new Error('比赛不存在'),{status:404});
    if(m.status==='settled')throw Object.assign(new Error('比赛已经结算'),{status:409});
    if(winner!==m.team_a&&winner!==m.team_b)throw Object.assign(new Error('获胜队伍无效'),{status:400});
    const preds=(await client.query('SELECT * FROM predictions WHERE match_id=$1 AND result IS NULL FOR UPDATE',[m.id])).rows;
    for(const p of preds){
      const isWin=p.predicted_team===winner, delta=isWin?100:-50, result=isWin?'win':'loss';
      await client.query('UPDATE predictions SET result=$1,points_delta=$2 WHERE id=$3',[result,delta,p.id]);
      await client.query('UPDATE users SET points=GREATEST(0,points+$1) WHERE id=$2',[delta,p.user_id]);
    }
    await client.query("UPDATE matches SET winner=$1,status='settled' WHERE id=$2",[winner,m.id]);
    await client.query('COMMIT');
    return {settledPredictions:preds.length};
  }catch(e){await client.query('ROLLBACK');throw e}
  finally{client.release()}
}
app.post('/api/admin/matches/:id/result',auth,admin,async(req,res)=>{
  try{const r=await settleMatch(req.params.id,(req.body||{}).winner);res.json({message:'比赛已结算',...r})}
  catch(e){res.status(e.status||500).json({message:e.status?e.message:'结算失败'})}
});

function teamName(opp){return opp?.opponent?.name||null}
app.post('/api/admin/sync/pandascore',auth,admin,async(req,res)=>{
  if(!PANDA_TOKEN)return res.status(400).json({message:'尚未设置 PANDASCORE_TOKEN'});
  try{
    const url='https://api.pandascore.co/csgo/matches/upcoming?per_page=50&sort=begin_at';
    const pr=await fetch(url,{headers:{Accept:'application/json',Authorization:`Bearer ${PANDA_TOKEN}`}});
    if(!pr.ok)return res.status(502).json({message:`PandaScore 请求失败 (${pr.status})`});
    const items=await pr.json();
    let inserted=0,updated=0,skipped=0;
    for(const x of items){
      const a=teamName(x.opponents?.[0]),b=teamName(x.opponents?.[1]);
      if(!a||!b||!x.begin_at){skipped++;continue}
      const event=x.league?.name||x.serie?.full_name||x.tournament?.name||'CS2';
      const external=String(x.id);
      const r=await pool.query(`INSERT INTO matches(event_name,team_a,team_b,odds_a,odds_b,starts_at,source,external_id)
        VALUES($1,$2,$3,1.80,1.80,$4,'pandascore',$5)
        ON CONFLICT(source,external_id) WHERE external_id IS NOT NULL
        DO UPDATE SET event_name=EXCLUDED.event_name,team_a=EXCLUDED.team_a,team_b=EXCLUDED.team_b,starts_at=EXCLUDED.starts_at
        RETURNING (xmax=0) AS inserted`,[event,a,b,x.begin_at,external]);
      if(r.rows[0]?.inserted)inserted++;else updated++;
    }
    res.json({fetched:items.length,inserted,updated,skipped});
  }catch(e){console.error(e);res.status(500).json({message:'同步 PandaScore 失败'})}
});

app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));
app.use((req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT,()=>console.log(`CS2 Prediction Center V2 running on http://localhost:${PORT}`));
