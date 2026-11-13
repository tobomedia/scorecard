'use strict';

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));

const store = {
  get(k, d) {
    try { const v = localStorage.getItem('sc.' + k); return v ? JSON.parse(v) : d; } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('sc.' + k, JSON.stringify(v)); } catch (e) { toast('Could not save: storage full?'); }
  },
  del(k) { try { localStorage.removeItem('sc.' + k); } catch {} },
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---------- data ---------- */
const PRESETS = [
  {
    id: 'rugby-union',
    name: 'Rugby Union',
    periods: { count: 2, minutes: 40 },
    scoreTypes: [
      { id: 'try', name: 'Try', points: 5, followUpId: 'conversion', hidden: false },
      { id: 'conversion', name: 'Conversion', points: 2, followUpId: null, hidden: true },
      { id: 'penalty', name: 'Penalty', points: 3, followUpId: null, hidden: false },
      { id: 'drop-goal', name: 'Drop goal', points: 3, followUpId: null, hidden: false },
    ],
  },
  {
    id: 'football',
    name: 'Football',
    periods: { count: 2, minutes: 45 },
    scoreTypes: [{ id: 'goal', name: 'Goal', points: 1, followUpId: null, hidden: false }],
  },
];

const DEFAULT_PERIODS = { count: 2, minutes: 40 };
const getSports = () => {
  let s = store.get('sports');
  if (!s) { s = clone(PRESETS); store.set('sports', s); }
  for (const sp of s) { // sports saved before periods existed
    if (!sp.periods) sp.periods = clone((PRESETS.find((p) => p.id === sp.id) || {}).periods || DEFAULT_PERIODS);
  }
  return s;
};
const getTeams = () => store.get('teams', []);
const getHistory = () => store.get('history', []).map(normaliseMatch);
const getLive = () => normaliseMatch(store.get('live', null));

/* Matches saved before periods existed get sensible defaults. */
function normaliseMatch(m) {
  if (!m) return m;
  m.periods = m.periods || clone(m.sport.periods || DEFAULT_PERIODS);
  m.period = m.period || 1;
  m.playedMs = m.playedMs || 0;
  m.reminded = m.reminded || [];
  m.inBreak = !!m.inBreak;
  return m;
}

function getMatch(ref) {
  return ref === 'live' ? getLive() : getHistory().find((m) => m.id === ref) || null;
}
function saveMatch(ref, m) {
  if (ref === 'live') return store.set('live', m);
  const h = getHistory();
  const i = h.findIndex((x) => x.id === ref);
  if (i >= 0) { h[i] = m; store.set('history', h); }
}

const DEFAULT_NAMES = { home: 'Home', away: 'Away' };
const teamName = (m, side) => m[side] || DEFAULT_NAMES[side];

/* ---------- clock & periods ----------
   The clock runs per period. elapsedMs is time within the current period; the match clock
   shown is periodStart + elapsed (so the 2nd half always starts at 40:00). Past the period
   length the clock shows added time, e.g. 40:00 +2:13, and events are stamped 40+3'. */
const elapsedMs = (m) => m.clock.elapsedMs + (m.clock.runningSince ? Date.now() - m.clock.runningSince : 0);
const periodMs = (m) => m.periods.minutes * 60000;
const periodStartMin = (m, p = m.period) => (p - 1) * m.periods.minutes;
const periodEndMin = (m, p = m.period) => p * m.periods.minutes;
const isLastPeriod = (m) => m.period >= m.periods.count;
const isTimeUp = (m) => elapsedMs(m) >= periodMs(m);
/* match minute for an event happening now: 1-based, can run past the period end */
const matchMinute = (m) => periodStartMin(m) + Math.floor(elapsedMs(m) / 60000) + 1;

function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function fmtMatchClock(m) {
  const el = elapsedMs(m);
  const len = periodMs(m);
  const base = periodStartMin(m) * 60000;
  if (el < len) return fmtClock(base + el);
  const over = Math.floor((el - len) / 1000);
  return `${fmtClock(base + len)} <span class="added">+${Math.floor(over / 60)}:${String(over % 60).padStart(2, '0')}</span>`;
}
function fmtMinute(m, e) {
  const end = periodEndMin(m, e.period || 1);
  return e.period && e.minute > end ? `${end}+${e.minute - end}'` : `${e.minute}'`;
}

function periodName(m, p = m.period) {
  if (m.periods.count === 2) return p === 1 ? '1st half' : '2nd half';
  if (m.periods.count === 4) return `Q${p}`;
  if (m.periods.count === 1) return 'Match';
  return `Period ${p}`;
}
/* what the whistle at the end of period p is called */
function whistleName(m, p = m.period) {
  if (p >= m.periods.count) return 'Full time';
  if (m.periods.count === 2) return 'Half time';
  return `End of ${periodName(m, p)}`;
}
const playedMs = (m) => m.playedMs + (m.inBreak ? 0 : elapsedMs(m));

/* ---------- scoring (always derived from the event log) ---------- */
const typeById = (m, id) => m.sport.scoreTypes.find((t) => t.id === id);

const isMarker = (e) => !!e.marker; // time-up / whistle entries in the log, never scored

