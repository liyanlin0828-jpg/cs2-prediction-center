const state={token:localStorage.getItem('cs2_token'),me:null,matches:[],leaderboard:[],results:[],mapPredictions:[],mapSelections:[],resultsExpanded:false,mode:'login',matchFilter:'all',historyFilter:'all',historySort:'desc',historySearch:'',historyPage:1,
historyPageSize:10,lang:localStorage.getItem('cs2_lang')||'zh',};
const $=id=>document.getElementById(id);
const api=async(path,options={})=>{
  const headers={'Content-Type':'application/json',...(options.headers||{})};
  if(state.token)headers.Authorization=`Bearer ${state.token}`;
  const res=await fetch(`/api${path}`,{...options,headers});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Object.assign(new Error(data.message||'请求失败'),{status:res.status});
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
  const isZh=state.lang==='zh';

  if(d<=0)return isZh?'比赛已开始':'Match Started';

  const h=Math.floor(d/3600000);
  const m=Math.floor((d%3600000)/60000);

  if(h>=24){
    const days=Math.floor(h/24);
    const hours=h%24;

    return isZh
      ? `${days}天 ${hours}小时`
      : `${days}d ${hours}h`;
  }

  return isZh
    ? `${h}小时 ${m}分`
    : `${h}h ${m}m`;
}
function openAuth(mode='login'){
  state.mode=mode;$('authTitle').textContent=mode==='login'?'登录':'注册';
  $('authSubmit').textContent=mode==='login'?'登录':'注册';
  $('toggleAuth').textContent=mode==='login'?'没有账号？注册':'已有账号？登录';
  $('authModal').classList.remove('hidden');
}
function closeAuth(){$('authModal').classList.add('hidden')}
async function loadAll(){
  const requestedSort=$('matchSort')?.value||'popular';
  const [matches,leaderboard,results]=await Promise.all([
  api('/matches?sort='+encodeURIComponent(requestedSort)),
  api('/leaderboard'),
  api('/results')
]);
  if(requestedSort!==($('matchSort')?.value||'popular'))return loadAll();
  state.matches=matches.matches;
state.leaderboard=leaderboard.users;
state.results=results.results||[];
  if(state.token){
  try{
    state.me=(await api('/auth/me')).user;

    const mapData=await api('/map-predictions/me');
    state.mapPredictions=mapData.mapPredictions||[];
    state.mapSelections=(await api('/map-selection-predictions/me')).predictions||[];
  }catch{
    state.mapPredictions=[];state.mapSelections=[];
    logout(false);
  }
}else{
  state.mapPredictions=[];state.mapSelections=[];
}
  renderMatches();renderResults();renderLeaderboard();renderUser();
  const detail=$('matchDetail');
if(detail&&!detail.classList.contains('hidden')&&detail.dataset.matchId){
  openMatchDetail(detail.dataset.matchId,true);
}
  if(state.me)await renderProfile();else $('profileCard').innerHTML='<div class="empty">请登录后查看。</div>';
}
function renderUser(){
  $('loginBtn').classList.toggle('hidden',!!state.me);
  $('logoutBtn').hidden=!state.me;
  $('heroPoints').textContent=state.me?state.me.points:'0';
  $('adminLink').classList.toggle('hidden',!(state.me&&state.me.role==='admin'));
}
function renderResults(){
  const grid=$('resultsGrid');
  if(!grid)return;

  grid.classList.add('match-grid');

  if(!state.results.length){
    grid.innerHTML='<div class="empty">暂无已结算比赛</div>';
    return;
  }

  const visibleResults=state.resultsExpanded
  ? state.results
  : state.results.slice(0,6);

grid.innerHTML=visibleResults.map(m=>{
    const source=m.source==='pandascore'?'PandaScore':'手动赛事';
    const sourceClass=m.source==='pandascore'?'':' manual';
    const teamAWin=m.winner===m.team_a;
    const teamBWin=m.winner===m.team_b;

    return `<article class="match-card">
      <div class="match-title-row">
        <span class="live-source${sourceClass}">${source}</span>
        <span class="countdown">✅ 已结束</span>
      </div>

      <div class="match-meta">
        <span>${escapeHtml(m.event_name||'CS2 比赛')}</span>
        <span>${new Date(m.starts_at).toLocaleString('zh-CN')}</span>
      </div>

      <div class="teams">
        <div class="team ${teamAWin?'selected':''}">
          ${logo(m.team_a_logo,m.team_a)}
          <strong>${escapeHtml(m.team_a)}</strong>
          
        </div>

        <div class="vs">
  ${
    Number.isFinite(Number(m.score_a)) &&
Number.isFinite(Number(m.score_b)) &&
m.score_a !== null &&
m.score_b !== null &&
(Number(m.score_a)>0 || Number(m.score_b)>0)
  ? `
    <div class="result-score">
      <span class="${Number(m.score_a)>Number(m.score_b)?'score-winner':'score-loser'}">
        ${Number(m.score_a)}
      </span>
      <span class="score-colon">:</span>
      <span class="${Number(m.score_b)>Number(m.score_a)?'score-winner':'score-loser'}">
        ${Number(m.score_b)}
      </span>
    </div>
  `
  : 'VS'
  }
  ${
    m.number_of_games
      ? `<div class="match-format">BO${Number(m.number_of_games)}</div>`
      : ''
  }
</div>

        <div class="team ${teamBWin?'selected':''}">
          ${logo(m.team_b_logo,m.team_b)}
          <strong>${escapeHtml(m.team_b)}</strong>
          
        </div>
      </div>

      <div class="match-footer">
        <span>🏆 胜者：${escapeHtml(m.winner)}</span>
        ${matchActions(m)}
      </div>
    </article>`;
}).join('');

if(state.results.length>6){
  grid.insertAdjacentHTML('beforeend',`
    <div class="results-more">
      <button type="button" class="btn btn-secondary" id="resultsToggleBtn">
        ${state.resultsExpanded
          ? '收起赛果 ↑'
          : `查看更多赛果（还有 ${state.results.length-6} 场）↓`
        }
      </button>
    </div>
  `);

  const toggleBtn=$('resultsToggleBtn');
  if(toggleBtn){
    toggleBtn.onclick=()=>{
      state.resultsExpanded=!state.resultsExpanded;
      renderResults();

      if(!state.resultsExpanded){
        $('results').scrollIntoView({
          behavior:'smooth',
          block:'start'
        });
      }
    };
  }
}
}
function isPredictionLocked(iso){
  return new Date(iso).getTime()-Date.now()<=10*60*1000;
}
function isLiveMatch(m){
  return m.status==='running'&&!m.winner&&!m.predictions_voided_at;
}
function isActiveMatch(m,now=Date.now()){
  if(m.winner||m.predictions_voided_at)return false;
  return isLiveMatch(m)||m.status==='postponed'||(m.status==='open'&&Date.parse(m.starts_at)>now);
}
function matchesFilter(m,filter,now=Date.now()){
  if(filter==='finished')return m.status==='settled'&&!!m.winner;
  if(!isActiveMatch(m,now))return false;
  if(filter==='live')return isLiveMatch(m);
  if(filter==='all')return true;
  if(m.status==='postponed')return false; // Its old schedule is not a confirmed new date.
  const start=Date.parse(m.starts_at),day=new Date(now);day.setHours(0,0,0,0);
  if(filter==='tomorrow')day.setDate(day.getDate()+1);
  const end=new Date(day);end.setDate(end.getDate()+1);
  return start>=day.getTime()&&start<end.getTime();
}
function matchTimeLabel(m){
  if(m.predictions_voided_at)return state.lang==='zh'?'已退本金 · 预测关闭':'Refunded · Closed';
  if(m.status==='postponed')return state.lang==='zh'?'已延期 · 暂停预测':'Postponed';
  if(m.status==='canceled')return state.lang==='zh'?'已取消':'Canceled';
  if(m.status==='settled'||m.winner)return state.lang==='zh'?'比赛已结束':'Finished';
  if(isLiveMatch(m))return state.lang==='zh'?'🔴 进行中':'🔴 Live';
  if(Date.parse(m.starts_at)<=Date.now())return state.lang==='zh'?'等待开赛确认':'Awaiting start confirmation';
  return countdown(m.starts_at);
}
function renderMatches(){
  const grid=$('matchesGrid');
  const now=Date.now();

const baseMatches=(state.matchFilter==='finished'?state.results:state.matches)
  .filter(m=>matchesFilter(m,state.matchFilter,now));

const searchTerm=($('matchSearch')?.value||'').trim().toLowerCase();

const searchedMatches=baseMatches.filter(m=>{
  if(!searchTerm)return true;

  const text=`${m.event_name||''} ${m.team_a||''} ${m.team_b||''}`.toLowerCase();
  return text.includes(searchTerm);
});
const counts=Object.fromEntries(['all','today','tomorrow','live','finished'].map(key=>
  [key,(key==='finished'?state.results:state.matches).filter(m=>matchesFilter(m,key,now)).length]));

document.querySelectorAll('.match-filter[data-filter]').forEach(btn=>{
  const key=btn.dataset.filter;
  const labels={
    all:state.lang==='zh'?'全部':'All',
    today:state.lang==='zh'?'今日':'Today',
    tomorrow:state.lang==='zh'?'明日':'Tomorrow',
    live:'Live',
    finished:state.lang==='zh'?'已结束':'Finished'
  };

  btn.textContent=`${labels[key]} ${counts[key]??0}`;
});

const visibleMatches=searchedMatches;
  const sortDirection=$('matchSort')?.value||'popular';

const sortedMatches=[...visibleMatches].sort((a,b)=>{
  const timeA=new Date(a.starts_at).getTime();
  const timeB=new Date(b.starts_at).getTime();

  if(sortDirection==='popular'){
    const held=Number(a.status==='postponed')-Number(b.status==='postponed');
    return held||(Number(b.popularity_score)||0)-(Number(a.popularity_score)||0)||timeA-timeB||Number(a.id)-Number(b.id);
  }

  return sortDirection==='desc'
    ? timeB-timeA
    : timeA-timeB;
});
  if(!visibleMatches.length){
  const emptyMessages={
    all: state.lang==='zh'?'暂无比赛':'No matches',
    today: state.lang==='zh'?'今日暂无比赛':'No matches today',
    tomorrow: state.lang==='zh'?'明日暂无比赛':'No matches tomorrow',
    live: state.lang==='zh'?'当前暂无进行中的比赛':'No live matches',
    finished: state.lang==='zh'?'暂无已结束比赛':'No finished matches'
  };

  const emptyText=emptyMessages[state.matchFilter] || emptyMessages.all;

  grid.innerHTML=`<div class="empty">${emptyText}</div>`;
  return;
}
  grid.innerHTML=sortedMatches.map(m=>{
    const source=m.source==='pandascore'?'PandaScore':'手动赛事';
    const sourceClass=m.source==='pandascore'?'':' manual';
   if(state.matchFilter==='finished'){
  const teamAWin=m.winner===m.team_a;
  const teamBWin=m.winner===m.team_b;

  const hasScore=
    Number.isFinite(Number(m.score_a)) &&
    Number.isFinite(Number(m.score_b)) &&
    m.score_a!==null &&
    m.score_b!==null &&
    (Number(m.score_a)>0 || Number(m.score_b)>0);

  return `<article class="match-card">
    <div class="match-title-row">
      <span class="live-source ${sourceClass}">${source}</span>
      <span class="match-status">✅ 已结束</span>
    </div>

    <div class="match-meta">
      <span>${escapeHtml(m.event_name||'')}</span>
      <span>${new Date(m.starts_at).toLocaleString('zh-CN')}</span>
    </div>

    <div class="teams">
      <div class="team ${teamAWin?'selected':''}">
        ${logo(m.team_a_logo,m.team_a)}
        <strong>${escapeHtml(m.team_a)}</strong>
      </div>

      <div class="vs">
        ${
          hasScore
            ? `<div class="result-score">
                <span class="${Number(m.score_a)>Number(m.score_b)?'score-winner':'score-loser'}">
                  ${Number(m.score_a)}
                </span>
                <span class="score-colon">:</span>
                <span class="${Number(m.score_b)>Number(m.score_a)?'score-winner':'score-loser'}">
                  ${Number(m.score_b)}
                </span>
              </div>`
            : 'VS'
        }

        ${
          m.number_of_games
            ? `<div class="match-format">BO${Number(m.number_of_games)}</div>`
            : ''
        }
      </div>

      <div class="team ${teamBWin?'selected':''}">
        ${logo(m.team_b_logo,m.team_b)}
        <strong>${escapeHtml(m.team_b)}</strong>
      </div>
    </div>

    <div class="match-footer">
      <span>🏆 胜者：${escapeHtml(m.winner||'待确认')}</span>
      ${matchActions(m)}
    </div>
  </article>`;
} 
    const locked=m.status!=='open'||!!m.predictions_voided_at||isPredictionLocked(m.starts_at);
    const predictionDisabled=locked;
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
        <span class="countdown ${countdownClass}">${matchTimeLabel(m)}</span>
      </div>
      <div class="match-meta">
        <span>${escapeHtml(m.event_name)}</span>
        <span>${new Date(m.starts_at).toLocaleString('zh-CN')}</span>
      </div>
      <div class="teams">
        <button class="team ${m.user_prediction===m.team_a?'selected':''} ${locked?'locked':''}" ${predictionDisabled?'disabled':''} onclick="predict(${m.id},${JSON.stringify(m.team_a).replace(/"/g,'&quot;')})">
          ${logo(m.team_a_logo,m.team_a)}
          <strong>${escapeHtml(m.team_a)}</strong>
