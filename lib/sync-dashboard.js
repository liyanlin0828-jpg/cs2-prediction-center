'use strict';
const {SOURCES}=require('./news');
function state(row,minutes){return row?.failed?'failed':!row?.success_at?'pending':Date.now()-new Date(row.success_at).getTime()>minutes*120000?'stale':'ready'}
function createDashboard(pool,{teams,schedules,news,configured,matchMinutes}){
 let running=false,nextRetryAt=0;
 async function read(){
  const [directory,feeds,profiles,cache,matches]=await Promise.all([teams.list(),pool.query('SELECT * FROM news_feeds'),pool.query('SELECT * FROM team_sync_state WHERE id=1'),pool.query('SELECT team_id,checked_at,success_at,failed,data IS NOT NULL AS has_data,jsonb_array_length(data->\'upcoming\') AS upcoming_count,jsonb_array_length(data->\'results\') AS result_count FROM team_match_cache'),pool.query('SELECT status,last_run_at,last_success_at FROM sync_status WHERE id=1')]);
  const byId=new Map(cache.rows.map(r=>[Number(r.team_id),r]));
  const teamRows=directory.teams.map(t=>{const r=byId.get(Number(t.id));return {name:t.name,hltvId:t.hltvId,state:!t.profileAvailable?'unmatched':!configured?'disabled':state(r,30),successAt:r?.success_at||null,empty:!!r?.has_data&&Number(r.upcoming_count)===0&&Number(r.result_count)===0}});
  const counts={ready:0,pending:0,failed:0,stale:0,unmatched:0,disabled:0};for(const t of teamRows)counts[t.state]++;
  const p=profiles.rows[0],m=matches.rows[0];
  const sources=[{name:'赛事与结算',state:!configured?'disabled':state({failed:m?.status==='error',success_at:m?.last_success_at},matchMinutes),successAt:m?.last_success_at||null,checkedAt:m?.last_run_at||null,interval:matchMinutes},...SOURCES.map(s=>{const r=feeds.rows.find(f=>f.source===s.id);return {name:s.label+'新闻',state:state(r,10),successAt:r?.success_at||null,checkedAt:r?.checked_at||null,interval:10}}),{name:'战队资料',state:!configured?'disabled':state(p,15),successAt:p?.success_at||null,checkedAt:p?.checked_at||null,interval:15}];
  return {sources,counts,teams:teamRows,coverage:directory.coverage,ranking:directory.ranking,retry:{running,nextRetryAt:new Date(nextRetryAt).toISOString()},checkedAt:new Date().toISOString()};
 }
 function retry(){
  if(running||Date.now()<nextRetryAt)return {accepted:false};
  running=true;nextRetryAt=Date.now()+5*60000;
  // Keep the request short; each service owns its single-flight and cache publication guards.
  void (async()=>{
   await news.sync({retryFailed:true});
   if(configured){
    const p=(await pool.query('SELECT failed FROM team_sync_state WHERE id=1')).rows[0];
    if(p?.failed)await teams.sync({force:true});
    await schedules.tick((await teams.list()).teams,{retryFailed:true});
   }
  })().catch(e=>console.error('[Sync dashboard retry]',e.message)).finally(()=>{running=false});
  return {accepted:true};
 }
 return {read,retry};
}
module.exports={createDashboard,state};
