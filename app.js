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
    if (k === 'live' && v && v.live) publishLive(v); // live score sharing: push every change
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
    id: 'golf',
    name: 'Golf',
    kind: 'golf', // stroke play per hole, not team scoring: see the golf section
    periods: { count: 1, minutes: 1 },
    scoreTypes: [],
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
  if (!s.some((x) => x.id === 'golf') && !store.get('golfAdded')) { // golf added after launch
    s.splice(1, 0, clone(PRESETS.find((p) => p.id === 'golf')));
    store.set('sports', s);
    store.set('golfAdded', true);
  }
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

/* ---------- full screen ----------
   Android Chrome can hide the status and navigation bars. iPhone ignores this (no API);
   there the home-screen app is as full screen as it gets. Must be called from a tap. */
function enterFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation?.lock?.('portrait'))
    .catch(() => { /* not allowed here; carry on */ });
}
function exitFullscreen() {
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}

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
  view: viewShared,
  card: viewGolfCard,
  course: viewCourse,
  help: viewHelp,
  watch: viewWatch,
};

function render() {
  const [name, ...args] = route();
  const view = views[name] || viewHome;
  const app = $('#app');
  app.innerHTML = view(...args) + `<footer class="app-version" data-action="version-tap">Version ${esc(APP_VERSION)}</footer>`;
  // small tally logo, top-right of every header except Home (which has the big logo)
  const bar = name ? app.querySelector('.topbar') : null;
  if (bar) bar.insertAdjacentHTML('beforeend', '<img class="header-logo" src="assets/brand/tally.webp" alt="" width="109" height="96">');
  document.body.classList.toggle('debug', debugOn());
  window.scrollTo(0, 0);
  if (view.after) view.after(...args);
  setWakeLock(name === 'live' && !!getLive());
  if (name !== 'watch') stopWatching();
}

/* ---------- views ---------- */
function viewHome() {
  const live = getLive();
  const t = live && totals(live);
  return `
    <div class="logo-bar"><h1 class="logo"><img src="assets/brand/logo.webp" alt="Scorecard" width="900" height="516"></h1></div>
    ${live ? `
      <button class="card resume-card stack btn-block" data-action="resume-match" style="text-align:left;align-items:stretch;min-height:auto;padding:16px">
        <span class="tag">Match in progress · ${esc(live.sport.name)}</span>
        <span style="font-size:1.4rem">${esc(teamName(live, 'home'))} <span class="big-score">${t.home} – ${t.away}</span> ${esc(teamName(live, 'away'))}</span>
        <span class="btn btn-primary">Resume match</span>
      </button>` : `
      <button class="btn-primary btn-big btn-block" data-go="new">New match</button>`}
    <button class="btn-big btn-block btn-paint" data-go="history">History</button>
    <button class="btn-big btn-block btn-paint" data-go="settings">Settings</button>
    <button class="btn-ghost btn-block" data-go="help">Help &amp; FAQ</button>
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
  const golf = sel && sel.kind === 'golf';
  return `
    <div class="topbar"><button class="btn-ghost btn-small" data-go="">‹ Back</button><h2>New match</h2></div>
    <form id="new-form" class="stack">
      <label>Sport<select name="sport">${opts}</select></label>
      <fieldset id="golf-fields" class="stack plain" ${golf ? '' : 'hidden disabled'}>${golfNewFields()}</fieldset>
      <fieldset id="team-fields" class="stack plain" ${golf ? 'hidden disabled' : ''}>
      <label>Home team<input name="home" placeholder="Home" list="teams" autocomplete="off" maxlength="40"></label>
      <label>Away team<input name="away" placeholder="Away" list="teams" autocomplete="off" maxlength="40"></label>
      <datalist id="teams">${teams}</datalist>
      <div class="row">
        <label>Periods<input name="pcount" type="number" inputmode="numeric" min="1" max="8" value="${sel ? sel.periods.count : 2}" required></label>
        <label>Minutes each<input name="pminutes" type="number" inputmode="numeric" min="1" max="120" value="${sel ? sel.periods.minutes : 40}" required></label>
      </div>
      </fieldset>
      <button class="btn-primary btn-big" type="submit">${golf ? 'Start round' : 'Start match'}</button>
    </form>`;
}
viewNew.after = () => {
  const f = $('#new-form');
  if (!f) return;
  golfNewFieldsAfter(f);
  f.elements.sport.addEventListener('change', () => { // reset periods to the sport's default
    const sp = getSports().find((s) => s.id === f.elements.sport.value);
    if (!sp) return;
    const golf = sp.kind === 'golf';
    for (const [id, on] of [['#golf-fields', golf], ['#team-fields', !golf]]) { $(id).hidden = !on; $(id).disabled = !on; }
    f.querySelector('[type=submit]').textContent = golf ? 'Start round' : 'Start match';
    if (golf) return;
    f.elements.pcount.value = sp.periods.count;
    f.elements.pminutes.value = sp.periods.minutes;
  });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const sport = getSports().find((s) => s.id === fd.get('sport'));
    if (!sport) return toast('Pick a sport');
    if (sport.kind === 'golf') return startGolfRound(f, sport);
    const home = fd.get('home').trim();
    const away = fd.get('away').trim();
    rememberTeams([home, away]);
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
    enterFullscreen();
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
      <div class="prompt-actions${okLabel.length > 12 ? ' stacked' : ''}">
        <button data-modal="cancel">${esc(cancelLabel)}</button>
        <button class="${danger ? 'btn-danger' : 'btn-primary'}" data-modal="ok">${esc(okLabel)}</button>
      </div>`, (res) => resolve(res === 'ok'));
  });
}