<span>${m.source==='pandascore'?'—':m.odds_a}</span>
        </button>
        <div class="vs">VS${m.number_of_games?`<div class="match-format">BO${Number(m.number_of_games)}</div>`:(m.match_type?`<div class="match-format">${escapeHtml(m.match_type)}</div>`:'')}</div>
       <button class="team ${m.user_prediction===m.team_b?'selected':''} ${locked?'locked':''}" ${predictionDisabled?'disabled':''} onclick="predict(${m.id},${JSON.stringify(m.team_b).replace(/"/g,'&quot;')})">
          ${logo(m.team_b_logo,m.team_b)}
          <strong>${escapeHtml(m.team_b)}</strong>
<span>${m.source==='pandascore'?'—':m.odds_b}</span>
        </button>
      </div>
      <div class="match-footer">
<span>${m.predictions_voided_at?'本金已退还 · 不计输赢':m.status==='postponed'?'暂停预测 · 原下注保留':state.lang==='zh'?'按锁定赔率结算':'Settled at locked odds'}</span>

<span>${
  m.user_prediction
    ? (state.lang==='zh'?'最近下注：':'Predicted: ') + escapeHtml(m.user_prediction)
    : locked
      ? (state.lang==='zh'?'🔒 已锁盘':'🔒 Locked')
      : (state.lang==='zh'?'尚未预测':'Not Predicted')
}</span>