function totals(m) {
  const t = { home: 0, away: 0 };
  for (const e of m.events) {
    if (!e.made || isMarker(e)) continue;
    const st = typeById(m, e.scoreTypeId);
    if (st) t[e.team] += st.points;
  }
  return t;
}

function sortedEvents(m) {
  return [...m.events].sort((a, b) => (a.period || 1) - (b.period || 1) || a.minute - b.minute || a.createdAt - b.createdAt);
}

function breakdown(m, side) {
  const followUps = new Set(m.sport.scoreTypes.map((t) => t.followUpId).filter(Boolean));
  const lines = [];
  for (const st of m.sport.scoreTypes) {
    const evs = m.events.filter((e) => e.team === side && e.scoreTypeId === st.id);
    if (!evs.length) continue;
    const made = evs.filter((e) => e.made).length;
    const attempted = followUps.has(st.id) || made !== evs.length;
    lines.push(`${st.name}: ${attempted ? `${made}/${evs.length}` : made}`);
  }
  return lines;
}

/* ---------- wake lock ---------- */
let wakeLock = null;
async function setWakeLock(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* not supported or denied */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') setWakeLock(!!getLive());
});

/* ---------- modal ---------- */
const modal = $('#modal');
function openModal(html, onClose) {
  modal.innerHTML = html;
  modal._onClose = onClose;
  modal.showModal();
}
function closeModal(result) {
  const cb = modal._onClose;
  modal._onClose = null;
  if (modal.open) modal.close();
  modal.innerHTML = '';
  if (cb) cb(result);
}
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal('dismiss'); });
modal.addEventListener('cancel', (e) => { e.preventDefault(); closeModal('dismiss'); });

/* ---------- routing ---------- */
const route = () => (location.hash.slice(2) || '').split('/');
const go = (path) => { location.hash = '#/' + path; };
window.addEventListener('hashchange', render);

const views = {
  '': viewHome,
  new: viewNew,
  live: viewLive,
  log: viewLog,
  history: viewHistory,
  match: viewMatch,
  settings: viewSettings,
  sport: viewSport,
};

function render() {
  const [name, ...args] = route();
  const view = views[name] || viewHome;
  const app = $('#app');
  app.innerHTML = view(...args) + `<footer class="app-version" data-action="version-tap">Version ${esc(APP_VERSION)}</footer>`;
  document.body.classList.toggle('debug', debugOn());
  window.scrollTo(0, 0);
  if (view.after) view.after(...args);
  setWakeLock(name === 'live' && !!getLive());
}

/* ---------- views ---------- */
function viewHome() {
  const live = getLive();
  const t = live && totals(live);
  return `
    <div class="logo-bar"><h1 class="logo"><img src="assets/brand/logo.webp" alt="Scorecard" width="900" height="516"></h1></div>
    ${live ? `
      <button class="card resume-card stack btn-block" data-go="live" style="text-align:left;align-items:stretch;min-height:auto;padding:16px">
        <span class="tag">Match in progress · ${esc(live.sport.name)}</span>
        <span style="font-size:1.4rem">${esc(teamName(live, 'home'))} <span class="big-score">${t.home} – ${t.away}</span> ${esc(teamName(live, 'away'))}</span>
        <span class="btn btn-primary">Resume match</span>
      </button>` : `
      <button class="btn-primary btn-big btn-block" data-go="new">New match</button>`}
    <button class="btn-big btn-block btn-paint" data-go="history">History</button>
    <button class="btn-big btn-block btn-paint" data-go="settings">Settings</button>
    <div class="spacer"></div>
    <p class="muted" style="text-align:center;font-size:.85rem">Add to your home screen to use offline.</p>`;
}

