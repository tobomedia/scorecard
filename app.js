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
    scoreTypes: [{ id: 'goal', name: 'Goal', points: 1, followUpId: null, hidden: false }],
  },
];

const getSports = () => {
  let s = store.get('sports');
  if (!s) { s = clone(PRESETS); store.set('sports', s); }
  return s;
};
const getTeams = () => store.get('teams', []);
const getHistory = () => store.get('history', []);
const getLive = () => store.get('live', null);

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

/* ---------- clock ---------- */
const elapsedMs = (m) => m.clock.elapsedMs + (m.clock.runningSince ? Date.now() - m.clock.runningSince : 0);
const minuteOf = (ms) => Math.floor(ms / 60000) + 1;
function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/* ---------- scoring (always derived from the event log) ---------- */
const typeById = (m, id) => m.sport.scoreTypes.find((t) => t.id === id);

function totals(m) {
  const t = { home: 0, away: 0 };
  for (const e of m.events) {
    if (!e.made) continue;
    const st = typeById(m, e.scoreTypeId);
    if (st) t[e.team] += st.points;
  }
  return t;
}

function sortedEvents(m) {
  return [...m.events].sort((a, b) => a.minute - b.minute || a.createdAt - b.createdAt);
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
  app.innerHTML = view(...args);
  window.scrollTo(0, 0);
  if (view.after) view.after(...args);
  setWakeLock(name === 'live' && !!getLive());
}

