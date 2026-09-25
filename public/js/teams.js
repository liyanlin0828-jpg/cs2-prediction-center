(()=>{
 const en=localStorage.getItem('cs2_lang')==='en',t=(zh,english)=>en?english:zh;
 const node=(tag,value,className)=>{const e=document.createElement(tag);if(value!=null)e.textContent=value;if(className)e.className=className;return e};
 function region(code){if(!code)return t('暂无地区资料','Region unavailable');try{return new Intl.DisplayNames([en?'en':'zh-CN'],{type:'region'}).of(code.toUpperCase())||code}catch{return code}}
 function avatar(url,name){
  const fallback=()=>node('span',(name||'?').slice(0,2).toUpperCase(),'profile-avatar profile-placeholder');
  try{const u=new URL(url);if(u.protocol!=='https:'||!(u.hostname==='pandascore.co'||u.hostname.endsWith('.pandascore.co')))return fallback();
   const img=node('img',null,'profile-avatar');img.src=u.href;img.alt=name||'';img.loading='lazy';img.referrerPolicy='no-referrer';img.onerror=()=>img.replaceWith(fallback());return img;
  }catch{return fallback()}
 }
 function card(profile,name,sync){
  const el=node('article',null,'team-profile-card'),head=node('div',null,'team-profile-head'),heading=node('div');
  head.append(avatar(profile?.imageUrl,name));heading.append(node('h3',profile?.name||name));
  if(profile?.rank)heading.prepend(node('p','HLTV #'+profile.rank));
  if(profile)heading.append(node('p',[profile.acronym,region(profile.location)].filter(Boolean).join(' · ')));
  head.append(heading);el.append(head);
  if(!profile){el.append(node('p',t('暂无已同步的战队资料，请稍后刷新。','No synced team profile yet. Please check again shortly.')));return el}
  if(profile.profileAvailable===false){el.append(node('p',t('已收录排名，暂未匹配到可靠的 PandaScore 战队资料。','Ranked team listed; a reliable PandaScore profile is not available yet.')));return el}
  if(!profile.rosterKnown||!profile.players.length)el.append(node('p',t('数据源暂未提供当前队员名单。','The source has not provided a current roster.')));
  else{
   el.append(node('p',t('数据源收录 '+profile.players.length+' 人','Source lists '+profile.players.length+' people'),'muted'));
   const list=node('ul',null,'team-player-list');
   for(const player of profile.players){const li=node('li'),info=node('div');li.append(avatar(player.imageUrl,player.nickname));info.append(node('strong',player.nickname),node('small',player.nationality?region(player.nationality):t('国籍暂无资料','Nationality unavailable')));li.append(info);list.append(li)}
   el.append(list);
  }
  const evidence=node('details'),summary=node('summary',t('阵容来源与核查说明','Roster sources and verification'));evidence.append(summary,node('p',t('PandaScore 战队关联名单，不代表本场比赛已确认出场名单。','PandaScore team-associated list, not a confirmed lineup for this match.')));
  evidence.append(node('p',t('源资料更新时间：','Source record updated: ')+(profile.sourceUpdatedAt?new Date(profile.sourceUpdatedAt).toLocaleString(en?'en':'zh-CN'):t('未提供','Not provided'))+t('（不是阵容确认时间）',' (not a roster verification time)')));
  const reference=profile.rosterReference;
  if(reference?.source==='HLTV ranking'&&Array.isArray(reference.players)&&reference.players.length){
   evidence.append(node('p',t('HLTV 榜单阵容参考（','HLTV ranking roster reference (')+reference.date+'）：'+reference.players.join('、')));
   try{const url=new URL(reference.url);if(url.origin==='https://www.hltv.org'&&/^\/ranking\/teams\/\d{4}\/[a-z]+\/\d{1,2}$/.test(url.pathname)){const a=node('a',t('查看该日期榜单','View dated ranking'));a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';evidence.append(a)}}catch{}
   evidence.append(node('p',t('仅反映该日期榜单收录，不作为当前首发、替补或离队判定依据。','This dated list does not establish current starters, substitutes or departures.')));
  }
  el.append(evidence);
  el.append(node('p',t('最近同步：','Last synced: ')+(profile.syncedAt?new Date(profile.syncedAt).toLocaleString(en?'en':'zh-CN'):t('暂无','Unavailable'))+((profile.stale||sync?.stale)?t(' · 更新延迟，展示缓存资料',' · Update delayed; showing cached data'):''),'profile-updated'));
  return el;
 }
 async function get(url){const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Unavailable');return r.json()}
 let matchRequest=0;
 async function renderMatch(id,target){
  if(!target)return;const request=++matchRequest;
  target.replaceChildren(node('h3',t('双方战队与收录名单','Teams and listed players')),node('p',t('数据来源 PandaScore · 收录名单并非本场已确认出场名单','Source: PandaScore · Listed players are not confirmed lineups for this match')));
  const container=node('div',t('正在加载战队资料…','Loading team profiles…'),'team-profile-grid');target.append(container);
  try{const data=await get('/api/matches/'+encodeURIComponent(id)+'/teams');if(request!==matchRequest||!target.isConnected)return;
   container.replaceChildren(...data.teams.map(team=>card(team.profile,team.name,data.sync)));
  }catch{if(request===matchRequest&&target.isConnected)container.replaceChildren(node('p',t('战队资料暂时无法加载。','Team profiles are temporarily unavailable.')))}
 }
 window.TeamProfiles={renderMatch,card};
 const grid=document.getElementById('teamsList');if(!grid)return;
 const search=document.getElementById('teamSearch'),more=document.getElementById('teamsMore'),status=document.getElementById('teamSyncStatus'),refresh=document.getElementById('teamRefresh');
 let data={teams:[],sync:{}},limit=12,busy=false;
 const searchKey=value=>String(value||'').toLowerCase().replace(/[\s._-]+/g,'');
 function render(){const q=searchKey(search.value);const teams=data.teams.filter(team=>[team.name,team.acronym,...(team.aliases||[]),...team.players.map(p=>p.nickname)].some(value=>searchKey(value).includes(q)));
  grid.replaceChildren(...teams.slice(0,limit).map(team=>{const link=node('a',null,'team-directory-link');link.href='/team.html?id='+encodeURIComponent(team.hltvId);link.setAttribute('aria-label','查看 '+team.name+' 战队详情');link.append(card(team,team.name,data.sync));return link}));if(!teams.length)grid.append(node('p',q?'没有找到匹配的战队或队员。':'暂无战队资料，首次同步可能需要稍等片刻。'));
  more.hidden=teams.length<=limit;status.textContent=`已显示 ${Math.min(limit,teams.length)} / ${teams.length} 支战队 · 最近成功同步：${data.sync.successAt?new Date(data.sync.successAt).toLocaleString('zh-CN'):'等待首次同步'}${data.sync.stale?' · 更新延迟':''}`;
  if(data.coverage)status.textContent+=` · 已匹配资料 ${data.coverage.profiles} / ${data.coverage.total}`;
  const rankingStatus=document.getElementById('teamRankingStatus');
  if(rankingStatus&&data.ranking){
   const r=data.ranking;rankingStatus.replaceChildren(node('span',`排名日期：${r.date} · `));
   const link=node('a','查看 HLTV 原始榜单');
   try{const url=new URL(r.sourceUrl);if(url.origin==='https://www.hltv.org'){link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';rankingStatus.append(link)}}catch{}
   rankingStatus.append(node('span',r.failed?' · 排名自动更新暂不可用，展示已核实快照':r.stale?' · 排名更新延迟，展示历史榜单':' · HLTV 每周发布，网站每天检查更新'));
  }
 }
 async function load(){if(busy)return;busy=true;refresh.disabled=true;try{const next=await get('/api/teams');if(!Array.isArray(next.teams))throw Error();data=next;render()}catch{status.textContent='战队资料暂时无法更新，将自动重试。'}finally{busy=false;refresh.disabled=false}}
 search.oninput=()=>{limit=12;render()};more.onclick=()=>{limit+=12;render()};refresh.onclick=load;load();
 setInterval(()=>{if(!document.hidden)load()},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load()});
})();
