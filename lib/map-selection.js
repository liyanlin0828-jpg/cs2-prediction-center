'use strict';
const {oddsValue,payout}=require('./map-market');
const MAX=2147483647;
// A name catalogue, NOT a claim about an event's active map pool.
// Administrators explicitly enable only the maps offered by that event.
const MAPS=['Ancient','Anubis','Cache','Cobblestone','Dust2','Inferno','Mirage','Nuke','Overpass','Train','Vertigo'];
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status})};
async function transaction(pool,id,work){
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const m=(await c.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!m)fail('比赛不存在',404);
    const result=await work(c,m);await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
async function requireOpen(c,m){
  const r=await c.query(`SELECT id FROM matches WHERE id=$1 AND status='open' AND winner IS NULL
    AND predictions_voided_at IS NULL AND selected_maps IS NULL AND map_selection_locked_at IS NULL
    AND starts_at>NOW()+INTERVAL '10 minutes'
    AND map_selection_closes_at>NOW()`,[m.id]);
  if(!r.rows.length)fail('地图选择预测未开放或已锁盘');
  if(![1,3,5].includes(Number(m.number_of_games)))fail('仅支持 BO1、BO3、BO5');
}
async function configure(pool,id,{odds,closesAt}={}){
  if(typeof closesAt!=='string'||!Number.isFinite(Date.parse(closesAt)))fail('请填写有效锁盘时间',400);
  return transaction(pool,id,async(c,m)=>{
    if(m.predictions_voided_at||m.winner||m.status!=='open'||m.selected_maps||m.map_selection_locked_at)fail('本场不能开放地图预测');
    if(![1,3,5].includes(Number(m.number_of_games)))fail('仅支持 BO1、BO3、BO5');
    // Once a cutoff passes it cannot be moved forward to reopen known information.
    const valid=(await c.query(`SELECT id FROM matches WHERE id=$1 AND starts_at>NOW()+INTERVAL '10 minutes'
      AND (map_selection_closes_at IS NULL OR map_selection_closes_at>NOW())
      AND $2::timestamptz>NOW() AND $2::timestamptz<=starts_at-INTERVAL '10 minutes'`,[id,closesAt||null])).rows.length;
    if(!valid)fail('锁盘时间须在现在之后、开赛至少十分钟前；已过期盘口不能重新开放');
    if(!odds||typeof odds!=='object'||Array.isArray(odds)||Object.keys(odds).some(k=>!MAPS.includes(k)))fail('无效地图配置',400);
    const values={};
    for(const name of MAPS){
      const v=odds[name];
      if(v==null||v==='')continue;
      const n=oddsValue(v);if(n===null)fail('赔率须为 1–100，最多四位小数',400);values[name]=n;
    }
    await c.query('UPDATE matches SET map_selection_odds=$1::jsonb,map_selection_closes_at=$2 WHERE id=$3',[JSON.stringify(values),closesAt,id]);
    return {ok:true,message:'地图选项与锁盘时间已保存，已有预测保留原赔率'};
  });
}
async function lock(pool,id){
  return transaction(pool,id,async(c,m)=>{
    if(m.predictions_voided_at)fail('本场已退本金');
    await c.query('UPDATE matches SET map_selection_locked_at=COALESCE(map_selection_locked_at,NOW()) WHERE id=$1',[id]);
    return {ok:true,message:'地图选择预测已锁盘，不可重新开放'};
  });
}
async function place(pool,userId,{matchId,map,stakePoints,expectedOdds}={}){
  if(!MAPS.includes(map)||!Number.isSafeInteger(stakePoints)||stakePoints<1||stakePoints>1000000)fail('请选择地图并输入 1–1000000 的整数积分',400);
  return transaction(pool,matchId,async(c,m)=>{
    await requireOpen(c,m);
    const odds=oddsValue(m.map_selection_odds?.[map]);if(odds===null)fail('该地图尚未开放');
    const u=(await c.query('SELECT id,username,role,points,locked_points FROM users WHERE id=$1 FOR UPDATE',[userId])).rows[0];
    if(!u)fail('用户不存在',404);
    const p=(await c.query('SELECT * FROM map_selection_predictions WHERE user_id=$1 AND match_id=$2 FOR UPDATE',[userId,matchId])).rows[0];
    if(p?.result)fail('该预测已结算');
    const old=Number(p?.stake_points||0),diff=stakePoints-old;
    if(Number(u.points)<diff)fail('可用积分不足',400);
    if(Number(u.locked_points)<old||Number(u.points)-diff>MAX||Number(u.locked_points)+diff>MAX)fail('积分账目异常');
    const locked=p&&p.predicted_map===map&&old===stakePoints?Number(p.odds_at_prediction):odds;
    if(oddsValue(expectedOdds)!==locked)fail('赔率已变化，请刷新后重新确认');
    payout(stakePoints,locked);
    if(diff)await c.query('UPDATE users SET points=points-$1,locked_points=locked_points+$1 WHERE id=$2',[diff,userId]);
    await c.query(`INSERT INTO map_selection_predictions(user_id,match_id,predicted_map,stake_points,odds_at_prediction)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,match_id) DO UPDATE SET
      predicted_map=EXCLUDED.predicted_map,stake_points=EXCLUDED.stake_points,odds_at_prediction=EXCLUDED.odds_at_prediction`,[userId,matchId,map,stakePoints,locked]);
    const user=(await c.query('SELECT id,username,role,points,locked_points FROM users WHERE id=$1',[userId])).rows[0];
    return {ok:true,user,message:`已预测 ${map} 入选，下注 ${stakePoints} 积分，锁定赔率 ${locked}`};
  });
}
function validateResult(m,maps,source){
  const bestOf=Number(m.number_of_games);
  if(![1,3,5].includes(bestOf)||!Array.isArray(maps)||maps.length!==bestOf||new Set(maps).size!==bestOf||maps.some(n=>!MAPS.includes(n)))fail(`必须核实完整的 ${bestOf} 张选图名单，包含未打的决胜图`,400);
  if(typeof source!=='string')fail('请填写可核查的选图来源网址',400);
  let url;try{url=new URL(source)}catch{fail('请填写可核查的选图来源网址',400)}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||source.length>2000)fail('无效来源网址',400);
  return [...maps].sort();
}
async function settle(pool,id,{maps,source}={}){
  return transaction(pool,id,async(c,m)=>{
    if(m.predictions_voided_at)fail('本场已退本金');
    if(m.status!=='settled'||!m.winner)fail('请在比赛结束并确认胜负后结算地图名单');
    const names=validateResult(m,maps,source);
    if(m.selected_maps){
      if(JSON.stringify([...m.selected_maps].sort())!==JSON.stringify(names))fail('名单已结算且不同，请先撤销地图选择结算');
      return {ok:true,alreadySettled:true,message:'该名单已结算，无需重复操作'};
    }
    const picks=(await c.query('SELECT * FROM map_selection_predictions WHERE match_id=$1 AND result IS NULL ORDER BY user_id,id FOR UPDATE',[id])).rows;
    for(const p of picks){
      const stake=Number(p.stake_points),win=names.includes(p.predicted_map),returned=win?payout(stake,p.odds_at_prediction):0;
      const r=await c.query('UPDATE users SET locked_points=locked_points-$1,points=points+$2 WHERE id=$3 AND locked_points>=$1 AND points<=$4 RETURNING id',[stake,returned,p.user_id,MAX-returned]);
      if(!r.rowCount)fail('冻结积分不足或余额超限，整笔结算已取消');
      await c.query('UPDATE map_selection_predictions SET result=$1,points_delta=$2,payout_points=$3 WHERE id=$4',[win?'win':'loss',returned-stake,returned,p.id]);
    }
    await c.query('UPDATE matches SET selected_maps=$1::jsonb,selected_maps_source=$2,map_selection_locked_at=COALESCE(map_selection_locked_at,NOW()) WHERE id=$3',[JSON.stringify(names),source,id]);
    return {ok:true,message:`已按完整名单结算 ${picks.length} 条地图预测（含未打的决胜图）`};
  });
}
// Caller owns the match lock; shared with whole-match undo.
async function undoLocked(c,id){
  const picks=(await c.query("SELECT * FROM map_selection_predictions WHERE match_id=$1 AND result IN ('win','loss') ORDER BY user_id,id FOR UPDATE",[id])).rows;
  for(const p of picks){
    const stake=Number(p.stake_points),returned=Number(p.payout_points);
    const r=await c.query('UPDATE users SET points=points-$1,locked_points=locked_points+$2 WHERE id=$3 AND points>=$1 AND locked_points<=$4 RETURNING id',[returned,stake,p.user_id,MAX-stake]);
    if(!r.rowCount)fail('用户可用积分不足以撤销地图选择结算，未作更改');
    await c.query('UPDATE map_selection_predictions SET result=NULL,points_delta=0,payout_points=0 WHERE id=$1',[p.id]);
  }
  // Never reopen a market whose final list was public.
  await c.query('UPDATE matches SET selected_maps=NULL,selected_maps_source=NULL,map_selection_locked_at=COALESCE(map_selection_locked_at,NOW()) WHERE id=$1',[id]);
  return {ok:true,message:'地图选择结算已撤销，积分恢复冻结，盘口保持关闭'};
}
async function undo(pool,id){return transaction(pool,id,async(c,m)=>{if(m.predictions_voided_at)fail('已退分记录不能撤销');return undoLocked(c,id)})}
module.exports={MAPS,configure,lock,place,settle,undo,undoLocked,validateResult};
