import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, setDoc, serverTimestamp, runTransaction, writeBatch } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyB3gR2Lu5Lj0OLVgv83Qdu2DGMqCThL0wg',
  authDomain: 'volume-competition.firebaseapp.com',
  projectId: 'volume-competition',
  storageBucket: 'volume-competition.firebasestorage.app',
  messagingSenderId: '681802026275',
  appId: '1:681802026275:web:a4ce78cdaed0f7045c5096'
};
const START = '2026-11-01', END = '2027-01-01'; // END is exclusive.
const DAY = 86400000, LIMIT = 12;
const ROOT = ['artifacts', 'volume-challenge-app', 'public', 'data'];
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const sessionsRef = collection(db, ...ROOT, 'sessions');
const profilesRef = collection(db, ...ROOT, 'profiles');
const legacyRef = collection(db, ...ROOT, 'workouts');
const privateRef = (uid, type) => collection(db, 'users', uid, type);
const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('en-AU', { maximumFractionDigits: 1 });
const currency = n => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);
const key = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const dateOf = ms => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date(ms));
const today = () => dateOf(Date.now());
const shift = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
const monday = date => shift(date, -((new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7));
const inCompetition = s => s.date >= START && s.date < END;
const volume = ex => ex.weight * ex.reps * ex.sets;
const total = s => s.exercises.reduce((sum, ex) => sum + volume(ex), 0);
const uuid = () => crypto.randomUUID();
const clock = seconds => [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
const validExercise = e => e && typeof e.name === 'string' && e.name.trim().length > 0 && e.name.length <= 100 && Number.isFinite(e.weight) && e.weight > 0 && e.weight <= 2000 && Number.isInteger(e.reps) && e.reps > 0 && e.reps <= 1000 && Number.isInteger(e.sets) && e.sets > 0 && e.sets <= 100;
let user = null, signup = false, authBusy = false, signupName = '';
let sessions = [], legacy = [], profiles = [], routines = [], memory = [];
let local = { draft: null, outbox: {} }, unsubs = [], chart, epoch = 0;
let restUntil = 0, selectedOpponent = '', streamState = new Map();
const sending = new Set();

function element(tag, text = '', className = '') {
  const el = document.createElement(tag); el.textContent = text; el.className = className; return el;
}
function button(text, action, className = '') {
  const el = element('button', text, className); el.type = 'button'; el.addEventListener('click', action); return el;
}
function notice(text) { $('status').textContent = text; }
function fail(error, prefix = '') {
  console.error(error);
  const messages = {
    'auth/email-already-in-use': 'That email already has an account. Sign in instead.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/weak-password': 'Use at least six characters and meet the Firebase password policy.',
    'auth/operation-not-allowed': 'Enable Email/Password in Firebase Authentication.',
    'auth/network-request-failed': 'Connect to the internet to sign in.',
    'auth/too-many-requests': 'Too many attempts. Try again later.',
    'permission-denied': 'Access denied. Check the published Firestore rules and username cooldown.'
  };
  $('error').hidden = false;
  $('error').textContent = prefix + (messages[error.code] || error.message || String(error));
}
function clearError() { $('error').hidden = true; }
function storageKey(uid) { return 'volume-v2:' + uid; }
function readLocal(uid) {
  const value = JSON.parse(localStorage.getItem(storageKey(uid)) || '{"draft":null,"outbox":{}}');
  return { draft: value.draft || null, outbox: value.outbox || {} };
}
function persist(value, uid = user.uid) {
  // Fail visibly if durable local storage is unavailable; never silently discard a session.
  localStorage.setItem(storageKey(uid), JSON.stringify(value));
  if (user?.uid === uid) local = value;
}
function persistDraft() {
  if (!user) return;
  try { const fresh = readLocal(user.uid); persist({ ...fresh, draft: local.draft }); }
  catch (e) { fail(e, 'Could not back up the active session on this device. '); }
}
function nameFor(uid) {
  return profiles.find(p => p.id === uid)?.displayName ||
    (uid === user?.uid ? signupName || user.displayName : '') ||
    sessions.find(s => s.userId === uid)?.userName ||
    legacy.find(s => s.userId === uid)?.userName || 'Athlete';
}
function showView(id) {
  document.querySelectorAll('.view').forEach(el => el.hidden = el.id !== id);
  document.querySelectorAll('[data-view]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.view === id)));
  render();
}
document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => showView(el.dataset.view)));

$('auth-toggle').addEventListener('click', () => {
  signup = !signup;
  $('name-field').hidden = !signup; $('auth-name').required = signup;
  $('auth-password').minLength = signup ? 6 : 1;
  $('auth-password').autocomplete = signup ? 'new-password' : 'current-password';
  $('auth-submit').textContent = signup ? 'Create account' : 'Sign in';
  $('auth-toggle').textContent = signup ? 'Already registered? Sign in' : 'Create an account';
});
$('auth-form').addEventListener('submit', async event => {
  event.preventDefault(); if (authBusy) return;
  authBusy = true; clearError(); $('auth-submit').disabled = true; $('auth-toggle').disabled = true;
  signupName = signup ? $('auth-name').value.trim() : '';
  try {
    if (signup && !signupName) throw new Error('Enter a username.');
    const action = signup ? createUserWithEmailAndPassword : signInWithEmailAndPassword;
    await action(auth, $('auth-email').value.trim(), $('auth-password').value);
    $('auth-password').value = '';
  } catch (e) { fail(e); }
  finally { authBusy = false; $('auth-submit').disabled = false; $('auth-toggle').disabled = false; }
});
$('logout').addEventListener('click', async () => {
  try { persistDraft(); await signOut(auth); } catch (e) { fail(e); }
});
try { await setPersistence(auth, browserLocalPersistence); }
catch (e) { fail(e, 'Persistent sign-in is unavailable in this browser. '); }
$('auth-submit').disabled = false;

async function ensureProfile(u, displayName) {
  const ref = doc(profilesRef, u.uid);
  await runTransaction(db, async tx => {
    if (!(await tx.get(ref)).exists()) tx.set(ref, {
      userId: u.uid, displayName: displayName.slice(0, 40) || 'Athlete',
      nameChangedAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
  });
}
function watch(ref, label, assign, token) {
  unsubs.push(onSnapshot(ref, { includeMetadataChanges: true }, snap => {
    if (epoch !== token) return;
    assign(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    streamState.set(label, snap.metadata.fromCache ? 'cached' : 'synced');
    render();
  }, e => { if (epoch === token) { streamState.set(label, 'error'); fail(e, label + ': '); syncStatus(); } }));
}
onAuthStateChanged(auth, u => {
  const token = ++epoch;
  unsubs.forEach(stop => stop()); unsubs = []; streamState.clear();
  sessions = []; legacy = []; profiles = []; routines = []; memory = []; restUntil = 0;
  if (chart) { chart.destroy(); chart = null; }
  user = u; local = { draft: null, outbox: {} };
  $('auth-view').hidden = !!u; $('app-view').hidden = !u; $('logout').hidden = !u;
  clearError();
  if (!u) { signupName = ''; notice('Sign in to start lifting.'); return; }
  try { local = readLocal(u.uid); } catch (e) { fail(e, 'Could not restore local sessions. '); }
  renderDraft();
  watch(sessionsRef, 'Sessions', value => sessions = value.filter(s => Array.isArray(s.exercises) && s.exercises.every(validExercise)), token);
  watch(legacyRef, 'Legacy logs', value => legacy = value, token);
  watch(profilesRef, 'Profiles', value => profiles = value, token);
  watch(privateRef(u.uid, 'routines'), 'Routines', value => routines = value, token);
  watch(privateRef(u.uid, 'exercises'), 'Exercise memory', value => memory = value, token);
  ensureProfile(u, signupName || u.displayName || 'Athlete').catch(e => {
    if (epoch === token) fail(e, 'Signed in, but profile setup needs a connection. Workouts can still be logged. ');
  });
  flush(); render();
});

// Legacy records remain in their original collection. No migration or double-counting.
function allSessions() {
  const result = new Map(sessions.map(s => [s.id, { ...s, source: 'sessions' }]));
  const groups = new Map();
  for (const w of legacy) {
    const ex = { name: w.exercise, weight: Number(w.weight), reps: Number(w.reps), sets: Number(w.sets) };
    if (!validExercise(ex) || typeof w.userId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(w.date)) continue;
    const id = 'legacy:' + w.userId + ':' + w.date + ':' + key(w.session);
    if (!groups.has(id)) groups.set(id, { id, userId: w.userId, userName: w.userName, date: w.date, name: w.session || 'Legacy session', exercises: [], notes: '', source: 'legacy', legacyIds: [], durationSec: null });
    groups.get(id).exercises.push(ex); groups.get(id).legacyIds.push(w.id);
  }
  for (const s of groups.values()) result.set(s.id, s);
  for (const [id, job] of Object.entries(local.outbox)) {
    if (job.type === 'delete') result.delete(id);
    else result.set(id, { ...job.data, id, source: 'sessions', pending: true, rejected: !!job.error });
  }
  return [...result.values()].sort((a, b) => b.date.localeCompare(a.date) || (b.startedAt || 0) - (a.startedAt || 0));
}
function syncStatus() {
  if (!user) return;
  const jobs = Object.values(local.outbox), failed = jobs.filter(j => j.error).length;
  $('retry').hidden = !jobs.length;
  notice(`${navigator.onLine ? 'Online' : 'Offline'} · ${jobs.length ? jobs.length + ' change(s) waiting for server confirmation' : 'No pending session changes'}${failed ? ' · ' + failed + ' failed; retry from History' : ''}${[...streamState.values()].includes('error') ? ' · Some data could not be loaded' : [...streamState.values()].includes('cached') ? ' · Showing cached data' : ''}`);
}
function queue(id, job) {
  const fresh = readLocal(user.uid);
  const token = uuid();
  persist({ ...fresh, outbox: { ...fresh.outbox, [id]: { ...job, token } } });
  flush(); render();
}
function flush() {
  if (!user) return;
  const uid = user.uid;
  for (const [id, job] of Object.entries(local.outbox)) {
    const task = uid + ':' + id + ':' + job.token;
    if (sending.has(task) || job.error) continue;
    sending.add(task);
    let operation;
    if (job.type === 'put') {
      // A stable document ID makes retries idempotent.
      operation = setDoc(doc(sessionsRef, id), { ...job.data, updatedAt: serverTimestamp() });
    } else {
      const batch = writeBatch(db);
      if (job.legacyIds) job.legacyIds.forEach(oldId => batch.delete(doc(legacyRef, oldId)));
      else batch.delete(doc(sessionsRef, id));
      operation = batch.commit();
    }
    operation.then(() => {
      const fresh = readLocal(uid);
      if (fresh.outbox[id]?.token === job.token) { delete fresh.outbox[id]; persist(fresh, uid); }
    }).catch(e => {
      try {
        const fresh = readLocal(uid);
        if (fresh.outbox[id]?.token === job.token) { fresh.outbox[id].error = e.message || 'Write failed'; persist(fresh, uid); }
      } catch (storageError) { console.error(storageError); }
      if (user?.uid === uid) fail(e, 'Change retained on this device; use Retry in History. ');
    }).finally(() => { sending.delete(task); if (user?.uid === uid) render(); });
  }
}
$('retry').addEventListener('click', () => {
  try {
    const fresh = readLocal(user.uid);
    Object.values(fresh.outbox).forEach(job => delete job.error);
    persist(fresh); clearError(); flush(); render();
  } catch (e) { fail(e); }
});
window.addEventListener('online', () => { flush(); syncStatus(); });
window.addEventListener('offline', syncStatus);
window.addEventListener('storage', event => {
  if (user && event.key === storageKey(user.uid)) {
    try { local = readLocal(user.uid); renderDraft(); render(); flush(); } catch (e) { fail(e); }
  }
});

function startSession(exercises = [], name = '') {
  if (local.draft) {
    if (!confirm('Replace the active session with this routine?')) return;
  }
  const draft = { id: uuid(), startedAt: Date.now(), name, notes: '', exercises: exercises.map(e => ({ ...e })) };
  if (!draft.exercises.length) draft.exercises.push({ name: '', weight: '', reps: '', sets: 3 });
  try { persist({ ...readLocal(user.uid), draft }); restUntil = 0; renderDraft(); showView('train'); }
  catch (e) { fail(e, 'Cannot start a recoverable session: '); }
}
$('start').addEventListener('click', () => startSession());
$('discard').addEventListener('click', () => {
  if (!confirm('Discard this unfinished session?')) return;
  try { persist({ ...readLocal(user.uid), draft: null }); restUntil = 0; renderDraft(); }
  catch (e) { fail(e); }
});
function addExercise(name = '') {
  if (!local.draft) return;
  if (local.draft.exercises.length >= LIMIT) return fail(new Error('Maximum 12 blocks per session.'));
  local.draft.exercises.push({ name, weight: '', reps: '', sets: 3 });
  persistDraft(); renderDraft();
}
$('add-exercise').addEventListener('click', () => addExercise());
function previous(name) {
  if (!name) return '';
  const session = allSessions().find(s => s.userId === user.uid && s.exercises.some(e => key(e.name) === key(name)));
  if (!session) return 'First time — set your baseline.';
  return 'Last time · ' + session.date + ': ' + session.exercises.filter(e => key(e.name) === key(name)).map(e => `${fmt(e.weight)} kg × ${e.reps} reps × ${e.sets} sets`).join(' / ');
}
function remember(name) {
  name = name.trim(); if (!name || name.length > 100 || !user) return;
  const uid = user.uid, id = 'e-' + encodeURIComponent(key(name));
  setDoc(doc(privateRef(uid, 'exercises'), id), { userId: uid, name, updatedAt: serverTimestamp() }).catch(e => { if (user?.uid === uid) fail(e, 'Exercise memory: '); });
}
function renderDraft() {
  const draft = local.draft;
  $('idle').hidden = !!draft; $('active').hidden = !draft;
  if (!draft) { $('exercise-blocks').replaceChildren(); return; }
  $('session-name').value = draft.name; $('session-notes').value = draft.notes;
  $('exercise-blocks').replaceChildren();
  draft.exercises.forEach((ex, index) => {
    const card = element('div', '', 'exercise'), head = element('div', '', 'exercise-head');
    const label = element('label', 'Exercise ' + (index + 1)), input = element('input');
    input.value = ex.name; input.required = true; input.maxLength = 100; input.setAttribute('list', 'exercise-options');
    const ghost = element('p', previous(ex.name), 'ghost');
    input.addEventListener('input', () => { ex.name = input.value; ghost.textContent = previous(ex.name); persistDraft(); });
    input.addEventListener('change', () => remember(ex.name));
    label.append(input);
    const del = button('×', () => { draft.exercises.splice(index, 1); persistDraft(); renderDraft(); }, 'delete-icon');
    del.setAttribute('aria-label', 'Delete exercise ' + (index + 1)); head.append(label, del);
    const numbers = element('div', '', 'numbers');
    for (const [field, title, min, max, step] of [['weight', 'Weight (kg)', .01, 2000, .01], ['reps', 'Reps', 1, 1000, 1], ['sets', 'Sets', 1, 100, 1]]) {
      const l = element('label', title), n = element('input');
      Object.assign(n, { type: 'number', min, max, step, required: true, value: ex[field] });
      n.inputMode = field === 'weight' ? 'decimal' : 'numeric';
      n.addEventListener('input', () => { ex[field] = n.value === '' ? '' : Number(n.value); persistDraft(); preview(); });
      l.append(n); numbers.append(l);
    }
    card.append(head, ghost, numbers); $('exercise-blocks').append(card);
  });
  preview(); tick();
}
function preview() {
  $('session-volume').textContent = fmt((local.draft?.exercises || []).reduce((sum, e) => sum + (Number.isFinite(volume(e)) ? volume(e) : 0), 0)) + ' kg';
}
$('session-name').addEventListener('input', e => { local.draft.name = e.target.value; persistDraft(); });
$('session-notes').addEventListener('input', e => { local.draft.notes = e.target.value; persistDraft(); });
function cleanExercises() {
  const exercises = local.draft.exercises.map(e => ({ name: e.name.trim(), weight: Number(e.weight), reps: Number(e.reps), sets: Number(e.sets) }));
  if (!exercises.length || exercises.length > LIMIT || !exercises.every(validExercise)) throw new Error('Complete each exercise: positive external weight and whole reps/sets.');
  return exercises;
}
$('session-form').addEventListener('submit', event => {
  event.preventDefault(); if (!local.draft) return;
  try {
    const exercises = cleanExercises(), draft = local.draft, endedAt = Date.now();
    if (endedAt < draft.startedAt) throw new Error('The device clock changed. Correct its time before finishing.');
    const durationSec = Math.floor((endedAt - draft.startedAt) / 1000);
    if (durationSec > 604800) throw new Error('This session exceeds seven days. Discard it and start a new session.');
    const data = { userId: user.uid, userName: nameFor(user.uid).slice(0, 60), name: draft.name.trim() || 'Workout', notes: draft.notes.trim(), date: dateOf(draft.startedAt), startedAt: draft.startedAt, endedAt, durationSec, exercises };
    const fresh = readLocal(user.uid);
    // Commit the outbox and clear the draft in the same localStorage write.
    persist({ draft: null, outbox: { ...fresh.outbox, [draft.id]: { type: 'put', data, token: uuid() } } });
    exercises.forEach(e => remember(e.name)); restUntil = 0; renderDraft(); flush(); showView('history');
  } catch (e) { fail(e); }
});
$('save-routine').addEventListener('click', () => {
  try {
    const exercises = cleanExercises(), name = prompt('Routine name (e.g. Push or Pull):', local.draft.name || '');
    if (!name?.trim()) return;
    if (name.trim().length > 60) throw new Error('Routine name must be 60 characters or fewer.');
    const uid = user.uid;
    setDoc(doc(privateRef(uid, 'routines'), 'r-' + encodeURIComponent(key(name))), { userId: uid, name: name.trim(), exercises, updatedAt: serverTimestamp() }).catch(e => { if (user?.uid === uid) fail(e, 'Routine was not synced: '); });
    notice('Routine queued; it will appear in Your routines when stored locally.');
  } catch (e) { fail(e); }
});
document.querySelectorAll('[data-rest]').forEach(el => el.addEventListener('click', () => { restUntil = Date.now() + Number(el.dataset.rest) * 1000; tick(); }));
$('stop-rest').addEventListener('click', () => { restUntil = 0; $('rest-clock').textContent = 'Ready'; });
function tick() {
  if (local.draft) $('stopwatch').textContent = clock(Math.max(0, Math.floor((Date.now() - local.draft.startedAt) / 1000)));
  if (restUntil) {
    const seconds = Math.max(0, Math.ceil((restUntil - Date.now()) / 1000));
    $('rest-clock').textContent = seconds ? seconds + 's' : 'Go!';
    if (!seconds) { restUntil = 0; navigator.vibrate?.([120, 60, 120]); }
  }
}
setInterval(tick, 1000);
document.addEventListener('visibilitychange', tick);

function athleteTotals(data) {
  const ids = new Set([user.uid, ...profiles.map(p => p.id), ...data.map(s => s.userId)]);
  return [...ids].map(id => ({ id, name: nameFor(id), total: data.filter(s => s.userId === id && inCompetition(s)).reduce((v, s) => v + total(s), 0) })).sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
}
function bossInfo(data) {
  const week = monday(today()), bosses = ['Deadlift', 'Squat', 'Bench Press'];
  const index = ((Math.floor((Date.parse(week) - Date.parse('2026-10-26')) / (7 * DAY)) % 3) + 3) % 3;
  const lift = bosses[index];
  const scores = data.filter(s => s.date >= week && s.date < shift(week, 7)).map(s => ({ id: s.userId, value: s.exercises.filter(e => key(e.name) === key(lift)).reduce((v, e) => v + volume(e), 0) }));
  const best = Math.max(0, ...scores.map(s => s.value));
  return { lift, best, winners: best ? [...new Set(scores.filter(s => Math.abs(s.value - best) < .000001).map(s => s.id))] : [] };
}
function streak(data, now = Date.now()) {
  // Legacy dates cannot establish a precise <48-hour gap: only timed sessions qualify.
  const timed = data.filter(s => Number.isFinite(s.startedAt) && Number.isFinite(s.endedAt)).sort((a, b) => a.startedAt - b.startedAt);
  let days = new Set(), lastEnd = null;
  for (const s of timed) {
    if (lastEnd !== null && s.startedAt - lastEnd >= 2 * DAY) days = new Set();
    days.add(s.date); lastEnd = Math.max(lastEnd || 0, s.endedAt);
  }
  return lastEnd !== null && now - lastEnd < 2 * DAY ? days.size : 0;
}
function render() {
  if (!user) return;
  const data = allSessions(), mine = data.filter(s => s.userId === user.uid), people = athleteTotals(data), boss = bossInfo(data);
  $('welcome').textContent = `Let’s go, ${nameFor(user.uid)}. Your next session is waiting.`;
  renderQuick(mine); renderRace(people, data, boss); renderHistory(mine); renderProfile(mine, boss); syncStatus();
}
function renderQuick(mine) {
  const names = new Map();
  [...memory.map(e => e.name), ...mine.flatMap(s => s.exercises.map(e => e.name))].forEach(n => { if (typeof n === 'string' && n.trim()) names.set(key(n), n); });
  const sorted = [...names.values()].sort();
  $('quick-list').replaceChildren(...sorted.map(n => button(n, () => addExercise(n), 'chip')));
  $('exercise-options').replaceChildren(...sorted.map(n => { const o = element('option'); o.value = n; return o; }));
  $('routines').replaceChildren(...routines.filter(r => Array.isArray(r.exercises) && r.exercises.every(validExercise)).map(r => button(r.name, () => startSession(r.exercises, r.name), 'chip')));
}
function renderRace(people, data, boss) {
  const first = people[0], second = people[1], tie = second && Math.abs(first.total - second.total) < .000001;
  $('leaderboard').replaceChildren();
  people.forEach((p, i) => {
    const row = element('div', '', 'rank'), name = element('div', '', 'rank-name');
    name.append(element('span', `${i + 1}. ${p.name}${p.id === user.uid ? ' (you)' : ''}`));
    if (i === 0 && p.total > 0 && !tie && people.length > 1) {
      const crown = element('span', '♛', 'crown'); crown.title = 'Current volume leader'; crown.setAttribute('aria-label', 'Current leader'); name.append(crown);
    }
    row.append(name, element('span', fmt(p.total) + ' kg', 'rank-total')); $('leaderboard').append(row);
  });
  $('leader-message').textContent = !first.total ? 'The competition starts on 1 November.' : !second ? 'Waiting for your competitor.' : tie ? 'Level pegging. The crown is unclaimed.' : `${first.name} leads by ${fmt(first.total - second.total)} kg.`;
  $('payout').textContent = `Projected winner’s payout: ${currency(first.total / 1000)}${tie && first.total ? ' · Tied; agree a tie-break before awarding.' : ''} · Competition dates only.`;
  const others = people.filter(p => p.id !== user.uid);
  if (!others.some(p => p.id === selectedOpponent)) selectedOpponent = others[0]?.id || '';
  $('opponent').replaceChildren(...others.map(p => { const o = element('option', p.name); o.value = p.id; return o; })); $('opponent').value = selectedOpponent;
  const me = people.find(p => p.id === user.uid), opponent = others.find(p => p.id === selectedOpponent), sum = me.total + (opponent?.total || 0);
  const percent = sum ? me.total / sum * 100 : 50;
  $('rope-left').textContent = nameFor(user.uid); $('rope-right').textContent = opponent?.name || 'Waiting for opponent';
  $('rope-fill').style.width = percent + '%'; $('rope-knot').style.left = percent + '%';
  $('rope-caption').textContent = opponent ? `${fmt(me.total)} kg vs ${fmt(opponent.total)} kg · ${fmt(Math.abs(me.total - opponent.total))} kg difference` : 'An opponent must register to join the tug-of-war.';
  $('rope').setAttribute('aria-label', $('rope-caption').textContent);
  $('boss-name').textContent = boss.lift;
  $('boss-result').textContent = boss.best ? `${boss.winners.map(nameFor).join(' & ')} · ${fmt(boss.best)} kg in one session · Boss Slayer` : 'Unclaimed. Log ' + boss.lift + ' this week to challenge the boss.';
  if (!$('race').hidden) drawChart(data);
}
$('opponent').addEventListener('change', e => { selectedOpponent = e.target.value; render(); });
$('chart-mode').addEventListener('change', render);
function drawChart(data) {
  if (!window.Chart) { $('chart-fallback').hidden = false; return; }
  $('chart-fallback').hidden = true;
  const week = monday(today()), dates = Array.from({ length: 7 }, (_, i) => shift(week, i)), cumulative = $('chart-mode').value === 'cumulative';
  function series(uid, previousWeek) {
    let sum = 0;
    return dates.map(date => {
      const target = previousWeek ? shift(date, -7) : date;
      const dayTotal = data.filter(s => s.userId === uid && s.date === target).reduce((n, s) => n + total(s), 0);
      sum += dayTotal; return !previousWeek && date > today() ? null : cumulative ? sum : dayTotal;
    });
  }
  const datasets = [{ label: nameFor(user.uid), data: series(user.uid, false), borderColor: '#c4f568', borderWidth: 3, pointRadius: 3 }];
  if (selectedOpponent) datasets.push(
    { label: nameFor(selectedOpponent), data: series(selectedOpponent, false), borderColor: '#b2a1ff', borderWidth: 2, pointRadius: 3 },
    { label: nameFor(selectedOpponent) + ' · last week', data: series(selectedOpponent, true), borderColor: '#b2a1ff70', borderDash: [6, 5], borderWidth: 2, pointRadius: 0 }
  );
  if (chart) { chart.data = { labels: dates, datasets }; chart.update('none'); return; }
  chart = new window.Chart($('chart'), {
    type: 'line', data: { labels: dates, datasets },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#a5afbd' } } }, scales: { x: { ticks: { color: '#a5afbd', maxTicksLimit: 7 } }, y: { beginAtZero: true, title: { display: true, text: 'Volume (kg)', color: '#a5afbd' }, ticks: { color: '#a5afbd' } } } }
  });
}
function renderHistory(mine) {
  const opened = new Set([...$('session-history').querySelectorAll('details[open]')].map(el => el.dataset.id));
  $('session-history').replaceChildren();
  if (!mine.length) $('session-history').append(element('p', 'No sessions yet. Start your first one.'));
  mine.forEach(s => {
    const card = element('details', '', 'session-card'); card.dataset.id = s.id; card.open = opened.has(s.id);
    const summary = element('summary', s.name || 'Workout');
    summary.append(element('small', `${s.date} · ${fmt(total(s))} kg · ${s.durationSec === null ? 'Duration unavailable (legacy)' : clock(s.durationSec || 0)}${inCompetition(s) ? '' : ' · Practice'}${s.pending ? s.rejected ? ' · Sync failed — retry' : ' · Pending sync' : ''}`));
    const list = element('ul'); s.exercises.forEach(e => list.append(element('li', `${e.name}: ${fmt(e.weight)} kg × ${e.reps} × ${e.sets} = ${fmt(volume(e))} kg`)));
    const del = button('Delete session', () => {
      if (!confirm(`Delete “${s.name || 'Workout'}” on ${s.date} and all its exercises?`)) return;
      try {
        if (s.legacyIds?.length > 450) throw new Error('This legacy session is too large to delete in one batch.');
        queue(s.id, { type: 'delete', ...(s.legacyIds ? { legacyIds: s.legacyIds } : {}) });
      } catch (e) { fail(e); }
    }, 'danger');
    card.append(summary, list); if (s.notes) card.append(element('p', s.notes)); card.append(del); $('session-history').append(card);
  });
}
function renderProfile(mine, boss) {
  $('profile-name').textContent = nameFor(user.uid);
  $('badges').replaceChildren();
  if (boss.winners.includes(user.uid)) $('badges').append(element('span', '⚔ Boss Slayer · ' + boss.lift, 'badge'));
  $('badges').append(element('span', '🔥 ' + streak(mine) + ' training-day streak', 'badge'));
  const lifetime = mine.reduce((n, s) => n + total(s), 0), competition = mine.filter(inCompetition).reduce((n, s) => n + total(s), 0);
  $('stats').replaceChildren();
  for (const [label, value, detail] of [
    ['Competition volume', fmt(competition) + ' kg', '1 Nov–31 Dec'],
    ['Lifetime volume', fmt(lifetime) + ' kg', mine.length + ' sessions'],
    ['RPG total weight', fmt(lifetime / 6000) + ' 🐘', 'African elephant equivalents (~6,000 kg each)'],
    ['Current streak', streak(mine) + ' days', 'Distinct training days; gaps must be <48h. Legacy sessions excluded.']
  ]) { const stat = element('div', '', 'stat'); stat.append(element('small', label), element('strong', value), element('small', detail)); $('stats').append(stat); }
  const daily = new Map(); mine.forEach(s => daily.set(s.date, (daily.get(s.date) || 0) + total(s)));
  const max = Math.max(1, ...Array.from({ length: 91 }, (_, i) => daily.get(shift(today(), -i)) || 0));
  $('heatmap').replaceChildren();
  for (let i = 90; i >= 0; i--) {
    const date = shift(today(), -i), v = daily.get(date) || 0, level = v ? Math.max(1, Math.ceil(v / max * 4)) : 0;
    const label = `${date}: ${fmt(v)} kg`, square = button('', () => $('heatmap-detail').textContent = label, 'level-' + level);
    square.title = label; square.setAttribute('aria-label', label); $('heatmap').append(square);
  }
  const p = profiles.find(p => p.id === user.uid), changed = p?.nameChangedAt?.toMillis?.() || 0, next = changed + 7 * DAY;
  $('name-cooldown').textContent = changed && next > Date.now() ? 'Next change: ' + new Date(next).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' }) + ' Brisbane time.' : 'Username change available. Server rules verify the cooldown.';
  $('rename').disabled = !!changed && next > Date.now();
  if (document.activeElement !== $('profile-input')) $('profile-input').value = nameFor(user.uid);
}
$('profile-form').addEventListener('submit', async event => {
  event.preventDefault(); const uid = user.uid, name = $('profile-input').value.trim();
  if (!name || name.length > 40) return fail(new Error('Use 1–40 characters.'));
  if (!navigator.onLine) return fail(new Error('Connect to the internet to change your username.'));
  $('rename').disabled = true;
  try {
    await runTransaction(db, async tx => {
      const ref = doc(profilesRef, uid), snap = await tx.get(ref), p = snap.exists() ? snap.data() : {};
      if (p.displayName === name) return;
      const changed = p.nameChangedAt?.toMillis?.() || 0;
      if (changed && Date.now() - changed < 7 * DAY) throw new Error('Wait seven days between username changes.');
      tx.set(ref, { userId: uid, displayName: name, nameChangedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    });
    clearError(); notice('Username updated.');
  } catch (e) { fail(e); }
  finally { if (user?.uid === uid) render(); }
});
$('export').addEventListener('click', () => {
  const rows = [['Session', 'Date', 'Duration seconds', 'Exercise', 'Weight kg', 'Reps', 'Sets', 'Volume kg', 'Notes', 'Competition', 'Sync']];
  allSessions().filter(s => s.userId === user.uid).forEach(s => s.exercises.forEach(e => rows.push([s.name, s.date, s.durationSec ?? '', e.name, e.weight, e.reps, e.sets, volume(e), s.notes || '', inCompetition(s) ? 'Yes' : 'No', s.pending ? 'Pending' : 'Synced'])));
  const cell = value => '"' + (typeof value === 'string' && /^\s*[=+@-]/.test(value) ? "'" + value : String(value ?? '')).replaceAll('"', '""') + '"';
  const blob = new Blob(['\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'volume-sessions-' + today() + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
