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
const AUTO_SYNC_MINUTES=Math.max(5,Number(process.env.AUTO_SYNC_MINUTES||15));
const CRON_SECRET=process.env.CRON_SECRET||'';

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

async function panda(pathname){
  if(!PANDA_TOKEN) throw Object.assign(new Error('尚未设置 PANDASCORE_TOKEN'),{status:400});
  const url=`https://api.pandascore.co${pathname}`;
  const r=await fetch(url,{headers:{Accept:'application/json',Authorization:`Bearer ${PANDA_TOKEN}`}});
  if(!r.ok) throw Object.assign(new Error(`PandaScore 请求失败 (${r.status})`),{status:502});
  return r.json();
}
function oppTeam(opp){return opp?.opponent||null}
function leagueLabel(x){
  const league=x.league?.name||'CS2';
  const serie=x.serie?.full_name||x.serie?.name;
  const tournament=x.tournament?.name;
  return [league,serie,tournament].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' · ').slice(0,120);
}
function normalizedOpponents(x){
  const a=oppTeam(x.opponents?.[0]),b=oppTeam(x.opponents?.[1]);
  if(!a||!b) return null;
  return {a,b};
}

async function syncUpcoming(){
  const items=await panda('/csgo/matches/upcoming?per_page=100&sort=begin_at');
  let inserted=0,updated=0,skipped=0;
  for(const x of items){
    const teams=normalizedOpponents(x);
    if(!teams||!x.begin_at){skipped++;continue}
    const r=await pool.query(`
      INSERT INTO matches(
        event_name,team_a,team_b,odds_a,odds_b,starts_at,status,source,external_id,
team_a_logo,team_b_logo,source_status,match_type,number_of_games,stage_name,synced_at
      )
      VALUES($1,$2,$3,1.80,1.80,$4,'open','pandascore',$5,$6,$7,$8,$9,$10,$11,NOW())
      ON CONFLICT(source,external_id) WHERE external_id IS NOT NULL
      DO UPDATE SET
        event_name=EXCLUDED.event_name,
        team_a=EXCLUDED.team_a,
        team_b=EXCLUDED.team_b,
        starts_at=EXCLUDED.starts_at,
        team_a_logo=EXCLUDED.team_a_logo,
        team_b_logo=EXCLUDED.team_b_logo,
        source_status=EXCLUDED.source_status,
        match_type=EXCLUDED.match_type,
        number_of_games=EXCLUDED.number_of_games,
        stage_name=EXCLUDED.stage_name,
        synced_at=NOW()
      RETURNING (xmax=0) AS inserted
    `,[
      leagueLabel(x),teams.a.name,teams.b.name,x.begin_at,String(x.id),
      teams.a.image_url||null,teams.b.image_url||null,x.status||'not_started',
x.match_type||null,
x.number_of_games||null,
x.tournament?.name||null
    ]);
    if(r.rows[0]?.inserted)inserted++;else updated++;
  }
  return {fetched:items.length,inserted,updated,skipped};
}

