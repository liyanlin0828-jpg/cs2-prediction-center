require('dotenv').config();
const express=require('express');
const path=require('path');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const {Pool}=require('pg');
const mapMarket=require('./lib/map-market');
const matchLifecycle=require('./lib/match-lifecycle');
const {auditedPool}=require('./lib/admin-audit');
const {createNewsService}=require('./lib/news');

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
    if(x.status==='postponed'||x.status==='canceled'){
      const local=(await pool.query("SELECT id FROM matches WHERE source='pandascore' AND external_id=$1",[String(x.id)])).rows[0];
      if(local){
        if(x.status==='postponed')await matchLifecycle.postpone(pool,local.id,x);
        else await matchLifecycle.refund(pool,local.id,'canceled',x);
      }
      skipped++;continue;
    }
    if(x.status!=='not_started'){skipped++;continue}
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
        status=CASE WHEN matches.status='postponed' AND EXCLUDED.starts_at>NOW()
                         AND EXCLUDED.starts_at<>matches.starts_at THEN 'open' ELSE matches.status END,
        team_a_logo=EXCLUDED.team_a_logo,
        team_b_logo=EXCLUDED.team_b_logo,
        source_status=EXCLUDED.source_status,
        match_type=EXCLUDED.match_type,
        number_of_games=EXCLUDED.number_of_games,
        stage_name=EXCLUDED.stage_name,
        synced_at=NOW()
      WHERE matches.status NOT IN ('settled','canceled')
        AND matches.predictions_voided_at IS NULL
      RETURNING (xmax=0) AS inserted
    `,[
      leagueLabel(x),teams.a.name,teams.b.name,x.begin_at,String(x.id),
      teams.a.image_url||null,teams.b.image_url||null,x.status||'not_started',
x.match_type||null,
x.number_of_games||null,
x.tournament?.name||null
    ]);
    if(!r.rows.length)skipped++;
    else if(r.rows[0].inserted)inserted++;else updated++;
  }
  return {fetched:items.length,inserted,updated,skipped};
}

async function settleMatch(matchId,winner,sourceMatch=null,transactionPool=pool){
  const client=await transactionPool.connect();
  try{
    await client.query('BEGIN');
  const m=(await client.query(
  "SELECT * FROM matches WHERE id=$1 FOR UPDATE",
  [matchId]
)).rows[0];
    if(!m)throw Object.assign(new Error('比赛不存在'),{status:404});
    if(m.predictions_voided_at)throw Object.assign(new Error('本场预测已退分，不能再次结算'),{status:409,code:'SYNC_RESULT_CONFLICT'});
    // Validate the upstream identity against the locked local row before any writes.
    if(sourceMatch){
      const teams=normalizedOpponents(sourceMatch);
      const winnerTeam=teams && [teams.a,teams.b].find(t=>String(t.id)===String(sourceMatch.winner_id));
      if(sourceMatch.status!=='finished' || !sourceMatch.winner_id || !winnerTeam ||
         m.source!=='pandascore' || String(m.external_id)!==String(sourceMatch.id) ||
         ![teams.a.name,teams.b.name].includes(m.team_a) ||
         ![teams.a.name,teams.b.name].includes(m.team_b) || m.team_a===m.team_b ||
         winnerTeam.name!==winner){
        throw Object.assign(new Error('PandaScore 比赛或获胜队伍与本地记录不一致'),{status:409,code:'SYNC_RESULT_CONFLICT'});
      }
      if(m.status==='settled' && m.winner!==winner){
        throw Object.assign(new Error('PandaScore 胜者与已结算结果不一致，请人工核查'),{status:409,code:'SYNC_RESULT_CONFLICT'});
      }
      const scores=validResultScores(sourceMatch,teams);
      // Opponent order may differ from the local A/B order.
      if(scores){
        const ordered=teams.a.name===m.team_a ? scores : [scores[1],scores[0]];
        await client.query('UPDATE matches SET score_a=$1,score_b=$2 WHERE id=$3',
          [ordered[0],ordered[1],m.id]);
      }
      await client.query(
        "UPDATE matches SET stage_name=COALESCE($1,stage_name),source_status='finished',synced_at=NOW() WHERE id=$2",
        [sourceMatch.tournament?.name||null,m.id]
      );
    }
    if(m.status==='settled'){
      await client.query('COMMIT');
      return {settledPredictions:0,alreadySettled:true};
    }
    if(winner!==m.team_a&&winner!==m.team_b)throw Object.assign(new Error('获胜队伍无效'),{status:400});
    const preds=(await client.query(
  'SELECT * FROM predictions WHERE match_id=$1 AND result IS NULL FOR UPDATE',
  [m.id]
)).rows;
    for(const p of preds){
  const isWin=p.predicted_team===winner;
  const result=isWin?'win':'loss';

  const stake=Number(p.stake_points||0);
  const odds=Number(p.odds_at_prediction||0);

  const payout=
    isWin && stake>0 && Number.isFinite(odds) && odds>0
      ? Math.floor(stake*odds)
      : 0;

  const pointsDelta=isWin
    ? Math.max(0,payout-stake)
    : -stake;

  await client.query(
    `UPDATE predictions
     SET result=$1,
         points_delta=$2
     WHERE id=$3`,
    [result,pointsDelta,p.id]
  );

  if(stake>0){
    await client.query(
      `UPDATE users
       SET
         locked_points=GREATEST(0,locked_points-$1),
         points=points+$2
       WHERE id=$3`,
      [stake,payout,p.user_id]
    );
  }
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
    if(x.status!=='running'){skipped++;continue}
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
      WHERE matches.status NOT IN ('settled','canceled')
        AND matches.predictions_voided_at IS NULL
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

    if(!r.rows.length)skipped++;
    else if(r.rows[0].inserted)inserted++;
    else updated++;
  }

  return {
    fetched:items.length,
    inserted,
    updated,
    skipped
  };
}
// Missing/null/blank scores must never become zero through Number() coercion.
function validResultScores(x,teams){
  const results=Array.isArray(x.results)?x.results:[];
  const read=id=>{
    const entries=results.filter(r=>String(r.team_id)===String(id));
    if(entries.length!==1)return null;
    const value=entries[0].score;
    if(typeof value!=='number' && !(typeof value==='string' && /^[0-9]+$/.test(value)))return null;
    const score=Number(value);
    return Number.isSafeInteger(score) && score>=0 && score<=2147483647 ? score : null;
  };
  const a=read(teams.a.id),b=read(teams.b.id);
  if(a===null || b===null || a===b)return null;
  const scoreWinner=a>b?teams.a.id:teams.b.id;
  if(String(scoreWinner)!==String(x.winner_id))return null;
  return [a,b];
}

async function pastMatchesByIds(ids){
  const matches=new Map();
  const unique=[...new Set(ids.map(String))].filter(id=>/^[1-9][0-9]*$/.test(id));
  for(let offset=0;offset<unique.length;offset+=100){
    const batch=unique.slice(offset,offset+100);
    const wanted=new Set(batch);
    const items=await panda('/csgo/matches/past?per_page=100&filter[id]='+batch.join(','));
    if(!Array.isArray(items))throw new Error('PandaScore 返回了无效的比赛列表');
    for(const x of items){
      if(!wanted.has(String(x.id)))throw new Error('PandaScore 未正确应用比赛 ID 过滤条件');
      matches.set(String(x.id),x);
    }
  }
  return [...matches.values()];
}

async function syncResults(){
  const recent=await panda('/csgo/matches/past?per_page=100&sort=-end_at');
  if(!Array.isArray(recent))throw new Error('PandaScore 返回了无效的比赛列表');
  const items=new Map(recent.map(x=>[String(x.id),x]));
  // Include previously mis-canceled rows and settled rows awaiting real scores.
  const local=(await pool.query(`
    SELECT id,external_id,status,score_a,score_b
    FROM matches
    WHERE source='pandascore' AND external_id IS NOT NULL
      AND predictions_voided_at IS NULL
      AND (status<>'settled' OR score_a IS NULL OR score_b IS NULL
           OR (score_a=0 AND score_b=0)
           OR (actual_map_count IS NULL AND EXISTS (SELECT 1 FROM map_predictions mp WHERE mp.match_id=matches.id AND mp.result IS NULL)))
  `)).rows;
  const missing=local.filter(m=>!items.has(String(m.external_id))).map(m=>m.external_id);
  const recovered=await pastMatchesByIds(missing);
  for(const x of recovered)items.set(String(x.id),x);
  // The past list can omit canceled/postponed fixtures. Check unresolved IDs in the all-status list.
  const unresolved=local.filter(m=>!items.has(String(m.external_id))&&m.status!=='settled');
  for(let offset=0;offset<unresolved.length;offset+=100){
    const ids=unresolved.slice(offset,offset+100).map(m=>String(m.external_id)).filter(id=>/^[1-9][0-9]*$/.test(id));
    if(!ids.length)continue;
    const updates=await panda('/matches?per_page=100&filter[id]='+ids.join(','));
    if(!Array.isArray(updates)||updates.some(x=>!ids.includes(String(x.id))))throw new Error('PandaScore 未正确返回指定比赛的状态');
    for(const x of updates)items.set(String(x.id),x);
  }

  let checked=0,settled=0,skipped=0;
  const warnings=[];
  for(const x of items.values()){
    let m=(await pool.query(
      "SELECT id,status FROM matches WHERE source='pandascore' AND external_id=$1",
      [String(x.id)]
    )).rows[0];
    if(m)checked++;
    if(m&&(x.status==='postponed'||x.status==='not_started')){
      try{
        if(x.status==='postponed')await matchLifecycle.postpone(pool,m.id,x);
        else await matchLifecycle.resumeFromSource(pool,m.id,x);
      }catch(e){if(e.code!=='LIFECYCLE_CONFLICT')throw e;warnings.push(`比赛 ${m.id} 状态处理: ${e.message}`)}
      skipped++;continue;
    }
    if(x.status==='canceled'){
      if(m){
        // Never erase an existing settlement because a later feed changes status.
        try{await matchLifecycle.refund(pool,m.id,'canceled',x)}
        catch(e){if(e.code!=='LIFECYCLE_CONFLICT')throw e;warnings.push(`比赛 ${m.id} 退分: ${e.message}`)}
      }
      skipped++;
      continue;
    }
    const teams=normalizedOpponents(x);
    const winnerTeam=teams && [teams.a,teams.b].find(t=>String(t.id)===String(x.winner_id));
    if(x.status!=='finished' || !x.winner_id || !winnerTeam){
      skipped++;
      continue;
    }
    if(!m){
      if(!x.begin_at){skipped++;continue}
      // Insert as locked, then use the same transactional settlement path.
      // A concurrent importer may already have inserted this external ID.
      await pool.query(`
        INSERT INTO matches(
          event_name,team_a,team_b,starts_at,status,source,external_id,
          team_a_logo,team_b_logo,source_status,match_type,number_of_games,stage_name,synced_at
        ) VALUES($1,$2,$3,$4,'running','pandascore',$5,$6,$7,'finished',$8,$9,$10,NOW())
        ON CONFLICT(source,external_id) WHERE external_id IS NOT NULL DO NOTHING
      `,[
        leagueLabel(x),teams.a.name,teams.b.name,x.begin_at,String(x.id),
        teams.a.image_url||null,teams.b.image_url||null,x.match_type||null,
        x.number_of_games||null,x.tournament?.name||null
      ]);
      m=(await pool.query(
        "SELECT id,status FROM matches WHERE source='pandascore' AND external_id=$1",
        [String(x.id)]
      )).rows[0];
    }
    try{
      const result=await settleMatch(m.id,winnerTeam.name,x);
      if(!result.alreadySettled)settled++;
      const actualMaps=mapMarket.verifiedMapCount(x);
      if(actualMaps!==null){
        try{await mapMarket.settle(pool,m.id,actualMaps,x)}
        catch(e){if(e.status!==409)throw e;warnings.push(`比赛 ${m.id} 地图数: ${e.message}`)}
      }
    }catch(e){
      // Only known identity/result conflicts are isolated; DB/payout failures remain fatal.
      if(e.code!=='SYNC_RESULT_CONFLICT')throw e;
      skipped++;
      warnings.push(`比赛 ${m.id} / PandaScore ${x.id}: ${e.message}`);
    }
  }
  // Absence from an API page is not evidence of cancellation.
  return {fetched:items.size,checked,settled,skipped,conflicts:warnings.length,warnings};
}
async function saveSyncStatus({
  status,
  triggerSource,
  upcoming=null,
  results=null,
  errorMessage=null
}){
  // Keep conflict details visible in existing sync status/history without blocking other matches.
  if(!errorMessage && results?.warnings?.length){
    errorMessage=`${results.warnings.length} 场结果冲突，已保留原结算，其他比赛正常同步。`+
      results.warnings.slice(0,20).join('；');
  }
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
    const r=await pool.query(
  'INSERT INTO users(username,password_hash,points) VALUES($1,$2,0) RETURNING id,username,role,points',
  [username,hash]
);
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
  const r=await pool.query(`SELECT u.id,u.username,u.role,u.points,u.locked_points,
    COALESCE(ROUND(100.0*COUNT(p.id) FILTER(WHERE p.result='win')/NULLIF(COUNT(p.id) FILTER(WHERE p.result IN ('win','loss')),0),1),0) AS win_rate
    FROM users u LEFT JOIN (SELECT id,user_id,result FROM predictions UNION ALL SELECT id,user_id,result FROM map_predictions) p ON p.user_id=u.id WHERE u.id=$1 GROUP BY u.id`,[req.user.id]);
  if(!r.rowCount)return res.status(404).json({message:'用户不存在'});
  res.json({user:r.rows[0]});
});

app.get('/api/matches',async(req,res)=>{
  let userId=null;
  const h=req.headers.authorization||'';
  if(h.startsWith('Bearer ')){try{userId=jwt.verify(h.slice(7),JWT_SECRET).id}catch{}}
  const r=await pool.query(`SELECT m.*,
    (SELECT p.predicted_team FROM predictions p WHERE p.match_id=m.id AND p.user_id=$1) AS user_prediction,
    (SELECT p.result FROM predictions p WHERE p.match_id=m.id AND p.user_id=$1) AS user_result,
    (SELECT p.points_delta FROM predictions p WHERE p.match_id=m.id AND p.user_id=$1) AS user_points_delta
    FROM matches m