function viewNew() {
  if (getLive()) {
    return `
      <div class="topbar"><button class="btn-ghost btn-small" data-go="">‹ Back</button><h2>New match</h2></div>
      <p>A match is already in progress. End it before starting a new one.</p>
      <button class="btn-primary btn-big" data-go="live">Go to current match</button>`;
  }
  const sports = getSports();
  const last = store.get('lastSport');
  const opts = sports.map((s) => `<option value="${esc(s.id)}" ${s.id === last ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  const sel = sports.find((s) => s.id === last) || sports[0];
  const teams = getTeams().map((t) => `<option value="${esc(t)}">`).join('');
  return `
    <div class="topbar"><button class="btn-ghost btn-small" data-go="">‹ Back</button><h2>New match</h2></div>
    <form id="new-form" class="stack">
      <label>Sport<select name="sport">${opts}</select></label>
      <label>Home team<input name="home" placeholder="Home" list="teams" autocomplete="off" maxlength="40"></label>
      <label>Away team<input name="away" placeholder="Away" list="teams" autocomplete="off" maxlength="40"></label>
      <datalist id="teams">${teams}</datalist>
      <div class="row">
        <label>Periods<input name="pcount" type="number" inputmode="numeric" min="1" max="8" value="${sel ? sel.periods.count : 2}" required></label>
        <label>Minutes each<input name="pminutes" type="number" inputmode="numeric" min="1" max="120" value="${sel ? sel.periods.minutes : 40}" required></label>
      </div>
      <button class="btn-primary btn-big" type="submit">Start match</button>
    </form>`;
}
viewNew.after = () => {
  const f = $('#new-form');
  if (!f) return;
  f.elements.sport.addEventListener('change', () => { // reset periods to the sport's default
    const sp = getSports().find((s) => s.id === f.elements.sport.value);
    if (!sp) return;
    f.elements.pcount.value = sp.periods.count;
    f.elements.pminutes.value = sp.periods.minutes;
  });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const sport = getSports().find((s) => s.id === fd.get('sport'));
    if (!sport) return toast('Pick a sport');
    const home = fd.get('home').trim();
    const away = fd.get('away').trim();
    const teams = getTeams();
    for (const n of [home, away]) if (n && !teams.some((t) => t.toLowerCase() === n.toLowerCase())) teams.push(n);
    teams.sort((a, b) => a.localeCompare(b));
    store.set('teams', teams);
    store.set('lastSport', sport.id);
    store.set('live', {
      id: uid(),
      sport: clone(sport), // snapshot so later settings edits don't change this match
      home, away,
      startedAt: Date.now(),
      endedAt: null,
      periods: {
        count: Math.min(8, Math.max(1, parseInt(fd.get('pcount'), 10) || sport.periods.count)),
        minutes: Math.min(120, Math.max(1, parseInt(fd.get('pminutes'), 10) || sport.periods.minutes)),
      },
      period: 1,
      inBreak: false,
      playedMs: 0,
      reminded: [],
      clock: { elapsedMs: 0, runningSince: null },
      events: [],
    });
    go('live');
    kickOffPrompt();
  });
};

function startClock() {
  updateLive((m) => { if (!m.clock.runningSince) m.clock.runningSince = Date.now(); });
  if (navigator.vibrate) navigator.vibrate(50);
}

function kickOffPrompt() {
  const m = getLive();
  openModal(`
    <div class="kickoff">
      <h2>${esc(teamName(m, 'home'))} v ${esc(teamName(m, 'away'))}</h2>
      <p class="muted">Tap at kick-off to start the match clock.</p>
      <button class="btn-primary kickoff-btn" data-modal="start">▶<br>Start clock</button>
      <button class="btn-ghost btn-block" data-modal="later">Not yet</button>
    </div>`, (res) => { if (res === 'start') startClock(); });
}

/* Resolves true if the user confirms. Tapping outside counts as cancel. */
function confirmModal(title, body, okLabel, cancelLabel, danger = false) {
  return new Promise((resolve) => {
    openModal(`
      <h2>${esc(title)}</h2>
      ${body ? `<p class="muted">${esc(body)}</p>` : ''}
      <div class="prompt-actions">
        <button data-modal="cancel">${esc(cancelLabel)}</button>
        <button class="${danger ? 'btn-danger' : 'btn-primary'}" data-modal="ok">${esc(okLabel)}</button>
      </div>`, (res) => resolve(res === 'ok'));
  });
}

function viewLive() {
  const m = getLive();
  if (!m) { setTimeout(() => go(''), 0); return ''; }
  const t = totals(m);
  const buttons = m.sport.scoreTypes.filter((st) => !st.hidden);
  const col = (side) => `
    <div class="col ${side}">
      ${buttons.map((st) => `<button class="score-btn" data-score="${side}:${esc(st.id)}">${esc(st.name)}<small>+${st.points}</small></button>`).join('')}
    </div>`;
  const running = !!m.clock.runningSince;
  const over = isTimeUp(m) && !m.inBreak;
  const started = m.clock.elapsedMs > 0 || running;
  let bar = '';
  if (m.inBreak) {
    bar = `<button class="btn-primary start-bar" data-action="next-period">▶ Start ${esc(periodName(m, m.period + 1))}</button>`;
  } else if (over) {
    bar = `<button class="whistle-bar" data-action="whistle">⏱ ${esc(whistleName(m))}</button>`;
  } else if (!running) {
    bar = `<button class="btn-primary start-bar" data-action="start-clock">▶ ${started ? 'Resume clock' : 'Start clock'}</button>`;
  }
  const status = m.inBreak ? whistleName(m) : periodName(m);
  return `
    <div class="topbar"><button class="btn-ghost btn-small" data-go="">‹ Home</button><span class="tag">${esc(m.sport.name)}</span></div>
    ${over ? `<div class="timeup-banner">${esc(whistleName(m))}<small>Tap the button below when the ref blows</small></div>` : ''}
    <div class="scoreboard${over ? ' is-over' : ''}">
      <div class="team home">${esc(teamName(m, 'home'))}</div>
      <div></div>
      <div class="team away">${esc(teamName(m, 'away'))}</div>
      <div class="score">${t.home}</div>
      <div class="dash">–</div>
      <div class="score">${t.away}</div>
      <div class="period-label">${esc(status)}</div>
      <div class="clock-row">
        <span class="clock ${running ? '' : 'paused'} ${over ? 'over' : ''}" id="clock">${fmtMatchClock(m)}</span>
        ${running ? '<button class="clock-btn" data-action="pause-clock">❚❚ Pause</button>' : ''}
      </div>
    </div>
    ${bar}
    ${!running && started && !over && !m.inBreak ? `<button class="btn-ghost btn-small" data-action="whistle">End ${esc(periodName(m))} early</button>` : ''}
    <div class="columns">${col('home')}${col('away')}</div>
    ${debugOn() ? debugPanel(m) : ''}
    <div class="actionbar">
      <button data-action="undo" ${m.events.some((e) => !isMarker(e)) ? '' : 'disabled'}>Undo</button>
      <button data-go="log/live">Log (${m.events.length})</button>
      <button class="btn-danger" data-action="end">End</button>
    </div>`;
}

function updateLive(fn) {
  const m = getLive();
  if (!m) return;
  fn(m);
  store.set('live', m);
  render();
}

function addScore(side, typeId) {
  const m = getLive();
  const st = typeById(m, typeId);
  if (!st) return;
  const minute = matchMinute(m);
  const period = m.period;
  updateLive((m) => m.events.push({ id: uid(), team: side, scoreTypeId: st.id, minute, period, made: true, createdAt: Date.now() }));
  if (navigator.vibrate) navigator.vibrate(30);
  const fu = st.followUpId && typeById(m, st.followUpId);
  if (!fu) return toast(`${st.name} – ${teamName(m, side)}`);
  openModal(`
    <h2>${esc(fu.name)} – ${esc(teamName(m, side))}</h2>
    <p class="muted">After ${esc(st.name.toLowerCase())} at ${fmtMinute(m, { minute, period })}</p>
    <div class="prompt-actions">
      <button class="btn-grey" data-modal="missed">Missed</button>
      <button class="btn-primary" data-modal="made">Made +${fu.points}</button>
    </div>`, (res) => {
    const made = res === 'made';
    updateLive((m) => m.events.push({ id: uid(), team: side, scoreTypeId: fu.id, minute, period, made, createdAt: Date.now() }));
    toast(`${fu.name} ${made ? 'made' : 'missed'}`);
  });
}

function viewLog(ref) {
  const m = getMatch(ref);
  if (!m) { setTimeout(() => go(''), 0); return ''; }
  const back = ref === 'live' ? 'live' : `match/${ref}`;
  const evs = sortedEvents(m);
  return `
    <div class="topbar"><button class="btn-ghost btn-small" data-go="${back}">‹ Back</button><h2>Event log</h2></div>
    <button class="btn-primary" data-action="add-event" data-ref="${esc(ref)}">+ Add missed event</button>
    ${evs.length ? `<ul class="list">${evs.map((e) => eventRow(m, e, ref)).join('')}</ul>` : '<p class="empty">No events yet.</p>'}
    ${evs.length ? '<p class="muted" style="text-align:center;font-size:.85rem">Tap an event to edit or delete it.</p>' : ''}`;
}

function markerLabel(m, e) {
  return e.marker === 'timeup' ? `Time up – ${periodName(m, e.period)}` : whistleName(m, e.period);
}

function eventRow(m, e, ref) {
  if (isMarker(e)) {
    const inner = `
      <span class="min">${fmtMinute(m, e)}</span>
      <span class="marker-icon">${e.marker === 'timeup' ? '⏱' : '📣'}</span>
      <span class="grow"><span>${esc(markerLabel(m, e))}</span></span>`;
    return ref
      ? `<li><button class="list-item marker ${e.marker}" data-action="edit-event" data-ref="${esc(ref)}" data-id="${esc(e.id)}">${inner}</button></li>`
      : `<li class="list-item marker ${e.marker}">${inner}</li>`;
  }
  const st = typeById(m, e.scoreTypeId);
  const label = `${esc(st ? st.name : 'Unknown')}${e.made ? '' : ' (missed)'}`;
  const inner = `
    <span class="min">${fmtMinute(m, e)}</span>
    <span class="dot ${e.team}"></span>
    <span class="grow"><span class="${e.made ? '' : 'missed'}">${label}</span><br><span class="tag">${esc(teamName(m, e.team))}</span></span>
    <span class="tag">${e.made && st ? '+' + st.points : ''}</span>`;
  return ref
    ? `<li><button class="list-item" data-action="edit-event" data-ref="${esc(ref)}" data-id="${esc(e.id)}">${inner}</button></li>`
    : `<li class="list-item">${inner}</li>`;
}

function eventForm(ref, e) {
  const m = getMatch(ref);
  const isNew = !e;
  e = e || { team: 'home', scoreTypeId: m.sport.scoreTypes[0]?.id, minute: matchMinute(m), period: m.period, made: true };
  const periodOpts = Array.from({ length: m.periods.count }, (_, i) => i + 1)
    .map((p) => `<option value="${p}" ${p === (e.period || 1) ? 'selected' : ''}>${esc(periodName(m, p))}</option>`).join('');
  const typeOpts = m.sport.scoreTypes.map((st) => `<option value="${esc(st.id)}" ${st.id === e.scoreTypeId ? 'selected' : ''}>${esc(st.name)} (+${st.points})</option>`).join('');
  openModal(`
    <h2>${isNew ? 'Add event' : 'Edit event'}</h2>
    <form id="event-form" class="stack" method="dialog">
      <label>Team<select name="team">
        <option value="home" ${e.team === 'home' ? 'selected' : ''}>${esc(teamName(m, 'home'))}</option>
        <option value="away" ${e.team === 'away' ? 'selected' : ''}>${esc(teamName(m, 'away'))}</option>
      </select></label>
      <label>Score type<select name="type">${typeOpts}</select></label>
      <div class="row">
        ${m.periods.count > 1 ? `<label>Period<select name="period">${periodOpts}</select></label>` : ''}
        <label>Minute<input name="minute" type="number" inputmode="numeric" min="1" max="999" value="${e.minute}" required></label>
      </div>
      <p class="muted form-hint">For added time use the full minute, e.g. 42 for 40+2.</p>
      <div class="row">
        <label>Result<select name="made">
          <option value="1" ${e.made ? 'selected' : ''}>Made</option>
          <option value="0" ${e.made ? '' : 'selected'}>Missed</option>
        </select></label>
      </div>
      <div class="row">
        ${isNew ? '<button type="button" data-modal="cancel">Cancel</button>' : '<button type="button" class="btn-danger" data-modal="delete">Delete</button>'}
        <button type="submit" class="btn-primary" value="save">Save</button>
      </div>
    </form>`, (res) => {
    if (res === 'dismiss' || res === 'cancel') return;
    const m2 = getMatch(ref);
    if (res === 'delete') {
      if (!confirm('Delete this event?')) return;
      m2.events = m2.events.filter((x) => x.id !== e.id);
    } else {
      const ev = isNew ? { id: uid(), createdAt: Date.now() } : m2.events.find((x) => x.id === e.id);
      Object.assign(ev, res);
      if (isNew) m2.events.push(ev);
    }
    saveMatch(ref, m2);
    render();
  });
  const f = $('#event-form');
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const fd = new FormData(f);
    const minute = Math.max(1, parseInt(fd.get('minute'), 10) || 1);
    const period = parseInt(fd.get('period'), 10) || 1;
    closeModal({ team: fd.get('team'), scoreTypeId: fd.get('type'), minute, period, made: fd.get('made') === '1' });
  });
}

function viewHistory() {
  const h = getHistory();
  return `
    <div class="topbar"><button class="btn-ghost btn-small" data-go="">‹ Back</button><h2>History</h2></div>
    ${h.length ? `<ul class="list">${h.map((m) => {
      const t = totals(m);
      return `<li><button class="list-item" data-go="match/${esc(m.id)}">
        <span class="grow"><span class="tag">${new Date(m.startedAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${esc(m.sport.name)}</span><br>
        ${esc(teamName(m, 'home'))} <span class="big-score">${t.home} – ${t.away}</span> ${esc(teamName(m, 'away'))}</span>
        <span class="tag">›</span></button></li>`;
    }).join('')}</ul>` : '<p class="empty">No finished matches yet.</p>'}`;
}

function viewMatch(id) {
  const m = getMatch(id);
  if (!m) { setTimeout(() => go('history'), 0); return ''; }
  const t = totals(m);
  const bd = (side) => {
    const lines = breakdown(m, side);
    return `<div class="card team-card ${side}"><strong class="team-label">${esc(teamName(m, side))}</strong>
      ${lines.length ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="muted">No scores</p>'}</div>`;
  };
  const evs = sortedEvents(m);
  return `
    <div class="topbar"><button class="btn-ghost btn-small" data-go="history">‹ History</button><span class="tag">${esc(m.sport.name)}</span></div>
    <div class="scoreboard" style="position:static">
      <div class="team home">${esc(teamName(m, 'home'))}</div><div></div><div class="team away">${esc(teamName(m, 'away'))}</div>
      <div class="score">${t.home}</div><div class="dash">–</div><div class="score">${t.away}</div>
      <div class="clock-row tag">${new Date(m.startedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · ${fmtClock(playedMs(m))} played</div>
    </div>
    <h3>Breakdown</h3>
    <div class="breakdown">${bd('home')}${bd('away')}</div>
    <h3>Timeline</h3>
    ${evs.length ? `<ul class="list">${evs.map((e) => eventRow(m, e, null)).join('')}</ul>` : '<p class="empty">No events.</p>'}
    <div class="row">
      <button data-go="log/${esc(m.id)}">Edit log</button>
      <button class="btn-danger" data-action="delete-match" data-id="${esc(m.id)}">Delete match</button>
    </div>`;
}

function viewSettings() {
  const sports = getSports();
  const teams = getTeams();
  const missingPresets = PRESETS.filter((p) => !sports.some((s) => s.id === p.id));
  return `
    <div class="topbar"><button class="btn-ghost btn-small" data-go="">‹ Back</button><h2>Settings</h2></div>
    <h3>Sports &amp; scoring</h3>
    <ul class="list">${sports.map((s) => `
      <li><button class="list-item" data-go="sport/${esc(s.id)}">
        <span class="grow">${esc(s.name)}<br><span class="tag">${s.periods.count} × ${s.periods.minutes} min · ${s.scoreTypes.map((t) => `${esc(t.name)} ${t.points}`).join(' · ')}</span></span>
        <span class="tag">Edit ›</span></button></li>`).join('')}
    </ul>
    <button data-go="sport/new">+ New sport</button>
    ${missingPresets.length ? `<button class="btn-ghost" data-action="restore-presets">Restore default sports</button>` : ''}
    <h3>Time-up alerts</h3>
    <label class="check"><input type="checkbox" data-action="toggle-sound" ${store.get('sound', true) === false ? '' : 'checked'}> Beep when a half (or period) is up</label>
    <p class="muted" style="font-size:.95rem">The clock always flashes, and Android phones also vibrate.</p>
    <h3>Saved teams</h3>
    ${teams.length ? `<ul class="list">${teams.map((t, i) => `
      <li class="list-item"><span class="grow">${esc(t)}</span><button class="btn-small btn-ghost" data-action="delete-team" data-i="${i}" aria-label="Delete ${esc(t)}">✕</button></li>`).join('')}</ul>`
      : '<p class="muted">Team names you type when starting a match are saved here.</p>'}`;
}

/* sport editor keeps a working draft so add/remove rows don't lose typed input */
let sportDraft = null;
function viewSport(id) {
  if (!sportDraft || sportDraft._for !== id) {
    const existing = getSports().find((s) => s.id === id);
    sportDraft = existing ? clone(existing)
      : { id: uid(), name: '', periods: clone(DEFAULT_PERIODS), scoreTypes: [{ id: uid(), name: '', points: 1, followUpId: null, hidden: false }] };
    sportDraft._for = id;
    sportDraft._isNew = !existing;
  }
  const d = sportDraft;
  const rows = d.scoreTypes.map((st, i) => {
    const fuOpts = d.scoreTypes.filter((o) => o.id !== st.id)
      .map((o) => `<option value="${esc(o.id)}" ${o.id === st.followUpId ? 'selected' : ''}>${esc(o.name || 'Untitled')}</option>`).join('');
    return `
      <div class="card st-editor" data-i="${i}">
        <div class="row">
          <label>Score name<input name="st-name" value="${esc(st.name)}" placeholder="e.g. Try" maxlength="30" required></label>
          <label class="pts">Points<input name="st-points" type="number" inputmode="numeric" min="0" max="99" value="${st.points}" required></label>
        </div>
        <label>Follow-up prompt<select name="st-followup"><option value="">None</option>${fuOpts}</select></label>
        <label class="check"><input type="checkbox" name="st-hidden" ${st.hidden ? 'checked' : ''}> Only via follow-up prompt (no button)</label>
        <button type="button" class="btn-small btn-ghost" data-action="remove-type" data-i="${i}" ${d.scoreTypes.length < 2 ? 'disabled' : ''}>Remove score type</button>
      </div>`;
  }).join('');
  return `
    <div class="topbar"><button class="btn-ghost btn-small" data-action="cancel-sport">‹ Cancel</button><h2>${d._isNew ? 'New sport' : 'Edit sport'}</h2></div>
    <form id="sport-form" class="stack">
      <label>Sport name<input name="name" value="${esc(d.name)}" placeholder="e.g. Rugby League" maxlength="40" required></label>
      <div class="row">
        <label>Periods<input name="pcount" type="number" inputmode="numeric" min="1" max="8" value="${d.periods.count}" required></label>
        <label>Minutes each<input name="pminutes" type="number" inputmode="numeric" min="1" max="120" value="${d.periods.minutes}" required></label>
      </div>
      <h3>Score types</h3>
      ${rows}
      <button type="button" data-action="add-type">+ Add score type</button>
      <p class="muted" style="font-size:.9rem">Changes apply to new matches only. Past matches keep their original scoring.</p>
      <button type="submit" class="btn-primary btn-big">Save</button>
      ${d._isNew ? '' : '<button type="button" class="btn-danger" data-action="delete-sport">Delete sport</button>'}
    </form>`;
}

function readSportForm() {
  const f = $('#sport-form');
  if (!f || !sportDraft) return;
  sportDraft.name = f.elements.name.value;
  sportDraft.periods = {
    count: Math.min(8, Math.max(1, parseInt(f.elements.pcount.value, 10) || 2)),
    minutes: Math.min(120, Math.max(1, parseInt(f.elements.pminutes.value, 10) || 40)),
  };
  f.querySelectorAll('.st-editor').forEach((el) => {
    const st = sportDraft.scoreTypes[+el.dataset.i];
    st.name = $('[name=st-name]', el).value;
    st.points = parseInt($('[name=st-points]', el).value, 10) || 0;
    st.followUpId = $('[name=st-followup]', el).value || null;
    st.hidden = $('[name=st-hidden]', el).checked;
  });
}

viewSport.after = () => {
  const f = $('#sport-form');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    readSportForm();
    const d = sportDraft;
    d.name = d.name.trim();
    d.scoreTypes.forEach((st) => { st.name = st.name.trim(); });
    if (!d.name) return toast('Give the sport a name');
    if (d.scoreTypes.some((st) => !st.name)) return toast('Every score type needs a name');
    if (!d.scoreTypes.some((st) => !st.hidden)) return toast('At least one score type needs a button');
    const ids = new Set(d.scoreTypes.map((st) => st.id));
    d.scoreTypes.forEach((st) => { if (st.followUpId && !ids.has(st.followUpId)) st.followUpId = null; });
    const { _for, _isNew, ...sport } = d;
    const sports = getSports();
    const i = sports.findIndex((s) => s.id === sport.id);
    if (i >= 0) sports[i] = sport; else sports.push(sport);
    store.set('sports', sports);
    sportDraft = null;
    toast('Saved');
    go('settings');
  });
};

/* ---------- periods: whistle & time-up cues ---------- */

/* Stops the clock for the current period and logs the whistle. Mutates m. */
function blowWhistle(m) {
  const el = elapsedMs(m);
  m.events.push({ id: uid(), marker: 'whistle', period: m.period, minute: periodStartMin(m) + Math.max(1, Math.ceil(el / 60000)), team: null, made: false, createdAt: Date.now() });
  m.playedMs += el;
  m.clock = { elapsedMs: el, runningSince: null };
  m.inBreak = true;
}

const REMINDER_MIN = 10; // repeat the cue if the period runs this far over

/* Called on every clock tick: logs time-up and fires the cue once per period. */
function checkTimeUp() {
  const m = getLive();
  if (!m || m.inBreak || !m.clock.runningSince || !isTimeUp(m)) return;
  const logged = m.events.some((e) => e.marker === 'timeup' && e.period === m.period);
  const overBy = elapsedMs(m) - periodMs(m);
  if (!logged) {
    m.events.push({ id: uid(), marker: 'timeup', period: m.period, minute: periodEndMin(m), team: null, made: false, createdAt: Date.now() });
    store.set('live', m);
    if ($('#clock')) render();
    if (overBy < 60000) cue(); // don't sound off if we only noticed late (app was closed)
  } else if (overBy >= REMINDER_MIN * 60000 && !m.reminded.includes(m.period)) {
    m.reminded.push(m.period);
    store.set('live', m);
    cue();
    toast(`${REMINDER_MIN} min over – still playing?`);
  }
}

function cue() {
  if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
  beep();
  document.body.classList.remove('flash');
  void document.body.offsetWidth; // restart the animation
  document.body.classList.add('flash');
}

/* Web Audio beep. iPhone only allows sound after a tap, so armAudio() runs on every tap. */
let audioCtx = null;
function armAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* no audio */ }
}
function beep() {
  if (!audioCtx || store.get('sound', true) === false) return;
  const t0 = audioCtx.currentTime;
  [[0, 880], [0.25, 880], [0.5, 1320]].forEach(([at, hz]) => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'square';
    o.frequency.value = hz;
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.2);
    o.connect(g).connect(audioCtx.destination);
    o.start(t0 + at);
    o.stop(t0 + at + 0.22);
  });
}

