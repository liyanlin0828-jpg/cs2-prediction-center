const state = {
  token: localStorage.getItem('cs2_token'),
  me: null,
  matches: [],
  leaderboard: [],
  mode: 'login'
};

const $ = id => document.getElementById(id);
const api = async (path, options = {}) => {
  const headers = {'Content-Type':'application/json', ...(options.headers || {})};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`/api${path}`, {...options, headers});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || '请求失败');
  return data;
};

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function openAuth(mode='login') {
  state.mode = mode;
  $('authTitle').textContent = mode === 'login' ? '登录' : '注册';
  $('authSubmit').textContent = mode === 'login' ? '登录' : '注册';
  $('toggleAuth').textContent = mode === 'login' ? '没有账号？注册' : '已有账号？登录';
  $('authModal').classList.remove('hidden');
}
function closeAuth(){ $('authModal').classList.add('hidden'); }

async function loadAll() {
  const [matches, leaderboard] = await Promise.all([
    api('/matches'),
    api('/leaderboard')
  ]);
  state.matches = matches.matches;
  state.leaderboard = leaderboard.users;
  renderMatches();
  renderLeaderboard();
  if (state.token) {
    try { state.me = (await api('/auth/me')).user; }
    catch { logout(false); }
  }
  renderUser();
  if (state.me) renderProfile();
}

function renderUser() {
  $('loginBtn').classList.toggle('hidden', !!state.me);
  $('logoutBtn').classList.toggle('hidden', !state.me);
  $('heroPoints').textContent = state.me ? state.me.points : '0';
  $('adminLink').classList.toggle('hidden', !(state.me && state.me.role === 'admin'));
}
function renderMatches() {
  const grid = $('matchesGrid');
  if (!state.matches.length) {
    grid.innerHTML = '<div class="empty">暂无可预测比赛</div>'; return;
  }
  grid.innerHTML = state.matches.map(m => `
    <article class="match-card">
      <div class="match-meta"><span>${escapeHtml(m.event_name)}</span><span>${new Date(m.starts_at).toLocaleString('zh-CN')}</span></div>
      <div class="teams">
        <button class="team ${m.user_prediction === m.team_a ? 'selected':''}" onclick="predict(${m.id}, '${m.team_a.replace(/'/g,"\\'")}')">
          <strong>${escapeHtml(m.team_a)}</strong><span>${m.odds_a}</span>
        </button>
        <div class="vs">VS</div>
        <button class="team ${m.user_prediction === m.team_b ? 'selected':''}" onclick="predict(${m.id}, '${m.team_b.replace(/'/g,"\\'")}')">
          <strong>${escapeHtml(m.team_b)}</strong><span>${m.odds_b}</span>
        </button>
      </div>
      <div class="match-footer"><span>预测奖励：+50</span><span>${m.user_prediction ? '已预测' : '尚未预测'}</span></div>
    </article>`).join('');
}
async function predict(matchId, team) {
  if (!state.me) { openAuth('login'); toast('请先登录'); return; }
  try {
    const data = await api('/predictions', {
      method:'POST',
      body: JSON.stringify({matchId, team})
    });
    state.me = data.user;
    toast(data.message || '预测成功');
    await loadAll();
  } catch(e) { toast(e.message); }
}
window.predict = predict;

function renderLeaderboard() {
  $('leaderboardBody').innerHTML = state.leaderboard.map((u,i) => `
    <tr><td>${i+1}</td><td><strong>${escapeHtml(u.username)}</strong></td>
    <td>${u.points}</td><td>${u.win_rate}%</td><td>${u.predictions}</td></tr>`).join('');
}
async function renderProfile() {
  if (!state.me) {
    $('profileCard').innerHTML = '<div class="empty">请登录后查看。</div>'; return;
  }
  const {predictions} = await api('/predictions/me');
  $('profileHint').textContent = `${state.me.username} · ${state.me.points} 积分`;
  $('profileCard').innerHTML = `
    <div class="profile-top"><div><h3>${escapeHtml(state.me.username)}</h3><p>积分 ${state.me.points} · ${state.me.win_rate}% 胜率</p></div>
    <div class="profile-badge">${state.me.role === 'admin' ? '管理员' : '玩家'}</div></div>
    <div class="history">${predictions.length ? predictions.map(p => `
      <div class="history-row"><span>${escapeHtml(p.team_a)} vs ${escapeHtml(p.team_b)}</span>
      <span>${escapeHtml(p.predicted_team)}</span><span>${p.result || '待结算'}</span></div>`).join('') : '<div class="empty">还没有预测记录。</div>'}</div>`;
}

$('loginBtn').onclick = () => openAuth('login');
$('logoutBtn').onclick = () => logout(true);
$('closeModal').onclick = closeAuth;
$('authModal').onclick = e => { if(e.target === $('authModal')) closeAuth(); };
$('toggleAuth').onclick = () => openAuth(state.mode === 'login' ? 'register' : 'login');

$('authForm').onsubmit = async e => {
  e.preventDefault();
  const username = $('username').value.trim();
  const password = $('password').value;
  try {
    const data = await api(state.mode === 'login' ? '/auth/login' : '/auth/register', {
      method:'POST', body: JSON.stringify({username,password})
    });
    state.token = data.token;
    localStorage.setItem('cs2_token', state.token);
    closeAuth(); toast(data.message || '操作成功');
    await loadAll();
  } catch(err) { toast(err.message); }
};
function logout(show=true) {
  state.token = null; state.me = null;
  localStorage.removeItem('cs2_token');
  renderUser(); renderProfile();
  if(show) toast('已退出登录');
}
window.addEventListener('load', async () => {
  try { await loadAll(); } catch(e) { toast(e.message); }
});
