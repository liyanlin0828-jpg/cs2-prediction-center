'use strict';
const INTERVAL=30*60*1000;
const id=n=>Number.isSafeInteger(Number(n))&&Number(n)>0?Number(n):null;
const text=v=>typeof v==='string'?v.trim().slice(0,200):'';
const date=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
function normalize(match,teamId){
 if(!id(match?.id)||!['not_started','running','postponed','finished'].includes(match.status))return null;
 const opponents=(match.opponents||[]).map(o=>o.opponent).filter(o=>id(o?.id)&&text(o.name));
 if(opponents.length!==2||id(opponents[0].id)===id(opponents[1].id)||!opponents.some(o=>id(o.id)===teamId))return null;
 const [a,b]=opponents,winner=match.status==='finished'?opponents.find(o=>id(o.id)===id(match.winner_id)):null;
 const scores=Array.isArray(match.results)?match.results:[];
 const scoreFor=team=>{const rows=scores.filter(r=>id(r.team_id)===id(team.id));return rows.length===1&&Number.isInteger(rows[0].score)&&rows[0].score>=0?rows[0].score:null};
 let sa=scoreFor(a),sb=scoreFor(b);if(sa===null||sb===null||sa+sb===0){sa=null;sb=null}
 return {id:id(match.id),event_name:[text(match.league?.name),text(match.serie?.full_name||match.serie?.name),text(match.tournament?.name)].filter(Boolean).join(' · '),team_a:text(a.name),team_b:text(b.name),starts_at:date(match.begin_at||match.scheduled_at),status:({not_started:'open',finished:'settled'})[match.status]||match.status,winner:winner?text(winner.name):null,score_a:sa,score_b:sb};
}
function clean(items,teamId,finished){
 if(!Array.isArray(items))throw Error('Invalid team matches response');
 const unique=new Map();for(const item of items){const m=normalize(item,teamId);if(!m||((m.status==='settled')!==finished))continue;unique.set(m.id,m)}
 const rows=[...unique.values()];rows.sort((a,b)=>finished?(Date.parse(b.starts_at)||0)-(Date.parse(a.starts_at)||0):({running:0,open:1,postponed:2}[a.status]-{running:0,open:1,postponed:2}[b.status])||(Date.parse(a.starts_at)||Infinity)-(Date.parse(b.starts_at)||Infinity));return rows.slice(0,10);
}
function createScheduleService(pool,panda){
 let running=null;
 async function tick(teams,{retryFailed=false}={}){if(running)return running;running=(async()=>{
  const states=new Map((await pool.query('SELECT team_id,checked_at,failed FROM team_match_cache')).rows.map(r=>[Number(r.team_id),r]));
  const due=teams.filter(t=>t.profileAvailable&&id(t.id)&&(!retryFailed||states.get(Number(t.id))?.failed)&&(!states.get(Number(t.id))?.checked_at||Date.now()-new Date(states.get(Number(t.id)).checked_at).getTime()>=(retryFailed?60000:INTERVAL)));
  due.sort((a,b)=>(new Date(states.get(Number(a.id))?.checked_at||0).getTime())-(new Date(states.get(Number(b.id))?.checked_at||0).getTime())||a.rank-b.rank);
  for(const team of due.slice(0,5)){
   await pool.query('INSERT INTO team_match_cache(team_id,checked_at) VALUES($1,NOW()) ON CONFLICT(team_id) DO UPDATE SET checked_at=NOW()',[team.id]);
   try{
    const base='/teams/'+team.id+'/matches?per_page=100&';
    const future=await panda(base+'filter[status]=not_started,running,postponed&sort=begin_at');
    const past=await panda(base+'filter[status]=finished&sort=-begin_at');
    const data={upcoming:clean(future,Number(team.id),false),results:clean(past,Number(team.id),true)};
    // Publish both lists together; a partial request failure must retain the previous snapshot.
    await pool.query('UPDATE team_match_cache SET data=$2::jsonb,success_at=NOW(),failed=false WHERE team_id=$1',[team.id,JSON.stringify(data)]);
   }catch(e){console.warn('[Team schedules]',team.id,e.message);await pool.query('UPDATE team_match_cache SET failed=true WHERE team_id=$1',[team.id])}
  }
 })().finally(()=>{running=null});return running}
 async function read(team){if(!team.profileAvailable||!id(team.id))return {data:null,state:'unmatched',intervalMinutes:30};const row=(await pool.query('SELECT * FROM team_match_cache WHERE team_id=$1',[team.id])).rows[0];return {data:row?.data||null,state:row?.failed?'failed':!row?.success_at?'pending':Date.now()-new Date(row.success_at).getTime()>INTERVAL*2?'stale':'ready',successAt:row?.success_at||null,checkedAt:row?.checked_at||null,intervalMinutes:30}}
 return {tick,read};
}
module.exports={createScheduleService,normalize,clean};
