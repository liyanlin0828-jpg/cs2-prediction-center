const state={token:localStorage.getItem('cs2_token'),me:null,matches:[],leaderboard:[],results:[],mapPredictions:[],resultsExpanded:false,mode:'login',matchFilter:'all',historyFilter:'all',historySort:'desc',historySearch:'',historyPage:1,
historyPageSize:10,lang:localStorage.getItem('cs2_lang')||'zh',};
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
  const [matches,leaderboard,results]=await Promise.all([
  api('/matches'),
  api('/leaderboard'),
  api('/results')
]);
  state.matches=matches.matches;
state.leaderboard=leaderboard.users;
state.results=results.results||[];
  if(state.token){
  try{
    state.me=(await api('/auth/me')).user;

    const mapData=await api('/map-predictions/me');
    state.mapPredictions=mapData.mapPredictions||[];
  }catch{
    state.mapPredictions=[];
    logout(false);
  }
}else{
  state.mapPredictions=[];
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
        <button
  type="button"
  class="match-detail-btn"
  onclick="openMatchDetail(${m.id})"
>
  查看详情 →
</button>
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
function renderMatches(){
  const grid=$('matchesGrid');
  const now=Date.now();

const baseMatches=
  state.matchFilter==='finished'
    ? state.results
    : state.matchFilter==='live'
      ? state.matches
      : state.matches.filter(
          m=>new Date(m.starts_at).getTime()>now
        );

const searchTerm=($('matchSearch')?.value||'').trim().toLowerCase();

const searchedMatches=baseMatches.filter(m=>{
  if(!searchTerm)return true;

  const text=`${m.event_name||''} ${m.team_a||''} ${m.team_b||''}`.toLowerCase();
  return text.includes(searchTerm);
});
const todayStart=new Date();
todayStart.setHours(0,0,0,0);

const tomorrowStart=new Date(todayStart);
tomorrowStart.setDate(tomorrowStart.getDate()+1);

const dayAfterTomorrow=new Date(todayStart);
dayAfterTomorrow.setDate(dayAfterTomorrow.getDate()+2);

const counts={
  all: state.matches.filter(
    m=>new Date(m.starts_at).getTime()>Date.now()
  ).length,

  today: state.matches.filter(m=>{
    const start=new Date(m.starts_at);
    return start>=todayStart && start<tomorrowStart;
  }).length,

  tomorrow: state.matches.filter(m=>{
    const start=new Date(m.starts_at);
    return start>=tomorrowStart && start<dayAfterTomorrow;
  }).length,

  live: state.matches.filter(
    m=>m.status==='running' || m.source_status==='running'
  ).length,

  finished: state.results.length
};

document.querySelectorAll('.match-filter').forEach(btn=>{
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

const visibleMatches=searchedMatches.filter(m=>{
  if(state.matchFilter==='all')return true;

  const now=new Date();
  const start=new Date(m.starts_at);

  const todayStart=new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  const tomorrowStart=new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate()+1);

  const dayAfterTomorrow=new Date(todayStart);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate()+2);

  if(state.matchFilter==='today'){
    return start>=todayStart && start<tomorrowStart;
  }

  if(state.matchFilter==='tomorrow'){
    return start>=tomorrowStart && start<dayAfterTomorrow;
  }

  if(state.matchFilter==='live'){
    return m.status==='running' || m.source_status==='running';
  }

  if(state.matchFilter==='finished'){
    return m.status==='settled' || !!m.winner;
  }

  return true;
});
  const sortDirection=$('matchSort')?.value||'asc';

const sortedMatches=[...visibleMatches].sort((a,b)=>{
  const timeA=new Date(a.starts_at).getTime();
  const timeB=new Date(b.starts_at).getTime();

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
      <span>已结束</span>
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
        <span class="countdown ${countdownClass}">${m.status==='postponed'?(m.predictions_voided_at?'已延期 · 已退本金':'已延期 · 暂停预测'):countdown(m.starts_at)}</span>
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
    ? (state.lang==='zh'?'已预测：':'Predicted: ') + escapeHtml(m.user_prediction)
    : locked
      ? (state.lang==='zh'?'🔒 已锁盘':'🔒 Locked')
      : (state.lang==='zh'?'尚未预测':'Not Predicted')
}</span>

<button class="match-detail-btn" onclick="event.stopPropagation();openMatchDetail(${m.id})">
  ${state.lang==='zh'?'查看详情 →':'View Details →'}
</button>
</div>
    </article>`;
  }).join('');
  }

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
  const locked=m.status!=='open'||!!m.predictions_voided_at||isPredictionLocked(m.starts_at);
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
    (m.status==='settled' || m.winner)
  ? (state.lang==='zh'?'比赛已结束':'Match Finished')
  : m.status==='postponed'?'已延期 · 暂停预测':countdown(m.starts_at)
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
    : (m.status==='running' || m.source_status==='running')
      ? `<p class="match-stage">比赛状态：进行中</p>`
      : `<p class="match-stage">比赛状态：未开始</p>`
}
    <p>${new Date(m.starts_at).toLocaleString('zh-CN')}</p>

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
</div>
${!locked && m.status!=='settled' && !m.winner ? `
  <div style="margin:16px 0;">
    <div style="margin-bottom:8px;">
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
        style="width:160px;margin-left:8px;"
      >
    </label>
  </div>
` : ''}
${renderMapMarket(m,mapPrediction)}
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
        ? (state.lang==='zh'?'当前预测：':'Predicted: ') + escapeHtml(m.user_prediction)
        : (locked
          ? (state.lang==='zh'?'🔒 已锁盘':'🔒 Locked')
          : (state.lang==='zh'?'尚未预测':'Not Predicted')
        )
  }
</span>
    </div>
  `;

 detail.dataset.matchId=String(m.id);
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
  const options=mapChoices(m);
  if(!options.length&&!p)return '';
  const open=m.status==='open'&&!m.winner&&!m.predictions_voided_at&&!isPredictionLocked(m.starts_at)&&!p?.result;
  const actual=m.actual_map_count??p?.actual_map_count;
  return `<div class="map-predict-box">
    <div class="map-predict-title">总地图数预测 · BO${Number(m.number_of_games)}</div>
    <p>仅使用娱乐积分。猜中返还包含本金，按下注时锁定赔率向下取整；猜错扣除下注积分。</p>
    ${open?`<label>地图数下注积分：
      <input id="mapStakePointsInput" type="number" min="1" max="1000000" step="1"
        value="${Number(p?.stake_points)>0?Number(p.stake_points):''}" placeholder="请输入积分" style="max-width:160px">
    </label>
    <div class="map-predict-options">${options.map(n=>{
      const odds=Number(m['map_odds_'+n]),enabled=Number.isFinite(odds)&&odds>=1;
      return `<button type="button" class="btn btn-secondary ${Number(p?.predicted_map_count)===n?'selected':''}"
        ${enabled?'':'disabled'} onclick="selectMapCount(${n},this)">
        ${n} 张 · ${enabled?odds.toFixed(4).replace(/0+$/,'').replace(/\\.$/,''):'未开放'}</button>`;
    }).join('')}</div>`:'<p>已锁盘</p>'}
    ${p?`<p>我的预测：${Number(p.predicted_map_count)} 张 · 下注 ${Number(p.stake_points||0)} 积分
      ${Number(p.odds_at_prediction)>0?' · 锁定赔率 '+Number(p.odds_at_prediction):' · 历史无下注记录'}</p>
      <p>${p.result==='refunded'?'已退本金 '+Number(p.refund_points||0)+' 积分 · 不计输赢':p.result?(p.result==='win'?'猜中':'猜错')+' · 返还 '+Number(p.payout_points||0)+' · 盈亏 '+pointsLabel(p.points_delta):m.status==='postponed'?'延期暂停，原下注保留':'待结算（实际地图数未确认时继续等待）'}</p>`:''}
    <p>实际地图数：${actual==null?'待确认':Number(actual)+' 张'}</p>
  </div>`;
}
async function selectMapCount(count,btn){
  if(!state.me){openAuth('login');toast('请先登录');return}
  const matchId=Number($('matchDetail')?.dataset?.matchId);
  const stakePoints=Number($('mapStakePointsInput')?.value);
  if(!matchId)return toast('找不到比赛');
  if(!Number.isSafeInteger(stakePoints)||stakePoints<1||stakePoints>1000000)return toast('请输入 1–1000000 的整数积分');
  const match=state.matches.find(m=>Number(m.id)===matchId);
  const old=state.mapPredictions.find(p=>Number(p.match_id)===matchId);
  const odds=Number(old&&Number(old.predicted_map_count)===count&&Number(old.stake_points)===stakePoints?old.odds_at_prediction:match?.['map_odds_'+count]);
  if(!Number.isFinite(odds)||odds<1)return toast('当前赔率未开放');
  if(!confirm(`确认预测 ${count} 张，下注 ${stakePoints} 积分，赔率 ${odds}？猜中预计返还 ${Math.floor(stakePoints*Math.round(odds*10000)/10000)} 积分（含本金）。`))return;
  const buttons=[...btn.closest('.map-predict-options').querySelectorAll('button')];
  const disabled=buttons.map(b=>b.disabled);buttons.forEach(b=>b.disabled=true);
  try{
    const data=await api('/map-predictions',{method:'POST',body:JSON.stringify({matchId,mapCount:count,stakePoints,expectedOdds:odds})});
    state.me=data.user;toast(data.message);await loadAll();
  }catch(e){toast(e.message||'地图数预测失败')}
  finally{buttons.forEach((b,i)=>b.disabled=disabled[i])}
}

window.selectMapCount=selectMapCount;
$('backToMatchesBtn').onclick=()=>{
  $('matchDetail').classList.add('hidden');
  $('matches').classList.remove('hidden');
  $('matches').scrollIntoView({behavior:'smooth',block:'start'});
};
async function predict(matchId,team){
  if(!state.me){openAuth('login');toast('请先登录');return}
  const match=state.matches.find(m=>Number(m.id)===Number(matchId));
const currentPrediction=match?.user_prediction||null;
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
  ? `确认修改预测为 ${team}，下注 ${stakePoints} 积分吗？`
  : `确认预测 ${team}，下注 ${stakePoints} 积分吗？`;

if(!window.confirm(confirmText))return;
  try{
    
const data=await api('/predictions',{
  method:'POST',
  body:JSON.stringify({
  matchId,
  team,
  stakePoints
})
});

state.me=data.user;
toast(data.message||'预测成功');
await loadAll();
  }catch(e){toast(e.message)}
}
window.predict=predict;
function renderLeaderboard(){
  $('leaderboardBody').innerHTML=state.leaderboard.map((u,i)=>`
    <tr><td>${i+1}</td><td><strong>${escapeHtml(u.username)}</strong></td>
    <td>${u.points}</td><td>${u.win_rate}%</td><td>${u.predictions}</td></tr>`).join('');
}
async function renderProfile(){
  const {predictions:winnerPredictions}=await api('/predictions/me');
  const predictions=[...winnerPredictions.map(p=>({...p,market:'winner'})),...(state.mapPredictions||[]).map(p=>({...p,market:'maps',predicted_team:'总地图数 '+p.predicted_map_count+' 张'}))];
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

  ${p.result==='refunded'?'退分原因：'+(p.void_reason==='postponed'?'比赛延期':'比赛取消'):isMaps
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
const matchSort=$('matchSort');
if(matchSort){
  matchSort.addEventListener('change',()=>{
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
function applyLanguage(){
  const isZh=state.lang==='zh';

  document.documentElement.lang=isZh?'zh-CN':'en';

  const navLinks=document.querySelectorAll('nav a');
  if(navLinks[0])navLinks[0].textContent=isZh?'赛事':'Matches';
  if(navLinks[1])navLinks[1].textContent=isZh?'排行榜':'Leaderboard';
  if(navLinks[2])navLinks[2].textContent=isZh?'个人中心':'Profile';

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
  matchSort.options[0].textContent=isZh?'最近开赛':'Starting Soon';
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
