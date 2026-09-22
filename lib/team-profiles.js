'use strict';
const priority=require('./match-priority');
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
function createTeamService(pool,panda){
  let running=null;
  async function sync({force=false}={}){
    if(running)return running;
    running=(async()=>{
      const previous=(await pool.query('SELECT * FROM team_sync_state WHERE id=1')).rows[0];
      if(!force&&previous?.checked_at&&Date.now()-new Date(previous.checked_at).getTime()<INTERVAL)return;
      await pool.query('INSERT INTO team_sync_state(id,checked_at) VALUES(1,NOW()) ON CONFLICT(id) DO UPDATE SET checked_at=NOW()');
      try{
        // Focus on the site's current matches and recent results; never look up teams by fuzzy name.
        const locals=(await pool.query(`SELECT id,external_id,team_a,team_b FROM matches WHERE source='pandascore' AND id IN (
          SELECT id FROM (SELECT m.id,m.status,m.starts_at,${priority.scoreSql()} AS popularity_score FROM matches m
          WHERE m.source='pandascore' AND m.winner IS NULL AND m.predictions_voided_at IS NULL
          AND ((m.status='open' AND m.starts_at>NOW()) OR m.status IN ('running','postponed'))
          ORDER BY ${priority.orderSql('popular')} LIMIT 400) active
          UNION SELECT id FROM (SELECT id FROM matches WHERE source='pandascore' AND status='settled' AND winner IS NOT NULL ORDER BY starts_at DESC LIMIT 20) recent
        )`)).rows.filter(m=>positiveId(m.external_id)&&(priority.teamScore(m.team_a)||priority.teamScore(m.team_b)));
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
            links.push(link);if(priority.teamScore(local.team_a))ids.add(link.a);if(priority.teamScore(local.team_b))ids.add(link.b);
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
          let complete=false;
          for(let page=1;page<=10;page++){
            const teams=await panda('/csgo/teams?per_page=100&sort=id&page='+page+'&filter[name]='+encodeURIComponent([...new Set(priority.featuredTeamNames.flatMap(name=>[name,name.replace(/\s+/g,'')]))].join(',')));
            if(!Array.isArray(teams))throw Error('Invalid featured teams response');
            for(const team of teams){if(priority.teamScore(team?.name)&&positiveId(team?.id))profiles.set(Number(team.id),normalizeTeam(team))}
            if(teams.length<100){complete=true;break}
          }
          if(!complete)throw Error('Featured team pagination incomplete');
          if(![...profiles.values()].some(t=>priority.teamScore(t.name)))throw Error('No featured team profiles returned');
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
  const present=row=>row&&priority.teamScore(row.data.name)?{...row.data,syncedAt:row.synced_at,stale:Date.now()-new Date(row.synced_at).getTime()>INTERVAL*2}:null;
  async function list(){const rows=(await pool.query('SELECT * FROM team_profiles ORDER BY data->>\'name\',id')).rows;const candidates=rows.filter(row=>priority.teamScore(row.data.name)).map(present);
    // Prefer a full current roster over an empty/partial historical duplicate.
    candidates.sort((a,b)=>Math.min(b.players.length,5)-Math.min(a.players.length,5)||(Date.parse(b.sourceUpdatedAt)||0)-(Date.parse(a.sourceUpdatedAt)||0)||b.id-a.id);
    const unique=new Map();for(const team of candidates){const key=priority.teamKey(team.name);if(!unique.has(key))unique.set(key,team)}
    const teams=[...unique.values()];teams.sort((a,b)=>priority.teamScore(b.name)-priority.teamScore(a.name)||a.name.localeCompare(b.name)||a.id-b.id);return {teams,sync:await status()}}
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
