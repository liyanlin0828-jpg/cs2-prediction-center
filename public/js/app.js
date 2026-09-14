const state={token:localStorage.getItem('cs2_token'),me:null,matches:[],leaderboard:[],mode:'login',matchFilter:'all'};
const $=id=>document.getElementById(id);
const api=async(path,options={})=>{
  const headers={'Content-Type':'application/json',...(options.headers||{})};
  if(state.token)headers.Authorization=`Bearer ${state.token}`;
  const res=await fetch(`/api${path}`,{...options,headers});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.message||'请求失败');
  return data;
};
function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2800)}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function attr(s){return escapeHtml(s).replace(/`/g,'&#096;')}
function logo(url,name){
  return url?`<img class="team-logo" src="${attr(url)}" alt="${attr(name)}" loading="lazy">`
    :`<div class="team-logo placeholder">${escapeHtml((name||'?').slice(0,2).toUpperCase())}</div>`;
}
function countdown(iso){
  const d=new Date(iso).getTime()-Date.now();
  if(d<=0)return '比赛已开始';
  const h=Math.floor(d/3600000),m=Math.floor((d%3600000)/60000);
  if(h>=24)return `${Math.floor(h/24)}天 ${h%24}小时`;
  return `${h}小时 ${m}分`;
}
function openAuth(mode='login'){
  state.mode=mode;$('authTitle').textContent=mode==='login'?'登录':'注册';
  $('authSubmit').textContent=mode==='login'?'登录':'注册';
  $('toggleAuth').textContent=mode==='login'?'没有账号？注册':'已有账号？登录';
  $('authModal').classList.remove('hidden');
}
function closeAuth(){$('authModal').classList.add('hidden')}
async function loadAll(){
  const [matches,leaderboard]=await Promise.all([api('/matches'),api('/leaderboard')]);
  state.matches=matches.matches;state.leaderboard=leaderboard.users;
  if(state.token){try{state.me=(await api('/auth/me')).user}catch{logout(false)}}
  renderMatches();renderLeaderboard();renderUser();
  const detail=$('matchDetail');
if(detail&&!detail.classList.contains('hidden')&&detail.dataset.matchId){
  openMatchDetail(detail.dataset.matchId,true);
}
  if(state.me)await renderProfile();else $('profileCard').innerHTML='<div class="empty">请登录后查看。</div>';
}
function renderUser(){
  $('loginBtn').classList.toggle('hidden',!!state.me);
  $('logoutBtn').classList.toggle('hidden',!state.me);
  $('heroPoints').textContent=state.me?state.me.points:'0';
  $('adminLink').classList.toggle('hidden',!(state.me&&state.me.role==='admin'));
}
function isPredictionLocked(iso){
  return new Date(iso).getTime()-Date.now()<=10*60*1000;
}
function renderMatches(){
  const grid=$('matchesGrid');
  const upcomingMatches=state.matches.filter(
  m=>new Date(m.starts_at).getTime()>Date.now()
);
const searchTerm=($('matchSearch')?.value||'').trim().toLowerCase();

const searchedMatches=upcomingMatches.filter(m=>{
  if(!searchTerm)return true;

  const text=`${m.event_name||''} ${m.team_a||''} ${m.team_b||''}`.toLowerCase();
  return text.includes(searchTerm);
});
const predictedCount=searchedMatches.filter(m=>!!m.user_prediction).length;
const pendingCount=searchedMatches.length-predictedCount;

const allBtn=document.querySelector('.match-filter[data-filter="all"]');
const pendingBtn=document.querySelector('.match-filter[data-filter="pending"]');
const predictedBtn=document.querySelector('.match-filter[data-filter="predicted"]');

if(allBtn)allBtn.textContent=`全部 ${searchedMatches.length}`;
if(pendingBtn)pendingBtn.textContent=`未预测 ${pendingCount}`;
if(predictedBtn)predictedBtn.textContent=`已预测 ${predictedCount}`;

const visibleMatches=searchedMatches.filter(m=>{
  if(state.matchFilter==='pending')return !m.user_prediction;
  if(state.matchFilter==='predicted')return !!m.user_prediction;
  return true;
});
  if(!visibleMatches.length){
  const emptyText=
    state.matchFilter==='pending'
      ? '暂无未预测比赛'
      : state.matchFilter==='predicted'
        ? '暂无已预测比赛'
        : '暂无未来比赛';

  grid.innerHTML=`<div class="empty">${emptyText}</div>`;
  return;
}
  grid.innerHTML=visibleMatches.map(m=>{
    const source=m.source==='pandascore'?'PandaScore':'手动赛事';
    const sourceClass=m.source==='pandascore'?'':' manual';
    const locked=isPredictionLocked(m.starts_at);
    const predictionDisabled=locked||!!m.user_prediction;
    const timeToStart=new Date(m.starts_at).getTime()-Date.now();
    const countdownClass=locked?'locked':timeToStart<=30*60*1000?'soon':'';

const matchStatus=m.user_prediction
  ? 'predicted'
  : locked
    ? 'locked'
    : timeToStart<=30*60*1000
      ? 'soon'
      : '';
    return `<article class="match-card">
      <div class="match-title-row">
        <span class="live-source${sourceClass}">${source}</span>
        ${matchStatus?`<span class="match-status ${matchStatus}">${matchStatus==='predicted'?'✓ 已预测':matchStatus==='locked'?'🔒 已锁盘':'⏳ 即将锁盘'}</span>`:''}
        <span class="countdown ${countdownClass}">${countdown(m.starts_at)}</span>
      </div>
      <div class="match-meta">
        <span>${escapeHtml(m.event_name)}</span>
        <span>${new Date(m.starts_at).toLocaleString('zh-CN')}</span>
      </div>
      <div class="teams">
        <button class="team ${m.user_prediction===m.team_a?'selected':''} ${locked?'locked':''}" ${predictionDisabled?'disabled':''} onclick="predict(${m.id},${JSON.stringify(m.team_a).replace(/"/g,'&quot;')})">
          ${logo(m.team_a_logo,m.team_a)}
          <strong>${escapeHtml(m.team_a)}</strong><span>${m.odds_a}</span>
        </button>
        <div class="vs">VS${m.number_of_games?`<div class="match-format">BO${Number(m.number_of_games)}</div>`:(m.match_type?`<div class="match-format">${escapeHtml(m.match_type)}</div>`:'')}</div>
       <button class="team ${m.user_prediction===m.team_b?'selected':''} ${locked?'locked':''}" ${predictionDisabled?'disabled':''} onclick="predict(${m.id},${JSON.stringify(m.team_b).replace(/"/g,'&quot;')})">
          ${logo(m.team_b_logo,m.team_b)}
          <strong>${escapeHtml(m.team_b)}</strong><span>${m.odds_b}</span>
        </button>
      </div>
      <div class="match-footer">
  <span>猜中奖励：+50</span>
 <span>${m.user_prediction?'已预测：'+escapeHtml(m.user_prediction):(locked?'🔒 已锁盘':'尚未预测')}</span>
  <button class="match-detail-btn" onclick="event.stopPropagation();openMatchDetail(${m.id})">查看详情 →</button>