WHERE m.predictions_voided_at IS NULL AND m.winner IS NULL
  AND ((m.status='open' AND m.starts_at>NOW()) OR m.status IN ('running','postponed'))
ORDER BY CASE WHEN m.status='running' THEN 0 WHEN m.status='open' THEN 1 ELSE 2 END,m.starts_at
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
        number_of_games,
        actual_map_count,
        status
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
    COALESCE(ROUND(100.0*COUNT(p.id) FILTER(WHERE p.result='win')/NULLIF(COUNT(p.id) FILTER(WHERE p.result IN ('win','loss')),0),1),0) AS win_rate
    FROM users u LEFT JOIN (SELECT id,user_id,result FROM predictions UNION ALL SELECT id,user_id,result FROM map_predictions) p ON p.user_id=u.id
    GROUP BY u.id ORDER BY u.points DESC,u.created_at ASC LIMIT 100`);
  res.json({users:r.rows});
});
app.post('/api/predictions',auth,async(req,res)=>{
  const {matchId,team,stakePoints}=req.body||{};
  const stake=Number(stakePoints);
  const client=await pool.connect();

  try{
    await client.query('BEGIN');

    const m=(await client.query(
      "SELECT * FROM matches WHERE id=$1 AND status='open' AND winner IS NULL AND predictions_voided_at IS NULL AND starts_at>NOW()+INTERVAL '10 minutes' FOR UPDATE",
      [matchId]
    )).rows[0];

    if(!m){
      throw Object.assign(
        new Error('竞猜已锁定：比赛开始前10分钟停止预测'),
        {status:400}
      );
    }

    if(team!==m.team_a && team!==m.team_b){
      throw Object.assign(
        new Error('无效的预测队伍'),
        {status:400}
      );
    }

    if(!Number.isInteger(stake) || stake<=0){
      throw Object.assign(
        new Error('下注积分必须是大于0的整数'),
        {status:400}
      );
    }

    const currentOdds=
      team===m.team_a
        ? Number(m.odds_a)
        : Number(m.odds_b);

    if(!Number.isFinite(currentOdds) || currentOdds<=0){
      throw Object.assign(
        new Error('当前赔率无效，暂时无法下注'),
        {status:400}
      );
    }

    const user=(await client.query(
      'SELECT id,username,role,points,locked_points FROM users WHERE id=$1 FOR UPDATE',
      [req.user.id]
    )).rows[0];

    if(!user){
      throw Object.assign(
        new Error('用户不存在'),
        {status:404}
      );
    }

    const existing=(await client.query(
      `SELECT id,predicted_team,result,stake_points,odds_at_prediction
       FROM predictions
       WHERE user_id=$1 AND match_id=$2
       FOR UPDATE`,
      [req.user.id,matchId]
    )).rows[0];

    if(existing?.result){
      throw Object.assign(
        new Error('该预测已经结算，不能修改'),
        {status:409}
      );
    }

    const oldStake=Number(existing?.stake_points||0);
    const stakeDiff=stake-oldStake;

    if(stakeDiff>0 && Number(user.points)<stakeDiff){
      throw Object.assign(
        new Error(`积分不足，当前可用积分：${user.points}`),
        {status:400}
      );
    }

    if(stakeDiff!==0){
      await client.query(
        `UPDATE users
         SET
           points=points-$1,
           locked_points=locked_points+$1
         WHERE id=$2`,
        [stakeDiff,req.user.id]
      );
    }

    let responseStatus=201;
    let responseMessage='';

    if(existing){
      await client.query(
        `UPDATE predictions
         SET predicted_team=$1,
             stake_points=$2,
             odds_at_prediction=$3
         WHERE id=$4`,
        [team,stake,currentOdds,existing.id]
      );

      responseStatus=200;
      responseMessage=`预测已修改：${team}，下注 ${stake} 积分，锁定赔率 ${currentOdds}`;
    }else{
      await client.query(
        `INSERT INTO predictions(
           user_id,
           match_id,
           predicted_team,
           stake_points,
           odds_at_prediction
         )
         VALUES($1,$2,$3,$4,$5)`,
        [req.user.id,matchId,team,stake,currentOdds]
      );

      responseMessage=`预测成功：${team}，下注 ${stake} 积分，锁定赔率 ${currentOdds}`;
    }

    const updatedUser=(await client.query(
      `SELECT id,username,role,points,locked_points
       FROM users
       WHERE id=$1`,
      [req.user.id]
    )).rows[0];

    await client.query('COMMIT');

    res.status(responseStatus).json({
      ok:true,
      user:updatedUser,
      predicted_team:team,
      stake_points:stake,
      odds_at_prediction:currentOdds,
      message:responseMessage
    });

  }catch(e){
    await client.query('ROLLBACK');

    res.status(e.status||500).json({
      message:e.status ? e.message : '预测失败'
    });
  }finally{
    client.release();
  }
});
app.post('/api/map-predictions',auth,async(req,res)=>{
  try{res.json(await mapMarket.place(pool,req.user.id,req.body||{}))}
  catch(e){res.status(e.status||500).json({message:e.status?e.message:'地图数预测失败'})}
});
app.get('/api/predictions/me',auth,async(req,res)=>{
  const r=await pool.query(`SELECT p.id,p.match_id,p.predicted_team,p.result,p.points_delta,p.stake_points,p.refund_points,p.refunded_at,
