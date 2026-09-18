'use strict';
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status,code:'LIFECYCLE_CONFLICT'})};
async function transaction(pool,id,work){
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const m=(await c.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!m)fail('比赛不存在',404);
    const result=await work(c,m);
    await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK');throw e}
  finally{c.release()}
}
function validateSource(m,x,status){
  if(!x)return;
  if(x.status!==status||m.source!=='pandascore'||String(m.external_id)!==String(x.id))fail('来源比赛或状态不一致');
}
async function refund(pool,id,reason='canceled',sourceMatch=null){
  if(!['canceled','postponed'].includes(reason))fail('无效退分原因',400);
  return transaction(pool,id,async(c,m)=>{
    validateSource(m,sourceMatch,reason);
    if(m.predictions_voided_at)return {ok:true,alreadyRefunded:true,refundedPredictions:0,refundedPoints:0,message:'本场预测已退分，无需重复操作'};
    if(reason==='postponed'&&m.status!=='postponed')fail('仅延期比赛可以执行延期退分');
    if(m.status==='settled'||m.winner||m.actual_map_count!=null)fail('已有赛果结算，请先核查并撤销结算后再退分');
    // Match lock serializes betting, winner/map settlement and refunds.
    const groups=[];
    for(const table of ['predictions','map_predictions']){
      const rows=(await c.query(`SELECT * FROM ${table} WHERE match_id=$1 ORDER BY user_id,id FOR UPDATE`,[m.id])).rows;
      if(rows.some(p=>p.result!=null&&p.result!=='refunded'))fail('存在已结算预测，未执行退分');
      groups.push({table,rows:rows.filter(p=>p.result==null)});
    }
    const totals=new Map();let count=0,total=0;
    for(const {rows} of groups)for(const p of rows){
      const stake=Number(p.stake_points||0);
      if(!Number.isSafeInteger(stake)||stake<0)fail('下注本金异常，未执行退分');
      totals.set(p.user_id,(totals.get(p.user_id)||0)+stake);count++;total+=stake;
    }
    // Lock all affected users in stable order; never clamp or silently lose frozen points.
    for(const [userId,stake] of [...totals].sort((a,b)=>a[0]-b[0])){
      const r=await c.query('UPDATE users SET points=points+$1,locked_points=locked_points-$1 WHERE id=$2 AND locked_points>=$1 AND points<=$3 RETURNING id',[stake,userId,2147483647-stake]);
      if(!r.rowCount)fail('冻结积分不足、用户缺失或余额超限，整笔退分已取消');
    }
    for(const {table,rows} of groups)for(const p of rows){
      await c.query(`UPDATE ${table} SET result='refunded',points_delta=0,refund_points=$1,refunded_at=NOW() WHERE id=$2`,[Number(p.stake_points||0),p.id]);
    }
    await c.query('UPDATE matches SET status=$1,source_status=$1,predictions_voided_at=NOW(),void_reason=$1,synced_at=NOW() WHERE id=$2',[reason,m.id]);
    return {ok:true,refundedPredictions:count,refundedPoints:total,message:`已退还 ${count} 条预测的 ${total} 积分本金；本场预测不再开放或结算`};
  });
}
async function postpone(pool,id,sourceMatch=null){
  return transaction(pool,id,async(c,m)=>{
    validateSource(m,sourceMatch,'postponed');
    if(m.predictions_voided_at||m.status==='canceled'||m.status==='settled'||m.winner)return {skipped:true};
    await c.query("UPDATE matches SET status='postponed',source_status='postponed',synced_at=NOW() WHERE id=$1",[m.id]);
    return {ok:true,message:'比赛已暂停预测，原下注和冻结积分保留；确认新日期后可恢复'};
  });
}
async function resume(pool,id,startsAt){
  const time=typeof startsAt==='string'?Date.parse(startsAt):NaN;
  if(!Number.isFinite(time)||time<=Date.now()+600000)fail('请填写至少十分钟后的新开赛时间',400);
  return transaction(pool,id,async(c,m)=>{
    if(m.source!=='manual')fail('数据源比赛请等待官方更新日期，不能手动恢复');
    if(m.status!=='postponed'||m.predictions_voided_at||m.winner)fail('仅未退分的延期比赛可以恢复');
    await c.query("UPDATE matches SET status='open',source_status='not_started',starts_at=$1,synced_at=NOW() WHERE id=$2",[new Date(time).toISOString(),m.id]);
    return {ok:true,message:'已按新开赛时间恢复预测，原下注及赔率保留'};
  });
}
async function resumeFromSource(pool,id,x){
  return transaction(pool,id,async(c,m)=>{
    validateSource(m,x,'not_started');
    if(m.status!=='postponed'||m.predictions_voided_at||m.winner)return {skipped:true};
    const names=(x.opponents||[]).map(o=>o.opponent?.name);
    const time=Date.parse(x.begin_at||'');
    if(!Number.isFinite(time)||time<=Date.now()||time===Date.parse(m.starts_at)||!names.includes(m.team_a)||!names.includes(m.team_b))return {skipped:true};
    await c.query("UPDATE matches SET status='open',source_status='not_started',starts_at=$1,synced_at=NOW() WHERE id=$2",[new Date(time).toISOString(),m.id]);
    return {ok:true};
  });
}
module.exports={refund,postpone,resume,resumeFromSource};