${matchActions(m)}
</div>
    </article>`;
  }).join('');
  }

function matchActions(m){
  const zh=state.lang==='zh',finished=m.status==='settled'||!!m.winner;
  const locked=finished||m.status!=='open'||!!m.predictions_voided_at||isPredictionLocked(m.starts_at);
  const label=finished?(zh?'已结束':'Finished'):locked?(zh?'已锁盘':'Locked'):(zh?'下注':'Place prediction');
  return `<div class="match-actions"><button type="button" class="match-detail-btn" onclick="event.stopPropagation();openMatchDetail(${Number(m.id)})">${zh?'查看详情 →':'View Details →'}</button><button type="button" class="match-bet-btn" ${locked?'disabled':''} onclick="event.stopPropagation();openMatchBet(${Number(m.id)})">${label}</button></div>`;
}
function openMatchBet(matchId){
  const m=state.matches.find(x=>Number(x.id)===Number(matchId));
  if(!m||m.status!=='open'||m.winner||m.predictions_voided_at||isPredictionLocked(m.starts_at)){toast(state.lang==='zh'?'该比赛已停止下注':'Predictions are closed for this match');return}
  openMatchDetail(matchId,true);
  const target=$('stakePointsInput');
  if(target){target.focus({preventScroll:true});target.scrollIntoView({behavior:'smooth',block:'center'})}
}
window.openMatchBet=openMatchBet;
function openMatchDetail(matchId,autoRefresh=false){
  const m=
  state.matches.find(x=>Number(x.id)===Number(matchId)) ||
  state.results.find(x=>Number(x.id)===Number(matchId));
  const mapPrediction=state.mapPredictions.find(
  p=>Number(p.match_id)===Number(matchId)
);
  if(!m){
    toast('找不到比赛');
    return;
  }

  const detail=$('matchDetail');
  const card=$('matchDetailCard');
  const matches=$('matches');
  const locked=m.status!=='open'||!!m.winner||!!m.predictions_voided_at||isPredictionLocked(m.starts_at);
  const predictionDisabled=locked;
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
      <span class="countdown ${countdownClass}">
  ${
    matchTimeLabel(m)
  }
</span>
    </div>

    <h2>${escapeHtml(m.event_name)}</h2>
    ${m.stage_name
  ? `<p class="match-stage">赛事阶段：${escapeHtml(m.stage_name)}</p>`
  : ''
}
${
  (m.status==='settled' || m.winner)
    ? `<p class="match-stage">比赛状态：已结束</p>`
    : m.status==='postponed'
      ? `<p class="match-stage">比赛已延期：${m.predictions_voided_at?'本金已退还，本场预测关闭':'原下注和冻结积分保留，等待新赛程'}</p>`
    : isLiveMatch(m)
      ? `<p class="match-stage">比赛状态：进行中</p>`
      : `<p class="match-stage">比赛状态：未开始</p>`
}
    <p>${new Date(m.starts_at).toLocaleString('zh-CN')}</p>

${!locked && m.status!=='settled' && !m.winner ? `
  <section class="winner-entry" aria-label="胜负预测">
    <h3>胜负预测</h3>
    <p class="prediction-entry-hint">${state.lang==='zh'?'先输入积分，再点击战队选择胜方。每次确认新增一笔下注，已有下注不可修改；明细见个人记录。仅使用娱乐积分。':'Enter your points, then select a team below. Entertainment points only.'}</p>
    <div class="winner-balance">
      可用积分：<strong>${Number(state.me?.points||0)}</strong>
    </div>

    <label>
      下注积分：
      <input
        id="stakePointsInput"
        type="number"
        min="1"
        step="1"
        placeholder="请输入下注积分"
        class="winner-stake-input"
      >
    </label>
  </section>