p.odds_at_prediction,p.created_at,
    m.event_name,m.team_a,m.team_b,m.starts_at,m.winner,m.status,m.void_reason
    FROM predictions p JOIN matches m ON m.id=p.match_id WHERE p.user_id=$1 ORDER BY p.created_at DESC`,[req.user.id]);
  res.json({predictions:r.rows});
});
app.get('/api/map-predictions/me',auth,async(req,res)=>{
  try{
    const r=await pool.query(`
      SELECT
        mp.id,
        mp.match_id,
        mp.predicted_map_count,
        mp.result,
        mp.points_delta,
        mp.stake_points,
        mp.odds_at_prediction,
        mp.payout_points,
        mp.refund_points,
        mp.refunded_at,
        m.status,
        m.void_reason,
        m.actual_map_count,
        mp.created_at,
        m.event_name,
        m.team_a,
        m.team_b,
        m.starts_at,
        m.number_of_games,
        m.score_a,
        m.score_b,
        m.winner
      FROM map_predictions mp
      JOIN matches m ON m.id=mp.match_id
      WHERE mp.user_id=$1
      ORDER BY mp.created_at DESC
    `,[req.user.id]);

    res.json({mapPredictions:r.rows});
  }catch(e){
    console.error(e);
    res.status(500).json({message:'获取地图数预测失败'});
  }
});
/* ---------- Admin ---------- */
app.get('/api/admin/stats',auth,admin,async(req,res)=>{
  const r=await pool.query(`SELECT
    (SELECT COUNT(*)::int FROM users) users,
    (SELECT COUNT(*)::int FROM matches) matches,
    (SELECT COUNT(*)::int FROM matches WHERE status='open') open_matches,
    ((SELECT COUNT(*) FROM predictions)+(SELECT COUNT(*) FROM map_predictions))::int predictions,
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

