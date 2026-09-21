(()=>{
 const en=localStorage.getItem('cs2_lang')==='en',el=id=>document.getElementById(id);
 let data={items:[],sources:[]},filter='all',limit=6,busy=false;
 const labels=en?{all:'All',esports:'Esports',official:'Official'}:{all:'全部',esports:'电竞新闻',official:'官方公告'};
 if(en){el('newsNav').textContent='News';el('newsTitle').textContent='CS2 Latest News';el('newsHint').textContent='Esports and official updates · Open the original article';el('newsMore').textContent='More news'}
 function render(){
  const items=data.items.filter(x=>filter==='all'||x.category===filter);el('newsList').replaceChildren();
  for(const item of items.slice(0,limit)){
   let url;try{url=new URL(item.url);if(url.protocol!=='https:')continue}catch{continue}
   const article=document.createElement('article');article.className='news-card';
   const meta=document.createElement('div');meta.className='news-meta';
   const source=document.createElement('span');source.textContent=item.source==='hltv'?'HLTV':(en?'CS2 Official':'CS2 官方');
   const time=document.createElement('time');time.dateTime=item.publishedAt;time.textContent=new Date(item.publishedAt).toLocaleString(en?'en':'zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
   const heading=document.createElement('h3'),link=document.createElement('a');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=item.title+' ↗';heading.append(link);meta.append(source,time);article.append(meta,heading);el('newsList').append(article);
  }
  if(!items.length)el('newsList').textContent=en?'No news available yet. Please check again shortly.':'暂无资讯，稍后会自动刷新。';
  el('newsMore').hidden=items.length<=limit;
  el('newsStatus').textContent=(en?'Last synced · ':'最近同步 · ')+data.sources.map(s=>`${s.id==='hltv'?'HLTV':(en?'Official':'官方')}：${s.successAt?new Date(s.successAt).toLocaleString(en?'en':'zh-CN'):(en?'Awaiting sync':'等待同步')}${s.stale?(en?' (update delayed)':'（更新延迟）'):''}`).join(' · ');
 }
 async function load(){
  if(busy||document.hidden)return;busy=true;
  try{const r=await fetch('/api/news',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error();const next=await r.json();if(!Array.isArray(next.items)||!Array.isArray(next.sources))throw new Error();data=next;render()}
  catch{el('newsStatus').textContent=en?'News update unavailable. Retrying automatically.':'新闻暂时无法更新，将自动重试。';if(!data.items.length)el('newsList').textContent=en?'News temporarily unavailable.':'新闻暂时无法加载。'}finally{busy=false}
 }
 document.querySelectorAll('[data-news]').forEach(button=>{button.textContent=labels[button.dataset.news];button.onclick=()=>{filter=button.dataset.news;limit=6;document.querySelectorAll('[data-news]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button))});render()}});
 el('newsMore').onclick=()=>{limit+=6;render()};load();setInterval(load,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load()});
})();
