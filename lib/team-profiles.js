'use strict';
const priority=require('./match-priority');
const rankingTools=require('./team-ranking');
const INTERVAL=15*60*1000;
const positiveId=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
const text=value=>typeof value==='string'?value.trim().slice(0,120):'';
const nameKey=value=>text(value).toLowerCase();
function imageUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname==='pandascore.co'||u.hostname.endsWith('.pandascore.co'))?u.href:null}catch{return null}}
function normalizeTeam(team){
  const id=positiveId(team?.id);if(!id||!text(team.name))throw Error('Invalid team profile');
  const players=Array.isArray(team.players)?team.players:null;
  const seen=new Set();
  return {id,name:text(team.name),acronym:text(team.acronym),location:text(team.location),imageUrl:imageUrl(team.image_url),rosterKnown:players!==null,sourceUpdatedAt:Number.isFinite(Date.parse(team.modified_at))?new Date(team.modified_at).toISOString():null,
    players:(players||[]).flatMap(p=>{const id=positiveId(p?.id);if(!id||!text(p.name)||seen.has(id))return [];seen.add(id);return [{id,nickname:text(p.name),nationality:text(p.nationality),imageUrl:imageUrl(p.image_url)}]})};
}
function createTeamService(pool,panda,ranking=rankingTools.createRankingService(pool)){
  let running=null;
  async function sync({force=false}={}){
    if(running)return running;
    running=(async()=>{
      const previous=(await pool.query('SELECT * FROM team_sync_state WHERE id=1')).rows[0];
      if(!force&&previous?.checked_at&&Date.now()-new Date(previous.checked_at).getTime()<INTERVAL)return;
      await pool.query('INSERT INTO team_sync_state(id,checked_at) VALUES(1,NOW()) ON CONFLICT(id) DO UPDATE SET checked_at=NOW()');
      try{
        await ranking.sync();
        const ranked=await ranking.get(),index=rankingTools.indexTeams(ranked);
        const included=name=>index.has(priority.teamKey(name));
        // Focus on the site's current matches and recent results; never look up teams by fuzzy name.
        const locals=(await pool.query(`SELECT id,external_id,team_a,team_b FROM matches WHERE source='pandascore' AND id IN (
          SELECT id FROM (SELECT m.id,m.status,m.starts_at,${priority.scoreSql()} AS popularity_score FROM matches m
          WHERE m.source='pandascore' AND m.winner IS NULL AND m.predictions_voided_at IS NULL
          AND ((m.status='open' AND m.starts_at>NOW()) OR m.status IN ('running','postponed'))
          ORDER BY ${priority.orderSql('popular')} LIMIT 400) active
          UNION SELECT id FROM (SELECT id FROM matches WHERE source='pandascore' AND status='settled' AND winner IS NOT NULL ORDER BY starts_at DESC LIMIT 20) recent
        )`)).rows.filter(m=>positiveId(m.external_id)&&(included(m.team_a)||included(m.team_b)));
        const links=[],ids=new Set();
        for(let offset=0;offset<locals.length;offset+=100){
          const batch=locals.slice(offset,offset+100),byExternal=new Map(batch.map(m=>[String(m.external_id),m]));
          const matches=await panda('/matches?per_page=100&filter[id]='+batch.map(m=>m.external_id).join(','));
          if(!Array.isArray(matches))throw Error('Invalid match identity response');
          for(const match of matches){
            const local=byExternal.get(String(match.id));if(!local)continue;
            const opponents=(match.opponents||[]).map(o=>o.opponent).filter(o=>positiveId(o?.id));
            const a=opponents.filter(t=>nameKey(t.name)===nameKey(local.team_a)),b=opponents.filter(t=>nameKey(t.name)===nameKey(local.team_b));
            if(a.length!==1||b.length!==1||positiveId(a[0].id)===positiveId(b[0].id))continue;
            const link={matchId:local.id,a:positiveId(a[0].id),b:positiveId(b[0].id),aName:local.team_a,bName:local.team_b};
            links.push(link);if(included(local.team_a))ids.add(link.a);if(included(local.team_b))ids.add(link.b);
          }
        }
        const profiles=new Map(),teamIds=[...ids];
        for(let offset=0;offset<teamIds.length;offset+=100){
          const batch=teamIds.slice(offset,offset+100);
          const teams=await panda('/csgo/teams?per_page=100&filter[id]='+batch.join(','));
          if(!Array.isArray(teams))throw Error('Invalid teams response');
          for(const team of teams){if(batch.includes(positiveId(team?.id)))profiles.set(Number(team.id),normalizeTeam(team))}
        }
        // Fetch featured main teams independently of the site's current schedule.
        // Exact aliases avoid accidentally selecting academy or female rosters.
        let featuredFailed=false;
        try{
          const names=[...new Set(ranked.teams.filter(t=>!rankingTools.academy(t.name)).flatMap(rankingTools.queryNames))];
          for(let offset=0;offset<names.length;offset+=40){
          let complete=false;
          for(let page=1;page<=10;page++){
            const teams=await panda('/csgo/teams?per_page=100&sort=id&page='+page+'&filter[name]='+encodeURIComponent(names.slice(offset,offset+40).join(',')));
            if(!Array.isArray(teams))throw Error('Invalid featured teams response');
            for(const team of teams){if(included(team?.name)&&positiveId(team?.id))profiles.set(Number(team.id),normalizeTeam(team))}
            if(teams.length<100){complete=true;break}
          }
          if(!complete)throw Error('Featured team pagination incomplete');
          }
          if(!profiles.size)throw Error('No ranked team profiles returned');
        }catch(e){featuredFailed=true;console.warn('[Featured teams]',e.message)}
        if(locals.length&&!profiles.size)throw Error('No matching team profiles returned');
        const client=await pool.connect();
        try{
          await client.query('BEGIN');
          for(const profile of profiles.values())await client.query('INSERT INTO team_profiles(id,data,synced_at) VALUES($1,$2::jsonb,NOW()) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,synced_at=NOW()',[profile.id,JSON.stringify(profile)]);
          for(const link of links)await client.query('INSERT INTO match_team_links(match_id,team_a_id,team_b_id,team_a_name,team_b_name) VALUES($1,$2,$3,$4,$5) ON CONFLICT(match_id) DO UPDATE SET team_a_id=EXCLUDED.team_a_id,team_b_id=EXCLUDED.team_b_id,team_a_name=EXCLUDED.team_a_name,team_b_name=EXCLUDED.team_b_name',[link.matchId,link.a,link.b,link.aName,link.bName]);
          await client.query('UPDATE team_sync_state SET success_at=NOW(),failed=$1 WHERE id=1',[featuredFailed||teamIds.some(id=>!profiles.has(id))||links.length<locals.length]);
          await client.query('COMMIT');
        }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
      }catch(e){
        console.warn('[Team profiles]',e.message);
        await pool.query('UPDATE team_sync_state SET failed=true WHERE id=1');
      }
    })().finally(()=>{running=null});return running;
  }
  async function status(){const s=(await pool.query('SELECT * FROM team_sync_state WHERE id=1')).rows[0];return {successAt:s?.success_at||null,stale:!s?.success_at||s.failed||Date.now()-new Date(s.success_at).getTime()>INTERVAL*2,intervalMinutes:15}}
  const present=row=>row?{...row.data,syncedAt:row.synced_at,stale:Date.now()-new Date(row.synced_at).getTime()>INTERVAL*2}:null;
  async function list(){
    const ranked=await ranking.get(),index=rankingTools.indexTeams(ranked);
    const rows=(await pool.query('SELECT * FROM team_profiles')).rows;
    const teams=ranked.teams.filter(t=>!rankingTools.academy(t.name)).map(entry=>{
      const overlap=row=>row.data.players.filter(p=>entry.players.some(n=>nameKey(n)===nameKey(p.nickname))).length;
      const candidates=rows.filter(row=>index.get(priority.teamKey(row.data.name))?.hltvId===entry.hltvId&&(priority.teamKey(row.data.name)===priority.teamKey(entry.name)||overlap(row)>=2));
      candidates.sort((a,b)=>overlap(b)-overlap(a)||Math.min(b.data.players.length,5)-Math.min(a.data.players.length,5)||(Date.parse(b.data.sourceUpdatedAt)||0)-(Date.parse(a.data.sourceUpdatedAt)||0)||Number(b.id)-Number(a.id));
      // Conflicting historical identities require roster evidence; never pick a random team ID.
      const chosen=candidates.length===1?candidates[0]:candidates.length>1&&overlap(candidates[0])>=2&&overlap(candidates[0])>overlap(candidates[1])?candidates[0]:null;
      const profile=present(chosen);
      return {...(profile||{id:'hltv:'+entry.hltvId,players:[],rosterKnown:false}),name:entry.name,aliases:[...rankingTools.aliases(entry),...(profile?[profile.name]:[])],rank:entry.rank,hltvId:entry.hltvId,profileAvailable:!!profile};
    });
    return {teams,ranking:{date:ranked.date,sourceUrl:ranked.sourceUrl,failed:ranked.failed,stale:ranked.stale,checkedAt:ranked.checkedAt},coverage:{total:teams.length,profiles:teams.filter(t=>t.profileAvailable).length},sync:await status()};
  }
  async function forMatch(id){
    const match=(await pool.query('SELECT id,team_a,team_b,source FROM matches WHERE id=$1',[id])).rows[0];
    if(!match)return null;
    const link=(await pool.query('SELECT * FROM match_team_links WHERE match_id=$1 AND team_a_name=$2 AND team_b_name=$3',[id,match.team_a,match.team_b])).rows[0];
    const rows=link?(await pool.query('SELECT * FROM team_profiles WHERE id=ANY($1::bigint[])',[[link.team_a_id,link.team_b_id]])).rows:[];
    return {matchId:match.id,source:match.source,teams:[{name:match.team_a,profile:present(rows.find(r=>String(r.id)===String(link?.team_a_id)))},{name:match.team_b,profile:present(rows.find(r=>String(r.id)===String(link?.team_b_id)))}],sync:await status()};
  }
  return {sync,list,forMatch};
}
module.exports={createTeamService,normalizeTeam,imageUrl};
