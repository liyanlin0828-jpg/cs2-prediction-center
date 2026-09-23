'use strict';
const seed=require('../data/hltv-top100.json');
const priority=require('./match-priority');
const DAY=24*60*60*1000;
const extraAliases={innercircle:['Inner Circle Esports'],sinners:['Sinners Esports'],sashi:['Sashi Esport'],baks:['BakS eSports'],bountyhunters:['Bounty Hunters Esports'],ww:['WW Team'],lag:['LAG Gaming'],unity:['UNiTY esports']};
const academy=name=>/\b(academy|junior|youngsters|youth|nxt)\b/i.test(name)||/^(G2 Ares|FaZe Up Next|Falcons Force)$/i.test(name);
function aliases(team){return [...new Set([team.name,...priority.featuredTeamNames.filter(n=>priority.teamKey(n)===priority.teamKey(team.name)),...(extraAliases[priority.teamKey(team.name)]||[])])]}
function indexTeams(data){const map=new Map();for(const team of data.teams){if(academy(team.name))continue;for(const name of aliases(team))map.set(priority.teamKey(name),team)}return map}
function validate(data){
  if(!data||!/^\d{4}-\d{2}-\d{2}$/.test(data.date)||!Number.isFinite(Date.parse(data.date))||Date.parse(data.date)>Date.now()+DAY)throw Error('Invalid ranking date');
  if(!Array.isArray(data.teams)||data.teams.length!==100)throw Error('Incomplete HLTV top 100');
  const ids=new Set();for(let i=0;i<100;i++){const t=data.teams[i];if(t.rank!==i+1||!Number.isSafeInteger(t.hltvId)||t.hltvId<1||ids.has(t.hltvId)||typeof t.name!=='string'||!t.name.trim()||t.name.length>120||!Array.isArray(t.players)||t.players.some(p=>typeof p!=='string'||p.length>120))throw Error('Invalid ranking entry');ids.add(t.hltvId)}
  const url=new URL(data.sourceUrl);if(url.origin!=='https://www.hltv.org'||!/^\/ranking\/teams\/\d{4}\/[a-z]+\/\d{1,2}$/.test(url.pathname))throw Error('Invalid ranking source');
  const parts=url.pathname.split('/');const month=['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(parts[4])+1;
  if(!month||`${parts[3]}-${String(month).padStart(2,'0')}-${parts[5].padStart(2,'0')}`!==data.date||new Date(data.date).toISOString().slice(0,10)!==data.date)throw Error('Ranking date/source mismatch');
  return data;
}
const decode=s=>s.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim();
function parseRanking(html,url){
  const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
  const match=new URL(url).pathname.match(/^\/ranking\/teams\/(\d{4})\/([a-z]+)\/(\d{1,2})$/);
  if(!match||!months.includes(match[2]))throw Error('Missing dated ranking URL');
  const teams=[];
  for(const block of html.split(/<div\s+class="ranking-header">/).slice(1)){
    const rank=Number(block.match(/class="position[^\"]*">#(\d+)/)?.[1]);if(rank<1||rank>100)continue;
    const name=decode(block.match(/<span\s+class="name">([\s\S]*?)<\/span>/)?.[1]||'');
    const hltvId=Number(block.match(/href="\/team\/(\d+)\//)?.[1]);
    const players=[...block.matchAll(/<div\s+class="rankingNicknames">\s*<span>([\s\S]*?)<\/span>/g)].map(m=>decode(m[1]));
    teams.push({rank,name,hltvId,players});
  }
  return validate({date:`${match[1]}-${String(months.indexOf(match[2])+1).padStart(2,'0')}-${match[3].padStart(2,'0')}`,sourceUrl:url,teams});
}
async function fetchRanking(){const r=await fetch('https://www.hltv.org/ranking/teams',{signal:AbortSignal.timeout(15000),headers:{Accept:'text/html'}});if(!r.ok)throw Error('HLTV HTTP '+r.status);const html=await r.text();if(html.length>3000000)throw Error('Ranking response too large');return parseRanking(html,r.url)}
function createRankingService(pool,fetcher=fetchRanking){
  let running=null;
  async function get(){const row=(await pool.query('SELECT * FROM team_ranking_cache WHERE id=1')).rows[0];let data=seed;try{if(row?.data&&validate(row.data).date>=seed.date)data=row.data}catch{}return {...data,failed:!!row?.failed,checkedAt:row?.checked_at||null,stale:Date.now()-Date.parse(data.date)>8*DAY}}
  async function sync(){if(running)return running;running=(async()=>{const row=(await pool.query('SELECT * FROM team_ranking_cache WHERE id=1')).rows[0];if(row?.checked_at&&Date.now()-new Date(row.checked_at).getTime()<DAY)return;await pool.query('INSERT INTO team_ranking_cache(id,checked_at) VALUES(1,NOW()) ON CONFLICT(id) DO UPDATE SET checked_at=NOW()');try{const data=validate(await fetcher());const current=await get();if(data.date<current.date)throw Error('Older ranking rejected');await pool.query('UPDATE team_ranking_cache SET data=$1::jsonb,failed=false WHERE id=1',[JSON.stringify(data)])}catch(e){console.warn('[HLTV ranking]',e.message);await pool.query('UPDATE team_ranking_cache SET failed=true WHERE id=1')}})().finally(()=>{running=null});return running}
  return {get,sync};
}
module.exports={createRankingService,validate,parseRanking,indexTeams,aliases,academy};
