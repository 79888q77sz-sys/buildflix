/* StreamVault frontend
 * Security-lab note: the VIP gating below is driven entirely by the `is_vip`/`plan`
 * field in the /api/me response. That is intentional — it's what makes the
 * Burp Suite response-tampering exercise work. See README.md for the switch
 * that makes the server enforce it instead (LAB_MODE=false).
 */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app'), modalBackdrop = $('#modalBackdrop'), modal = $('#modal'), tabsEl = $('#tabs');

let state = { user: null, movies: [], view: 'home', authMode: 'login' };

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts });
  let data = {}; try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
function toast(msg) {
  let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600);
}
function closeModal() { modalBackdrop.classList.remove('open'); modal.innerHTML = ''; }
modalBackdrop.addEventListener('click', e => { if (e.target === modalBackdrop) closeModal(); });
window.addEventListener('scroll', () => $('#topbar').classList.toggle('solid', window.scrollY > 20));

const isVip = () => !!(state.user && (state.user.is_vip || state.user.plan === 'vip'));

function renderAuthArea() {
  const el = $('#authArea');
  if (!state.user) { el.innerHTML = `<button class="btn ghost" id="navLogin">Sign in</button>`; $('#navLogin').onclick = () => setView('login'); return; }
  el.innerHTML = `<span class="pill ${isVip() ? 'vip' : 'free'}">${isVip() ? '★ VIP' : 'Free plan'}</span>
    <span style="color:var(--mute);font-size:13.5px">${esc(state.user.name)}</span>
    <button class="btn ghost" id="navLogout">Sign out</button>`;
  $('#navLogout').onclick = async () => { await api('/api/logout', { method: 'POST' }); state.user = null; state.movies = []; setView('home'); };
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (!state.user && ['dashboard', 'settings', 'vip'].includes(view)) view = 'login';
  render(view);
}
tabsEl.addEventListener('click', e => { if (e.target.dataset.view) setView(e.target.dataset.view); });

