(()=>{
 const labels={ready:'正常',pending:'等待首次同步',failed:'最近同步失败',stale:'同步延迟',unmatched:'数据源身份未匹配',disabled:'未配置数据源'};
 const date=v=>v?new Date(v).toLocaleString('zh-CN'):'尚无记录';let busy=false,posting=false;
 const row=values=>{const tr=document.createElement('tr');for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td)}return tr};
 async function load(){if(busy)return;busy=true;$('dataSyncRefresh').disabled=true;
  try{const d=await api('/admin/data-sync');
   $('dataSyncSources').replaceChildren(...d.sources.map(s=>row([s.name,labels[s.state],date(s.checkedAt),date(s.successAt),s.interval+' 分钟'])));
   const c=d.counts;$('dataSyncProgress').textContent=`战队赛程共 ${d.teams.length} 队：正常 ${c.ready} · 等待 ${c.pending} · 失败 ${c.failed} · 延迟 ${c.stale} · 未匹配 ${c.unmatched} · 未配置 ${c.disabled}。资料覆盖 ${d.coverage.profiles}/${d.coverage.total}。`;
   $('dataSyncRanking').textContent=`HLTV 排名日期：${d.ranking.date}。${d.ranking.failed?'排名自动获取失败，保留已核实快照。':'最近检查：'+date(d.ranking.checkedAt)}`;
   $('dataSyncTeams').replaceChildren(...d.teams.map(t=>{const tr=row([t.name,labels[t.state],date(t.successAt),t.state==='unmatched'?'尚未确认战队身份':t.empty?'上次成功响应没有赛程或赛果':t.successAt?'已有缓存，失败时保留':'尚无成功缓存']);const a=document.createElement('a');a.textContent=t.name;a.href='/team.html?id='+encodeURIComponent(t.hltvId);tr.firstChild.replaceChildren(a);return tr}));
   const cooling=new Date(d.retry.nextRetryAt).getTime()>Date.now(),failed=c.failed>0||d.sources.some(s=>s.name!=='赛事与结算'&&s.state==='failed');
   $('dataSyncRetry').disabled=posting||d.retry.running||cooling||!failed;
   $('dataSyncMessage').textContent=d.retry.running?'正在重试，完成后自动更新状态。':cooling?'状态更新：'+date(d.checkedAt)+' · 可再次重试：'+date(d.retry.nextRetryAt):'状态更新：'+date(d.checkedAt);
  }catch(e){$('dataSyncMessage').textContent=e.message+'；已显示的数据可能不是最新。';$('dataSyncRetry').disabled=true}finally{busy=false;$('dataSyncRefresh').disabled=false}
 }
 $('dataSyncRefresh').onclick=load;
 $('dataSyncRetry').onclick=async()=>{if(posting)return;posting=true;$('dataSyncRetry').disabled=true;try{const r=await api('/admin/data-sync/retry',{method:'POST'});toast(r.message)}catch(e){toast(e.message)}finally{posting=false;await load()}};
 if(token){load();setInterval(()=>{if(!document.hidden)load()},30000)}
})();