async function settleMatch(matchId,winner){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
  const m=(await client.query(
  "SELECT * FROM matches WHERE id=$1 FOR UPDATE",
  [matchId]
)).rows[0];
    if(!m)throw Object.assign(new Error('比赛不存在'),{status:404});
    if(m.status==='settled')return {settledPredictions:0,alreadySettled:true};
    if(winner!==m.team_a&&winner!==m.team_b)throw Object.assign(new Error('获胜队伍无效'),{status:400});
    const preds=(await client.query('SELECT * FROM predictions WHERE match_id=$1 AND result IS NULL FOR UPDATE',[m.id])).rows;
    for(const p of preds){
const isWin=p.predicted_team===winner,delta=isWin?50:0,result=isWin?'win':'loss';
      await client.query('UPDATE predictions SET result=$1,points_delta=$2 WHERE id=$3',[result,delta,p.id]);
      await client.query('UPDATE users SET points=GREATEST(0,points+$1) WHERE id=$2',[delta,p.user_id]);
    }
    await client.query("UPDATE matches SET winner=$1,status='settled',source_status='finished',synced_at=NOW() WHERE id=$2",[winner,m.id]);
    await client.query('COMMIT');
    return {settledPredictions:preds.length,alreadySettled:false};
  }catch(e){await client.query('ROLLBACK');throw e}
  finally{client.release()}
}
async function syncRunning(){
  const items=await panda('/csgo/matches/running?per_page=100');
  let inserted=0,updated=0,skipped=0;

  for(const x of items){
    const teams=normalizedOpponents(x);
    if(!teams){
      skipped++;
      continue;
    }

    const r=await pool.query(`
      INSERT INTO matches(
        event_name,
        team_a,
        team_b,
        odds_a,
        odds_b,
        starts_at,
        status,
        source,
        external_id,
        team_a_logo,
        team_b_logo,
        source_status,
        match_type,
        number_of_games,
        stage_name,
        synced_at
      )
      VALUES(
       $1,$2,$3,1.80,1.80,$4,'running','pandascore',$5,
$6,$7,$8,$9,$10,$11,NOW()
      )
      ON CONFLICT(source,external_id)
      WHERE external_id IS NOT NULL
      DO UPDATE SET
        event_name=EXCLUDED.event_name,
        team_a=EXCLUDED.team_a,
        team_b=EXCLUDED.team_b,
        starts_at=EXCLUDED.starts_at,
        status='running',
        team_a_logo=EXCLUDED.team_a_logo,
        team_b_logo=EXCLUDED.team_b_logo,
        source_status=EXCLUDED.source_status,
        match_type=EXCLUDED.match_type,
        number_of_games=EXCLUDED.number_of_games,
        stage_name=EXCLUDED.stage_name,
      
       synced_at=NOW()
      RETURNING (xmax=0) AS inserted
    `,[
      leagueLabel(x),
      teams.a.name,
      teams.b.name,
      x.begin_at||new Date().toISOString(),
      String(x.id),
      teams.a.image_url||null,
      teams.b.image_url||null,
      x.status||'running',
     x.match_type||null,
x.number_of_games||null,
x.tournament?.name||null
    ]);

    if(r.rows[0]?.inserted)inserted++;
    else updated++;
  }

  return {
    fetched:items.length,
    inserted,
    updated,
    skipped
  };
}
async function syncResults(){
  const items=await panda('/csgo/matches/past?per_page=100&sort=-end_at');
  let checked=0,settled=0,skipped=0;

  const local=(await pool.query(`
    SELECT id,external_id,status
    FROM matches
    WHERE source='pandascore'
      AND external_id IS NOT NULL
  `)).rows;

  const map=new Map(local.map(m=>[String(m.external_id),m]));

  for(const x of items){
   const m=map.get(String(x.id));
    if(m && x.tournament?.name){
  await pool.query(
    'UPDATE matches SET stage_name=$1 WHERE id=$2',
    [x.tournament.name,m.id]
  );
}

if(!m){
  if(x.status!=='finished' || !x.begin_at || !x.winner_id){
    continue;
  }

  const teams=normalizedOpponents(x);
  if(!teams)continue;

  const scoreMap=new Map(
    Array.isArray(x.results)
      ? x.results.map(r=>[String(r.team_id),Number(r.score)])
      : []
  );

  const scoreA=scoreMap.get(String(teams.a.id));
  const scoreB=scoreMap.get(String(teams.b.id));

  if(
    !Number.isFinite(scoreA) ||
    !Number.isFinite(scoreB) ||
    (scoreA===0 && scoreB===0)
  ){
    continue;
  }

  const winnerTeam=[teams.a,teams.b].find(
    t=>String(t.id)===String(x.winner_id)
  );

  if(!winnerTeam)continue;

  await pool.query(`
    INSERT INTO matches(
      event_name,
      team_a,
      team_b,
      starts_at,
      status,
      winner,
      source,
      external_id,
      team_a_logo,
      team_b_logo,
      source_status,
      match_type,
      number_of_games,
stage_name,
score_a,
score_b,
synced_at
    )
    VALUES(
      $1,$2,$3,$4,'settled',$5,'pandascore',$6,
      $7,$8,'finished',$9,$10,$11,$12,$13,NOW()
    )
    ON CONFLICT(source,external_id)
WHERE external_id IS NOT NULL
DO NOTHING
  `,[
    leagueLabel(x),
    teams.a.name,
    teams.b.name,
    x.begin_at,
    winnerTeam.name,
    String(x.id),
    teams.a.image_url||null,
    teams.b.image_url||null,
    x.match_type||null,
x.number_of_games||null,
x.tournament?.name||null,
scoreA,
scoreB
  ]);

  settled++;
  continue;
}
    checked++;

if(x.status==='canceled'){
  await pool.query(
    `UPDATE matches
     SET status='canceled',
         winner=NULL,
         score_a=NULL,
         score_b=NULL
     WHERE id=$1`,
    [m.id]
  );

  skipped++;
  continue;
}

if(
  x.status==='not_started' &&
  x.begin_at &&
  new Date(x.begin_at).getTime() < Date.now() - 24*60*60*1000
){
  await pool.query(
    `UPDATE matches
     SET status='canceled',
         winner=NULL,
         score_a=NULL,
         score_b=NULL
     WHERE id=$1`,
    [m.id]
  );

  skipped++;
  continue;
}

if(x.status!=='finished'){
  skipped++;
  continue;
}

const teams=normalizedOpponents(x);
    if(!teams){
      skipped++;
      continue;
    }

    const scoreMap=new Map(
      Array.isArray(x.results)
        ? x.results.map(r=>[String(r.team_id),Number(r.score)])
        : []
    );

    const scoreA=scoreMap.get(String(teams.a.id));
    const scoreB=scoreMap.get(String(teams.b.id));
    
    if(
  Number.isFinite(scoreA) &&
  Number.isFinite(scoreB) &&
  (scoreA>0 || scoreB>0)
){
      await pool.query(
        'UPDATE matches SET score_a=$1,score_b=$2 WHERE id=$3',
        [scoreA,scoreB,m.id]
      );
    }

    if(m.status==='settled')continue;

    if(!x.winner_id){
      skipped++;
      continue;
    }

    const winnerTeam=[teams.a,teams.b].find(
      t=>String(t.id)===String(x.winner_id)
    );

    if(!winnerTeam){
      skipped++;
      continue;
    }

    const result=await settleMatch(m.id,winnerTeam.name);

    if(!result.alreadySettled){
      settled++;
    }
  }

  const pastIds=new Set(items.map(x=>String(x.id)));

const stale=(await pool.query(`
  SELECT id,external_id
  FROM matches
  WHERE source='pandascore'
    AND status='open'
    AND starts_at < NOW() - INTERVAL '24 hours'
`)).rows;

for(const m of stale){
  if(pastIds.has(String(m.external_id)))continue;

  await pool.query(
    `UPDATE matches
     SET status='canceled',
         winner=NULL,
         score_a=NULL,
         score_b=NULL
     WHERE id=$1`,
    [m.id]
  );

  skipped++;
}
  return {
    fetched:items.length,
    checked,
    settled,
    skipped
  };
}
async function saveSyncStatus({
  status,
  triggerSource,
  upcoming=null,
  results=null,
  errorMessage=null
}){
  await pool.query(`
    UPDATE sync_status
    SET
      last_run_at=NOW(),
      last_success_at=CASE
        WHEN $1='success' THEN NOW()
        ELSE last_success_at
      END,
      status=$1,
      trigger_source=$2,

      upcoming_fetched=$3,
      upcoming_inserted=$4,
      upcoming_updated=$5,
      upcoming_skipped=$6,

      results_fetched=$7,
      results_checked=$8,
      results_settled=$9,
      results_skipped=$10,

      error_message=$11
    WHERE id=1
  `,[
    status,
    triggerSource,

    upcoming?.fetched ?? 0,
    upcoming?.inserted ?? 0,
    upcoming?.updated ?? 0,
    upcoming?.skipped ?? 0,

    results?.fetched ?? 0,
    results?.checked ?? 0,
    results?.settled ?? 0,
    results?.skipped ?? 0,

    errorMessage
  ]);
  await pool.query(`
  INSERT INTO sync_history (
    status,
    trigger_source,

    upcoming_fetched,
    upcoming_inserted,
    upcoming_updated,
    upcoming_skipped,

    results_fetched,
    results_checked,
    results_settled,
    results_skipped,

    error_message
  )
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
`,[
  status,
  triggerSource,

  upcoming?.fetched ?? 0,
  upcoming?.inserted ?? 0,
  upcoming?.updated ?? 0,
  upcoming?.skipped ?? 0,

  results?.fetched ?? 0,
  results?.checked ?? 0,
  results?.settled ?? 0,
  results?.skipped ?? 0,

  errorMessage
]);
}
app.get('/api/health',async(req,res)=>{
  try{
    await pool.query('SELECT 1');
    res.json({ok:true,version:'3.0.0',pandascoreConfigured:!!PANDA_TOKEN,autoSyncMinutes:AUTO_SYNC_MINUTES});
  }catch{res.status(503).json({ok:false})}
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
    FROM matches m
WHERE
  (m.status='open' AND m.starts_at>NOW())
  OR m.status='running'
  OR m.source_status='running'
ORDER BY m.starts_at
LIMIT 100
`,[userId]);
  
  res.json({matches:r.rows});
});
app.get('/api/results',async(req,res)=>{
  try{
    const r=await pool.query(`
      SELECT
        id,
        event_name,
        team_a,
        team_b,
        team_a_logo,
        team_b_logo,
        winner,
        score_a,
        score_b,
        starts_at,
        source,
        number_of_games
      FROM matches
      WHERE status='settled'
        AND winner IS NOT NULL
      ORDER BY starts_at DESC
      LIMIT 20
    `);

    res.json({results:r.rows});
  }catch(e){
    console.error(e);
    res.status(500).json({message:'获取最近赛果失败'});
  }
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
    const m=(await client.query(
  "SELECT * FROM matches WHERE id=$1 AND status='open' AND starts_at>NOW()+INTERVAL '10 minutes' FOR UPDATE",
  [matchId]
)).rows[0];
    if(!m)throw Object.assign(
  new Error('竞猜已锁定：比赛开始前10分钟停止预测'),
  {status:400}
);
    if(team!==m.team_a&&team!==m.team_b)throw Object.assign(new Error('无效的预测队伍'),{status:400});
   const existing=(await client.query(
  'SELECT id,predicted_team,result FROM predictions WHERE user_id=$1 AND match_id=$2 FOR UPDATE',
  [req.user.id,matchId]
)).rows[0];

let responseStatus=201;
let responseMessage=`预测 ${team} 成功，比赛结算后猜中 +50 积分`;

if(existing){
  if(existing.result){
    throw Object.assign(new Error('该预测已经结算，不能修改'),{status:409});
  }

  if(existing.predicted_team===team){
    throw Object.assign(new Error(`你已经预测了 ${team}`),{status:409});
  }

  await client.query(
    'UPDATE predictions SET predicted_team=$1 WHERE id=$2',
    [team,existing.id]
  );

  responseStatus=200;
  responseMessage=`预测已修改为 ${team}，比赛结算后猜中 +50 积分`;
}else{
  await client.query(
    'INSERT INTO predictions(user_id,match_id,predicted_team) VALUES($1,$2,$3)',
    [req.user.id,matchId,team]
  );
}
const u=(await client.query('SELECT id,username,role,points FROM users WHERE id=$1',[req.user.id])).rows[0];
await client.query('COMMIT');
res.status(responseStatus).json({
  user:u,
  message:responseMessage
});
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
    (SELECT COUNT(*)::int FROM predictions) predictions,
    (SELECT COUNT(*)::int FROM matches WHERE source='pandascore') pandascore_matches
  `);

  const sync=(await pool.query(`
    SELECT *
    FROM sync_status
    WHERE id=1
  `)).rows[0]||null;

  res.json({
    ...r.rows[0],
    pandascore_configured:!!PANDA_TOKEN,
    auto_sync_minutes:AUTO_SYNC_MINUTES,
    sync_status:sync
  });
});
app.get('/api/admin/sync-history',auth,admin,async(req,res)=>{
  try{
    const r=await pool.query(`
      SELECT
        id,
        created_at,
        status,
        trigger_source,
        upcoming_fetched,
        upcoming_inserted,
        upcoming_updated,
        upcoming_skipped,
        results_fetched,
        results_checked,
        results_settled,
        results_skipped,
        error_message
      FROM sync_history
      ORDER BY created_at DESC
      LIMIT 50
    `);

    res.json({history:r.rows});
  }catch(e){
    console.error(e);
    res.status(500).json({message:'获取同步历史失败'});
  }
});
app.get('/api/admin/debug/pandascore-match/:id',auth,admin,async(req,res)=>{
  try{
    const id=String(req.params.id||'').trim();

    if(!/^\d+$/.test(id)){
      return res.status(400).json({message:'无效比赛 ID'});
    }

    const local=(await pool.query(
  `SELECT external_id
   FROM matches
   WHERE id=$1
     AND source='pandascore'
     AND external_id IS NOT NULL`,
  [id]
)).rows[0];

if(!local){
  return res.status(404).json({message:'找不到对应的 PandaScore 比赛'});
}

const items=await panda('/csgo/matches/past?per_page=100&sort=-end_at');

const match=items.find(
  x=>String(x.id)===String(local.external_id)
);

if(!match){
  return res.status(404).json({
    message:'这场比赛不在 PandaScore 最近 100 场历史数据中'
  });
}

    res.json({
      id:match.id,
      name:match.name,
      status:match.status,
      winner_id:match.winner_id,
      number_of_games:match.number_of_games,
      results:match.results,
      games:match.games,
      opponents:match.opponents
    });
  }catch(e){
    console.error('[PandaScore debug]',e);
    res.status(e.status||500).json({
      message:e.message||'读取 PandaScore 比赛详情失败'
    });
  }
});
app.get('/api/admin/debug/pandascore-past',auth,admin,async(req,res)=>{
  try{
    const items=await panda('/csgo/matches/past?per_page=100&sort=-end_at');

    res.json({
      matches:items.map(x=>({
        id:x.id,
        name:x.name,
        status:x.status,
        winner_id:x.winner_id,
        number_of_games:x.number_of_games,
        results:x.results,
        games:Array.isArray(x.games)
          ? x.games.map(g=>({
              id:g.id,
              position:g.position,
              status:g.status,
              complete:g.complete,
              finished:g.finished,
              winner:g.winner
            }))
          : []
      }))
    });
  }catch(e){
    console.error('[PandaScore past debug]',e);
    res.status(e.status||500).json({
      message:e.message||'读取 PandaScore 历史比赛失败'
    });
  }
});
app.get('/api/admin/debug/canceled-settlements',auth,admin,async(req,res)=>{
  try{
    const r=await pool.query(`
      SELECT
        m.id AS match_id,
        m.external_id,
        m.event_name,
        m.team_a,
        m.team_b,
        m.winner,
        p.id AS prediction_id,
        p.user_id,
        p.predicted_team,
        p.result,
        p.points_delta,
        p.created_at
      FROM matches m
      LEFT JOIN predictions p ON p.match_id=m.id
      WHERE m.id IN (8869,3255,957,9,24,32,39,20,13,10959)
      ORDER BY m.id,p.id
    `);

    res.json({rows:r.rows});
  }catch(e){
    console.error('[Canceled settlements debug]',e);
    res.status(500).json({
      message:'读取误结算检查数据失败'
    });
  }
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
const {
  eventName,
  teamA,
  teamB,
  oddsA=1.8,
  oddsB=1.8,
  numberOfGames=3,
  startsAt
}=req.body||{};

if(!eventName||!teamA||!teamB||!startsAt)
  return res.status(400).json({message:'缺少比赛字段'});

if(teamA===teamB)
  return res.status(400).json({message:'两支队伍不能相同'});

const r=await pool.query(`
  INSERT INTO matches(
    event_name,
    team_a,
    team_b,
    odds_a,
    odds_b,
    number_of_games,
    match_type,
    starts_at,
    source
  )
  VALUES($1,$2,$3,$4,$5,$6,'best_of',$7,'manual')
  RETURNING *
`,[
  eventName,
  teamA,
  teamB,
  oddsA,
  oddsB,
  numberOfGames,
  startsAt
]);

res.status(201).json({match:r.rows[0]});

});
app.post('/api/admin/matches/:id/result',auth,admin,async(req,res)=>{
  try{const r=await settleMatch(req.params.id,(req.body||{}).winner);res.json({message:'比赛已结算',...r})}
  catch(e){res.status(e.status||500).json({message:e.status?e.message:'结算失败'})}
});
app.delete('/api/admin/matches/:id',auth,admin,async(req,res)=>{
  const client=await pool.connect();

  try{
    await client.query('BEGIN');

    const m=(await client.query(
      'SELECT id,event_name,source,status FROM matches WHERE id=$1 FOR UPDATE',
      [req.params.id]
    )).rows[0];

    if(!m){
      throw Object.assign(new Error('比赛不存在'),{status:404});
    }

    if(m.source!=='manual'){
      throw Object.assign(
        new Error('只能删除手动创建的比赛'),
        {status:400}
      );
    }

    const predictionCount=Number(
      (await client.query(
        'SELECT COUNT(*) AS count FROM predictions WHERE match_id=$1',
        [m.id]
      )).rows[0].count||0
    );

    if(predictionCount>0){
      throw Object.assign(
        new Error('该比赛已有预测记录，不能删除'),
        {status:409}
      );
    }

    await client.query(
      'DELETE FROM matches WHERE id=$1',
      [m.id]
    );

    await client.query('COMMIT');

    res.json({
      message:'手动比赛已删除'
    });

  }catch(e){
    await client.query('ROLLBACK');
    res.status(e.status||500).json({
      message:e.status?e.message:'删除比赛失败'
    });
  }finally{
    client.release();
  }
});
app.post('/api/cron/sync',async(req,res)=>{
  const provided=req.headers['x-cron-secret'];

  if(!CRON_SECRET || provided!==CRON_SECRET){
    return res.status(401).json({message:'Unauthorized'});
  }

  try{
    const upcoming=await syncUpcoming();
const running=await syncRunning();
const results=await syncResults();

console.log('[CronSync]',{upcoming,running,results});
    await saveSyncStatus({
  status:'success',
  triggerSource:'github-cron',
  upcoming,
  running,
  results
});

    res.json({
  ok:true,
  upcoming,
  running,
  results
});
  }catch(e){
  console.error('[CronSync error]',e);

  try{
    await saveSyncStatus({
      status:'error',
      triggerSource:'github-cron',
      errorMessage:e.message||String(e)
    });
  }catch(statusError){
    console.error('[SyncStatus error]',statusError);
  }

  res.status(500).json({message:'同步失败'});
}
});
app.post('/api/admin/sync/pandascore',auth,admin,async(req,res)=>{
  try{
    const upcoming=await syncUpcoming();

    await saveSyncStatus({
      status:'success',
      triggerSource:'admin-upcoming',
      upcoming
    });

    res.json(upcoming);
  }catch(e){
    console.error(e);

    try{
      await saveSyncStatus({
        status:'error',
        triggerSource:'admin-upcoming',
        errorMessage:e.message||String(e)
      });
    }catch(statusError){
      console.error('[SyncStatus error]',statusError);
    }

    res.status(e.status||500).json({
      message:e.message||'同步 PandaScore 失败'
    });
  }
});
app.post('/api/admin/sync/results',auth,admin,async(req,res)=>{
  try{
    const results=await syncResults();

    await saveSyncStatus({
      status:'success',
      triggerSource:'admin-results',
      results
    });

    res.json(results);
  }catch(e){
    console.error(e);

    try{
      await saveSyncStatus({
        status:'error',
        triggerSource:'admin-results',
        errorMessage:e.message||String(e)
      });
    }catch(statusError){
      console.error('[SyncStatus error]',statusError);
    }

    res.status(e.status||500).json({
      message:e.message||'同步比赛结果失败'
    });
  }
});
app.post('/api/admin/sync/all',auth,admin,async(req,res)=>{
  try{
    const upcoming=await syncUpcoming();
    const results=await syncResults();

    await saveSyncStatus({
      status:'success',
      triggerSource:'admin-all',
      upcoming,
      results
    });

    res.json({upcoming,results});
  }catch(e){
    console.error(e);

    try{
      await saveSyncStatus({
        status:'error',
        triggerSource:'admin-all',
        errorMessage:e.message||String(e)
      });
    }catch(statusError){
      console.error('[SyncStatus error]',statusError);
    }

    res.status(e.status||500).json({
      message:e.message||'同步失败'
    });
  }
});

/* Auto sync while the instance is awake. Render free instances may sleep when idle. */
if(PANDA_TOKEN){
const run=async()=>{
  try{
    const u=await syncUpcoming();
const l=await syncRunning();
const r=await syncResults();

console.log('[AutoSync]',{upcoming:u,running:l,results:r});

    await saveSyncStatus({
  status:'success',
  triggerSource:'render-autosync',
  upcoming:u,
  running:l,
  results:r
});
  }catch(e){
    console.error('[AutoSync error]',e.message);

    try{
      await saveSyncStatus({
        status:'error',
        triggerSource:'render-autosync',
        errorMessage:e.message||String(e)
      });
    }catch(statusError){
      console.error('[SyncStatus error]',statusError);
    }
  }
};
setTimeout(run,15000);
  setInterval(run,AUTO_SYNC_MINUTES*60*1000);
}
app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));
app.use((req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT,()=>console.log(`CS2 Prediction Center V3 running on http://localhost:${PORT}`));
