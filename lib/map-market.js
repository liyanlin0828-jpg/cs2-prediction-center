'use strict';
const MAX_POINTS=2147483647;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
function mapOptions(bestOf){return Number(bestOf)===3?[2,3]:Number(bestOf)===5?[3,4,5]:[]}
function integer(value){return typeof value==='number' && Number.isSafeInteger(value)}
function oddsValue(value){
  if(typeof value!=='number' && !(typeof value==='string' && /^\d+(\.\d{1,4})?$/.test(value)))return null;
  const n=Number(value);
  return Number.isFinite(n)&&n>=1&&n<=100&&Math.abs(n*10000-Math.round(n*10000))<0.000001?n:null;
}
function payout(stake,odds){
  const n=oddsValue(odds);
  if(!integer(stake)||stake<0||stake>1000000||n===null)fail('下注或锁定赔率异常，请核查',409);
  return Math.floor(stake*Math.round(n*10000)/10000);
}
// Require evidence of each played map. A series score or best-of alone is insufficient.
function verifiedMapCount(x){
  const bestOf=Number(x.number_of_games), needed=Math.floor(bestOf/2)+1;
  if(x.status!=='finished'||!mapOptions(bestOf).length||x.forfeit!==false||!Array.isArray(x.games))return null;
  const ids=(x.opponents||[]).map(o=>String(o.opponent?.id));
  if(ids.length!==2||ids[0]===ids[1]||!ids.includes(String(x.winner_id)))return null;
  const games=x.games.filter(g=>g.status==='finished');
  if(!mapOptions(bestOf).includes(games.length))return null;
  if(x.games.some(g=>g.status!=='finished'&&g.status!=='not_played'))return null;
  const seen=new Set(),wins=new Map(ids.map(id=>[id,0]));
  for(const [i,g] of [...games].sort((a,b)=>a.position-b.position).entries()){
    const winner=String(g.winner?.id);
    if(!g.id||seen.has(String(g.id))||Number(g.position)!==i+1||g.forfeit!==false||
       !g.begin_at||!g.end_at||!Number.isFinite(Date.parse(g.begin_at))||!Number.isFinite(Date.parse(g.end_at))||
       Date.parse(g.end_at)<=Date.parse(g.begin_at)||(g.detailed_stats===true&&g.complete!==true)||
       !ids.includes(winner)||g.winner?.type!=='Team')return null;
    if([...wins.values()].some(n=>n>=needed))return null;
    seen.add(String(g.id));wins.set(winner,wins.get(winner)+1);
  }
  return wins.get(String(x.winner_id))===needed?games.length:null;
}
async function transaction(pool,work){
  const client=await pool.connect();
  try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result}
  catch(e){await client.query('ROLLBACK');throw e}
  finally{client.release()}
}
async function lockMatch(client,id){
  const m=(await client.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!m)fail('比赛不存在',404);
  return m;
}
async function place(pool,userId,{matchId,mapCount,stakePoints,expectedOdds}={}){
  if(!integer(mapCount)||!integer(stakePoints)||stakePoints<1||stakePoints>1000000)fail('地图数及下注积分必须为整数，单笔积分为 1–1000000');
  return transaction(pool,async client=>{
    const m=(await client.query("SELECT * FROM matches WHERE id=$1 AND status='open' AND winner IS NULL AND predictions_voided_at IS NULL AND starts_at>NOW()+INTERVAL '10 minutes' FOR UPDATE",[matchId])).rows[0];
    if(!m)fail('竞猜已锁定：比赛开始前10分钟停止预测');
    if(!mapOptions(m.number_of_games).includes(mapCount))fail('无效的总地图数预测');
    const odds=oddsValue(m['map_odds_'+mapCount]);
    if(odds===null)fail('管理员尚未设置该地图数赔率');
    const user=(await client.query('SELECT id,username,role,points,locked_points FROM users WHERE id=$1 FOR UPDATE',[userId])).rows[0];
    if(!user)fail('用户不存在',404);
    const p=(await client.query('SELECT * FROM map_predictions WHERE user_id=$1 AND match_id=$2 FOR UPDATE',[userId,matchId])).rows[0];
    if(p?.result)fail('该地图数预测已结算，不能修改',409);
    const oldStake=Number(p?.stake_points||0),diff=stakePoints-oldStake;
    if(Number(user.points)<diff)fail('可用积分不足');
    if(Number(user.locked_points)<oldStake||Number(user.points)-diff>MAX_POINTS||Number(user.locked_points)+diff>MAX_POINTS)fail('积分账目异常，请管理员核查',409);
    // Exact retries retain the original locked odds, even if the admin has changed the market.
    const lockedOdds=p&&Number(p.predicted_map_count)===mapCount&&oldStake===stakePoints?p.odds_at_prediction:odds;
    if(expectedOdds!==undefined&&oddsValue(expectedOdds)!==Number(lockedOdds))fail('赔率已变化，请刷新后重新确认',409);
    payout(stakePoints,lockedOdds);
    if(diff)await client.query('UPDATE users SET points=points-$1,locked_points=locked_points+$1 WHERE id=$2',[diff,userId]);
    if(p)await client.query('UPDATE map_predictions SET predicted_map_count=$1,stake_points=$2,odds_at_prediction=$3 WHERE id=$4',[mapCount,stakePoints,lockedOdds,p.id]);
    else await client.query('INSERT INTO map_predictions(user_id,match_id,predicted_map_count,stake_points,odds_at_prediction) VALUES($1,$2,$3,$4,$5)',[userId,matchId,mapCount,stakePoints,lockedOdds]);
    const updated=(await client.query('SELECT id,username,role,points,locked_points FROM users WHERE id=$1',[userId])).rows[0];
    return {ok:true,user:updated,predicted_map_count:mapCount,stake_points:stakePoints,odds_at_prediction:lockedOdds,message:`已预测 ${mapCount} 张，下注 ${stakePoints} 积分，锁定赔率 ${lockedOdds}`};
  });
}
async function setOdds(pool,id,values){
  return transaction(pool,async client=>{
    const m=await lockMatch(client,id);
    const open=(await client.query("SELECT id FROM matches WHERE id=$1 AND status='open' AND winner IS NULL AND predictions_voided_at IS NULL AND starts_at>NOW()+INTERVAL '10 minutes'",[id])).rows.length;
    if(!open)fail('比赛已锁盘，不能修改地图数赔率',409);
    const options=mapOptions(m.number_of_games);
    if(!options.length)fail('仅支持 BO3 和 BO5');
    const odds=[2,3,4,5].map(n=>{
      if(!options.includes(n))return null;
      const v=values?.[n];
      if(v===null||v==='')return null;
      const result=oddsValue(v);
      if(result===null)fail('赔率应为 1–100，最多四位小数；留空表示关闭该选项');
      return result;
    });
    await client.query('UPDATE matches SET map_odds_2=$1,map_odds_3=$2,map_odds_4=$3,map_odds_5=$4 WHERE id=$5',[...odds,id]);
    return {ok:true,message:'地图数赔率已保存，已有下注保持原锁定赔率'};
  });
}
async function settle(pool,id,count,sourceMatch=null){
  return transaction(pool,async client=>{
    const m=await lockMatch(client,id);
    if(m.predictions_voided_at)fail('本场预测已退分，不能再次结算',409);
    if(m.status!=='settled'||!m.winner)fail('请先确认比赛结束并结算胜负',409);
    if(!integer(count)||!mapOptions(m.number_of_games).includes(count))fail('实际地图数与赛制不符');
    if(sourceMatch){
      const names=(sourceMatch.opponents||[]).map(o=>o.opponent?.name);
      const winner=(sourceMatch.opponents||[]).find(o=>String(o.opponent?.id)===String(sourceMatch.winner_id))?.opponent?.name;
      if(m.maps_manual_review)return {skipped:true};
      if(m.source!=='pandascore'||String(m.external_id)!==String(sourceMatch.id)||verifiedMapCount(sourceMatch)!==count||winner!==m.winner||!names.includes(m.team_a)||!names.includes(m.team_b))fail('地图结果与本地比赛不一致',409);
    }
    if(m.actual_map_count!=null){
      if(Number(m.actual_map_count)!==count)fail('地图数已结算且结果不同，请先撤销地图数结算',409);
      return {alreadySettled:true,settledPredictions:0};
    }
    const preds=(await client.query('SELECT * FROM map_predictions WHERE match_id=$1 AND result IS NULL ORDER BY user_id,id FOR UPDATE',[id])).rows;
    for(const p of preds){
      const stake=Number(p.stake_points||0),win=Number(p.predicted_map_count)===count;
      // Legacy picks carried no stake and must never receive invented payouts.
      const winPayout=stake>0?payout(stake,p.odds_at_prediction):0;
      const returned=win?winPayout:0;
      if(stake>0){
        const r=await client.query('UPDATE users SET locked_points=locked_points-$1,points=points+$2 WHERE id=$3 AND locked_points>=$1 AND points<=$4 RETURNING id',[stake,returned,p.user_id,MAX_POINTS-returned]);
        if(!r.rowCount)fail('冻结积分不足或余额超限，整笔结算已取消',409);
      }
      await client.query('UPDATE map_predictions SET result=$1,points_delta=$2,payout_points=$3 WHERE id=$4',[win?'win':'loss',returned-stake,returned,p.id]);
    }
    await client.query('UPDATE matches SET actual_map_count=$1,map_result_source=$2,maps_manual_review=FALSE WHERE id=$3',[count,sourceMatch?'pandascore_games':'admin',id]);
    return {ok:true,settledPredictions:preds.length,message:`已按实际 ${count} 张地图结算`};
  });
}
// Caller must hold the match row lock; used by both map-only and whole-match undo.
async function undoLocked(client,id){
  const preds=(await client.query("SELECT * FROM map_predictions WHERE match_id=$1 AND result IN ('win','loss') ORDER BY user_id,id FOR UPDATE",[id])).rows;
  for(const p of preds){
    const stake=Number(p.stake_points||0),returned=Number(p.payout_points||0);
    if(stake>0){
      const r=await client.query('UPDATE users SET points=points-$1,locked_points=locked_points+$2 WHERE id=$3 AND points>=$1 AND locked_points<=$4 RETURNING id',[returned,stake,p.user_id,MAX_POINTS-stake]);
      if(!r.rowCount)fail('用户可用积分不足以撤销地图数结算，未作更改',409);
    }
    await client.query('UPDATE map_predictions SET result=NULL,points_delta=0,payout_points=0 WHERE id=$1',[p.id]);
  }
  await client.query('UPDATE matches SET actual_map_count=NULL,map_result_source=NULL,maps_manual_review=TRUE WHERE id=$1',[id]);
  return {ok:true,restoredPredictions:preds.length,message:'地图数结算已撤销，待管理员重新确认实际地图数'};
}
async function undo(pool,id){return transaction(pool,async client=>{const m=await lockMatch(client,id);if(m.predictions_voided_at)fail('已退分记录不能撤销为待结算');return undoLocked(client,id)})}
module.exports={mapOptions,oddsValue,payout,verifiedMapCount,place,setOdds,settle,undo,undoLocked};