` : ''}

    <div class="teams">
  
      <button class="team ${m.user_prediction===m.team_a?'selected':''} ${locked?'locked':''}"
  ${predictionDisabled?'disabled':''}
  onclick="predict(${m.id},${JSON.stringify(m.team_a).replace(/"/g,'&quot;')})">
        ${logo(m.team_a_logo,m.team_a)}
        <strong>${escapeHtml(m.team_a)}</strong>
        <span>${m.source==='pandascore'?'—':m.odds_a}</span>
      </button>

    <div class="vs">
  ${
    Number.isFinite(Number(m.score_a)) &&
    Number.isFinite(Number(m.score_b)) &&
    m.score_a !== null &&
    m.score_b !== null &&
    (Number(m.score_a)>0 || Number(m.score_b)>0)
      ? `
        <div class="result-score">
          <span class="${Number(m.score_a)>Number(m.score_b)?'score-winner':'score-loser'}">
            ${Number(m.score_a)}
          </span>
          <span class="score-colon">:</span>
          <span class="${Number(m.score_b)>Number(m.score_a)?'score-winner':'score-loser'}">
            ${Number(m.score_b)}
          </span>
        </div>
      `
      : `
        <div>VS</div>
        ${
          m.winner
            ? `<div class="match-format">胜者：${escapeHtml(m.winner)}</div>`
            : ''
        }
      `
  }

  ${
    m.number_of_games
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
       <span>${m.source==='pandascore'?'—':m.odds_b}</span>
      </button>
    </div>
${renderMapSelection(m)}${renderMapMarket(m,mapPrediction)}
<div class="match-insight">
  <div>
    <span>我的预测</span>
    <strong>
      ${
        m.user_prediction
          ? escapeHtml(m.user_prediction)
          : '尚未预测'
      }
    </strong>
  </div>

  <div>
    <span>积分变化</span>
    <strong>
      ${
        (m.status==='settled' || m.winner) && m.user_prediction
          ? (
              m.user_result
                ? pointsLabel(m.user_points_delta)
                : '待结算'
            )
          : '—'
      }
    </strong>
  </div>
</div>

    <div class="match-footer">
      <span>
  ${
    (m.status==='settled' || m.winner)
      ? (state.lang==='zh'?'比赛已结束':'Match Finished')
      : (state.lang==='zh'?'按锁定赔率结算':'Settled at locked odds')
  }
</span>
     <span>
  ${
    (m.status==='settled' || m.winner)
      ? (state.lang==='zh'?'已结算':'Settled')
      : m.user_prediction
        ? (state.lang==='zh'?'最近一笔预测：':'Predicted: ') + escapeHtml(m.user_prediction)
        : (locked
          ? (state.lang==='zh'?'🔒 已锁盘':'🔒 Locked')
          : (state.lang==='zh'?'尚未预测':'Not Predicted')
        )
  }
</span>
    </div>
<section id="matchTeamProfiles" class="team-profiles-box"></section>
  `;

 detail.dataset.matchId=String(m.id);
window.TeamProfiles?.renderMatch(m.id,$('matchTeamProfiles'));
matches.classList.add('hidden');
detail.classList.remove('hidden');

if(!autoRefresh){
  const scrollOffset=window.innerWidth<=700?140:80;

  window.scrollTo({
    top:Math.max(0,detail.offsetTop-scrollOffset),
    behavior:'smooth'
  });
}
}

