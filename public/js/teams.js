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
  if(profile)heading.append(node('p',[profile.acronym,region(profile.location)].filter(Boolean).join(' · ')));
  head.append(heading);el.append(head);
  if(!profile){el.append(node('p',t('暂无已同步的战队资料，请稍后刷新。','No synced team profile yet. Please check again shortly.')));return el}
  if(!profile.rosterKnown||!profile.players.length)el.append(node('p',t('数据源暂未提供当前队员名单。','The source has not provided a current roster.')));
  else{
   const list=node('ul',null,'team-player-list');
   for(const player of profile.players){const li=node('li'),info=node('div');li.append(avatar(player.imageUrl,player.nickname));info.append(node('strong',player.nickname),node('small',player.nationality?region(player.nationality):t('国籍暂无资料','Nationality unavailable')));li.append(info);list.append(li)}
   el.append(list);
  }
  el.append(node('p',t('最近同步：','Last synced: ')+(profile.syncedAt?new Date(profile.syncedAt).toLocaleString(en?'en':'zh-CN'):t('暂无','Unavailable'))+((profile.stale||sync?.stale)?t(' · 更新延迟，展示缓存资料',' · Update delayed; showing cached data'):''),'profile-updated'));
  return el;
 }
 async function get(url){const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Unavailable');return r.json()}
 let matchRequest=0;
 async function renderMatch(id,target){
  if(!target)return;const request=++matchRequest;
  target.replaceChildren(node('h3',t('双方战队与当前阵容','Teams and current rosters')),node('p',t('数据来源 PandaScore · 当前阵容并非本场已确认出场名单','Source: PandaScore · Current rosters are not confirmed lineups for this match')));
  const container=node('div',t('正在加载战队资料…','Loading team profiles…'),'team-profile-grid');target.append(container);
  try{const data=await get('/api/matches/'+encodeURIComponent(id)+'/teams');if(request!==matchRequest||!target.isConnected)return;
   container.replaceChildren(...data.teams.map(team=>card(team.profile,team.name,data.sync)));
  }catch{if(request===matchRequest&&target.isConnected)container.replaceChildren(node('p',t('战队资料暂时无法加载。','Team profiles are temporarily unavailable.')))}
 }
 window.TeamProfiles={renderMatch};
 const grid=document.getElementById('teamsList');if(!grid)return;
 const search=document.getElementById('teamSearch'),more=document.getElementById('teamsMore'),status=document.getElementById('teamSyncStatus'),refresh=document.getElementById('teamRefresh');
 let data={teams:[],sync:{}},limit=12,busy=false;
 function render(){const q=search.value.trim().toLowerCase();const teams=data.teams.filter(team=>[team.name,team.acronym,...team.players.map(p=>p.nickname)].join(' ').toLowerCase().includes(q));
  grid.replaceChildren(...teams.slice(0,limit).map(team=>card(team,team.name,data.sync)));if(!teams.length)grid.append(node('p',q?'没有找到匹配的战队或队员。':'暂无战队资料，首次同步可能需要稍等片刻。'));
  more.hidden=teams.length<=limit;status.textContent=`共 ${teams.length} 支战队 · 最近成功同步：${data.sync.successAt?new Date(data.sync.successAt).toLocaleString('zh-CN'):'等待首次同步'}${data.sync.stale?' · 更新延迟':''}`;
 }
 async function load(){if(busy)return;busy=true;refresh.disabled=true;try{const next=await get('/api/teams');if(!Array.isArray(next.teams))throw Error();data=next;render()}catch{status.textContent='战队资料暂时无法更新，将自动重试。'}finally{busy=false;refresh.disabled=false}}
 search.oninput=()=>{limit=12;render()};more.onclick=()=>{limit+=12;render()};refresh.onclick=load;load();
 setInterval(()=>{if(!document.hidden)load()},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load()});
})();
