const token=localStorage.getItem('cs2_token');
const $=id=>document.getElementById(id);
const api=async(path,options={})=>{
  const res=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`,...(options.headers||{})}});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.message||'请求失败');
  return data;
};
function toast(msg){const e=$('toast');e.textContent=msg;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2600)}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
async function boot(){
  if(!token){location.href='/';return}
  try{
    const me=(await api('/auth/me')).user;
    if(me.role!=='admin'){location.href='/';return}
    $('adminName').textContent=me.username;await refreshAll();
  }catch{localStorage.removeItem('cs2_token');location.href='/'}
}
async function refreshAll(){
  const [stats,matches,users,health,syncHistory]=await Promise.all([
  api('/admin/stats'),
  api('/admin/matches'),
  api('/admin/users'),
  fetch('/api/health').then(r=>r.json()).catch(()=>({ok:false})),
  api('/admin/sync-history')
]);

  $('usersCount').textContent=stats.users;$('matchesCount').textContent=stats.matches;
  $('openCount').textContent=stats.open_matches;$('predictionsCount').textContent=stats.predictions;const sync=stats.sync_status;

$('syncStatusValue').textContent=sync?.status||'never';

$('syncLastRun').textContent=sync?.last_run_at
  ? new Date(sync.last_run_at).toLocaleString()
  : '—';

$('syncLastSuccess').textContent=sync?.last_success_at
  ? new Date(sync.last_success_at).toLocaleString()
  : '—';
 if(sync?.last_success_at){
  const diffMs=Date.now()-new Date(sync.last_success_at).getTime();
  const diffMinutes=Math.max(0,Math.floor(diffMs/60000));

  let ageText;

  if(diffMinutes<1){
    ageText='刚刚';
  }else if(diffMinutes<30){
    ageText=`${diffMinutes} 分钟前 · 正常`;
  }else if(diffMinutes<60){
    ageText=`${diffMinutes} 分钟前 · ⚠️ 同步延迟`;
  }else if(diffMinutes<1440){
    ageText=`${Math.floor(diffMinutes/60)} 小时前 · ❌ 同步异常`;
  }else{
    ageText=`${Math.floor(diffMinutes/1440)} 天前 · ❌ 同步异常`;
  }

  if(sync?.status==='error'){
    ageText+=` · 最近一次同步失败`;
  }

  $('syncSuccessAge').textContent=ageText;
}else{
  $('syncSuccessAge').textContent=sync?.status==='error'
    ? '❌ 尚无成功同步'
    : '—';
}

$('syncTriggerSource').textContent=sync?.trigger_source||'—';

$('syncUpcomingStats').textContent=sync
  ? `拉取 ${sync.upcoming_fetched} · 新增 ${sync.upcoming_inserted} · 更新 ${sync.upcoming_updated} · 跳过 ${sync.upcoming_skipped}`
  : '—';

$('syncResultsStats').textContent=sync
  ? `拉取 ${sync.results_fetched} · 检查 ${sync.results_checked} · 结算 ${sync.results_settled} · 跳过 ${sync.results_skipped}`
  : '—';

$('syncErrorMessage').textContent=sync?.error_message||'无';
  let systemStatus='系统正常';

if(!health.ok){
  systemStatus='系统异常';
}else if(sync?.status==='error'){
  systemStatus='同步异常';
}else if(sync?.last_success_at){
  const syncAgeMinutes=Math.max(
    0,
    Math.floor(
      (Date.now()-new Date(sync.last_success_at).getTime())/60000
    )
  );

  if(syncAgeMinutes>=60){
    systemStatus='同步异常';
  }else if(syncAgeMinutes>=30){
    systemStatus='同步延迟';
  }
}else{
  systemStatus='同步未运行';
}

$('apiStatus').textContent=systemStatus;
  $('pandaConfigured').textContent=stats.pandascore_configured?'已连接':'未配置';
  $('pandaMatches').textContent=stats.pandascore_matches||0;
  $('autoSync').textContent=stats.pandascore_configured?`${stats.auto_sync_minutes} 分钟`:'关闭';
  renderMatches(matches.matches);renderUsers(users.users);
  renderSyncHistory(syncHistory.history||[]);
}
function renderSyncHistory(rows){
  const body=$('syncHistoryBody');
  if(!body)return;

  if(!rows.length){
    body.innerHTML='<tr><td colspan="6">暂无同步历史</td></tr>';
    return;
  }

  body.innerHTML=rows.map(row=>`
    <tr>
      <td>${new Date(row.created_at).toLocaleString('zh-CN')}</td>
      <td>${esc(row.trigger_source||'-')}</td>
      <td>${esc(row.status||'-')}</td>
      <td>
        拉取 ${row.upcoming_fetched||0} /
        新增 ${row.upcoming_inserted||0} /
        更新 ${row.upcoming_updated||0} /
        跳过 ${row.upcoming_skipped||0}
      </td>
      <td>
        拉取 ${row.results_fetched||0} /
        检查 ${row.results_checked||0} /
        结算 ${row.results_settled||0} /
        跳过 ${row.results_skipped||0}
      </td>
      <td>${esc(row.error_message||'无')}</td>
    </tr>
  `).join('');
}
function renderMatches(rows){
  $('matchesBody').innerHTML=rows.map(m=>`<tr>
    <td>${m.id}</td><td>${esc(m.event_name)}</td>
    <td><strong>${esc(m.team_a)}</strong> vs <strong>${esc(m.team_b)}</strong></td>
    <td>${new Date(m.starts_at).toLocaleString('zh-CN')}</td>
    <td>${esc(m.status)}${m.winner?` · ${esc(m.winner)}`:''}</td>
    <td><span class="source-badge">${esc(m.source||'manual')}</span></td>
    <td><div class="action-row">
  ${m.status==='settled'?'已结算':`
    <button class="mini-btn win" onclick="settle(${m.id},${JSON.stringify(m.team_a).replace(/"/g,'&quot;')})">${esc(m.team_a)} 胜</button>
    <button class="mini-btn win" onclick="settle(${m.id},${JSON.stringify(m.team_b).replace(/"/g,'&quot;')})">${esc(m.team_b)} 胜</button>
  `}
  ${m.source==='manual' && m.status!=='settled'
    ? `<button class="mini-btn" onclick="deleteManualMatch(${m.id})">删除</button>`
    : ''}
</div></td></tr>`).join('');
}
function renderUsers(rows){$('usersBody').innerHTML=rows.map(u=>`<tr>
  <td>${u.id}</td><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td>${u.points}</td>
  <td>${u.predictions}</td><td>${new Date(u.created_at).toLocaleString('zh-CN')}</td></tr>`).join('')}
window.settle=async(id,winner)=>{
  if(!confirm(`确认 ${winner} 获胜并结算积分？`))return;
  try{await api(`/admin/matches/${id}/result`,{method:'POST',body:JSON.stringify({winner})});toast('结算完成');await refreshAll()}
  catch(e){toast(e.message)}
};window.deleteManualMatch=async(id)=>{
  if(!confirm('确认删除这场手动比赛吗？删除后无法恢复。'))return;

  try{
    const data=await api(`/admin/matches/${id}`,{
      method:'DELETE'
    });

    toast(data.message||'手动比赛已删除');
    await refreshAll();
  }catch(e){
    toast(e.message);
  }
};
$('matchForm').onsubmit=async e=>{
  e.preventDefault();
  try{
    await api('/admin/matches',{method:'POST',body:JSON.stringify({
      eventName:$('eventName').value.trim(),teamA:$('teamA').value.trim(),teamB:$('teamB').value.trim(),
      oddsA:Number($('oddsA').value),oddsB:Number($('oddsB').value),numberOfGames:Number($('numberOfGames').value),startsAt:new Date($('startsAt').value).toISOString()
    })});
    e.target.reset();$('oddsA').value='1.80';$('oddsB').value='1.80';toast('比赛已创建');await refreshAll();
  }catch(e){toast(e.message)}
};
async function doSync(path,label){
  $('syncResult').textContent=`${label}中…`;
  try{
    const r=await api(path,{method:'POST'});
    $('syncResult').textContent=`${label}完成：${JSON.stringify(r)}`;
    toast(`${label}完成`);await refreshAll();
  }catch(e){$('syncResult').textContent=e.message;toast(e.message)}
}
$('syncBtn').onclick=()=>doSync('/admin/sync/pandascore','未来赛事同步');
$('syncResultsBtn').onclick=()=>doSync('/admin/sync/results','赛果同步与结算');
$('syncAllBtn').onclick=()=>doSync('/admin/sync/all','全部同步');
$('refreshBtn').onclick=refreshAll;
$('logoutBtn').onclick=()=>{localStorage.removeItem('cs2_token');location.href='/'};
boot();