window.openMatchDetail=openMatchDetail;
function mapChoices(m){return Number(m.number_of_games)===3?[2,3]:Number(m.number_of_games)===5?[3,4,5]:[]}
function pointsLabel(n){return Number(n)>0?'+'+Number(n):String(Number(n)||0)}
function renderMapMarket(m,p){
  if(!p)return ''; // Historical map-count records only; no new map-count betting.
  const actual=m.actual_map_count??p?.actual_map_count;
  return `<div class="map-predict-box">
    <div class="map-predict-title">历史地图数预测 · BO${Number(m.number_of_games)}</div>
    <p>仅使用娱乐积分。猜中返还包含本金，按下注时锁定赔率向下取整；猜错扣除下注积分。</p>
    <p>已停止新增；此记录按原地图数规则结算。</p>
    ${p?`<p>我的预测：${Number(p.predicted_map_count)} 张 · 下注 ${Number(p.stake_points||0)} 积分
      ${Number(p.odds_at_prediction)>0?' · 锁定赔率 '+Number(p.odds_at_prediction):' · 历史无下注记录'}</p>
      <p>${p.result==='refunded'?'已退本金 '+Number(p.refund_points||0)+' 积分 · 不计输赢':p.result?(p.result==='win'?'猜中':'猜错')+' · 返还 '+Number(p.payout_points||0)+' · 盈亏 '+pointsLabel(p.points_delta):m.status==='postponed'?'延期暂停，原下注保留':'待结算（实际地图数未确认时继续等待）'}</p>`:''}
    <p>实际地图数：${actual==null?'待确认':Number(actual)+' 张'}</p>
  </div>`;
}
const mapNameCatalogue=['Ancient','Anubis','Cache','Cobblestone','Dust2','Inferno','Mirage','Nuke','Overpass','Train','Vertigo'];
function selectionIsOpen(m,p){
  return m.status==='open'&&!m.winner&&!m.predictions_voided_at&&!m.selected_maps&&!m.map_selection_locked_at&&!p?.result
    &&!isPredictionLocked(m.starts_at)&&Date.parse(m.map_selection_closes_at)>Date.now();
}
function renderMapSelection(m){
  const p=state.mapSelections.find(x=>Number(x.match_id)===Number(m.id));
  if(![1,3,5].includes(Number(m.number_of_games))&&!p)return '';
  const open=selectionIsOpen(m,p),names=mapNameCatalogue.filter(n=>Number(m.map_selection_odds?.[n])>=1);
  const actual=m.selected_maps||p?.selected_maps;
  return `<section class="map-predict-box" aria-label="地图选择预测">
    <h3 class="map-predict-title">预测哪张地图入选 · BO${Number(m.number_of_games)}</h3>
    <p>每场选一张地图。进入最终选图名单即算猜中，未打的决胜图也计入；不预测地图顺序或单图胜负。</p>
    <p>仅使用娱乐积分。猜中按锁定赔率返还（含本金），猜错损失本次下注积分。</p>
    ${open&&names.length?`<label>地图预测积分：<input id="mapSelectionStake" type="number" min="1" max="1000000" step="1" value="${Number(p?.stake_points)||''}" placeholder="请输入积分"></label>
    <div class="map-predict-options">${names.map(n=>`<button type="button" class="btn btn-secondary ${p?.predicted_map===n?'selected':''}" onclick="selectMapName('${n}',this)">${n} · ${Number(m.map_selection_odds[n])}</button>`).join('')}</div>
    <p>停止预测：${new Date(Math.min(Date.parse(m.map_selection_closes_at),Date.parse(m.starts_at)-600000)).toLocaleString('zh-CN')}；选图提前公布时会提前锁盘。</p>`:`<p>${m.status==='postponed'?'比赛延期，暂停预测':m.map_selection_locked_at||isPredictionLocked(m.starts_at)||m.winner||actual||m.map_selection_closes_at&&Date.parse(m.map_selection_closes_at)<=Date.now()?'已锁盘':'地图预测暂未开放，等待确认赛事图池与锁盘时间'}</p>`}
    ${p?`<p>我的选择：<strong>${escapeHtml(p.predicted_map)}</strong> · 下注 ${Number(p.stake_points)} 积分 · 锁定赔率 ${Number(p.odds_at_prediction)}</p>
      <p>${p.result==='refunded'?'已退本金 '+Number(p.refund_points)+' 积分 · 不计输赢':p.result?(p.result==='win'?'猜中':'猜错')+' · 返还 '+Number(p.payout_points)+' · 盈亏 '+pointsLabel(p.points_delta):'待结算：等待核实完整选图名单'}</p>`:''}
    <p>最终入选名单：${actual?escapeHtml(actual.join('、')):'待确认（包含未打的决胜图）'}</p>
  </section>`;
}
async function selectMapName(map,btn){
  if(!state.me){openAuth('login');return toast('请先登录')}
  const matchId=Number($('matchDetail')?.dataset.matchId),m=state.matches.find(x=>Number(x.id)===matchId);
  const p=state.mapSelections.find(x=>Number(x.match_id)===matchId),stakePoints=Number($('mapSelectionStake')?.value);
  if(!m||!selectionIsOpen(m,p))return toast('地图预测已锁盘');
  if(!Number.isSafeInteger(stakePoints)||stakePoints<1||stakePoints>1000000)return toast('请输入 1–1000000 的整数积分');
  const odds=Number(p&&p.predicted_map===map&&Number(p.stake_points)===stakePoints?p.odds_at_prediction:m.map_selection_odds?.[map]);
  if(!mapNameCatalogue.includes(map)||!Number.isFinite(odds)||odds<1)return toast('该地图尚未开放');
  if(!confirm(`预测 ${map} 进入最终名单，下注 ${stakePoints} 积分，赔率 ${odds}？\n包括未打的决胜图，猜中返还 ${Math.floor(stakePoints*Math.round(odds*10000)/10000)} 积分（含本金）。${p?'\n确认后将替换本场原地图选择。':''}`))return;
  const buttons=[...btn.closest('.map-predict-options').querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  try{const data=await api('/map-selection-predictions',{method:'POST',body:JSON.stringify({matchId,map,stakePoints,expectedOdds:odds})});state.me=data.user;toast(data.message);await loadAll()}
  catch(e){toast(e.message||'地图选择预测失败')}
  finally{buttons.forEach(b=>b.disabled=false)}
}
window.selectMapName=selectMapName;

$('backToMatchesBtn').onclick=()=>{
  $('matchDetail').classList.add('hidden');
  $('matches').classList.remove('hidden');
  $('matches').scrollIntoView({behavior:'smooth',block:'start'});
};
let winnerSubmitting=false;
async function predict(matchId,team){
  if(winnerSubmitting)return;
  if(!state.me){openAuth('login');toast('请先登录');return}
  const pendingKey='cs2_winner_pending_'+state.me.id;
  let pending;
  try{pending=JSON.parse(sessionStorage.getItem(pendingKey)||'null')}
  catch{toast('无法读取待确认下注，请先核对个人记录');return}
  if(pending){
    if(!window.confirm(`上一笔 ${pending.team}、${pending.stakePoints} 积分（赔率 ${pending.expectedOdds}）的结果尚未确认。先查询并重试原请求？本次不会新增另一笔下注。`))return;
    return submitWinner(pending,pendingKey);
  }
  if(matchId===null){toast('没有待确认的下注');return}
  const match=state.matches.find(m=>Number(m.id)===Number(matchId));
const currentPrediction=match?.user_prediction||null;
  const expectedOdds=Number(team===match?.team_a?match.odds_a:match?.odds_b);
  if(!Number.isFinite(expectedOdds)){toast('赔率不可用，请刷新');return}
  let stakePoints=Number($('stakePointsInput')?.value);

if(!Number.isInteger(stakePoints) || stakePoints<=0){
  const entered=window.prompt('请输入下注积分：');
  if(entered===null)return;

  stakePoints=Number(entered);

  if(!Number.isInteger(stakePoints) || stakePoints<=0){
    toast('下注积分必须是大于0的整数');
    return;
  }
}

const confirmText=currentPrediction
  ? `确认新增一笔 ${team} 预测，下注 ${stakePoints} 积分，锁定赔率 ${expectedOdds}？已有下注不会修改或退还。`
  : `确认预测 ${team}，下注 ${stakePoints} 积分，锁定赔率 ${expectedOdds}？`;

if(!window.confirm(confirmText))return;
  const request={matchId,team,stakePoints,expectedOdds,requestId:crypto.randomUUID()};
  try{sessionStorage.setItem(pendingKey,JSON.stringify(request))}
  catch{toast('无法保存下注请求，未提交。请允许浏览器会话存储后重试');return}
  return submitWinner(request,pendingKey);
}
async function submitWinner(request,pendingKey){
  winnerSubmitting=true;
  try{
const data=await api('/predictions',{
  method:'POST',
  body:JSON.stringify(request)
});
sessionStorage.removeItem(pendingKey);
state.me=data.user;
toast(data.message||'预测成功');
await loadAll();
  }catch(e){
    // Only explicit transactional rejections prove no new ticket was accepted.
    // A lost response/5xx keeps the original request across reloads and price changes.
    if([400,404,409].includes(e.status))sessionStorage.removeItem(pendingKey);
    toast(e.message);await loadAll().catch(()=>{});
  }
  finally{winnerSubmitting=false}
}
window.predict=predict;
window.retryWinner=()=>predict(null,null);
function renderLeaderboard(){
  $('leaderboardBody').innerHTML=state.leaderboard.map((u,i)=>`
    <tr><td>${i+1}</td><td><strong>${escapeHtml(u.username)}</strong></td>
    <td>${u.points}</td><td>${u.win_rate}%</td><td>${u.predictions}</td></tr>`).join('');
}
async function renderProfile(){
  const {predictions:winnerPredictions}=await api('/predictions/me');
  const predictions=[...winnerPredictions.map(p=>({...p,market:'winner'})),...(state.mapPredictions||[]).map(p=>({...p,market:'maps',predicted_team:'总地图数 '+p.predicted_map_count+' 张'})),...(state.mapSelections||[]).map(p=>({...p,market:'selection',predicted_team:'地图入选：'+p.predicted_map}))];
  const totalPredictions=predictions.length;
  const winCount=predictions.filter(p=>p.result==='win').length;
  const lossCount=predictions.filter(p=>p.result==='loss').length;
  const pendingCount=predictions.filter(p=>!p.result).length;
  const refundCount=predictions.filter(p=>p.result==='refunded').length;
  const settledCount=winCount+lossCount;
  const calculatedWinRate=settledCount
    ? ((winCount/settledCount)*100).toFixed(1)
    : '0.0';
const filteredPredictions=predictions.filter(p=>{
  if(state.historyFilter==='pending')return !p.result;
  if(state.historyFilter==='win')return p.result==='win';
  if(state.historyFilter==='loss')return p.result==='loss';
  if(state.historyFilter==='refunded')return p.result==='refunded';
  return true;
});
  const searchTerm=state.historySearch.trim().toLowerCase();

const searchedPredictions=filteredPredictions.filter(p=>{
  if(!searchTerm)return true;

  const text=`
    ${p.team_a||''}
    ${p.team_b||''}
    ${p.predicted_team||''}
    ${p.winner||''}
  `.toLowerCase();

  return text.includes(searchTerm);
});
  const sortedPredictions=[...searchedPredictions].sort((a,b)=>{
  const timeA=new Date(a.created_at).getTime();
  const timeB=new Date(b.created_at).getTime();

  return state.historySort==='asc'
    ? timeA-timeB
    : timeB-timeA;
});
  const totalHistoryPages=Math.max(
  1,
  Math.ceil(sortedPredictions.length/state.historyPageSize)
);

if(state.historyPage>totalHistoryPages){
  state.historyPage=totalHistoryPages;
}

const historyStart=(state.historyPage-1)*state.historyPageSize;

const pagedPredictions=sortedPredictions.slice(
  historyStart,
  historyStart+state.historyPageSize
);
  $('profileHint').textContent=`${state.me.username} · ${state.me.points} 积分`;
  $('profileCard').innerHTML=`
    <button type="button" class="btn btn-secondary" onclick="retryWinner()">核对待确认下注</button>
    <div class="profile-top"><div><h3>${escapeHtml(state.me.username)}</h3>
    <p>可用积分 ${state.me.points} · 冻结积分 ${Number(state.me.locked_points||0)} · ${calculatedWinRate}% 胜率</p></div>
    <div class="profile-badge">${state.me.role==='admin'?'管理员':'玩家'}</div></div>
    <div class="profile-stats">
  <div class="profile-stat">
    <strong>${totalPredictions}</strong>
    <span>总预测</span>
  </div>
  <div class="profile-stat win">
    <strong>${winCount}</strong>
    <span>猜中</span>
  </div>
  <div class="profile-stat loss">
    <strong>${lossCount}</strong>
    <span>猜错</span>
  </div>
  <div class="profile-stat pending">
    <strong>${pendingCount}</strong>
    <span>待结算</span>
  </div>
  <div class="profile-stat rate">
    <strong>${calculatedWinRate}%</strong>
    <span>胜率</span>
  </div>
</div>
    <div class="history">
    <div class="history-filters">
    <input
  id="historySearch"
  class="history-search"
  type="search"
  placeholder="搜索历史记录..."
  value="${attr(state.historySearch)}"
  autocomplete="off"
>
<button type="button" class="history-filter ${state.historyFilter==='all'?'active':''}" data-history-filter="all">全部 ${totalPredictions}</button>
<button type="button" class="history-filter ${state.historyFilter==='pending'?'active':''}" data-history-filter="pending">待结算 ${pendingCount}</button>
<button type="button" class="history-filter ${state.historyFilter==='win'?'active':''}" data-history-filter="win">猜中 ${winCount}</button>
<button type="button" class="history-filter ${state.historyFilter==='loss'?'active':''}" data-history-filter="loss">猜错 ${lossCount}</button>
<button type="button" class="history-filter ${state.historyFilter==='refunded'?'active':''}" data-history-filter="refunded">已退本金 ${refundCount}</button>

<select class="history-sort" id="historySort">
  <option value="desc" ${state.historySort==='desc'?'selected':''}>最新预测</option>
  <option value="asc" ${state.historySort==='asc'?'selected':''}>最早预测</option>
</select>
</div>
  <div class="history-head"><span>比赛</span><span>预测详情</span><span>结果</span></div>
 ${pagedPredictions.length?pagedPredictions.map(p=>{
  const isMaps=p.market==='maps';

  return `
  <div class="history-row">
    <span>
      ${escapeHtml(p.event_name||'CS2 比赛')}<br>
      ${escapeHtml(p.team_a)} vs ${escapeHtml(p.team_b)}
    </span>

    <span>
  你的预测：${escapeHtml(p.predicted_team)}<br>

  ${Number(p.stake_points)>0
    ? `下注积分：${Number(p.stake_points)}<br>`
    : ''
  }

  ${Number(p.odds_at_prediction)>0
    ? `锁定赔率：${Number(p.odds_at_prediction)}<br>`
    : ''
  }

  ${p.result==='refunded'?'退分原因：'+(p.void_reason==='postponed'?'比赛延期':'比赛取消'):p.market==='selection'?'入选名单：'+(p.selected_maps?escapeHtml(p.selected_maps.join('、')):'待确认'):isMaps
    ? '实际地图数：'+(p.actual_map_count==null?'待确认':Number(p.actual_map_count)+' 张')
    : '实际胜者：'+(p.winner?escapeHtml(p.winner):'待公布')}
  ${p.created_at?'<br>预测时间：'+new Date(p.created_at).toLocaleString('zh-CN'):''}
</span>

    <span class="prediction-status ${p.result==='win'?'win':p.result==='loss'?'loss':'pending'}">
      ${p.result==='win'
        ? '✅ 猜中 · 盈亏 '+pointsLabel(p.points_delta)+' 积分'
        : p.result==='loss'
        ? '❌ 猜错 · 盈亏 '+pointsLabel(p.points_delta)+' 积分'
        : p.result==='refunded'?'↩ 已退本金 '+Number(p.refund_points||0)+' 积分 · 不计输赢'
        : p.status==='postponed'?'⏸ 延期暂停 · 原下注保留':'⏳ 待结算'
      }
    </span>
  </div>`;
}).join('')
  : `<div class="empty">${
      state.historySearch.trim()
        ? '🔍 没有找到匹配的预测记录'
        : '当前筛选下没有预测记录。'
    }</div>`}
    ${sortedPredictions.length?`
  <div class="history-pagination">
    <button
      type="button"
      id="historyPrev"
      class="history-page-btn"
      ${state.historyPage<=1?'disabled':''}
    >← 上一页</button>

    <span class="history-page-info">
      第 ${state.historyPage} / ${totalHistoryPages} 页
    </span>

    <button
      type="button"
      id="historyNext"
      class="history-page-btn"
      ${state.historyPage>=totalHistoryPages?'disabled':''}
    >下一页 →</button>
  </div>
`:''}
</div>`;

$('profileCard').querySelectorAll('.history-filter').forEach(btn=>{
  btn.onclick=()=>{
    state.historyFilter=btn.dataset.historyFilter||'all';
state.historyPage=1;
renderProfile();
  };
});
const historyPrev=$('historyPrev');
if(historyPrev){
  historyPrev.onclick=()=>{
    if(state.historyPage>1){
      state.historyPage--;
      renderProfile();
    }
  };
}

const historyNext=$('historyNext');
if(historyNext){
  historyNext.onclick=()=>{
    if(state.historyPage<totalHistoryPages){
      state.historyPage++;
      renderProfile();
    }
  };
}
  const historySort=$('historySort');
if(historySort){
  historySort.onchange=()=>{
    state.historySort=historySort.value||'desc';
state.historyPage=1;
renderProfile();
  }};
const historySearch=$('historySearch');
if(historySearch){
  historySearch.onchange=()=>{
    state.historySearch=historySearch.value;
    state.historyPage=1;
    renderProfile();
  };
}
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
document.querySelectorAll('.match-filter[data-filter]').forEach(btn=>{
  btn.onclick=()=>{
    state.matchFilter=btn.dataset.filter||'all';

    document.querySelectorAll('.match-filter[data-filter]').forEach(x=>{
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
const matchSort=$('matchSort');
if(matchSort){
  matchSort.addEventListener('change',async()=>{
    const previous=matchSort.dataset.loadedSort||'popular';
    matchSort.disabled=true;
    try{await loadAll();matchSort.dataset.loadedSort=matchSort.value}
    catch(e){matchSort.value=previous;renderMatches();toast(e.message)}
    finally{matchSort.disabled=false}
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
function applyLanguage(){
  const isZh=state.lang==='zh';

  document.documentElement.lang=isZh?'zh-CN':'en';

  for(const [href,zh,en] of [['#matches','赛事','Matches'],['#leaderboard','排行榜','Leaderboard'],['#profile','个人中心','Profile']]){
    const link=document.querySelector(`nav a[href="${href}"]`);if(link)link.textContent=isZh?zh:en;
  }

  const adminLink=$('adminLink');
  if(adminLink)adminLink.textContent=isZh?'管理后台':'Admin';

  const loginBtn=$('loginBtn');
  if(loginBtn)loginBtn.textContent=isZh?'登录 / 注册':'Login / Register';

  const logoutBtn=$('logoutBtn');
if(logoutBtn)logoutBtn.textContent=isZh?'退出':'Logout';

const brand=document.querySelector('.brand span:last-child');
if(brand)brand.textContent=isZh?'CS2 预测中心':'CS2 Prediction Center';

const heroTitle=document.querySelector('.hero h1');
if(heroTitle)heroTitle.textContent=isZh?'预测比赛，赢取积分':'Predict Matches, Earn Points';

const heroText=document.querySelector('.hero p');
if(heroText)heroText.textContent=isZh
  ?'真实账号、云端数据库、共享排行榜。当前版本为演示赛事数据，不涉及真钱投注。'
  :'Real accounts, cloud database, and shared leaderboard. This version uses demo match data and does not involve real-money betting.';

const heroPointsLabel=document.querySelector('.hero-stat span');
if(heroPointsLabel)heroPointsLabel.textContent=isZh?'我的积分':'My Points';
const matchesTitle=document.querySelector('#matches h2');
if(matchesTitle)matchesTitle.textContent=isZh?'🔥 热门比赛':'🔥 Featured Matches';

const matchesSubtitle=document.querySelector('#matches .section-head p');
if(matchesSubtitle)matchesSubtitle.textContent=isZh
  ?'选择你认为会获胜的战队'
  :'Choose the team you think will win';

const matchSearch=$('matchSearch');
if(matchSearch)matchSearch.placeholder=isZh?'搜索战队或赛事...':'Search teams or events...';

const matchSort=$('matchSort');
if(matchSort && matchSort.options.length){
  const sortLabels=isZh?{popular:'热门优先',asc:'最近开赛',desc:'最晚开赛'}:{popular:'Popular First',asc:'Starting Soon',desc:'Starting Latest'};
  for(const option of matchSort.options)option.textContent=sortLabels[option.value]||option.textContent;
  matchSort.setAttribute('aria-label',isZh?'赛事排序':'Match order');
  matchSort.title=isZh?'热门优先按预设赛事与战队优先级排列，非实时人气榜':'Popular First uses curated event and team priorities, not live audience metrics';
}
}
const langToggle=$('langToggle');
applyLanguage();
if(langToggle){
  langToggle.textContent=state.lang==='zh'?'EN':'中文';

  langToggle.addEventListener('click',()=>{
    state.lang=state.lang==='zh'?'en':'zh';
    localStorage.setItem('cs2_lang',state.lang);
    location.reload();
  });
}