/* ---------- debug mode ----------
   Hidden: tap the version number 5 times. Lets you jump the match clock to test cues. */
const debugOn = () => store.get('debug', false) === true;

function debugPanel(m) {
  const b = (label, action, extra = '') => `<button class="btn-small" data-action="${action}" ${extra}>${label}</button>`;
  return `
    <div class="card debug-panel">
      <strong>Debug · ${esc(periodName(m))}</strong>
      <div class="debug-grid">
        ${b('+1 min', 'debug-skip', 'data-ms="60000"')}
        ${b('+5 min', 'debug-skip', 'data-ms="300000"')}
        ${b('10s before end', 'debug-jump', 'data-to="-10000"')}
        ${b('+10 min over', 'debug-jump', 'data-to="600500"')}
        ${b('Reset period', 'debug-jump', 'data-to="0"')}
        ${b('Test cue', 'debug-cue')}
      </div>
    </div>`;
}

/* Sets time elapsed in the current period, keeping the clock running or paused. */
function setElapsed(m, ms) {
  const running = !!m.clock.runningSince;
  m.clock.elapsedMs = Math.max(0, ms);
  m.clock.runningSince = running ? Date.now() : null;
  // let time-up and the reminder fire again for this period after jumping back
  m.events = m.events.filter((e) => !(e.marker === 'timeup' && e.period === m.period && ms < periodMs(m)));
  m.reminded = m.reminded.filter((p) => !(p === m.period && ms < periodMs(m) + REMINDER_MIN * 60000));
}