/* ---------- views ---------- */
function viewHome() {
  const live = getLive();
  const t = live && totals(live);
  return `
    <div class="topbar"><h1>Scorecard</h1></div>
    ${live ? `
      <button class="card stack btn-block" data-go="live" style="text-align:left;align-items:stretch;min-height:auto;padding:16px">
        <span class="tag">Match in progress · ${esc(live.sport.name)}</span>
        <span style="font-size:1.4rem">${esc(teamName(live, 'home'))} <span class="big-score">${t.home} – ${t.away}</span> ${esc(teamName(live, 'away'))}</span>
        <span class="btn btn-primary">Resume match</span>
      </button>` : `
      <button class="btn-primary btn-big btn-block" data-go="new">New match</button>`}
    <button class="btn-big btn-block" data-go="history">History</button>
    <button class="btn-big btn-block" data-go="settings">Settings</button>
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
  const teams = getTeams().map((t) => `<option value="${esc(t)}">`).join('');
  return `
    <div class="topbar"><button class="btn-ghost btn-small" data-go="">‹ Back</button><h2>New match</h2></div>
    <form id="new-form" class="stack">
      <label>Sport<select name="sport">${opts}</select></label>
      <label>Home team<input name="home" placeholder="Home" list="teams" autocomplete="off" maxlength="40"></label>
      <label>Away team<input name="away" placeholder="Away" list="teams" autocomplete="off" maxlength="40"></label>
      <datalist id="teams">${teams}</datalist>
      <button class="btn-primary btn-big" type="submit">Start match</button>
    </form>`;
}
viewNew.after = () => {
  const f = $('#new-form');
  if (!f) return;
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
      clock: { elapsedMs: 0, runningSince: null },
      events: [],
    });
    go('live');
  });
};

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
  return `
    <div class="topbar"><button class="btn-ghost btn-small" data-go="">‹ Home</button><span class="tag">${esc(m.sport.name)}</span></div>
    <div class="scoreboard">
      <div class="team home">${esc(teamName(m, 'home'))}</div>
      <div></div>
      <div class="team away">${esc(teamName(m, 'away'))}</div>
      <div class="score">${t.home}</div>
      <div class="dash">–</div>
      <div class="score">${t.away}</div>
      <div class="clock-row">
        <span class="clock ${running ? '' : 'paused'}" id="clock">${fmtClock(elapsedMs(m))}</span>
        <button class="btn-small ${running ? '' : 'btn-primary'}" data-action="toggle-clock">${running ? 'Pause' : (m.clock.elapsedMs ? 'Resume' : 'Start')}</button>
      </div>
    </div>
    <div class="columns">${col('home')}${col('away')}</div>
    <div class="actionbar">
      <button data-action="undo" ${m.events.length ? '' : 'disabled'}>Undo</button>
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
  const minute = minuteOf(elapsedMs(m));
  updateLive((m) => m.events.push({ id: uid(), team: side, scoreTypeId: st.id, minute, made: true, createdAt: Date.now() }));
  if (navigator.vibrate) navigator.vibrate(30);
  const fu = st.followUpId && typeById(m, st.followUpId);
  if (!fu) return toast(`${st.name} – ${teamName(m, side)}`);
  openModal(`
    <h2>${esc(fu.name)} – ${esc(teamName(m, side))}</h2>
    <p class="muted">After ${esc(st.name.toLowerCase())} at ${minute}'</p>
    <div class="prompt-actions">
      <button data-modal="missed">Missed</button>
      <button class="btn-primary" data-modal="made">Made +${fu.points}</button>
    </div>`, (res) => {
    const made = res === 'made';
    updateLive((m) => m.events.push({ id: uid(), team: side, scoreTypeId: fu.id, minute, made, createdAt: Date.now() }));
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

function eventRow(m, e, ref) {
  const st = typeById(m, e.scoreTypeId);
  const label = `${esc(st ? st.name : 'Unknown')}${e.made ? '' : ' (missed)'}`;
  const inner = `
    <span class="min">${e.minute}'</span>
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
  e = e || { team: 'home', scoreTypeId: m.sport.scoreTypes[0]?.id, minute: minuteOf(elapsedMs(m)), made: true };
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
        <label>Minute<input name="minute" type="number" inputmode="numeric" min="1" max="999" value="${e.minute}" required></label>
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
    closeModal({ team: fd.get('team'), scoreTypeId: fd.get('type'), minute, made: fd.get('made') === '1' });
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
    return `<div class="card"><strong class="${side === 'home' ? '' : ''}" style="color:var(--${side})">${esc(teamName(m, side))}</strong>
      ${lines.length ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="muted">No scores</p>'}</div>`;
  };
  const evs = sortedEvents(m);
  return `
    <div class="topbar"><button class="btn-ghost btn-small" data-go="history">‹ History</button><span class="tag">${esc(m.sport.name)}</span></div>
    <div class="scoreboard" style="position:static">
      <div class="team home">${esc(teamName(m, 'home'))}</div><div></div><div class="team away">${esc(teamName(m, 'away'))}</div>
      <div class="score">${t.home}</div><div class="dash">–</div><div class="score">${t.away}</div>
      <div class="clock-row tag">${new Date(m.startedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · ${fmtClock(m.clock.elapsedMs)} played</div>
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
        <span class="grow">${esc(s.name)}<br><span class="tag">${s.scoreTypes.map((t) => `${esc(t.name)} ${t.points}`).join(' · ')}</span></span>
        <span class="tag">Edit ›</span></button></li>`).join('')}
    </ul>
    <button data-go="sport/new">+ New sport</button>
    ${missingPresets.length ? `<button class="btn-ghost" data-action="restore-presets">Restore default sports</button>` : ''}
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
      : { id: uid(), name: '', scoreTypes: [{ id: uid(), name: '', points: 1, followUpId: null, hidden: false }] };
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

/* ---------- actions ---------- */
const actions = {
  'toggle-clock'() {
    updateLive((m) => {
      if (m.clock.runningSince) {
        m.clock.elapsedMs += Date.now() - m.clock.runningSince;
        m.clock.runningSince = null;
      } else {
        m.clock.runningSince = Date.now();
      }
    });
  },
  undo() {
    const m = getLive();
    if (!m || !m.events.length) return;
    const last = m.events.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    const st = typeById(m, last.scoreTypeId);
    updateLive((m) => { m.events = m.events.filter((e) => e.id !== last.id); });
    toast(`Undid ${st ? st.name : 'event'} – ${teamName(m, last.team)}`);
  },
  end() {
    const m = getLive();
    if (!m || !confirm('End this match and save it to history?')) return;
    if (m.clock.runningSince) { m.clock.elapsedMs += Date.now() - m.clock.runningSince; m.clock.runningSince = null; }
    m.endedAt = Date.now();
    const h = getHistory();
    h.unshift(m);
    store.set('history', h);
    store.del('live');
    setWakeLock(false);
    go('match/' + m.id);
  },
  'add-event'(el) { eventForm(el.dataset.ref, null); },
  'edit-event'(el) {
    const m = getMatch(el.dataset.ref);
    eventForm(el.dataset.ref, m.events.find((e) => e.id === el.dataset.id));
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
  const c = $('#clock');
  if (!c) return;
  const m = getLive();
  if (m) c.textContent = fmtClock(elapsedMs(m));
}, 500);

/* ---------- boot ---------- */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
if (!location.hash && getLive()) go('live'); else render();
