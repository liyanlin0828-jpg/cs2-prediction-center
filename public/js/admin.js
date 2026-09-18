const token=localStorage.getItem('cs2_token');
const $=id=>document.getElementById(id);
let syncHistoryExpanded=false;
let syncHistoryRows=[];
let adminMatches=[];
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

  syncHistoryRows=rows||[];

  if(!syncHistoryRows.length){
    body.innerHTML='<tr><td colspan="6">暂无同步历史</td></tr>';
    return;
  }

  const visibleRows=syncHistoryExpanded
    ? syncHistoryRows
    : syncHistoryRows.slice(0,10);

  body.innerHTML=visibleRows.map(row=>`
    <tr>
      <td>${new Date(row.created_at).toLocaleString('zh-CN')}</td>
      <td>${esc(row.trigger_source||'-')}</td>
     <td>
  <span class="source-badge ${row.status==='success'?'win':''}">
    ${esc(row.status||'-')}
  </span>
</td>
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

  if(syncHistoryRows.length>10){
    body.insertAdjacentHTML('beforeend',`
      <tr>
        <td colspan="6" style="text-align:center">
          <button type="button" class="btn btn-secondary" id="syncHistoryToggle">
            ${syncHistoryExpanded
              ? '收起同步历史 ↑'
              : `查看更多（还有 ${syncHistoryRows.length-10} 条）`
            }
          </button>
        </td>
      </tr>
    `);

    $('syncHistoryToggle').onclick=()=>{
      syncHistoryExpanded=!syncHistoryExpanded;
      renderSyncHistory(syncHistoryRows);
    };
  }
}
function renderMatches(rows){
  adminMatches=rows;
  $('matchesBody').innerHTML=rows.map(m=>`<tr>
    <td>${m.id}</td><td>${esc(m.event_name)}</td>
    <td><strong>${esc(m.team_a)}</strong> vs <strong>${esc(m.team_b)}</strong></td>
    <td>${new Date(m.starts_at).toLocaleString('zh-CN')}</td>
    <td>${esc(({open:'未开始',running:'进行中',settled:'已结算',canceled:'已取消',postponed:'已延期'})[m.status]||m.status)}${m.winner?` · ${esc(m.winner)}`:''}${m.predictions_voided_at?' · 已退本金':''}</td>
    <td><span class="source-badge">${esc(m.source||'manual')}</span></td>
    <td><div class="action-row">
 ${(m.status==='settled' || m.winner)
  ? `
    <span>已结算</span>
    <button
      class="mini-btn"
      onclick="unsettle(${m.id})"
    >撤销结算</button>
  `
  : m.predictions_voided_at?'已退分，预测关闭':m.status==='postponed'?'延期暂停中':`
    <button class="mini-btn win" onclick="settle(${m.id},${JSON.stringify(m.team_a).replace(/"/g,'&quot;')})">${esc(m.team_a)} 胜</button>
    <button class="mini-btn win" onclick="settle(${m.id},${JSON.stringify(m.team_b).replace(/"/g,'&quot;')})">${esc(m.team_b)} 胜</button>
  `
}
  ${!m.predictions_voided_at&&m.status!=='settled'&&!m.winner?`
    <button class="mini-btn" onclick="changeLifecycle(${m.id},'cancel')">取消并退本金</button>
    ${m.status==='postponed'?`
      <button class="mini-btn" onclick="changeLifecycle(${m.id},'refund-postponed')">延期退本金</button>
      ${m.source==='manual'?`<button class="mini-btn" onclick="resumeMatch(${m.id})">设置新时间并恢复</button>`:''}
    `:m.status!=='canceled'?`<button class="mini-btn" onclick="changeLifecycle(${m.id},'postpone')">延期保留下注</button>`:''}
  `:''}
  ${[3,5].includes(Number(m.number_of_games))?`<button class="mini-btn" onclick="manageMaps(${m.id})">地图数${m.actual_map_count==null?' · 待确认':' · '+Number(m.actual_map_count)+' 张'}</button>`:''}
  ${m.source==='manual' && m.status!=='settled'
    ? `<button class="mini-btn" onclick="deleteManualMatch(${m.id})">删除</button>`
    : ''}
</div></td></tr>`).join('');
}
function renderUsers(rows){
  $('usersBody').innerHTML=rows.map(u=>`<tr>
    <td>${u.id}</td>
    <td>${esc(u.username)}</td>
    <td>${esc(u.role)}</td>

    <td>
      <div>可用：<strong>${Number(u.points||0)}</strong></div>
      <div>冻结：${Number(u.locked_points||0)}</div>

      ${u.role!=='admin'?`
        <div style="display:flex;gap:6px;margin-top:8px;">
          <input
            id="grantPoints-${u.id}"
            type="number"
            min="1"
            step="1"
            placeholder="积分"
            style="width:90px;"
          >
          <button
            class="mini-btn"
            onclick="grantPoints(${u.id})"
          >发放</button>
        </div>
      `:''}
    </td>

    <td>${u.predictions}</td>
    <td>${new Date(u.created_at).toLocaleString('zh-CN')}</td>
  </tr>`).join('');
}
window.manageMaps=function(id){
  const m=adminMatches.find(x=>Number(x.id)===Number(id));
  if(!m)return;
  document.getElementById('mapMarketDialog')?.remove();
  const options=Number(m.number_of_games)===3?[2,3]:[3,4,5];
  const editable=m.status==='open'&&!m.winner&&new Date(m.starts_at).getTime()>Date.now()+600000;
  const dialog=document.createElement('dialog');
  dialog.id='mapMarketDialog';
  dialog.setAttribute('aria-label','总地图数管理');
  dialog.style.cssText='width:min(480px,90vw);max-height:85vh;overflow:auto;background:#152033;color:#fff;border:1px solid #53647b;border-radius:12px;padding:24px';
  dialog.innerHTML=`<form id="mapMarketForm">
    <h2>总地图数 · BO${Number(m.number_of_games)}</h2>
    <p>${esc(m.team_a)} vs ${esc(m.team_b)}</p>
    <p>已有下注保留原赔率；留空可关闭对应选项。</p>
    ${options.map(n=>`<label style="display:block;margin:12px 0">${n} 张赔率
      <input name="odds${n}" type="number" min="1" max="100" step="0.0001"
        value="${m['map_odds_'+n]==null?'':Number(m['map_odds_'+n])}" ${editable?'':'disabled'}>
    </label>`).join('')}
    ${editable?'<button class="btn" type="submit">保存赔率</button>':'<p>已锁盘，赔率不可修改。</p>'}
    <hr><p>实际地图数：${m.actual_map_count==null?'待确认':Number(m.actual_map_count)+' 张'}</p>
    ${m.maps_manual_review?'<p>结算已撤销，请人工核查后重新确认。</p>':''}
    ${m.status==='settled'&&m.winner&&m.actual_map_count==null?`
      <p>请核实实际打完的地图数。缺数据或弃赛时不要猜测。</p>
      <label>实际地图数 <select id="actualMapCount"><option value="">请选择</option>${options.map(n=>`<option value="${n}">${n} 张</option>`).join('')}</select></label>
      <button type="button" class="btn" id="settleMapsBtn">确认并结算地图积分</button>
    `:''}
    ${m.actual_map_count!=null?'<button type="button" class="btn" id="undoMapsBtn">撤销地图数结算</button>':''}
    <p id="mapMarketMessage" role="status"></p>
    <button type="button" class="btn btn-secondary" id="closeMapsBtn">关闭</button>
  </form>`;
  document.body.appendChild(dialog);dialog.showModal();
  $('closeMapsBtn').onclick=()=>{dialog.close();dialog.remove()};
  const perform=async(action,body)=>{
    const buttons=[...dialog.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
    try{
      const data=await api(`/admin/matches/${id}/${action}`,{method:'POST',body:JSON.stringify(body||{})});
      await refreshAll();dialog.close();dialog.remove();toast(data.message);
    }catch(e){$('mapMarketMessage').textContent=e.message;buttons.forEach(b=>b.disabled=false)}
  };
  $('mapMarketForm').onsubmit=e=>{
    e.preventDefault();
    const odds=Object.fromEntries(options.map(n=>[n,dialog.querySelector(`[name="odds${n}"]`).value||null]));
    perform('map-odds',{odds});
  };
  if($('settleMapsBtn'))$('settleMapsBtn').onclick=()=>{
    const mapCount=Number($('actualMapCount').value);
    if(!options.includes(mapCount))return $('mapMarketMessage').textContent='请先选择实际地图数';
    if(confirm(`已核实本场实际打了 ${mapCount} 张地图？确认后将结算地图预测积分。`))perform('map-result',{mapCount});
  };
  if($('undoMapsBtn'))$('undoMapsBtn').onclick=()=>{
    if(confirm('确认收回已返还的地图预测积分，并恢复冻结？胜负结算保持不变。'))perform('map-unsettle');
  };
};
window.changeLifecycle=async(id,action)=>{
  const m=adminMatches.find(x=>Number(x.id)===Number(id));if(!m)return;
  const description=action==='postpone'
    ? '暂停预测，保留两类下注和冻结积分'
    : '退还两类预测的未结算本金，并永久关闭本场预测（不计输赢）';
  if(!confirm(`${m.team_a} vs ${m.team_b}：确认${description}？`))return;
  try{const r=await api(`/admin/matches/${id}/${action}`,{method:'POST'});await refreshAll();toast(r.message)}catch(e){toast(e.message)}
};
window.resumeMatch=id=>{
  document.getElementById('resumeMatchDialog')?.remove();
  const dialog=document.createElement('dialog');dialog.id='resumeMatchDialog';dialog.setAttribute('aria-label','恢复延期比赛');
  dialog.style.cssText='background:#152033;color:#fff;padding:24px;border-radius:12px;max-width:90vw';
  dialog.innerHTML='<form><h2>恢复延期比赛</h2><label>新开赛时间 <input name="startsAt" type="datetime-local" required></label><p>原下注及锁定赔率保留。</p><button type="submit">确认恢复</button> <button type="button">关闭</button><p role="status"></p></form>';
  document.body.appendChild(dialog);dialog.showModal();
  dialog.querySelector('[type="button"]').onclick=()=>dialog.remove();
  dialog.querySelector('form').onsubmit=async e=>{
    e.preventDefault();const button=dialog.querySelector('[type="submit"]');button.disabled=true;
    try{const startsAt=new Date(dialog.querySelector('input').value).toISOString();const r=await api(`/admin/matches/${id}/resume`,{method:'POST',body:JSON.stringify({startsAt})});await refreshAll();dialog.remove();toast(r.message)}
    catch(err){dialog.querySelector('[role="status"]').textContent=err.message;button.disabled=false}
  };
};
window.grantPoints=async function(userId){
  const input=$(`grantPoints-${userId}`);
  const amount=Number(input?.value);

  if(!Number.isInteger(amount)||amount<=0){
    toast('请输入大于0的整数积分');
    return;
  }

  if(!confirm(`确认给该用户发放 ${amount} 积分？`)){
    return;
  }

  try{
    const data=await api(`/admin/users/${userId}/points`,{
      method:'POST',
      body:JSON.stringify({amount})
    });

    toast(data.message||'积分发放成功');
    await refreshAll();
  }catch(e){
    toast(e.message||'积分发放失败');
  }
};
window.settle=async(id,winner)=>{
   if(!confirm(`确认 ${winner} 获胜并结算积分？`))return;
 
  try{
    await api(`/admin/matches/${id}/result`,
              {method:'POST',
               body:JSON.stringify({winner})
              });
    toast('结算完成');
    await refreshAll()}
  catch(e){
    toast(e.message)}
};
window.unsettle=async function(id){
  if(!confirm('确认撤销这场比赛的结算，并恢复相关预测为待结算吗？')){
    return;
  }

  try{
    const data=await api(`/admin/matches/${id}/unsettle`,{
      method:'POST'
    });

    toast(data.message||'已撤销结算');
    await refreshAll();
  }catch(e){
    toast(e.message||'撤销结算失败');
  }
};
window.deleteManualMatch=async(id)=>{
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