let versionTaps = [];

/* ---------- actions ---------- */
const actions = {
  'start-clock'() { startClock(); },
  async 'pause-clock'() {
    const ok = await confirmModal('Pause the clock?', 'Use this for half-time or stoppages.', '❚❚ Pause', 'Keep running');
    if (!ok) return;
    updateLive((m) => {
      if (!m.clock.runningSince) return;
      m.clock.elapsedMs += Date.now() - m.clock.runningSince;
      m.clock.runningSince = null;
    });
  },
  undo() {
    const m = getLive();
    const scores = m ? m.events.filter((e) => !isMarker(e)) : [];
    if (!scores.length) return;
    const last = scores.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    const st = typeById(m, last.scoreTypeId);
    updateLive((m) => { m.events = m.events.filter((e) => e.id !== last.id); });
    toast(`Undid ${st ? st.name : 'event'} – ${teamName(m, last.team)}`);
  },
  async end() {
    const ok = await confirmModal('End the match?', 'The final score is saved to history. You can still edit the log afterwards.', 'End match', 'Keep playing', true);
    const m = getLive();
    if (!ok || !m) return;
    if (!m.inBreak) blowWhistle(m);
    m.endedAt = Date.now();
    const h = getHistory();
    h.unshift(m);
    store.set('history', h);
    store.del('live');
    setWakeLock(false);
    go('match/' + m.id);
  },
  async whistle() {
    const m = getLive();
    if (!m) return;
    if (isLastPeriod(m)) return actions.end();
    if (!isTimeUp(m)) {
      const ok = await confirmModal(`End ${periodName(m)} early?`, `The clock shows ${fmtClock(periodStartMin(m) * 60000 + elapsedMs(m))}.`, whistleName(m), 'Cancel');
      if (!ok) return;
    }
    updateLive((m) => blowWhistle(m));
    toast(whistleName(getLive()));
  },
  'next-period'() {
    updateLive((m) => {
      m.period += 1;
      m.inBreak = false;
      m.clock = { elapsedMs: 0, runningSince: Date.now() };
    });
    armAudio();
    if (navigator.vibrate) navigator.vibrate(50);
  },
  'add-event'(el) { eventForm(el.dataset.ref, null); },
  async 'edit-event'(el) {
    const ref = el.dataset.ref;
    const m = getMatch(ref);
    const e = m.events.find((x) => x.id === el.dataset.id);
    if (!isMarker(e)) return eventForm(ref, e);
    const ok = await confirmModal(markerLabel(m, e), `Logged at ${fmtMinute(m, e)}. This entry doesn't affect the score.`, 'Delete entry', 'Keep', true);
    if (!ok) return;
    const m2 = getMatch(ref);
    m2.events = m2.events.filter((x) => x.id !== e.id);
    saveMatch(ref, m2);
    render();
  },
  'version-tap'() {
    const now = Date.now();
    versionTaps = versionTaps.filter((t) => now - t < 2500).concat(now);
    if (versionTaps.length < 5) return;
    versionTaps = [];
    store.set('debug', !debugOn());
    toast(debugOn() ? 'Debug mode on' : 'Debug mode off');
    render();
  },
  'debug-skip'(el) { updateLive((m) => setElapsed(m, elapsedMs(m) + Number(el.dataset.ms))); },
  'debug-jump'(el) {
    updateLive((m) => {
      const to = Number(el.dataset.to);
      setElapsed(m, to < 0 ? periodMs(m) + to : to === 0 ? 0 : periodMs(m) + to);
    });
  },
  'debug-cue'() { cue(); },
  'toggle-sound'(el) {
    store.set('sound', el.checked);
    if (el.checked) { armAudio(); beep(); }
  },
  'delete-match'(el) {
    if (!confirm('Delete this match permanently?')) return;
    store.set('history', getHistory().filter((m) => m.id !== el.dataset.id));
    go('history');
  },
  'delete-team'(el) {
    const t = getTeams();
    t.splice(+el.dataset.i, 1);
    store.set('teams', t);
    render();
  },
  'restore-presets'() {
    const s = getSports();
    for (const p of PRESETS) if (!s.some((x) => x.id === p.id)) s.push(clone(p));
    store.set('sports', s);
    render();
  },
  'add-type'() {
    readSportForm();
    sportDraft.scoreTypes.push({ id: uid(), name: '', points: 1, followUpId: null, hidden: false });
    render();
  },
  'remove-type'(el) {
    readSportForm();
    const [gone] = sportDraft.scoreTypes.splice(+el.dataset.i, 1);
    sportDraft.scoreTypes.forEach((st) => { if (st.followUpId === gone.id) st.followUpId = null; });
    render();
  },
  'cancel-sport'() { sportDraft = null; go('settings'); },
  'delete-sport'() {
    if (!confirm(`Delete "${sportDraft.name}"? Past matches are not affected.`)) return;
    store.set('sports', getSports().filter((s) => s.id !== sportDraft.id));
    sportDraft = null;
    go('settings');
  },
};

