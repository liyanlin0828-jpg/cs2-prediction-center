(()=>{
 const el=id=>document.getElementById(id),node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e};
 const id=new URLSearchParams(location.search).get('id'),refresh=el('detailRefresh');let busy=false,loaded=false;
 const date=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN'):'时间待定';
 function matchCard(m,result){
  const card=node('article',null,'team-match-card');card.append(node('p',m.event_name||'赛事名称待更新','muted'),node('h3',m.team_a+' vs '+m.team_b),node('p',date(m.starts_at),'muted'));
  if(result){const valid=Number.isInteger(m.score_a)&&Number.isInteger(m.score_b)&&m.score_a>=0&&m.score_b>=0&&m.score_a+m.score_b>0;const winner=[m.team_a,m.team_b].includes(m.winner)?m.winner:null;card.append(node('p',valid?`${m.score_a} : ${m.score_b}`:'比分暂缺'),node('p',winner?'胜方：'+winner:'胜方资料待核实'))}
  else card.append(node('p',m.status==='running'?'进行中':m.status==='postponed'?'已延期，等待重新安排':'未开始'));
  return card;
 }
 async function load(){if(busy)return;if(!/^[1-9]\d*$/.test(id||'')||!Number.isSafeInteger(Number(id))){el('teamTitle').textContent='无效战队链接';el('detailStatus').textContent='请从全部战队页面选择战队。';el('matchSyncStatus').textContent='';refresh.disabled=true;return}
  busy=true;refresh.disabled=true;
  try{const r=await fetch('/api/teams/'+id,{signal:AbortSignal.timeout(15000)});if(r.status===404){el('teamTitle').textContent='该战队不在当前榜单中';el('detailStatus').textContent='请返回全部战队查看最新名单。';el('teamProfile').replaceChildren();el('teamUpcoming').replaceChildren();el('teamResults').replaceChildren();el('detailRanking').replaceChildren();el('matchSyncStatus').textContent='';return}if(!r.ok)throw Error();const d=await r.json();
   el('teamTitle').textContent=d.team.name;document.title=d.team.name+' · 战队详情';el('teamProfile').replaceChildren(window.TeamProfiles.card(d.team,d.team.name,d.sync));
   el('detailStatus').textContent='页面更新：'+date(d.checkedAt)+(d.sync.stale?' · 战队资料更新延迟，展示缓存':'');
   const ms=d.matchSync||{},independent=d.matchScope==='team';
   el('matchSyncStatus').textContent=(independent?'赛程与赛果来源 PandaScore，按战队独立同步，两类各最多 10 场。':'暂展示本站已有比赛，两类各最多 10 场。')+' '+({pending:'正在等待首次独立同步。',unmatched:'尚未确认数据源战队身份，暂不能独立同步。',failed:independent?'最近同步失败，保留上次成功数据。':'独立同步失败，请稍后重试。',stale:'同步延迟，展示缓存数据。',ready:'服务运行时约每 30 分钟更新，页面每 60 秒自动刷新。'}[ms.state]||'')+(ms.successAt?' 最近成功同步：'+date(ms.successAt):'');
   const rank=el('detailRanking');rank.replaceChildren(node('span',`HLTV #${d.team.rank} · 排名日期：${d.ranking.date} · `));const source=node('a','查看原始榜单');const url=new URL(d.ranking.sourceUrl);if(url.origin==='https://www.hltv.org'){source.href=url.href;source.target='_blank';source.rel='noopener noreferrer';rank.append(source)}rank.append(node('span',d.ranking.failed?' · 排名自动更新暂不可用，展示已核实快照':d.ranking.stale?' · 排名更新延迟':''));
   for(const [target,items,result] of [['teamUpcoming',d.upcoming,false],['teamResults',d.results,true]])el(target).replaceChildren(...(items.length?items.map(m=>matchCard(m,result)):[node('p',independent?(result?'数据源本次未返回近期赛果。':'数据源本次未返回后续赛程。'):(result?'本站暂无已同步赛果。':'本站暂无已同步赛程。'),'muted')]));loaded=true;
  }catch{el('detailStatus').textContent=loaded?'暂时无法更新，保留上次加载的资料。':'详情暂时无法加载，请点击刷新重试。';if(!loaded)el('teamTitle').textContent='战队详情'}finally{busy=false;refresh.disabled=false}
 }
 refresh.onclick=load;load();setInterval(()=>{if(!document.hidden)load()},60000);
})();