// ---------- Views ----------
function viewAuth() {
  const login = state.authMode === 'login';
  app.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <h1>${login ? 'Sign in' : 'Create your account'}</h1>
    <p class="sub">${login ? 'Welcome back to StreamVault.' : 'Join free — upgrade to VIP any time.'}</p>
    <div class="auth-err" id="authErr"></div>
    <form id="authForm">
      <div class="field"><label>Email</label><input type="email" name="email" required maxlength="120" autocomplete="username"></div>
      <div class="field"><label>Password</label><input type="password" name="password" required minlength="8" maxlength="100" autocomplete="${login ? 'current-password' : 'new-password'}"></div>
      <button class="btn primary" type="submit">${login ? 'Sign in' : 'Create account'}</button>
    </form>
    <div class="switch">${login ? "New here?" : 'Already have an account?'} <button id="switchAuth">${login ? 'Create an account' : 'Sign in'}</button></div>
  </div></div>`;
  $('#switchAuth').onclick = () => { state.authMode = login ? 'register' : 'login'; viewAuth(); };
  $('#authForm').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api(login ? '/api/login' : '/api/register', { method: 'POST', body: JSON.stringify(f) });
      state.user = r.user; toast(`Welcome, ${r.user.name}!`); await loadMovies(); setView('home');
    } catch (err) { $('#authErr').textContent = err.message; }
  };
}

function posterCard(m) {
  const locked = m.vip && !isVip();
  return `<div class="card" data-open="${m.id}">
    <div class="poster-wrap">
      <img loading="lazy" src="${esc(m.poster)}" alt="${esc(m.title)}">
      <span class="badge ${m.vip ? 'vip' : 'free'}">${m.vip ? 'VIP' : 'FREE'}</span>
      ${locked ? `<div class="lock">${lockIcon()}<span>VIP EXCLUSIVE</span></div>` : ''}
    </div>
    <div class="meta"><h3>${esc(m.title)}</h3><p><span>${esc(m.genre)}</span><span>·</span><span>${esc(m.duration)}</span></p></div>
  </div>`;
}
const lockIcon = () => `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;

function carousel(title, movies) {
  if (!movies.length) return '';
  return `<section class="row-section"><div class="row-head"><h2>${esc(title)}</h2><span class="count">${movies.length} titles</span></div>
    <div class="carousel">${movies.map(posterCard).join('')}</div></section>`;
}

function viewHome() {
  const featured = state.movies.find(m => m.featured) || state.movies[0];
  const byGenre = {};
  state.movies.forEach(m => { (byGenre[m.genre] ||= []).push(m); });
  app.innerHTML = `
    ${featured ? `<section class="hero"><img src="${esc(featured.backdrop)}" alt="">
      <div class="hero-content"><span class="tag">Featured Original</span>
        <h1>${esc(featured.title)}</h1>
        <div class="hero-meta"><span>${featured.year}</span><span class="dot">•</span><span>${esc(featured.duration)}</span><span class="dot">•</span><span>★ ${featured.rating}</span><span class="dot">•</span><span>${esc(featured.genre)}</span></div>
        <p>${esc(featured.description)}</p>
        <div class="hero-actions">
          <button class="btn primary" data-open="${featured.id}">▶ Play</button>
          <button class="btn ghost" data-open="${featured.id}">More info</button>
        </div></div></section>` : ''}
    ${carousel('Free to Watch', state.movies.filter(m => !m.vip))}
    ${Object.entries(byGenre).map(([g, ms]) => carousel(g, ms)).join('')}
  `;
}

function viewVip() {
  const vipMovies = state.movies.filter(m => m.vip);
  app.innerHTML = `<div class="page">
    <h1>VIP Vault</h1>
    <p class="lead">${isVip() ? 'Your VIP library — every exclusive title, unlocked.' : 'Exclusive titles for VIP members. Upgrade to unlock the full vault.'}</p>
    ${!isVip() ? `<div class="notice gold">You're on the <b>Free</b> plan. VIP titles below are locked.</div>` : ''}
    <div class="carousel" style="padding:0">${vipMovies.map(posterCard).join('')}</div>
  </div>`;
}

function viewDashboard() {
  const u = state.user;
  app.innerHTML = `<div class="page">
    <h1>Dashboard</h1><p class="lead">Your StreamVault overview.</p>
    <div class="cards-row">
      <div class="stat-card"><div class="k">Name</div><div class="v">${esc(u.name)}</div></div>
      <div class="stat-card"><div class="k">Email</div><div class="v" style="font-size:16px">${esc(u.email)}</div></div>
      <div class="stat-card"><div class="k">Plan</div><div class="v ${isVip() ? 'vip' : ''}">${isVip() ? 'VIP' : 'Free'}</div></div>
      <div class="stat-card"><div class="k">Titles unlocked</div><div class="v">${isVip() ? state.movies.length : state.movies.filter(m => !m.vip).length} / ${state.movies.length}</div></div>
    </div>
    <div class="panel"><h2>Subscription</h2>
      ${isVip()
        ? `<div class="notice gold">★ VIP Plan Active — full catalog access.</div>`
        : `<div class="notice mute">You're on the Free plan. Upgrade to VIP to unlock every title in the vault.</div>
           <button class="btn gold" id="goVip">Explore VIP Vault</button>`}
    </div>
  </div>`;
  if (!isVip()) $('#goVip').onclick = () => setView('vip');
}

function viewSettings() {
  const u = state.user;
  app.innerHTML = `<div class="page">
    <h1>Settings</h1><p class="lead">Manage your profile.</p>
    <div class="panel">
      <h2>Profile</h2>
      <div class="auth-err" id="setErr"></div>
      <form id="setForm">
        <div class="field"><label>Name</label><input name="name" value="${esc(u.name)}" maxlength="40" required></div>
        <div class="field"><label>Email</label><input value="${esc(u.email)}" disabled></div>
        <button class="btn primary" type="submit">Save changes</button>
      </form>
    </div>
    <div class="panel"><h2>Plan</h2>
      <p style="color:var(--mute);margin:0 0 12px">Current plan: <span class="pill ${isVip() ? 'vip' : 'free'}">${isVip() ? '★ VIP' : 'Free plan'}</span></p>
    </div>
  </div>`;
  $('#setForm').onsubmit = async e => {
    e.preventDefault();
    try {
      const r = await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ name: $('#setForm [name=name]').value }) });
      state.user = { ...state.user, ...r.user }; toast('Profile updated'); renderAuthArea();
    } catch (err) { $('#setErr').textContent = err.message; }
  };
}

function openMovie(id) {
  const m = state.movies.find(x => x.id === id); if (!m) return;
  const locked = m.vip && !isVip();
  modal.innerHTML = `<div class="modal-hero"><img src="${esc(m.backdrop)}" alt=""><button class="modal-close" id="mClose">✕</button></div>
    <div class="modal-body">
      <h2>${esc(m.title)}</h2>
      <div class="meta-line"><b>★ ${m.rating}</b><span>${m.year}</span><span>${esc(m.duration)}</span><span>${esc(m.genre)}</span>${m.vip ? '<span class="pill vip">VIP</span>' : '<span class="pill free">FREE</span>'}</div>
      <p class="desc">${esc(m.description)}</p>
      <div id="playerSlot">
        ${locked
          ? `<div class="vip-gate">${lockIcon()}<h3>This is a VIP exclusive movie.</h3><p>Upgrade to VIP to watch.</p><button class="btn gold" id="gateVip">Explore VIP Vault</button></div>`
          : `<button class="btn primary" id="playBtn">▶ Play ${esc(m.title)}</button>`}
      </div>
    </div>`;
  modalBackdrop.classList.add('open');
  $('#mClose').onclick = closeModal;
  if (locked) { $('#gateVip').onclick = () => { closeModal(); setView('vip'); }; return; }
  $('#playBtn').onclick = async () => {
    try {
      const r = await api(`/api/movies/${m.id}/watch`);
      $('#playerSlot').innerHTML = `<div class="player"><video src="${esc(r.src)}" controls autoplay></video></div>`;
    } catch (err) {
      $('#playerSlot').innerHTML = `<div class="vip-gate">${lockIcon()}<h3>${esc(err.message)}</h3><button class="btn gold" id="gateVip2">Explore VIP Vault</button></div>`;
      $('#gateVip2').onclick = () => { closeModal(); setView('vip'); };
    }
  };
}
document.addEventListener('click', e => { const id = e.target.closest('[data-open]')?.dataset.open; if (id) openMovie(Number(id)); });

function render(view) {
  renderAuthArea();
  if (!state.user) return viewAuth();
  if (view === 'dashboard') return viewDashboard();
  if (view === 'settings') return viewSettings();
  if (view === 'vip') return viewVip();
  return viewHome();
}

async function loadMovies() { const r = await api('/api/movies'); state.movies = r.movies; }

(async function init() {
  try {
    const me = await api('/api/me');
    state.user = me.user;
    if (state.user) await loadMovies();
  } catch {}
  render(state.view);
})();