function viewLive() {
  const m = getLive();
  if (!m) { setTimeout(() => go(''), 0); return ''; }
  if (isGolf(m)) return viewGolf(m);
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
    <div class="topbar"><button class="btn-ghost btn-small" data-go="">‹ Home</button><span class="tag">${esc(m.sport.name)}</span><span class="spacer"></span>${liveButton(m)}<button class="btn-ghost btn-small" data-action="edit-match" data-ref="live">Edit</button></div>
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
    <div class="columns${running ? '' : ' stopped'}">${col('home')}${col('away')}</div>
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

/* Scores only count while the clock runs. If it's stopped, offer to start it (or the next
   period during a break) so a real score isn't lost when someone forgot to restart it. */
async function addScore(side, typeId) {
  let m = getLive();
  if (!m || !typeById(m, typeId)) return;
  if (!m.clock.runningSince) {
    const label = m.inBreak ? `Start ${periodName(m, m.period + 1)} & add score` : 'Start clock & add score';
    const ok = await confirmModal("The clock isn't running", m.inBreak
      ? `It's ${whistleName(m).toLowerCase()}. Start the next period to add this score.`
      : 'Scores can only be added while the clock is running.', label, 'Cancel');
    if (!ok) return;
    if (m.inBreak) actions['next-period']();
    else startClock();
    m = getLive();
  }
  const st = typeById(m, typeId);
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
    <button data-action="open-link">Open a shared link</button>
    ${h.length ? `<ul class="list">${h.map((m) => {
      if (isGolf(m)) return golfHistoryRow(m);
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
  if (isGolf(m)) return viewGolfMatch(m);
  return `
    <div class="topbar"><button class="btn-ghost btn-small" data-go="history">‹ History</button><span class="tag">${esc(m.sport.name)}</span></div>
    ${matchSummary(m)}
    <button class="btn-primary" data-action="share-match" data-id="${esc(m.id)}">Share result</button>
    <div class="row">
      <button data-action="edit-match" data-ref="${esc(m.id)}">Edit match</button>
      <button data-go="log/${esc(m.id)}">Edit log</button>
    </div>
    <button class="btn-danger" data-action="delete-match" data-id="${esc(m.id)}">Delete match</button>`;
}

/* ---------- edit match ---------- */

/* Changes period length/count and shifts event times in later periods to match.
   e.g. 2x40 -> 2x35: a 2nd-half try at 46' becomes 41'. Mutates m. */
function retimeMatch(m, periods) {
  const diff = periods.minutes - m.periods.minutes;
  for (const e of m.events) {
    const p = e.period || 1;
    if (e.marker === 'timeup') e.minute = p * periods.minutes;
    else if (p > 1) e.minute = Math.max(1, e.minute + (p - 1) * diff);
  }
  m.periods = periods;
  // let time-up / reminder fire again if the current period is no longer over
  if (!m.endedAt && !m.inBreak && !isTimeUp(m)) {
    m.events = m.events.filter((e) => !(e.marker === 'timeup' && e.period === m.period));
    m.reminded = m.reminded.filter((p) => p !== m.period);
  }
}

const toLocalInput = (ms) => {
  const d = new Date(ms);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function editMatchForm(ref) {
  const m = getMatch(ref);
  if (!m) return;
  if (isGolf(m)) return editGolfForm(ref);
  const teams = getTeams().map((t) => `<option value="${esc(t)}">`).join('');
  const usedPeriods = Math.max(m.period || 1, ...m.events.map((e) => e.period || 1));
  openModal(`
    <h2>Edit match</h2>
    <form id="match-form" class="stack" method="dialog">
      <label>Home team<input name="home" value="${esc(m.home)}" placeholder="Home" list="teams-edit" autocomplete="off" maxlength="40"></label>
      <label>Away team<input name="away" value="${esc(m.away)}" placeholder="Away" list="teams-edit" autocomplete="off" maxlength="40"></label>
      <datalist id="teams-edit">${teams}</datalist>
      <div class="row">
        <label>Periods<input name="pcount" type="number" inputmode="numeric" min="${usedPeriods}" max="8" value="${m.periods.count}" required></label>
        <label>Minutes each<input name="pminutes" type="number" inputmode="numeric" min="1" max="120" value="${m.periods.minutes}" required></label>
      </div>
      <p class="muted form-hint">Changing the minutes moves event times in later periods to match.</p>
      <label>Date &amp; kick-off<input name="date" type="datetime-local" value="${toLocalInput(m.startedAt)}" required></label>
      <div class="row">
        <button type="button" data-modal="cancel">Cancel</button>
        <button type="submit" class="btn-primary">Save</button>
      </div>
    </form>`, (res) => {
    if (!res || typeof res !== 'object') return;
    const m2 = getMatch(ref);
    m2.home = res.home;
    m2.away = res.away;
    const shift = res.startedAt - m2.startedAt;
    m2.startedAt = res.startedAt;
    if (m2.endedAt) m2.endedAt += shift;
    retimeMatch(m2, res.periods);
    saveMatch(ref, m2);
    rememberTeams([res.home, res.away]);
    if (ref !== 'live') sortHistory();
    toast('Match updated');
    render();
  });
  const f = $('#match-form');
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const count = parseInt(f.elements.pcount.value, 10) || m.periods.count;
    if (count < usedPeriods) return toast(`This match already has events in ${periodName(m, usedPeriods)}`);
    const when = new Date(f.elements.date.value).getTime();
    closeModal({
      home: f.elements.home.value.trim(),
      away: f.elements.away.value.trim(),
      periods: { count: Math.min(8, count), minutes: Math.min(120, Math.max(1, parseInt(f.elements.pminutes.value, 10) || m.periods.minutes)) },
      startedAt: Number.isFinite(when) ? when : m.startedAt,
    });
  });
}

function rememberTeams(names) {
  const teams = getTeams();
  for (const n of names) if (n && !teams.some((t) => t.toLowerCase() === n.toLowerCase())) teams.push(n);
  teams.sort((a, b) => a.localeCompare(b));
  store.set('teams', teams);
}
function sortHistory() {
  store.set('history', getHistory().sort((a, b) => b.startedAt - a.startedAt));
}

/* ---------- sharing ----------
   The whole match is packed into the link after '#', so nothing is sent to a server.
   Format: 'z' + base64url(deflate(JSON)) or 'j' + base64url(JSON) where compression isn't available. */
const b64url = {
  enc: (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (str) => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
};
async function pipeBytes(bytes, stream) {
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(buf);
}

/* compact form: short keys, score types and events as arrays */
function packMatch(m) {
  if (isGolf(m)) return packGolf(m);
  const types = m.sport.scoreTypes;
  return {
    v: 1, id: m.id, h: m.home, a: m.away, d: m.startedAt, pl: playedMs(m),
    s: { n: m.sport.name, t: types.map((t) => [t.id, t.name, t.points, t.followUpId || 0, t.hidden ? 1 : 0]) },
    p: [m.periods.count, m.periods.minutes],
    e: sortedEvents(m).map((e) => e.marker
      ? [e.marker === 'timeup' ? 't' : 'w', e.period || 1, e.minute]
      : [e.team === 'home' ? 0 : 1, types.findIndex((t) => t.id === e.scoreTypeId), e.period || 1, e.minute, e.made ? 1 : 0]),
  };
}
function unpackMatch(o) {
  if (!o || o.v !== 1) throw new Error('bad version');
  if (o.k === 'golf') return unpackGolf(o);
  const types = o.s.t.map(([id, name, points, fu, hidden]) => ({ id: String(id), name: String(name), points: Number(points) || 0, followUpId: fu ? String(fu) : null, hidden: !!hidden }));
  const events = o.e.map((x, i) => (typeof x[0] === 'string'
    ? { id: 'e' + i, marker: x[0] === 't' ? 'timeup' : 'whistle', period: x[1], minute: x[2], team: null, made: false, createdAt: i }
    : { id: 'e' + i, team: x[0] ? 'away' : 'home', scoreTypeId: (types[x[1]] || {}).id, period: x[2], minute: x[3], made: !!x[4], createdAt: i }));
  return normaliseMatch({
    id: String(o.id), home: String(o.h || ''), away: String(o.a || ''), startedAt: Number(o.d), endedAt: Number(o.d) + Number(o.pl || 0),
    sport: { id: 'shared', name: String(o.s.n), scoreTypes: types, periods: { count: o.p[0], minutes: o.p[1] } },
    periods: { count: o.p[0], minutes: o.p[1] }, period: o.p[0], inBreak: true, playedMs: Number(o.pl) || 0,
    clock: { elapsedMs: 0, runningSince: null }, events,
  });
}

async function encodeMatch(m) {
  const json = new TextEncoder().encode(JSON.stringify(packMatch(m)));
  if ('CompressionStream' in window) {
    try { return 'z' + b64url.enc(await pipeBytes(json, new CompressionStream('deflate-raw'))); } catch { /* fall through */ }
  }
  return 'j' + b64url.enc(json);
}
async function decodeMatch(code) {
  let bytes = b64url.dec(code.slice(1));
  if (code[0] === 'z') bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
  else if (code[0] !== 'j') throw new Error('unknown format');
  return unpackMatch(JSON.parse(new TextDecoder().decode(bytes)));
}

const shareUrl = (code) => `${location.origin}${location.pathname}#/view/${code}`;

async function shareMatch(m) {
  const t = isGolf(m) ? null : totals(m);
  const title = isGolf(m) ? golfShareTitle(m) : `${teamName(m, 'home')} ${t.home}–${t.away} ${teamName(m, 'away')}`;
  const url = shareUrl(await encodeMatch(m));
  const when = new Date(m.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const text = isGolf(m) ? `${title}, ${when}` : `${title} · ${m.sport.name}, ${when}`;
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Link copied'); }
  catch { prompt('Copy this link:', url); }
}

/* #/view/<code>: read-only view of a shared match. Decoding is async, so render twice. */
let sharedView = { code: null, match: null, error: false };
function viewShared(code) {
  if (sharedView.code !== code) {
    sharedView = { code, match: null, error: false };
    decodeMatch(code || '')
      .then((m) => { sharedView.match = m; })
      .catch(() => { sharedView.error = true; })
      .finally(() => { if (route()[1] === code) render(); });
    return '<p class="empty">Loading match…</p>';
  }
  if (sharedView.error) {
    return `<p class="empty">This link doesn't contain a valid match. It may have been cut off when it was copied.</p>
      <button data-go="">Open Scorecard</button>`;
  }
  const m = sharedView.match;
  if (!m) return '<p class="empty">Loading match…</p>';
  const saved = getHistory().some((h) => h.id === m.id);
  return `
    <div class="topbar"><span class="tag shared-tag">Shared result</span><span class="tag">${esc(m.sport.name)}</span></div>
    ${matchSummary(m)}
    ${saved ? `<button data-go="match/${esc(m.id)}">Saved in your history ›</button>`
      : '<button class="btn-primary" data-action="save-shared">Save to my history</button>'}
    <button class="btn-ghost" data-go="">Open Scorecard</button>`;
}

/* ---------- live score sharing ----------
   Scorer: "Go live" creates a match id + secret key. Every change to the live match PUTs the
   whole state (see store.set) to the Cloudflare relay in live/. Offline? The latest state is
   kept and retried, so scoring never waits on the network.
   Viewer: #/watch/<id> holds a WebSocket open and re-renders on every update; the clock ticks
   locally from the last update, corrected for the difference between phone and server clocks. */
const LIVE_API = (document.querySelector('meta[name=live-api]')?.content || '').replace(/\/$/, '');
const randomToken = (bytes) => b64url.enc(crypto.getRandomValues(new Uint8Array(bytes)));
const watchUrl = (id) => `${location.origin}${location.pathname}#/watch/${id}`;
const HEARTBEAT_MS = 60000;           // resend while live so viewers can tell the scorer is still online
const STALE_MS = 150000;              // viewers warn after this long without an update

function packLive(m) {
  if (isGolf(m)) return { ...packGolf(m), end: !!m.endedAt, stop: !!m.liveStopped };
  return {
    ...packMatch(m),
    c: { p: m.period, el: elapsedMs(m), run: !!m.clock.runningSince, br: !!m.inBreak },
    end: !!m.endedAt,
    stop: !!m.liveStopped,
  };
}

const livePub = { pending: null, inFlight: false, timer: null, retry: 0, status: 'idle', lastSent: 0 };

function publishLive(m) {
  if (!LIVE_API || !m || !m.live) return;
  livePub.pending = { id: m.live.id, key: m.live.key, body: JSON.stringify(packLive(m)) };
  clearTimeout(livePub.timer);
  livePub.timer = setTimeout(flushLive, 200); // coalesce bursts (e.g. try + conversion)
}

async function flushLive() {
  if (livePub.inFlight || !livePub.pending) return;
  const job = livePub.pending;
  livePub.pending = null;
  livePub.inFlight = true;
  let retryIn = 0;
  try {
    const r = await fetch(`${LIVE_API}/m/${job.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${job.key}`, 'Content-Type': 'application/json' },
      body: job.body,
    });
    if (r.status === 403 || r.status === 413 || r.status === 400) {
      setLiveStatus('pending');
      toast("Live update rejected – try stopping and restarting live sharing");
    } else if (!r.ok) {
      throw new Error(`HTTP ${r.status}`);
    } else {
      livePub.retry = 0;
      livePub.lastSent = Date.now();
      setLiveStatus('ok');
    }
  } catch {
    if (!livePub.pending) livePub.pending = job; // keep the newest state for the retry
    livePub.retry = Math.min(livePub.retry + 1, 5);
    retryIn = 1000 * 2 ** livePub.retry;          // 2s, 4s … 32s
    setLiveStatus('pending');
  } finally {
    livePub.inFlight = false;
    if (livePub.pending) {
      clearTimeout(livePub.timer);
      livePub.timer = setTimeout(flushLive, retryIn);
    }
  }
}
window.addEventListener('online', () => { livePub.retry = 0; flushLive(); });

function setLiveStatus(status) {
  livePub.status = status;
  const b = $('#live-badge');
  if (b) b.dataset.status = status;
}

function liveHeartbeat() {
  const m = getLive();
  if (m?.live && !livePub.pending && !livePub.inFlight && Date.now() - livePub.lastSent > HEARTBEAT_MS) publishLive(m);
}

function liveButton(m) {
  if (!LIVE_API) return '';
  return m.live
    ? `<button id="live-badge" class="live-badge" data-action="live-menu" data-status="${livePub.status}">● LIVE</button>`
    : '<button class="btn-ghost btn-small" data-action="go-live">Go live</button>';
}

async function shareLiveLink(m) {
  if (!m?.live) return;
  const url = watchUrl(m.live.id);
  const who = isGolf(m) ? `the round at ${m.course.name}` : `${teamName(m, 'home')} v ${teamName(m, 'away')}`;
  const title = `${isGolf(m) ? m.course.name : who} – live`;
  const text = `Follow ${who} live`;
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Live link copied'); }
  catch { prompt('Copy this live link:', url); }
}

/* ----- viewer ----- */
const watch = { id: null, ws: null, msg: null, match: null, offset: 0, status: 'connecting', retry: 0, gone: false, timer: null, ping: null };

function unpackLive(msg, offset) {
  const st = msg.state;
  const m = unpackMatch(st);
  if (isGolf(m)) {
    m.endedAt = st.end ? msg.updatedAt - offset : null;
    m.stopped = !!st.stop;
    return m;
  }
  m.period = st.c.p;
  m.inBreak = st.c.br;
  // server time -> this phone's time, so the clock ticks correctly here
  m.clock = { elapsedMs: st.c.el, runningSince: st.c.run && !st.end ? msg.updatedAt - offset : null };
  m.endedAt = st.end ? msg.updatedAt - offset : null;
  m.stopped = !!st.stop;
  return m;
}

function startWatching(id) {
  stopWatching();
  Object.assign(watch, { id, msg: null, match: null, status: 'connecting', retry: 0, gone: false });
  connectWatch();
}
function stopWatching() {
  clearTimeout(watch.timer);
  clearInterval(watch.ping);
  if (watch.ws) { watch.ws.onclose = null; try { watch.ws.close(); } catch {} }
  watch.ws = null;
  watch.id = null;
}
function connectWatch() {
  const id = watch.id;
  if (!id) return;
  const ws = new WebSocket(`${LIVE_API.replace(/^http/, 'ws')}/m/${id}/ws`);
  watch.ws = ws;
  ws.onopen = () => {
    watch.retry = 0;
    clearInterval(watch.ping);
    watch.ping = setInterval(() => { try { ws.send('ping'); } catch {} }, 25000);
  };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    watch.offset = msg.serverNow - Date.now();
    if (msg.pong) return;
    watch.status = 'live';
    if (msg.gone) { watch.gone = true; render(); return; }
    const prev = watch.match;
    watch.msg = msg;
    watch.match = unpackLive(msg, watch.offset);
    announceScore(prev, watch.match);
    if (route()[0] === 'watch' && !modal.open) render();
  };
  ws.onclose = () => {
    clearInterval(watch.ping);
    if (watch.id !== id || watch.gone) return;
    watch.status = 'reconnecting';
    tickWatch();
    watch.retry = Math.min(watch.retry + 1, 5);
    watch.timer = setTimeout(connectWatch, 1000 * 2 ** (watch.retry - 1));
  };
}
document.addEventListener('visibilitychange', () => {
  // phones drop sockets in the background; reconnect straight away when looking again
  if (document.visibilityState === 'visible' && watch.id && (!watch.ws || watch.ws.readyState > 1)) {
    clearTimeout(watch.timer);
    watch.retry = 0;
    connectWatch();
  }
});

/* big "TRY!" flash for viewers when a new score arrives */
function announceScore(prev, m) {
  if (!prev || isGolf(m)) return;
  const before = totals(prev);
  const after = totals(m);
  if (before.home === after.home && before.away === after.away) return;
  const side = after.home !== before.home ? 'home' : 'away';
  // announce the biggest new score (a try, not the conversion that arrived with it)
  const made = (x) => sortedEvents(x).filter((e) => !isMarker(e) && e.made && e.team === side);
  const fresh = made(m).slice(made(prev).length);
  const pts = (e) => (typeById(m, e.scoreTypeId) || { points: 0 }).points;
  const scored = (fresh.length ? fresh : made(m).slice(-1)).reduce((a, e) => (pts(e) > pts(a) ? e : a));
  const st = scored && typeById(m, scored.scoreTypeId);
  const el = document.createElement('div');
  el.className = `score-flash ${side}`;
  el.innerHTML = `${esc(st ? st.name : 'Score')}!<small>${esc(teamName(m, side))}</small>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
  if (navigator.vibrate) navigator.vibrate(60);
}

function watchStatusText() {
  const m = watch.match;
  if (watch.status === 'reconnecting') return ['warn', 'Reconnecting…'];
  if (!m || !watch.msg) return ['', 'Connecting…'];
  if (m.stopped) return ['warn', 'The scorer stopped live sharing'];
  if (m.endedAt) return ['', 'Final score'];
  const age = Date.now() + watch.offset - watch.msg.updatedAt;
  const mins = Math.floor(age / 60000);
  if (age > STALE_MS) return ['warn', `Scorer's phone offline – last update ${mins} min ago`];
  return ['ok', 'Live · up to date'];
}

function tickWatch() {
  const m = watch.match;
  const c = $('#vclock');
  if (m && c) c.innerHTML = m.endedAt ? 'FT' : fmtMatchClock(m);
  const st = $('#watch-status');
  if (st) { const [cls, text] = watchStatusText(); st.className = `watch-status ${cls}`; st.textContent = text; }
}

function viewWatch(id) {
  if (!LIVE_API) return `<p class="empty">Live scores aren't available on this copy of Scorecard.</p><button data-go="">Open Scorecard</button>`;
  if (watch.id !== id) startWatching(id);
  if (watch.gone) {
    return `<p class="empty">This live match has finished and expired, or the link is wrong.</p><button data-go="">Open Scorecard</button>`;
  }
  const m = watch.match;
  if (!m) return '<p class="empty">Connecting to live match…</p>';
  if (isGolf(m)) return viewWatchGolf(m);
  const t = totals(m);
  const ended = !!m.endedAt;
  const [cls, statusText] = watchStatusText();
  const saved = getHistory().some((h) => h.id === m.id);
  const evs = sortedEvents(m).reverse(); // newest first while watching
  const bd = (side) => {
    const lines = breakdown(m, side);
    return `<div class="card team-card ${side}"><strong class="team-label">${esc(teamName(m, side))}</strong>
      ${lines.length ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="muted">No scores</p>'}</div>`;
  };
  return `
    <div class="topbar"><span class="live-pill ${ended ? 'ft' : ''}">${ended ? 'Full time' : '● Live'}</span><span class="tag">${esc(m.sport.name)}</span></div>
    <div class="scoreboard" style="position:static">
      <div class="team home">${esc(teamName(m, 'home'))}</div><div></div><div class="team away">${esc(teamName(m, 'away'))}</div>
      <div class="score">${t.home}</div><div class="dash">–</div><div class="score">${t.away}</div>
      <div class="period-label">${esc(ended ? 'Full time' : m.inBreak ? whistleName(m) : periodName(m))}</div>
      <div class="clock-row"><span class="clock" id="vclock">${ended ? 'FT' : fmtMatchClock(m)}</span></div>
    </div>
    <p class="watch-status ${cls}" id="watch-status">${esc(statusText)}</p>
    ${ended ? (saved ? `<button data-go="match/${esc(m.id)}">Saved in your history ›</button>` : '<button class="btn-primary" data-action="save-watched">Save to my history</button>') : ''}
    <h3>Timeline</h3>
    ${evs.length ? `<ul class="list">${evs.map((e) => eventRow(m, e, null)).join('')}</ul>` : '<p class="empty">No scores yet.</p>'}
    <h3>Breakdown</h3>
    <div class="breakdown">${bd('home')}${bd('away')}</div>
    <button class="btn-ghost" data-go="">Open Scorecard</button>`;
}

/* ---------- backup, restore, open shared link ----------
   iPhone keeps a home-screen app's data separate from Safari, and links always open in Safari.
   So data has to come in from inside the app: a backup file, or a pasted link. */
function buildBackup() {
  return { app: 'scorecard', v: 1, exportedAt: Date.now(), history: getHistory(), sports: getSports(), teams: getTeams(), courses: getCourses() };
}

async function saveBackup() {
  const data = JSON.stringify(buildBackup());
  const name = `scorecard-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([data], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Scorecard backup' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); // fallback: download
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Backup saved');
}

async function restoreBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast("That file isn't a Scorecard backup"); }
  if (!data || data.app !== 'scorecard' || !Array.isArray(data.history)) return toast("That file isn't a Scorecard backup");
  const have = getHistory();
  const newMatches = data.history.filter((m) => m && m.id && m.sport && Array.isArray(m.events) && !have.some((h) => h.id === m.id));
  const sports = getSports();
  const newSports = (data.sports || []).filter((sp) => sp && sp.id && Array.isArray(sp.scoreTypes) && !sports.some((x) => x.id === sp.id));
  const newTeams = (data.teams || []).filter((t) => typeof t === 'string' && !getTeams().some((x) => x.toLowerCase() === t.toLowerCase()));
  const newCourses = (data.courses || []).filter((c) => c && c.id && Array.isArray(c.pars) && !getCourses().some((x) => x.id === c.id));
  if (!newMatches.length && !newSports.length && !newTeams.length && !newCourses.length) return toast('Nothing new in that backup');
  const ok = await confirmModal('Restore backup?',
    `Adds ${newMatches.length} match${newMatches.length === 1 ? '' : 'es'}, ${newSports.length} sport${newSports.length === 1 ? '' : 's'}, ${newTeams.length} name${newTeams.length === 1 ? '' : 's'}${newCourses.length ? ` and ${newCourses.length} course${newCourses.length === 1 ? '' : 's'}` : ''}. Nothing here is deleted.`,
    'Restore', 'Cancel');
  if (!ok) return;
  store.set('history', have.concat(newMatches.map(normaliseMatch)));
  sortHistory();
  if (newSports.length) store.set('sports', sports.concat(newSports));
  rememberTeams(newTeams);
  if (newCourses.length) store.set('courses', getCourses().concat(newCourses));
  toast(`Restored ${newMatches.length} match${newMatches.length === 1 ? '' : 'es'}`);
  render();
}

/* pull a #/view/… or #/watch/… route out of whatever was pasted (often a whole message) */
function routeFromText(text) {
  const m = String(text || '').match(/#\/(view|watch)\/([A-Za-z0-9_-]+)/);
  return m ? `${m[1]}/${m[2]}` : null;
}

function openLinkForm() {
  openModal(`
    <h2>Open a shared link</h2>
    <p class="muted">Copy a Scorecard result or live link from a message, then paste it here.</p>
    <form id="link-form" class="stack" method="dialog">
      <input name="link" placeholder="Paste link here" autocomplete="off" autocapitalize="off" spellcheck="false">
      ${navigator.clipboard?.readText ? '<button type="button" data-action="paste-link">Paste from clipboard</button>' : ''}
      <div class="row">
        <button type="button" data-modal="cancel">Cancel</button>
        <button type="submit" class="btn-primary">Open</button>
      </div>
    </form>`, (res) => { if (res && res.route) go(res.route); });
  const f = $('#link-form');
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const r = routeFromText(f.elements.link.value);
    if (!r) return toast("That doesn't look like a Scorecard link");
    closeModal({ route: r });
  });
}

/* ---------- golf ----------
   Stroke play against par, any number of players. A round is stored in the same places as a
   match (live / history) but with kind 'golf': course { name, pars[] }, players [{ id, name }],
   scores { playerId: [strokes|null per hole] }, hole (current index). It keeps empty clock and
   events fields so shared code (time-up checks, heartbeat) is harmless. */
const isGolf = (m) => !!m && (m.kind === 'golf' || m.sport?.kind === 'golf');
const getCourses = () => store.get('courses', []);
const QUICK_COURSES = [
  { id: 'quick-18', name: 'Quick round (18 holes)', pars: Array(18).fill(4) },
  { id: 'quick-9', name: 'Quick round (9 holes)', pars: Array(9).fill(4) },
];
const allCourses = () => getCourses().concat(QUICK_COURSES);

/* per player: strokes so far, par of holes played, holes played, to-par */
function golfStats(m, pid) {
  const sc = m.scores[pid] || [];
  let strokes = 0, par = 0, thru = 0;
  m.course.pars.forEach((p, i) => { if (sc[i] != null) { strokes += sc[i]; par += p; thru += 1; } });
  return { strokes, toPar: strokes - par, thru };
}
const fmtToPar = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);
function golfBoard(m) {
  return m.players.map((p) => ({ ...p, ...golfStats(m, p.id) }))
    .sort((a, b) => (b.thru > 0) - (a.thru > 0) || a.toPar - b.toPar || b.thru - a.thru || a.strokes - b.strokes);
}
const playerName = (p, i) => p.name || `Player ${i + 1}`;

/* New match form fields */
function golfNewFields() {
  const last = store.get('lastCourse');
  const courses = allCourses().map((c) => `<option value="${esc(c.id)}" ${c.id === last ? 'selected' : ''}>${esc(c.name)} · par ${c.pars.reduce((a, b) => a + b, 0)}</option>`).join('');
  return `
    <label>Course<select name="course">${courses}</select></label>
    <p class="muted form-hint">Add your own courses with their pars in <b>Settings → Courses</b>.</p>
    <div class="stack" id="golf-players">
      <label>Players<input name="player" placeholder="Player 1" list="teams" autocomplete="off" maxlength="30"></label>
    </div>
    <button type="button" data-action="golf-add-player">+ Add player</button>`;
}
function golfNewFieldsAfter() { /* nothing to bind yet: kept so the form can grow */ }
function addPlayerInput() {
  const box = $('#golf-players');
  if (!box) return;
  const n = box.querySelectorAll('input').length + 1;
  box.insertAdjacentHTML('beforeend', `<input name="player" placeholder="Player ${n}" list="teams" autocomplete="off" maxlength="30">`);
  box.lastElementChild.focus();
}

function startGolfRound(f, sport) {
  const course = allCourses().find((c) => c.id === f.elements.course.value) || QUICK_COURSES[0];
  const names = [...f.querySelectorAll('[name=player]')].map((i) => i.value.trim());
  const filled = names.filter(Boolean);
  const players = (filled.length ? filled : ['']).map((name) => ({ id: uid(), name }));
  rememberTeams(filled);
  store.set('lastSport', sport.id);
  store.set('lastCourse', course.id);
  store.set('live', {
    id: uid(), kind: 'golf', sport: clone(sport),
    course: { name: course.name, pars: course.pars.slice() },
    players, scores: Object.fromEntries(players.map((p) => [p.id, course.pars.map(() => null)])),
    hole: 0, startedAt: Date.now(), endedAt: null,
    clock: { elapsedMs: 0, runningSince: null }, events: [], periods: { count: 1, minutes: 1 }, period: 1, inBreak: false, playedMs: 0, reminded: [],
  });
  enterFullscreen();
  go('live');
}

/* the hole screen */
function viewGolf(m) {
  const h = m.hole;
  const par = m.course.pars[h];
  const last = h === m.course.pars.length - 1;
  const board = golfBoard(m);
  const leader = board[0] && board[0].thru ? board[0] : null;
  const holeOpts = m.course.pars.map((p, i) => `<option value="${i}" ${i === h ? 'selected' : ''}>Hole ${i + 1} · par ${p}</option>`).join('');
  const rows = m.players.map((p, i) => {
    const v = m.scores[p.id][h];
    const st = golfStats(m, p.id);
    return `
      <div class="golf-row">
        <div class="golf-who"><strong>${esc(playerName(p, i))}</strong><span class="tag">${st.thru ? `${fmtToPar(st.toPar)} thru ${st.thru}` : 'not started'}</span></div>
        <button class="golf-step" data-action="golf-step" data-pid="${esc(p.id)}" data-d="-1" aria-label="One fewer">−</button>
        <span class="golf-strokes ${v == null ? 'suggested' : scoreClass(v - par)}">${v == null ? par : v}</span>
        <button class="golf-step" data-action="golf-step" data-pid="${esc(p.id)}" data-d="1" aria-label="One more">+</button>
      </div>`;
  }).join('');
  return `
    <div class="topbar"><button class="btn-ghost btn-small" data-go="">‹ Home</button><span class="tag">${esc(m.course.name)}</span><span class="spacer"></span>${liveButton(m)}<button class="btn-ghost btn-small" data-action="edit-match" data-ref="live">Edit</button></div>
    <div class="scoreboard golf-hole" style="position:static">
      <div class="golf-hole-no">Hole <b>${h + 1}</b><small>of ${m.course.pars.length}</small></div>
      <div class="golf-par">Par <b>${par}</b></div>
      <select class="golf-jump" data-action="golf-jump" aria-label="Go to hole">${holeOpts}</select>
    </div>
    <p class="golf-leader">${leader ? `Leader: <b>${esc(playerName(leader, m.players.indexOf(m.players.find((p) => p.id === leader.id))))}</b> ${fmtToPar(leader.toPar)} thru ${leader.thru}` : 'Tap − / + to set each score. Grey numbers are par and are saved when you move on.'}</p>
    <div class="golf-rows">${rows}</div>
    <div class="actionbar golf-actions">
      <button data-action="golf-prev" ${h === 0 ? 'disabled' : ''}>‹ ${h || ''}</button>
      <button data-go="card/live">Card</button>
      ${last ? '<button class="btn-primary" data-action="golf-finish">Finish</button>'
        : `<button class="btn-primary" data-action="golf-next">Hole ${h + 2} ›</button>`}
    </div>`;
}
const scoreClass = (d) => (d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'par' : d === 1 ? 'bogey' : 'double');

/* fill any unset scores on the current hole with par (what the screen was showing) */
function commitHole(m) {
  const h = m.hole;
  for (const p of m.players) if (m.scores[p.id][h] == null) m.scores[p.id][h] = m.course.pars[h];
}

/* scorecard grid: Out / In / Total for 18 holes, just Total for 9 */
function golfCardTable(m, ref) {
  const n = m.course.pars.length;
  const nines = n === 18 ? [[0, 9, 'Out'], [9, 18, 'In']] : [[0, n, '']];
  const sum = (arr, a, b) => arr.slice(a, b).reduce((t, v) => t + (v || 0), 0);
  const head = nines.map(([a, b, lab]) => m.course.pars.slice(a, b).map((_, i) => `<th>${a + i + 1}</th>`).join('') + (lab ? `<th class="sub">${lab}</th>` : '')).join('') + '<th class="sub">Tot</th>';
  const parRow = nines.map(([a, b, lab]) => m.course.pars.slice(a, b).map((p) => `<td>${p}</td>`).join('') + (lab ? `<td class="sub">${sum(m.course.pars, a, b)}</td>` : '')).join('') + `<td class="sub">${sum(m.course.pars, 0, n)}</td>`;
  const rows = m.players.map((p, pi) => {
    const sc = m.scores[p.id];
    const cells = nines.map(([a, b, lab]) => sc.slice(a, b).map((v, i) => {
      const hole = a + i;
      const cls = v == null ? '' : scoreClass(v - m.course.pars[hole]);
      const inner = `<span class="${cls}">${v == null ? '·' : v}</span>`;
      return ref ? `<td><button class="cell" data-action="golf-cell" data-ref="${esc(ref)}" data-pid="${esc(p.id)}" data-hole="${hole}">${inner}</button></td>` : `<td>${inner}</td>`;
    }).join('') + (lab ? `<td class="sub">${sum(sc, a, b) || ''}</td>` : '')).join('');
    const st = golfStats(m, p.id);
    const tp = st.thru ? `<small class="${st.toPar < 0 ? 'under' : st.toPar > 0 ? 'over' : ''}">${fmtToPar(st.toPar)}</small>` : '';
    return `<tr><th class="name">${esc(playerName(p, pi))}</th>${cells}<td class="sub tot">${st.strokes || ''}${tp}</td></tr>`;
  }).join('');
  return `
    <div class="golf-card-wrap"><table class="golf-card">
      <thead><tr><th class="name">Hole</th>${head}</tr></thead>
      <tbody><tr class="par-row"><th class="name">Par</th>${parRow}</tr>${rows}</tbody>
    </table></div>
    <p class="muted golf-key"><span class="eagle">2</span> eagle <span class="birdie">3</span> birdie <span class="bogey">5</span> bogey <span class="double">6</span> double+${ref ? ' · tap a score to change it' : ''}</p>`;
}

function viewGolfCard(ref) {
  const m = getMatch(ref);
  if (!m || !isGolf(m)) { setTimeout(() => go(''), 0); return ''; }
  const back = ref === 'live' ? 'live' : `match/${ref}`;
  return `
    <div class="topbar"><button class="btn-ghost btn-small" data-go="${esc(back)}">‹ Back</button><h2>Scorecard</h2></div>
    <p class="tag">${esc(m.course.name)}</p>
    ${golfCardTable(m, ref)}
    ${ref === 'live' ? '<button class="btn-danger" data-action="golf-finish">Finish round</button>' : ''}`;
}

function golfLeaderboard(m) {
  const board = golfBoard(m);
  const holes = m.course.pars.length;
  // golf positions share ties: 1, T2, T2, 4
  const pos = (p) => {
    const ahead = board.filter((q) => q.thru && q.toPar < p.toPar).length;
    const tied = board.filter((q) => q.thru && q.toPar === p.toPar).length;
    return `${tied > 1 ? 'T' : ''}${ahead + 1}`;
  };
  return `<ol class="golf-board">${board.map((p, i) => `
    <li class="card ${i === 0 && p.thru ? 'leader' : ''}">
      <span class="pos">${p.thru ? pos(p) : '–'}</span>
      <span class="grow"><strong>${esc(playerName(p, m.players.findIndex((x) => x.id === p.id)))}</strong><br><span class="tag">${p.thru === holes ? 'Finished' : p.thru ? `Thru ${p.thru}` : 'Not started'}</span></span>
      <span class="golf-total">${p.thru ? p.strokes : ''}</span>
      <span class="golf-topar ${p.toPar < 0 ? 'under' : p.toPar > 0 ? 'over' : ''}">${p.thru ? fmtToPar(p.toPar) : ''}</span>
    </li>`).join('')}</ol>`;
}

/* used by round detail, shared links and live viewers */
function golfSummary(m, ref) {
  const totalPar = m.course.pars.reduce((a, b) => a + b, 0);
  return `
    <div class="scoreboard golf-head" style="position:static">
      <div class="golf-course">${esc(m.course.name)}</div>
      <div class="tag">${m.course.pars.length} holes · par ${totalPar} · ${new Date(m.startedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</div>
    </div>
    <h3>Leaderboard</h3>
    ${golfLeaderboard(m)}
    <h3>Scorecard</h3>
    ${golfCardTable(m, ref)}`;
}

function viewGolfMatch(m) {
  return `
    <div class="topbar"><button class="btn-ghost btn-small" data-go="history">‹ History</button><span class="tag">Golf</span></div>
    ${golfSummary(m, m.id)}
    <button class="btn-primary" data-action="share-match" data-id="${esc(m.id)}">Share result</button>
    <button data-action="edit-match" data-ref="${esc(m.id)}">Edit round</button>
    <button class="btn-danger" data-action="delete-match" data-id="${esc(m.id)}">Delete round</button>`;
}

function golfHistoryRow(m) {
  const b = golfBoard(m)[0];
  const lead = b && b.thru ? `${esc(playerName(b, m.players.findIndex((x) => x.id === b.id)))} ${b.strokes} (${fmtToPar(b.toPar)})` : 'No scores';
  return `<li><button class="list-item" data-go="match/${esc(m.id)}">
    <span class="grow"><span class="tag">${new Date(m.startedAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · Golf · ${esc(m.course.name)}</span><br>
    ${lead}${m.players.length > 1 ? ` <span class="tag">· ${m.players.length} players</span>` : ''}</span>
    <span class="tag">›</span></button></li>`;
}

function golfShareTitle(m) {
  const b = golfBoard(m)[0];
  return b && b.thru ? `${playerName(b, m.players.findIndex((x) => x.id === b.id))} ${b.strokes} (${fmtToPar(b.toPar)}) at ${m.course.name}` : `Golf at ${m.course.name}`;
}

/* change one score from the card (any hole, live or saved round) */
function golfCellForm(ref, pid, hole) {
  const m = getMatch(ref);
  const p = m.players.find((x) => x.id === pid);
  const par = m.course.pars[hole];
  const cur = m.scores[pid][hole];
  openModal(`
    <h2>${esc(playerName(p, m.players.indexOf(p)))} · hole ${hole + 1}</h2>
    <p class="muted">Par ${par}</p>
    <form id="cell-form" class="stack" method="dialog">
      <input name="v" type="number" inputmode="numeric" min="1" max="20" value="${cur == null ? par : cur}" required>
      <div class="row">
        <button type="button" data-modal="clear">Clear</button>
        <button type="submit" class="btn-primary">Save</button>
      </div>
    </form>`, (res) => {
    if (res === 'dismiss' || res === undefined) return;
    const m2 = getMatch(ref);
    m2.scores[pid][hole] = res === 'clear' ? null : res;
    saveMatch(ref, m2);
    render();
  });
  const f = $('#cell-form');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = parseInt(f.elements.v.value, 10);
    closeModal(Number.isFinite(v) && v > 0 ? Math.min(v, 20) : 'dismiss');
  });
}

/* edit round: player names, add a player, date */
function editGolfForm(ref) {
  const m = getMatch(ref);
  openModal(`
    <h2>Edit round</h2>
    <form id="golf-edit" class="stack" method="dialog">
      ${m.players.map((p, i) => `<label>Player ${i + 1}<input name="p-${esc(p.id)}" value="${esc(p.name)}" placeholder="Player ${i + 1}" list="teams-edit" maxlength="30"></label>`).join('')}
      <label>Add a player<input name="newp" placeholder="Name (optional)" list="teams-edit" maxlength="30"></label>
      <datalist id="teams-edit">${getTeams().map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
      <label>Date &amp; tee time<input name="date" type="datetime-local" value="${toLocalInput(m.startedAt)}" required></label>
      <div class="row">
        <button type="button" data-modal="cancel">Cancel</button>
        <button type="submit" class="btn-primary">Save</button>
      </div>
    </form>`, (res) => {
    if (!res || typeof res !== 'object') return;
    const m2 = getMatch(ref);
    m2.players.forEach((p) => { p.name = (res.names[p.id] ?? p.name).trim(); });
    if (res.newp) { const p = { id: uid(), name: res.newp }; m2.players.push(p); m2.scores[p.id] = m2.course.pars.map(() => null); }
    if (Number.isFinite(res.when)) m2.startedAt = res.when;
    saveMatch(ref, m2);
    rememberTeams(m2.players.map((p) => p.name));
    if (ref !== 'live') sortHistory();
    toast('Round updated');
    render();
  });
  const f = $('#golf-edit');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const names = Object.fromEntries(m.players.map((p) => [p.id, f.elements[`p-${p.id}`].value]));
    closeModal({ names, newp: f.elements.newp.value.trim(), when: new Date(f.elements.date.value).getTime() });
  });
}

/* share links and live sharing */
function packGolf(m) {
  return {
    v: 1, k: 'golf', id: m.id, d: m.startedAt, h: m.hole || 0,
    c: [m.course.name, m.course.pars],
    pl: m.players.map((p) => p.name),
    s: m.players.map((p) => m.scores[p.id].map((v) => (v == null ? 0 : v))),
  };
}
function unpackGolf(o) {
  const players = o.pl.map((name, i) => ({ id: 'p' + i, name: String(name || '') }));
  const pars = o.c[1].map(Number);
  return {
    id: String(o.id), kind: 'golf', sport: { id: 'golf', name: 'Golf', kind: 'golf', scoreTypes: [], periods: { count: 1, minutes: 1 } },
    course: { name: String(o.c[0]), pars }, players,
    scores: Object.fromEntries(players.map((p, i) => [p.id, pars.map((_, h) => (o.s[i] && o.s[i][h]) || null)])),
    hole: Number(o.h) || 0, startedAt: Number(o.d), endedAt: Number(o.d),
    clock: { elapsedMs: 0, runningSince: null }, events: [], periods: { count: 1, minutes: 1 }, period: 1, inBreak: true, playedMs: 0, reminded: [],
  };
}

function viewWatchGolf(m) {
  const ended = !!m.endedAt;
  const [cls, statusText] = watchStatusText();
  const saved = getHistory().some((h) => h.id === m.id);
  return `
    <div class="topbar"><span class="live-pill ${ended ? 'ft' : ''}">${ended ? 'Finished' : '● Live'}</span><span class="tag">Golf</span></div>
    <p class="watch-status ${cls}" id="watch-status">${esc(ended ? 'Final scores' : statusText)}${ended ? '' : ` · on hole ${m.hole + 1}`}</p>
    ${golfSummary(m, null)}
    ${ended ? (saved ? `<button data-go="match/${esc(m.id)}">Saved in your history ›</button>` : '<button class="btn-primary" data-action="save-watched">Save to my history</button>') : ''}
    <button class="btn-ghost" data-go="">Open Scorecard</button>`;
}

/* courses in Settings */
function coursesSection() {
  const cs = getCourses();
  return `
    <h3>Golf courses</h3>
    ${cs.length ? `<ul class="list">${cs.map((c) => `
      <li><button class="list-item" data-go="course/${esc(c.id)}">
        <span class="grow">${esc(c.name)}<br><span class="tag">${c.pars.length} holes · par ${c.pars.reduce((a, b) => a + b, 0)}</span></span>
        <span class="tag">Edit ›</span></button></li>`).join('')}</ul>` : '<p class="muted">Add the courses you play so each hole has the right par. Without one, use a Quick round (par 4 every hole).</p>'}
    <button data-go="course/new">+ New course</button>`;
}

let courseDraft = null;
function viewCourse(id) {
  if (!courseDraft || courseDraft._for !== id) {
    const existing = getCourses().find((c) => c.id === id);
    courseDraft = existing ? clone(existing) : { id: uid(), name: '', pars: Array(18).fill(4) };
    courseDraft._for = id;
    courseDraft._isNew = !existing;
  }
  const d = courseDraft;
  const total = d.pars.reduce((a, b) => a + b, 0);
  return `
    <div class="topbar"><button class="btn-ghost btn-small" data-action="cancel-course">‹ Cancel</button><h2>${d._isNew ? 'New course' : 'Edit course'}</h2></div>
    <form id="course-form" class="stack">
      <label>Course name<input name="name" value="${esc(d.name)}" placeholder="e.g. Royal Bath GC" maxlength="40" required></label>
      <label>Holes<select name="holes" data-action="course-holes">
        <option value="18" ${d.pars.length === 18 ? 'selected' : ''}>18 holes</option>
        <option value="9" ${d.pars.length === 9 ? 'selected' : ''}>9 holes</option>
      </select></label>
      <h3>Par for each hole</h3>
      <div class="par-grid">${d.pars.map((p, i) => `
        <label>${i + 1}<select name="par-${i}">${[3, 4, 5, 6].map((v) => `<option ${v === p ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`).join('')}
      </div>
      <p class="muted" id="par-total">Total par ${total}</p>
      <button type="submit" class="btn-primary btn-big">Save course</button>
      ${d._isNew ? '' : '<button type="button" class="btn-danger" data-action="delete-course">Delete course</button>'}
    </form>`;
}
function readCourseForm() {
  const f = $('#course-form');
  if (!f || !courseDraft) return;
  courseDraft.name = f.elements.name.value;
  courseDraft.pars = courseDraft.pars.map((p, i) => Number(f.elements[`par-${i}`]?.value) || p);
}
viewCourse.after = () => {
  const f = $('#course-form');
  f.addEventListener('change', (e) => {
    if (e.target.name === 'holes') {
      readCourseForm();
      const n = Number(e.target.value);
      courseDraft.pars = Array.from({ length: n }, (_, i) => courseDraft.pars[i] || 4);
      render();
      return;
    }
    readCourseForm();
    $('#par-total').textContent = `Total par ${courseDraft.pars.reduce((a, b) => a + b, 0)}`;
  });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    readCourseForm();
    const { _for, _isNew, ...c } = courseDraft;
    c.name = c.name.trim();
    if (!c.name) return toast('Give the course a name');
    const cs = getCourses();
    const i = cs.findIndex((x) => x.id === c.id);
    if (i >= 0) cs[i] = c; else cs.push(c);
    store.set('courses', cs);
    courseDraft = null;
    toast('Course saved');
    go('settings');
  });
};

/* ---------- help, FAQ and welcome ----------
   One copy of the content: shown in the app at #/help, and the same link works in any browser
   for people who haven't installed it. Plain strings with a little inline HTML (<b>, <i>). */
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const HELP = {
  guides: [
    { id: 'install', title: 'Install on your phone', body: [
      '<b>iPhone:</b> open the app in <b>Safari</b>, tap the <b>Share</b> button, then <b>Add to Home Screen</b>.',
      '<b>Android:</b> open it in <b>Chrome</b>, tap the <b>⋮</b> menu, then <b>Add to Home screen</b> or <b>Install app</b>.',
      'Open it from the icon from then on. It works with no signal, and keeps your screen on during a match.',
    ] },
    { id: 'match', title: 'Scoring a match', body: [
      'Tap <b>New match</b>, choose the sport, type the team names (or leave them as Home and Away) and check the <b>periods and minutes</b>, e.g. 2 × 35 for juniors.',
      'At kick-off tap the big green <b>Start clock</b>. Score buttons only work while the clock runs. If you tap one when it is stopped, you can start the clock and add the score in one go.',
      'Tap a team’s button when they score. After a <b>try</b> you are asked whether the <b>conversion</b> was made or missed.',
      'Use <b>Pause</b> for stoppages. Pausing asks you to confirm so a stray tap can’t stop the clock.',
    ] },
    { id: 'halves', title: 'Half time and full time', body: [
      'When a half’s time is up, the screen flashes red, a <b>HALF TIME</b> banner shows, and the phone beeps (and vibrates on Android). The clock keeps counting added time, e.g. 40:00 +2:10.',
      'When the ref blows, tap the big red <b>Half time</b> button. Then tap <b>Start 2nd half</b> at the restart. The 2nd half always starts at the right time (e.g. 40:00) even if you paused late.',
      'At the end, tap <b>Full time</b>, or <b>End</b> at the bottom, to save the match to <b>History</b>.',
      'If the ref blows early, pause the clock and tap <b>End 1st half early</b>.',
    ] },
    { id: 'mistakes', title: 'Fixing mistakes', body: [
      '<b>Undo</b> removes the last score straight away.',
      '<b>Log</b> lists everything. Tap any entry to change the team, score type or minute, or delete it. <b>+ Add missed event</b> adds a score you missed, at any minute.',
      '<b>Edit</b> (during a match) or <b>Edit match</b> (in History) changes team names, date and the period length. Changing 40 to 35 minutes moves 2nd-half times to match.',
    ] },
    { id: 'share', title: 'Sharing a result', body: [
      'Open a match in <b>History</b> and tap <b>Share result</b> to send the score and a link, e.g. on WhatsApp.',
      'Anyone can open the link to see the score, breakdown and timeline. Scorecard users can tap <b>Save to my history</b>.',
      'On iPhone, links always open in Safari, not the home-screen app. To save one into the app, copy the link, then in the app use <b>History → Open a shared link</b>.',
    ] },
    { id: 'live', title: 'Live scores for people not at the game', body: [
      'During a match tap <b>Go live</b> at the top and send the link. Viewers see the score, a ticking clock and a big flash whenever someone scores.',
      'The red <b>LIVE</b> badge turns grey when your phone has no signal. Scores you add still count, and viewers catch up when you reconnect.',
      'Tap the <b>LIVE</b> badge to send the link again or stop sharing. Live links show the final score after full time and are deleted after 30 days.',
    ] },
    { id: 'sports', title: 'Sports, scoring and teams', body: [
      '<b>Settings</b> has Rugby Union (try 5, conversion 2, penalty 3, drop goal 3) and Football (goal 1). Tap one to change its points or periods.',
      '<b>+ New sport</b> builds your own: name it, set the periods, and add score types. A <b>follow-up</b> (like a conversion after a try) makes the app ask “made or missed?” after that score.',
      'Team names you type are remembered and suggested next time. Remove old ones in Settings.',
    ] },
    { id: 'golf', title: 'Golf rounds', body: [
      'Add your courses in <b>Settings → Golf courses</b>: name, 9 or 18 holes, and each hole’s par. No course set up? Pick a <b>Quick round</b> (par 4 on every hole).',
      '<b>New match → Golf</b>: choose the course and add as many players as you like.',
      'On each hole, use <b>−</b> / <b>+</b> to set each player’s strokes. Grey numbers are par and are saved when you tap <b>Next hole</b>. Each player shows how they stand, e.g. <b>+3 thru 7</b>.',
      '<b>Card</b> shows the whole scorecard with birdies and bogeys marked. Tap any score to fix it. Use the hole picker to jump back to a hole.',
      'On the last hole, <b>Finish</b> saves the round with a leaderboard. <b>Share result</b> and <b>Go live</b> work just like for matches.',
    ] },
    { id: 'backup', title: 'Backups and changing phones', body: [
      'Your matches are stored only on your phone. <b>Settings → Back up</b> saves them, with your sports and teams, to a file. Save it to Files or iCloud, or email it to yourself.',
      'On a new phone, or after re-adding the app, use <b>Settings → Restore</b> and pick that file. Nothing already there is deleted.',
    ] },
  ],
  faq: [
    { q: 'Why don’t the score buttons work?', a: 'The clock isn’t running, so the buttons look faded. Tap one and choose <b>Start clock & add score</b>, or tap the green <b>Start clock</b> bar.' },
    { q: 'Do I need signal at the ground?', a: 'No. Everything works offline except live sharing, and even that catches up when signal comes back.' },
    { q: 'I removed the app from my home screen. Where are my matches?', a: 'On iPhone, removing the icon deletes its data. Next time, use <b>Settings → Back up</b> first, then <b>Restore</b> after adding it again. Matches you shared can be brought back with <b>Open a shared link</b>.' },
    { q: 'I opened a shared link but it isn’t in my app.', a: 'On iPhone, links open in Safari, which keeps separate data from the home-screen app. Copy the link and use <b>History → Open a shared link</b> inside the app.' },
    { q: 'I forgot to change the half length. Can I fix the times?', a: 'Yes. Open the match, tap <b>Edit match</b> and change the minutes. Event times in later halves move to match.' },
    { q: 'Why didn’t my phone vibrate at half time?', a: 'iPhones don’t allow websites to vibrate. You still get the red flash, banner and beep. Check the beep is on in <b>Settings → Time-up alerts</b> and your phone isn’t on silent.' },
    { q: 'My screen keeps turning off.', a: 'The app keeps the screen on during a live match. Low Power Mode on iPhone can override this, so turn it off for the match, or raise Auto-Lock in Settings.' },
    { q: 'Viewers say “scorer’s phone offline”.', a: 'Your phone hasn’t reached the internet for a couple of minutes. Scores still save on your phone and are sent when signal returns.' },
    { q: 'Golf: why did a player get par on a hole I didn’t touch?', a: 'When you move to the next hole, any score you didn’t change is saved as par, the grey number shown. Fix it on the <b>Card</b> by tapping that hole.' },
    { q: 'Can two people score the same match?', a: 'Not yet. Only the phone that tapped <b>Go live</b> can update a live match.' },
    { q: 'How do I get the latest version?', a: 'When an update is ready, a green <b>New version available</b> bar appears. Tap it. The version number is at the bottom of every screen.' },
    { q: 'Is my data private?', a: 'Matches stay on your phone. A shared result link carries that match inside the link itself. Live matches pass through our live-score server and are deleted 30 days after the last update. There are no accounts or tracking.' },
  ],
};

function viewHelp() {
  const guides = HELP.guides.map((g) => `
    <details class="help-item" id="help-${g.id}">
      <summary>${esc(g.title)}</summary>
      <ul>${g.body.map((b) => `<li>${b}</li>`).join('')}</ul>
    </details>`).join('');
  const faq = HELP.faq.map((f) => `
    <details class="help-item faq">
      <summary>${esc(f.q)}</summary>
      <p>${f.a}</p>
    </details>`).join('');
  return `
    <div class="topbar"><button class="btn-ghost btn-small" data-go="">‹ Home</button><h2>Help</h2></div>
    ${isStandalone() ? '' : `<p class="help-note">${isIOS()
      ? 'Tip: add Scorecard to your home screen. Tap <b>Share</b>, then <b>Add to Home Screen</b>.'
      : 'Tip: install Scorecard from your browser menu (<b>⋮ → Install app</b>) so it works offline.'}</p>`}
    <h3>Guides</h3>
    <div class="help-list">${guides}</div>
    <h3>FAQ</h3>
    <div class="help-list">${faq}</div>
    <div class="row">
      <button data-action="show-welcome">Show welcome again</button>
      <button data-action="share-help">Share this guide</button>
    </div>`;
}

const WELCOME = () => [
  { title: 'Welcome to Scorecard', body: isStandalone()
    ? 'Keep score while you watch: rugby, football or your own sport. It works offline and keeps your screen on during a match.'
    : isIOS()
      ? 'First, add it to your home screen so it works offline at the ground: tap <b>Share</b> in Safari, then <b>Add to Home Screen</b>, and open it from the icon.'
      : 'First, install it so it works offline at the ground: tap your browser’s <b>⋮</b> menu, then <b>Install app</b> or <b>Add to Home screen</b>.' },
  { title: 'Scoring a match', body: 'Tap <b>New match</b>, set the teams and half length, then tap <b>Start clock</b> at kick-off. Tap a team’s button when they score. The app tells you when it’s half time.' },
  { title: 'Help is always here', body: '<b>Help & FAQ</b> on the Home screen covers fixing mistakes, sharing results, live scores for people at home, and backups.' },
];

function showWelcome(step = 0) {
  const cards = WELCOME();
  const c = cards[step];
  const last = step === cards.length - 1;
  openModal(`
    <div class="welcome">
      <div class="welcome-dots">${cards.map((_, i) => `<span class="${i === step ? 'on' : ''}"></span>`).join('')}</div>
      <h2>${c.title}</h2>
      <p>${c.body}</p>
      <div class="prompt-actions">
        <button data-modal="skip">${last ? 'Close' : 'Skip'}</button>
        <button class="btn-primary" data-modal="${last ? 'done' : 'next'}">${last ? 'Let’s go' : 'Next'}</button>
      </div>
    </div>`, (res) => {
    if (res === 'next') return showWelcome(step + 1);
    store.set('welcomed', true); // skip, done or tapping outside: never show again
  });
}

/* Scoreboard, breakdown and timeline: used by match detail and shared-link views. */
function matchSummary(m) {
  if (isGolf(m)) return golfSummary(m, null);
  const t = totals(m);
  const bd = (side) => {
    const lines = breakdown(m, side);
    return `<div class="card team-card ${side}"><strong class="team-label">${esc(teamName(m, side))}</strong>
      ${lines.length ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="muted">No scores</p>'}</div>`;
  };
  const evs = sortedEvents(m);
  return `
    <div class="scoreboard" style="position:static">
      <div class="team home">${esc(teamName(m, 'home'))}</div><div></div><div class="team away">${esc(teamName(m, 'away'))}</div>
      <div class="score">${t.home}</div><div class="dash">–</div><div class="score">${t.away}</div>
      <div class="clock-row tag">${new Date(m.startedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · ${fmtClock(playedMs(m))} played</div>
    </div>
    <h3>Breakdown</h3>
    <div class="breakdown">${bd('home')}${bd('away')}</div>
    <h3>Timeline</h3>
    ${evs.length ? `<ul class="list">${evs.map((e) => eventRow(m, e, null)).join('')}</ul>` : '<p class="empty">No events.</p>'}`;
}

function viewSettings() {
  const sports = getSports();
  const teams = getTeams();
  const missingPresets = PRESETS.filter((p) => !sports.some((s) => s.id === p.id));
  return `
    <div class="topbar"><button class="btn-ghost btn-small" data-go="">‹ Back</button><h2>Settings</h2></div>
    <h3>Sports &amp; scoring</h3>
    <ul class="list">${sports.filter((s) => s.kind !== 'golf').map((s) => `
      <li><button class="list-item" data-go="sport/${esc(s.id)}">
        <span class="grow">${esc(s.name)}<br><span class="tag">${s.periods.count} × ${s.periods.minutes} min · ${s.scoreTypes.map((t) => `${esc(t.name)} ${t.points}`).join(' · ')}</span></span>
        <span class="tag">Edit ›</span></button></li>`).join('')}
    </ul>
    <button data-go="sport/new">+ New sport</button>
    ${missingPresets.length ? `<button class="btn-ghost" data-action="restore-presets">Restore default sports</button>` : ''}
    ${coursesSection()}
    <h3>Time-up alerts</h3>
    <label class="check"><input type="checkbox" data-action="toggle-sound" ${store.get('sound', true) === false ? '' : 'checked'}> Beep when a half (or period) is up</label>
    <p class="muted" style="font-size:.95rem">The clock always flashes, and Android phones also vibrate.</p>
    <h3>Saved teams &amp; players</h3>
    ${teams.length ? `<ul class="list">${teams.map((t, i) => `
      <li class="list-item"><span class="grow">${esc(t)}</span><button class="btn-small btn-ghost" data-action="delete-team" data-i="${i}" aria-label="Delete ${esc(t)}">✕</button></li>`).join('')}</ul>`
      : '<p class="muted">Team and player names you type when starting a match are saved here.</p>'}
    <h3>Backup &amp; restore</h3>
    <p class="muted" style="font-size:.95rem">Saves your matches, sports and teams to a file, e.g. before removing the app from your home screen. Restore adds them back; nothing already here is deleted.</p>
    <div class="row">
      <button data-action="backup">Back up</button>
      <button data-action="restore-pick">Restore</button>
    </div>
    <input type="file" id="restore-file" accept=".json,application/json" hidden>
    <button class="btn-ghost" data-action="open-link">Open a shared link</button>`;
}
viewSettings.after = () => {
  const input = $('#restore-file');
  if (input) input.addEventListener('change', () => { if (input.files[0]) restoreBackup(input.files[0]); input.value = ''; });
};

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
    publishLive(m); // viewers see the final result
    const h = getHistory();
    h.unshift(m);
    store.set('history', h);
    store.del('live');
    setWakeLock(false);
    exitFullscreen();
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
  'resume-match'() { enterFullscreen(); go('live'); },
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
  'edit-match'(el) { editMatchForm(el.dataset.ref); },
  async 'go-live'() {
    if (!LIVE_API) return toast("Live sharing isn't set up yet");
    if (!getLive()?.live) {
      updateLive((m) => { m.live = { id: randomToken(15), key: randomToken(24), since: Date.now() }; });
      if (navigator.vibrate) navigator.vibrate(40);
    }
    await shareLiveLink(getLive());
  },
  async 'live-menu'() {
    const m = getLive();
    if (!m?.live) return;
    const statusText = { ok: 'Viewers are up to date.', pending: 'No signal – updates will send when you reconnect.', idle: 'Connecting…' }[livePub.status] || '';
    openModal(`
      <h2>Live sharing</h2>
      <p class="muted">${esc(statusText)}</p>
      <div class="stack" style="margin-top:14px">
        <button class="btn-primary" data-modal="share">Share link again</button>
        <button class="btn-danger" data-modal="stop">Stop live sharing</button>
        <button class="btn-ghost" data-modal="close">Close</button>
      </div>`, async (res) => {
      if (res === 'share') return shareLiveLink(getLive());
      if (res !== 'stop') return;
      updateLive((m) => { m.liveStopped = true; });     // last update tells viewers it stopped
      updateLive((m) => { delete m.live; delete m.liveStopped; });
      toast('Live sharing stopped');
    });
  },
  'save-watched'() {
    const m = watch.match;
    if (!m) return;
    const copy = clone(m);
    delete copy.live;
    const h = getHistory().filter((x) => x.id !== copy.id);
    h.push(copy);
    store.set('history', h);
    sortHistory();
    rememberTeams([copy.home, copy.away]);
    toast('Saved to your history');
    render();
  },
  async 'share-match'(el) {
    const m = getMatch(el.dataset.id);
    if (m) await shareMatch(m);
  },
  'golf-add-player'() { addPlayerInput(); },
  'golf-step'(el) {
    updateLive((m) => {
      const sc = m.scores[el.dataset.pid];
      const cur = sc[m.hole] == null ? m.course.pars[m.hole] : sc[m.hole];
      sc[m.hole] = Math.max(1, Math.min(20, cur + Number(el.dataset.d)));
    });
    if (navigator.vibrate) navigator.vibrate(15);
  },
  'golf-next'() { updateLive((m) => { commitHole(m); m.hole = Math.min(m.hole + 1, m.course.pars.length - 1); }); },
  'golf-prev'() { updateLive((m) => { m.hole = Math.max(0, m.hole - 1); }); },
  async 'golf-finish'() {
    const m = getLive();
    if (!m) return;
    const missing = m.players.reduce((t, p) => t + m.scores[p.id].filter((v, i) => v == null && i !== m.hole).length, 0);
    const ok = await confirmModal('Finish the round?', missing
      ? `${missing} score${missing === 1 ? ' is' : 's are'} still empty. You can fill them in later from the scorecard.`
      : 'The round is saved to History.', 'Finish round', 'Keep playing', true);
    if (!ok) return;
    const m2 = getLive();
    commitHole(m2);
    m2.endedAt = Date.now();
    publishLive(m2);
    const h = getHistory();
    h.unshift(m2);
    store.set('history', h);
    store.del('live');
    setWakeLock(false);
    exitFullscreen();
    go('match/' + m2.id);
  },
  'golf-cell'(el) { golfCellForm(el.dataset.ref, el.dataset.pid, Number(el.dataset.hole)); },
  'cancel-course'() { courseDraft = null; go('settings'); },
  async 'delete-course'() {
    const ok = await confirmModal(`Delete ${courseDraft.name || 'this course'}?`, 'Rounds already played there are not affected.', 'Delete', 'Cancel', true);
    if (!ok) return;
    store.set('courses', getCourses().filter((c) => c.id !== courseDraft.id));
    courseDraft = null;
    go('settings');
  },
  backup() { saveBackup(); },
  'show-welcome'() { showWelcome(0); },
  async 'share-help'() {
    const url = `${location.origin}${location.pathname}#/help`;
    if (navigator.share) { try { await navigator.share({ title: 'Scorecard – help', url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link:', url); }
  },
  'restore-pick'() { $('#restore-file')?.click(); },
  'open-link'() { openLinkForm(); },
  async 'paste-link'() {
    try {
      const text = await navigator.clipboard.readText();
      const f = $('#link-form');
      if (f) f.elements.link.value = text;
      const r = routeFromText(text);
      if (r) closeModal({ route: r });
      else toast("The clipboard doesn't contain a Scorecard link");
    } catch { toast('Paste into the box instead'); }
  },
  'save-shared'() {
    const m = sharedView.match;
    if (!m) return;
    const h = getHistory().filter((x) => x.id !== m.id);
    h.push(clone(m));
    store.set('history', h);
    sortHistory();
    rememberTeams([m.home, m.away]);
    toast('Saved to your history');
    render();
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

document.addEventListener('change', (e) => {
  if (e.target.matches('.golf-jump')) {
    const to = Number(e.target.value);
    updateLive((m) => { commitHole(m); m.hole = to; });
  }
});

document.addEventListener('click', (e) => {
  if (e.target.matches('select')) return; // selects handle their own change events
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
  liveHeartbeat();
  const c = $('#clock');
  const m = c && getLive();
  if (m) c.innerHTML = fmtMatchClock(m);
  if (route()[0] === 'watch') tickWatch();
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
// first launch, on the Home screen only (never over a match or someone's shared/live link)
if (!store.get('welcomed') && (!location.hash || location.hash === '#/')) setTimeout(() => { if (!route()[0]) showWelcome(); }, 400);