document.addEventListener('click', (e) => {
  armAudio();
  const el = e.target.closest('[data-go],[data-action],[data-score],[data-modal]');
  if (!el) return;
  if (el.dataset.modal) { e.preventDefault(); return closeModal(el.dataset.modal); }
  if (el.dataset.score) {
    const [side, id] = el.dataset.score.split(':');
    return addScore(side, id);
  }
  if (el.dataset.action && actions[el.dataset.action]) return actions[el.dataset.action](el);
  if (el.dataset.go !== undefined) go(el.dataset.go);
});

/* ---------- clock tick ---------- */
setInterval(() => {
  checkTimeUp();
  const c = $('#clock');
  const m = c && getLive();
  if (m) c.innerHTML = fmtMatchClock(m);
}, 500);

/* ---------- boot ---------- */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    // Home-screen apps often resume instead of reloading, so check on every return to the foreground.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {});
  // A new version has installed and taken over: offer a reload rather than interrupting a match.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) showUpdateBar();
  });
}

function showUpdateBar() {
  if ($('#update-bar')) return;
  const bar = document.createElement('button');
  bar.id = 'update-bar';
  bar.textContent = 'New version available – tap to update';
  bar.addEventListener('click', () => location.reload());
  document.body.appendChild(bar);
}

// Version is stamped into index.html at deploy time (see scripts/build.mjs).
const APP_VERSION = document.querySelector('meta[name=app-version]')?.content || 'dev';
if (!location.hash && getLive()) go('live'); else render();
