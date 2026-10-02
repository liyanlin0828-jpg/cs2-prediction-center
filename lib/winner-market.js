'use strict';
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status})};
function quote(m,liveEnabled=false,now=Date.now()){
  if(!m||m.winner||m.predictions_voided_at)return null;
  if(m.status==='open'&&Date.parse(m.starts_at)>now+600000)
    return {a:Number(m.odds_a),b:Number(m.odds_b),phase:'prematch',version:'prematch'};
  const q=m.live_market;
  // This gate stays off until a provider adapter has been verified and enabled.
  // A heartbeat alone is not evidence that an unchanged quote is still tradable.
  if(!liveEnabled||m.status!=='running'||!q||q.status!=='open'||q.connected!==true||
    !q.version||!q.provider||q.matchId!==m.id||q.teamA!==m.team_a||q.teamB!==m.team_b||
    !Number.isFinite(Date.parse(q.observedAt))||!Number.isFinite(Date.parse(q.expiresAt))||
    Date.parse(q.observedAt)>now||now-Date.parse(q.observedAt)>10000||
    Date.parse(q.expiresAt)<=now||Date.parse(q.expiresAt)-Date.parse(q.observedAt)>10000)return null;
  return {a:Number(q.a),b:Number(q.b),phase:'live',version:q.version};
}
async function place(pool,userId,input,liveEnabled=false){
  const {matchId,team,stakePoints,expectedOdds,requestId,quoteVersion}=input;
  if(!Number.isSafeInteger(matchId)||!Number.isSafeInteger(stakePoints)||stakePoints<1||stakePoints>1000000||
    typeof expectedOdds!=='number'||!Number.isFinite(expectedOdds)||expectedOdds<1||expectedOdds>100||
    typeof requestId!=='string'||! /^[a-zA-Z0-9_-]{16,100}$/.test(requestId))fail('下注参数无效，请刷新后重试',400);
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const m=(await c.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE',[matchId])).rows[0];
    const u=(await c.query('SELECT id,username,role,points,locked_points FROM users WHERE id=$1 FOR UPDATE',[userId])).rows[0];
    if(!u)fail('用户不存在',404);
    const old=(await c.query('SELECT * FROM predictions WHERE user_id=$1 AND request_id=$2',[userId,requestId])).rows[0];
    if(old){
      if(old.match_id!==matchId||old.predicted_team!==team||Number(old.stake_points)!==stakePoints||Number(old.odds_at_prediction)!==expectedOdds)fail('重复请求内容不一致');
      await c.query('COMMIT');return {user:u,prediction:old,message:'该笔下注已处理，未重复扣分',duplicate:true};
    }
    // Read database time after obtaining the locks; a waiting request must not use an old timestamp.
    const now=(await c.query('SELECT clock_timestamp() AS now')).rows[0].now;
    const q=quote(m,liveEnabled,new Date(now).getTime());
    if(!q)fail('本场已封盘或实时数据不可用，暂时无法下注');
    if(team!==m.team_a&&team!==m.team_b)fail('无效的预测队伍',400);
    const odds=team===m.team_a?q.a:q.b;
    if(!Number.isFinite(odds)||odds<1||odds>100||Math.abs(Math.round(odds*100)-odds*100)>0.000001)fail('当前赔率无效');
    if(odds!==expectedOdds||(q.phase==='live'&&quoteVersion!==q.version))fail('赔率已变化，请刷新后重新确认');
    const updated=(await c.query('UPDATE users SET points=points-$1,locked_points=locked_points+$1 WHERE id=$2 AND points>=$1 AND locked_points<=2147483647-$1 RETURNING id,username,role,points,locked_points',[stakePoints,userId])).rows[0];
    if(!updated)fail('可用积分不足或冻结积分超限');
    const p=(await c.query('INSERT INTO predictions(user_id,match_id,predicted_team,stake_points,odds_at_prediction,request_id,entry_phase) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[userId,matchId,team,stakePoints,odds,requestId,q.phase])).rows[0];
    await c.query('COMMIT');return {user:updated,prediction:p,message:`下注成功：${team}，${stakePoints} 积分，锁定赔率 ${odds}；原有下注保持不变`};
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
module.exports={place,quote};