</div>
    </article>`;
  }).join('');
  }

function openMatchDetail(matchId,autoRefresh=false){
  const m=state.matches.find(x=>Number(x.id)===Number(matchId));
  if(!m){
    toast('找不到比赛');
    return;
  }

  const detail=$('matchDetail');
  const card=$('matchDetailCard');
  const matches=$('matches');
  const locked=isPredictionLocked(m.starts_at);
  const predictionDisabled=locked||!!m.user_prediction;
  const timeToStart=new Date(m.starts_at).getTime()-Date.now();
const countdownClass=locked?'locked':timeToStart<=30*60*1000?'soon':'';
  card.innerHTML=`
    <div class="match-detail-header">
      <span class="live-source ${m.source==='pandascore'?'pandascore':'manual'}">
        ${m.source==='pandascore'?'PandaScore':'手动赛事'}
      </span>
      ${m.user_prediction
  ? '<span class="match-status predicted">✓ 已预测</span>'
  : locked
    ? '<span class="match-status locked">🔒 已锁盘</span>'
    : timeToStart<=30*60*1000
      ? '<span class="match-status soon">⏳ 即将锁盘</span>'
      : ''}
      <span class="countdown ${countdownClass}">${countdown(m.starts_at)}</span>
    </div>

    <h2>${escapeHtml(m.event_name)}</h2>
    <p>${new Date(m.starts_at).toLocaleString('zh-CN')}</p>

    <div class="teams">
      <button class="team ${m.user_prediction===m.team_a?'selected':''} ${locked?'locked':''}"
  ${predictionDisabled?'disabled':''}
  onclick="predict(${m.id},${JSON.stringify(m.team_a).replace(/"/g,'&quot;')})">
        ${logo(m.team_a_logo,m.team_a)}
        <strong>${escapeHtml(m.team_a)}</strong>
        <span>${m.odds_a}</span>
      </button>

      <div class="vs">
        VS
        ${m.number_of_games
          ? `<div class="match-format">BO${Number(m.number_of_games)}</div>`
          : (m.match_type
              ? `<div class="match-format">${escapeHtml(m.match_type)}</div>`
              : '')
        }
      </div>

      <button class="team ${m.user_prediction===m.team_b?'selected':''} ${locked?'locked':''}"
  ${predictionDisabled?'disabled':''}
  onclick="predict(${m.id},${JSON.stringify(m.team_b).replace(/"/g,'&quot;')})">
        ${logo(m.team_b_logo,m.team_b)}
        <strong>${escapeHtml(m.team_b)}</strong>
        <span>${m.odds_b}</span>
      </button>
    </div>

    <div class="match-footer">
      <span>猜中奖励：+50</span>
      <span>${m.user_prediction
  ? '当前预测：'+escapeHtml(m.user_prediction)
  : (locked?'🔒 已锁盘':'尚未预测')
}</span>
    </div>
  `;

 detail.dataset.matchId=String(m.id);
matches.classList.add('hidden');
detail.classList.remove('hidden');

if(!autoRefresh){
  window.scrollTo({
    top:detail.offsetTop-80,
    behavior:'smooth'
  });
}
}

window.openMatchDetail=openMatchDetail;
$('backToMatchesBtn').onclick=()=>{
  $('matchDetail').classList.add('hidden');
  $('matches').classList.remove('hidden');
  $('matches').scrollIntoView({behavior:'smooth',block:'start'});
};
async function predict(matchId,team){
  if(!state.me){openAuth('login');toast('请先登录');return}
  if(!window.confirm(`确认预测 ${team} 吗？提交后不能修改。`))return;
  try{
    const data=await api('/predictions',{method:'POST',body:JSON.stringify({matchId,team})});
   state.me=data.user;toast(data.message||'预测成功');await loadAll();
if(!$('matchDetail').classList.contains('hidden'))openMatchDetail(matchId);
  }catch(e){toast(e.message)}
}
window.predict=predict;
function renderLeaderboard(){
  $('leaderboardBody').innerHTML=state.leaderboard.map((u,i)=>`
    <tr><td>${i+1}</td><td><strong>${escapeHtml(u.username)}</strong></td>
    <td>${u.points}</td><td>${u.win_rate}%</td><td>${u.predictions}</td></tr>`).join('');
}
async function renderProfile(){
  const {predictions}=await api('/predictions/me');
  $('profileHint').textContent=`${state.me.username} · ${state.me.points} 积分`;
  $('profileCard').innerHTML=`
    <div class="profile-top"><div><h3>${escapeHtml(state.me.username)}</h3>
    <p>积分 ${state.me.points} · ${state.me.win_rate}% 胜率</p></div>
    <div class="profile-badge">${state.me.role==='admin'?'管理员':'玩家'}</div></div>
    <div class="history">
  <div class="history-head"><span>比赛</span><span>预测详情</span><span>结果</span></div>
  ${predictions.length?predictions.map(p=>`
      <div class="history-row"><span>${escapeHtml(p.team_a)} vs ${escapeHtml(p.team_b)}</span>
     <span>预测：${escapeHtml(p.predicted_team)}${p.winner?' · 获胜：'+escapeHtml(p.winner):''}${p.created_at?' · 预测时间：'+new Date(p.created_at).toLocaleString('zh-CN'):''}</span>
<span class="prediction-status ${p.result==='win'?'win':p.result==='loss'?'loss':'pending'}">${p.result==='win'
  ? '✅ 猜中 +'+Number(p.points_delta||0)+' 积分'
  : p.result==='loss'
    ? '❌ 猜错 +'+Number(p.points_delta||0)+' 积分'
    : '⏳ 待结算'
}</span></div>
`).join('')
      :'<div class="empty">还没有预测记录。</div>'}</div>`;
}
$('loginBtn').onclick=()=>openAuth('login');
$('logoutBtn').onclick=()=>logout(true);
$('closeModal').onclick=closeAuth;
$('authModal').onclick=e=>{if(e.target===$('authModal'))closeAuth()};
$('toggleAuth').onclick=()=>openAuth(state.mode==='login'?'register':'login');
$('authForm').onsubmit=async e=>{
  e.preventDefault();
  try{
    const data=await api(state.mode==='login'?'/auth/login':'/auth/register',{
      method:'POST',body:JSON.stringify({username:$('username').value.trim(),password:$('password').value})
    });
    state.token=data.token;localStorage.setItem('cs2_token',state.token);
    closeAuth();toast(data.message||'操作成功');await loadAll();
  }catch(err){toast(err.message)}
};
function logout(show=true){
  state.token=null;state.me=null;localStorage.removeItem('cs2_token');
  renderUser();$('profileCard').innerHTML='<div class="empty">请登录后查看。</div>';
  if(show)toast('已退出登录');
}
document.querySelectorAll('.match-filter').forEach(btn=>{
  btn.onclick=()=>{
    state.matchFilter=btn.dataset.filter||'all';

    document.querySelectorAll('.match-filter').forEach(x=>{
      x.classList.toggle('active',x===btn);
    });

    renderMatches();
  };
});
const matchSearch=$('matchSearch');
if(matchSearch){
  matchSearch.addEventListener('input',()=>{
    renderMatches();
  });
}
window.addEventListener('load',async()=>{
  try{await loadAll();setInterval(async()=>{
  try{
    await loadAll();
  }catch(e){
    console.error('[AutoRefresh]',e.message);
  }
},60000)}catch(e){toast(e.message)}
});