const items=await pastMatchesByIds([local.external_id]);

const match=items.find(
  x=>String(x.id)===String(local.external_id)
);

if(!match){
  return res.status(404).json({
    message:'PandaScore 暂未返回这场比赛的历史数据'
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
  const r=await pool.query(`SELECT u.id,u.username,u.role,u.points,u.locked_points,u.created_at,COUNT(p.id)::int predictions
    FROM users u LEFT JOIN (SELECT id,user_id FROM predictions UNION ALL SELECT id,user_id FROM map_predictions) p ON p.user_id=u.id GROUP BY u.id ORDER BY u.created_at DESC LIMIT 500`);
  res.json({users:r.rows});
});
app.post('/api/admin/users/:id/points',auth,admin,async(req,res)=>{
  const userId=Number(req.params.id);
  const amount=Number(req.body?.amount);

  if(!Number.isInteger(userId) || userId<=0){
    return res.status(400).json({message:'无效用户'});
  }

  if(!Number.isInteger(amount) || amount<=0){
    return res.status(400).json({message:'发放积分必须是大于0的整数'});
  }

  const client=await auditedPool(pool,req.user.id,'grant-points','user',userId).connect();
  try{
  await client.query('BEGIN');
  const r=await client.query(
    `UPDATE users
     SET points=points+$1
     WHERE id=$2
     RETURNING id,username,points,locked_points`,
    [amount,userId]
  );

  if(!r.rows[0]){
    await client.query('ROLLBACK');
    return res.status(404).json({message:'用户不存在'});
  }
  await client.query('COMMIT');
  res.json({
    ok:true,
    user:r.rows[0],
    message:`已发放 ${amount} 积分`
  });
  }catch(e){await client.query('ROLLBACK');res.status(500).json({message:'发放积分失败，未作更改'})}
  finally{client.release()}
});
app.get('/api/admin/matches',auth,admin,async(req,res)=>{
  const before=req.query.before==null?null:Number(req.query.before);
  if(before!==null&&(!Number.isSafeInteger(before)||before<=0))return res.status(400).json({message:'无效比赛分页位置'});
  const r=await pool.query(`SELECT m.*,pending.pending_map_users,pending.pending_map_points
    FROM (SELECT * FROM matches WHERE ($1::bigint IS NULL OR id<$1::bigint) ORDER BY id DESC LIMIT 501) m
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT user_id)::int AS pending_map_users,
        COALESCE(SUM(stake_points),0)::bigint AS pending_map_points
      FROM map_predictions WHERE match_id=m.id AND result IS NULL
    ) pending ON TRUE ORDER BY m.id DESC`,[before]);
  const matches=r.rows.slice(0,500);
  res.json({matches,nextCursor:r.rows.length>500?matches.at(-1).id:null});
});
app.get('/api/admin/audit-logs',auth,admin,async(req,res)=>{
  const before=req.query.before==null?null:Number(req.query.before);
  if(before!==null&&(!Number.isSafeInteger(before)||before<=0))return res.status(400).json({message:'无效日志分页位置'});
  const rows=(await pool.query('SELECT * FROM admin_audit_logs WHERE ($1::bigint IS NULL OR id<$1::bigint) ORDER BY id DESC LIMIT 51',[before])).rows;
  res.json({logs:rows.slice(0,50),nextCursor:rows.length>50?rows[49].id:null});
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
for(const [action,handler] of Object.entries({
  'cancel':(req,p)=>matchLifecycle.refund(p,req.params.id,'canceled'),
  'postpone':(req,p)=>matchLifecycle.postpone(p,req.params.id),
  'refund-postponed':(req,p)=>matchLifecycle.refund(p,req.params.id,'postponed'),
  'resume':(req,p)=>matchLifecycle.resume(p,req.params.id,req.body?.startsAt),
  'map-odds':(req,p)=>mapMarket.setOdds(p,req.params.id,req.body?.odds),
  'map-result':(req,p)=>mapMarket.settle(p,req.params.id,req.body?.mapCount),
  'map-unsettle':(req,p)=>mapMarket.undo(p,req.params.id)
})){
  app.post('/api/admin/matches/:id/'+action,auth,admin,async(req,res)=>{
    try{res.json(await handler(req,auditedPool(pool,req.user.id,action,'match',req.params.id)))}
    catch(e){res.status(e.status||500).json({message:e.status?e.message:'比赛操作失败'})}
  });
}
app.post('/api/admin/matches/:id/result',auth,admin,async(req,res)=>{
  try{const r=await settleMatch(req.params.id,(req.body||{}).winner,null,auditedPool(pool,req.user.id,'result','match',req.params.id));res.json({message:'比赛已结算',...r})}
  catch(e){
  console.error('Manual settlement failed:',e);
  res.status(e.status||500).json({
    message:e.message||'结算失败'
  });
}
});
app.get('/api/admin/matches/:id/prediction-audit',auth,admin,async(req,res)=>{
  try{
    const r=await pool.query(`
      SELECT 'winner' AS market,p.id,p.user_id,u.username,p.predicted_team AS selection,
        p.result,p.stake_points,p.points_delta,u.points,u.locked_points
      FROM predictions p JOIN users u ON u.id=p.user_id WHERE p.match_id=$1
      UNION ALL
      SELECT 'maps' AS market,p.id,p.user_id,u.username,p.predicted_map_count::text AS selection,
        p.result,p.stake_points,p.points_delta,u.points,u.locked_points
      FROM map_predictions p JOIN users u ON u.id=p.user_id WHERE p.match_id=$1
      ORDER BY user_id,market,id`,[req.params.id]);
    res.json({predictions:r.rows});
  }catch(e){res.status(500).json({message:'读取比赛预测核对记录失败'})}
});
app.post('/api/admin/matches/:id/unsettle',auth,admin,async(req,res)=>{
  const client=await auditedPool(pool,req.user.id,'unsettle','match',req.params.id).connect();

  try{
    await client.query('BEGIN');

    const m=(await client.query(
      `SELECT * FROM matches
       WHERE id=$1
       FOR UPDATE`,
      [req.params.id]
    )).rows[0];

    if(!m){
      throw Object.assign(
        new Error('比赛不存在'),
        {status:404}
      );
    }

    if(m.status!=='settled' && !m.winner){
      throw Object.assign(
        new Error('该比赛尚未结算'),
        {status:409}
      );
    }

    const preds=(await client.query(
      `SELECT *
       FROM predictions
       WHERE match_id=$1
         AND result IN ('win','loss')
       FOR UPDATE`,
      [m.id]
    )).rows;

    for(const p of preds){
      const stake=Number(p.stake_points||0);
      const odds=Number(p.odds_at_prediction||0);

      const payout=
        p.result==='win' &&
        stake>0 &&
        Number.isFinite(odds) &&
        odds>0
          ? Math.floor(stake*odds)
          : 0;

      if(stake>0){
        const user=(await client.query(
          `SELECT id,points,locked_points
           FROM users
           WHERE id=$1
           FOR UPDATE`,
          [p.user_id]
        )).rows[0];

        if(!user){
          throw Object.assign(
            new Error('预测用户不存在'),
            {status:404}
          );
        }

        if(Number(user.points)<payout){
          throw Object.assign(
            new Error(`无法撤销：用户 ${p.user_id} 的可用积分不足以收回已返还积分`),
            {status:409}
          );
        }

        await client.query(
          `UPDATE users
           SET
             points=points-$1,
             locked_points=locked_points+$2
           WHERE id=$3`,
          [payout,stake,p.user_id]
        );
      }else{
        // Legacy predictions had no stake: reverse the recorded signed reward,
        // not a newly invented stake/odds payout. The match lock prevents retries.
        const delta=Number(p.points_delta??0);
        if(stake!==0||!Number.isSafeInteger(delta)||Math.abs(delta)>2147483647){
          throw Object.assign(new Error('旧版积分记录异常，未撤销结算'),{status:409});
        }
        if(delta!==0){
          const reversed=await client.query(
            `UPDATE users SET points=(points::bigint-$1::bigint)::integer WHERE id=$2
             AND points::bigint-$1::bigint BETWEEN 0 AND 2147483647 RETURNING id`,
            [delta,p.user_id]
          );
          if(!reversed.rowCount)throw Object.assign(new Error(`无法撤销：用户 ${p.user_id} 的余额不足、超限或不存在`),{status:409});
        }
      }

      await client.query(
        `UPDATE predictions
         SET
           result=NULL,
           points_delta=0
         WHERE id=$1`,
        [p.id]
      );
    }

    await mapMarket.undoLocked(client,m.id);

    await client.query(
      `UPDATE matches
       SET
         winner=NULL,
         status=CASE
           WHEN starts_at>NOW() THEN 'open'
           ELSE 'running'
         END,
         source_status=CASE
           WHEN starts_at>NOW() THEN 'not_started'
           ELSE 'running'
         END,
         synced_at=NOW()
       WHERE id=$1`,
      [m.id]
    );

    await client.query('COMMIT');

    res.json({
      ok:true,
      restoredPredictions:preds.length,
      message:'比赛结算已撤销，预测已恢复为待结算'
    });

  }catch(e){
    await client.query('ROLLBACK');
    console.error('Undo settlement failed:',e);

    res.status(e.status||500).json({
      message:e.message||'撤销结算失败'
    });
  }finally{
    client.release();
  }
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
        'SELECT ((SELECT COUNT(*) FROM predictions WHERE match_id=$1)+(SELECT COUNT(*) FROM map_predictions WHERE match_id=$1)) AS count',
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
const news=createNewsService(pool);
const refreshNews=()=>news.sync().catch(e=>console.error('[News sync]',e.message));
setTimeout(refreshNews,1000);
setInterval(refreshNews,60*1000).unref();
app.get('/api/news',async(req,res)=>{
  try{void refreshNews();res.json(await news.read())}
  catch{res.status(503).json({message:'新闻暂时无法加载，请稍后重试'})}
});
app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));
app.use((req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT,()=>console.log(`CS2 Prediction Center V3 running on http://localhost:${PORT}`));
