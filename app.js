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
const DAY = 86400000, LIMIT = 30, SET_LIMIT = 30;
const COLORS = ['#bdf56b','#b7a6ff','#73ceff','#ffbd79','#ff89b1','#6ce2ca'];
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
const setVolume = set => set.complete ? Number(set.weight) * Number(set.reps) : 0;
const volume = ex => ex.sets.reduce((sum, set) => sum + setVolume(set), 0);
const total = s => s.exercises.reduce((sum, ex) => sum + volume(ex), 0);
const uuid = () => crypto.randomUUID();
const clock = seconds => [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
const validSet = s => !!s && Number.isFinite(Number(s.weight)) && Number(s.weight) > 0 && Number(s.weight) <= 2000 && Number.isInteger(Number(s.reps)) && Number(s.reps) > 0 && Number(s.reps) <= 1000;
const validBodyweight = n => Number.isFinite(Number(n)) && Number(n) >= 20 && Number(n) <= 500;
const complete = ex => ex.sets.length > 0 && ex.sets.every(s => s.complete && validSet(s));
function normalizeExercise(ex, index = 0, draft = false) {
  ex = ex && typeof ex === 'object' ? ex : {};
  const sets = Array.isArray(ex.sets) ? ex.sets.slice(0, 100).filter(s => s && typeof s === 'object').map(s => ({ weight: s.weight ?? '', reps: s.reps ?? '', complete: !!s.complete && validSet(s) })) :
    Array.from({ length: Math.min(100, Math.max(0, Number(ex.sets) || 0)) }, () => ({ weight: Number(ex.weight), reps: Number(ex.reps), complete: !draft && validSet(ex) }));
  return { id: ex.id || 'ex-' + index, name: String(ex.name || ''), groupId: typeof ex.groupId === 'string' ? ex.groupId : '', groupName: typeof ex.groupName === 'string' ? ex.groupName : '', sets, collapsed: draft ? !!ex.collapsed : false };
}
function normalizeSession(s) {
  return { ...s, bodyweight: validBodyweight(s.bodyweight) ? Number(s.bodyweight) : null, exercises: (s.exercises || []).map((e, i) => normalizeExercise(e, i)) };
}
function normalizeDraft(d) {
  if (!d) return null;
  const exercises = (d.exercises || []).map((e, i) => normalizeExercise(e, i, true));
  return { ...d, bodyweight: d.bodyweight ?? '', groups: d.groups || [], superset: !!d.superset, activeGroup: d.activeGroup || '', exercises };
}
let user = null, signup = false, authBusy = false, signupName = '';
let sessions = [], legacy = [], profiles = [], routines = [], memory = [];
let local = { draft: null, outbox: {} }, unsubs = [], epoch = 0;
let restUntil = 0, selectedExercise = '', streamState = new Map();
let exerciseChart, raceChart;
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
  return { draft: normalizeDraft(value.draft), outbox: value.outbox || {}, bodyweight: value.bodyweight ?? '', selected: value.selected || [uid], favorites: value.favorites || [] };
}
function persist(value, uid = user.uid) {
  // Fail visibly if durable local storage is unavailable; never silently discard a session.
  localStorage.setItem(storageKey(uid), JSON.stringify(value));
  if (user?.uid === uid) local = value;
}
function persistDraft() {
  if (!user) return;
  try { const draft = local.draft, fresh = readLocal(user.uid); persist({ ...fresh, draft }); }
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
  if (exerciseChart) exerciseChart.destroy(); if (raceChart) raceChart.destroy(); exerciseChart = null; raceChart = null;
  user = u; local = { draft: null, outbox: {}, selected: u ? [u.uid] : [], favorites: [], bodyweight: '' };
  $('auth-view').hidden = !!u; $('app-view').hidden = !u; $('logout').hidden = !u;
  clearError();
  if (!u) { signupName = ''; notice('Sign in to start lifting.'); return; }
  try { local = readLocal(u.uid); } catch (e) { fail(e, 'Could not restore local sessions. '); }
  renderDraft();
  watch(sessionsRef, 'Sessions', value => sessions = value.filter(s => typeof s.userId === 'string' && typeof s.date === 'string' && Array.isArray(s.exercises)).map(normalizeSession), token);
  watch(legacyRef, 'Legacy logs', value => legacy = value, token);
  watch(profilesRef, 'Profiles', value => profiles = value, token);
  watch(privateRef(u.uid, 'routines'), 'Routines', value => routines = value, token);
  watch(privateRef(u.uid, 'exercises'), 'Exercise memory', value => memory = value, token);
  watch(privateRef(u.uid, 'settings'), 'Preferences', value => {
    const prefs = value.find(p => p.id === 'competition');
    if (prefs) {
      try { persist({ ...readLocal(u.uid), selected: Array.isArray(prefs.selected) ? prefs.selected : [u.uid], favorites: Array.isArray(prefs.favorites) ? prefs.favorites : [], bodyweight: prefs.bodyweight ?? '', draft: local.draft }); }
      catch (e) { fail(e); }
    }
  }, token);
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
    const ex = normalizeExercise({ name: w.exercise, weight: Number(w.weight), reps: Number(w.reps), sets: Number(w.sets) });
    if (!ex.name || !ex.sets.length || !ex.sets.every(validSet) || typeof w.userId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(w.date)) continue;
    const id = 'legacy:' + w.userId + ':' + w.date + ':' + key(w.session);
    if (!groups.has(id)) groups.set(id, { id, userId: w.userId, userName: w.userName, date: w.date, name: w.session || 'Legacy session', exercises: [], notes: '', source: 'legacy', legacyIds: [], durationSec: null, bodyweight: null });
    groups.get(id).exercises.push(ex); groups.get(id).legacyIds.push(w.id);
  }
  for (const s of groups.values()) result.set(s.id, s);
  for (const [id, job] of Object.entries(local.outbox)) {
    if (job.type === 'delete') result.delete(id);
    else result.set(id, { ...normalizeSession(job.data), id, source: 'sessions', pending: true, rejected: !!job.error });
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
  persist({ ...fresh, draft: local.draft, outbox: { ...fresh.outbox, [id]: { ...job, token } } });
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
      if (fresh.outbox[id]?.token === job.token) { delete fresh.outbox[id]; persist({ ...fresh, draft: user?.uid === uid ? local.draft : fresh.draft }, uid); }
    }).catch(e => {
      try {
        const fresh = readLocal(uid);
        if (fresh.outbox[id]?.token === job.token) { fresh.outbox[id].error = e.message || 'Write failed'; persist({ ...fresh, draft: user?.uid === uid ? local.draft : fresh.draft }, uid); }
      } catch (storageError) { console.error(storageError); }
      if (user?.uid === uid) fail(e, 'Change retained on this device; use Retry in History. ');
    }).finally(() => { sending.delete(task); if (user?.uid === uid) render(); });
  }
}
$('retry').addEventListener('click', () => {
  try {
    const fresh = readLocal(user.uid);
    Object.values(fresh.outbox).forEach(job => delete job.error);
    persist({ ...fresh, draft: local.draft }); clearError(); flush(); render();
  } catch (e) { fail(e); }
});
window.addEventListener('online', () => { flush(); syncStatus(); });
window.addEventListener('offline', syncStatus);
window.addEventListener('storage', event => {
  if (user && event.key === storageKey(user.uid)) {
    try { local = readLocal(user.uid); renderDraft(); render(); flush(); } catch (e) { fail(e); }
  }
});

// Preferences are private per account and cached by Firestore.
function savePreferences(patch) {
  try {
    const uid = user.uid;
    persist({ ...readLocal(uid), ...patch, draft: local.draft });
    const { selected, favorites, bodyweight } = local;
    setDoc(doc(privateRef(uid, 'settings'), 'competition'), {
      userId: uid, selected, favorites, bodyweight: validBodyweight(bodyweight) ? Number(bodyweight) : null,
      updatedAt: serverTimestamp()
    }).catch(e => { if (user?.uid === uid) fail(e, 'Preferences did not sync: '); });
    render();
  } catch (e) { fail(e); }
}
function blankSet(previous = {}) { return { weight: previous.weight ?? '', reps: previous.reps ?? '', complete: false }; }
function startSession(template = null) {
  if (local.draft && !confirm('Replace the unfinished session?')) return;
  const latest = allSessions().find(s => s.userId === user.uid && validBodyweight(s.bodyweight));
  const exercises = template ? template.exercises.map((e, i) => ({ ...normalizeExercise(e, i), id: uuid(), collapsed: false, sets: normalizeExercise(e, i).sets.map(blankSet) })) : [];
  const groups = [...new Map(exercises.filter(e => e.groupId).map(e => [e.groupId, { id: e.groupId, name: e.groupName || 'Superset', collapsed: false }])).values()];
  const draft = { id: uuid(), startedAt: Date.now(), name: template?.name || '', notes: '', bodyweight: local.bodyweight || latest?.bodyweight || '', groups, exercises, superset: false, activeGroup: '' };
  try { persist({ ...readLocal(user.uid), draft }); restUntil = 0; renderDraft(); showView('train'); }
  catch (e) { fail(e); }
}
$('start').addEventListener('click', () => startSession());
$('discard').addEventListener('click', () => {
  if (!confirm('Discard this unfinished session?')) return;
  try { persist({ ...readLocal(user.uid), draft: null }); restUntil = 0; renderDraft(); }
  catch (e) { fail(e); }
});
function newGroup() {
  const d = local.draft, group = { id: uuid(), name: 'Superset ' + (d.groups.length + 1), collapsed: false };
  d.groups.push(group); d.activeGroup = group.id; d.superset = true; persistDraft(); renderDraft();
}
$('superset-mode').addEventListener('change', e => {
  local.draft.superset = e.target.checked;
  if (e.target.checked && !local.draft.groups.length) return newGroup();
  if (e.target.checked && !local.draft.activeGroup) local.draft.activeGroup = local.draft.groups[0].id;
  persistDraft(); renderDraft();
});
$('new-superset').addEventListener('click', newGroup);
$('superset-target').addEventListener('change', e => { local.draft.activeGroup = e.target.value; persistDraft(); });
function addExercise(name = '') {
  const d = local.draft; if (!d) return;
  if (d.exercises.length >= LIMIT) return fail(new Error('Maximum 30 exercises per session.'));
  const groupId = d.superset ? d.activeGroup : '';
  const group = d.groups.find(g => g.id === groupId); if (group) group.collapsed = false;
  d.exercises.push({ id: uuid(), name, groupId, groupName: group?.name || '', sets: [blankSet()], collapsed: false });
  persistDraft(); renderDraft();
}
$('add-exercise').addEventListener('click', () => addExercise());
function remember(name) {
  name = name.trim(); if (!name || name.length > 100 || !user) return;
  const uid = user.uid;
  setDoc(doc(privateRef(uid, 'exercises'), 'e-' + encodeURIComponent(key(name))), { userId: uid, name, updatedAt: serverTimestamp() }).catch(e => { if (user?.uid === uid) fail(e); });
}
function previous(name) {
  const s = allSessions().find(s => s.userId === user.uid && s.exercises.some(e => key(e.name) === key(name)));
  return !name ? '' : !s ? 'First time — set your baseline.' : 'Last · ' + s.date + ': ' + s.exercises.filter(e => key(e.name) === key(name)).flatMap(e => e.sets.filter(t => t.complete).map(t => `${fmt(t.weight)} kg × ${t.reps}`)).join(' / ');
}
function groupDone(groupId) {
  const exercises = local.draft.exercises.filter(e => e.groupId === groupId);
  return exercises.length >= 2 && exercises.every(complete);
}
function updateCompletion(ex) {
  ex.collapsed = complete(ex);
  const group = local.draft.groups.find(g => g.id === ex.groupId);
  if (group) group.collapsed = groupDone(group.id);
  persistDraft(); renderDraft();
}
function renderExercise(ex) {
  const card = element('details', '', 'exercise' + (complete(ex) ? ' completed' : ''));
  card.open = !ex.collapsed;
  const summary = element('summary', ex.name || 'New exercise');
  summary.append(element('span', fmt(volume(ex)) + ' kg', 'summary-total'));
  card.append(summary);
  card.addEventListener('toggle', () => {
    const d = local.draft; if (!d || !d.exercises.includes(ex)) return;
    if (ex.collapsed !== !card.open) { ex.collapsed = !card.open; persistDraft(); }
  });
  const body = element('div', '', 'exercise-body'), tools = element('div', '', 'exercise-tools');
  const label = element('label', 'Exercise'), name = element('input');
  name.value = ex.name; name.maxLength = 100; name.setAttribute('list', 'exercise-options');
  const ghost = element('p', previous(ex.name), 'ghost');
  name.addEventListener('input', () => { ex.name = name.value; summary.firstChild.textContent = name.value || 'New exercise'; ghost.textContent = previous(name.value); persistDraft(); });
  name.addEventListener('change', () => remember(name.value)); label.append(name);
  const gl = element('label', 'Group'), select = element('select');
  const option = element('option', 'Standalone'); option.value = ''; select.append(option);
  local.draft.groups.forEach(g => { const o = element('option', g.name); o.value = g.id; select.append(o); }); select.value = ex.groupId;
  select.addEventListener('change', () => {
    ex.groupId = select.value; ex.collapsed = false;
    local.draft.groups.forEach(g => g.collapsed = groupDone(g.id)); persistDraft(); renderDraft();
  }); gl.append(select);
  tools.append(label, gl, button('×', () => {
    local.draft.exercises = local.draft.exercises.filter(e => e.id !== ex.id);
    local.draft.groups.forEach(g => g.collapsed = groupDone(g.id)); persistDraft(); renderDraft();
  }, 'danger')); tools.lastChild.setAttribute('aria-label', 'Delete exercise');
  const table = element('table', '', 'set-table'), thead = element('thead'), tr = element('tr');
  ['Set', 'Weight', 'Reps', 'Complete'].forEach(t => tr.append(element('th', t))); thead.append(tr); table.append(thead);
  const tbody = element('tbody');
  ex.sets.forEach((set, index) => {
    const row = element('tr'); row.append(element('td', String(index + 1)));
    ['weight', 'reps'].forEach(field => {
      const td = element('td'), input = element('input');
      Object.assign(input, { type: 'number', min: field === 'weight' ? .01 : 1, max: field === 'weight' ? 2000 : 1000, step: field === 'weight' ? .01 : 1, value: set[field] });
      input.inputMode = field === 'weight' ? 'decimal' : 'numeric'; input.disabled = set.complete;
      input.setAttribute('aria-label', `${ex.name || 'Exercise'} set ${index + 1} ${field}${field === 'weight' ? ' kg' : ''}`);
      input.addEventListener('input', () => { set[field] = input.value === '' ? '' : Number(input.value); persistDraft(); });
      td.append(input); row.append(td);
    });
    const td = element('td'), done = button(set.complete ? '✓ Done' : 'Complete', () => {
      if (!set.complete && (!ex.name.trim() || !validSet(set))) return fail(new Error('Enter an exercise name, positive external weight and whole reps before completing the set.'));
      set.complete = !set.complete; if (set.complete) remember(ex.name); updateCompletion(ex);
    }, set.complete ? 'done' : ''); done.setAttribute('aria-pressed', String(set.complete)); td.append(done); row.append(td); tbody.append(row);
  }); table.append(tbody);
  const actions = element('div', '', 'set-actions');
  actions.append(button('＋ Add set', () => {
    if (ex.sets.length >= SET_LIMIT) return fail(new Error('Maximum 30 sets per exercise.'));
    ex.sets.push(blankSet(ex.sets.at(-1))); updateCompletion(ex);
  }), button('− Remove last set', () => {
    if (ex.sets.at(-1)?.complete && !confirm('Remove this completed set?')) return;
    ex.sets.pop(); updateCompletion(ex);
  }));
  body.append(tools, ghost, table, actions); card.append(body); return card;
}
function renderDraft() {
  const d = local.draft;
  $('idle').hidden = !!d; $('active').hidden = !d; $('exercise-blocks').replaceChildren();
  if (!d) return;
  $('session-name').value = d.name; $('session-notes').value = d.notes; $('bodyweight').value = d.bodyweight;
  $('superset-mode').checked = d.superset; $('superset-target').hidden = !d.superset; $('new-superset').hidden = !d.superset;
  $('superset-target').replaceChildren(...d.groups.map(g => { const o = element('option', g.name); o.value = g.id; return o; })); $('superset-target').value = d.activeGroup;
  const rendered = new Set();
  function renderGroup(group) {
    const members = d.exercises.filter(e => e.groupId === group.id);
    const card = element('details', '', 'superset' + (groupDone(group.id) ? ' completed' : '')); card.open = !group.collapsed;
    const summary = element('summary', group.name); summary.append(element('span', fmt(members.reduce((n, e) => n + volume(e), 0)) + ' kg', 'summary-total')); card.append(summary);
    card.addEventListener('toggle', () => { if (local.draft?.groups.includes(group) && group.collapsed !== !card.open) { group.collapsed = !card.open; persistDraft(); } });
    const body = element('div', '', 'group-body'), label = element('label', 'Superset name', 'group-title'), input = element('input'); input.maxLength = 60; input.value = group.name;
    input.addEventListener('input', () => { group.name = input.value; summary.firstChild.textContent = input.value || 'Superset'; persistDraft(); }); label.append(input); body.append(label);
    if (members.length < 2) body.append(element('p', 'Add at least two exercises to complete this superset.', 'hint'));
    members.forEach(ex => body.append(renderExercise(ex))); card.append(body); $('exercise-blocks').append(card);
  }
  for (const ex of d.exercises) {
    const group = d.groups.find(g => g.id === ex.groupId);
    if (!group) $('exercise-blocks').append(renderExercise(ex));
    else if (!rendered.has(group.id)) { rendered.add(group.id); renderGroup(group); }
  }
  d.groups.filter(g => !rendered.has(g.id)).forEach(renderGroup);
  tick();
}
$('session-name').addEventListener('input', e => { local.draft.name = e.target.value; persistDraft(); });
$('session-notes').addEventListener('input', e => { local.draft.notes = e.target.value; persistDraft(); });
$('bodyweight').addEventListener('input', e => { local.draft.bodyweight = e.target.value; persistDraft(); });
$('bodyweight').addEventListener('change', e => { if (e.target.value === '' || validBodyweight(e.target.value)) savePreferences({ bodyweight: e.target.value === '' ? '' : Number(e.target.value) }); });
function cleanExercises(requireComplete = true) {
  const d = local.draft;
  if (!d.exercises.length) throw new Error('Add an exercise first.');
  for (const g of d.groups) {
    const count = d.exercises.filter(e => e.groupId === g.id).length;
    if (count === 1) throw new Error('A superset needs two exercises. Add another or move its exercise to Standalone.');
  }
  return d.exercises.map(ex => {
    if (!ex.name.trim() || !ex.sets.length || !ex.sets.every(validSet) || (requireComplete && !complete(ex))) throw new Error('Complete every set, or remove unfinished sets/exercises.');
    return { id: ex.id, name: ex.name.trim(), groupId: ex.groupId, groupName: d.groups.find(g => g.id === ex.groupId)?.name.trim() || '', sets: ex.sets.map(s => ({ weight: Number(s.weight), reps: Number(s.reps), complete: requireComplete })) };
  });
}
$('finish').addEventListener('click', () => {
  if (!local.draft) return;
  try {
    const exercises = cleanExercises(), d = local.draft, endedAt = Date.now(), durationSec = Math.floor((endedAt - d.startedAt) / 1000);
    if (durationSec < 0 || durationSec > 604800) throw new Error('Check the session start time/device clock. Sessions must be under seven days.');
    if (d.bodyweight !== '' && !validBodyweight(d.bodyweight)) throw new Error('Bodyweight must be 20–500 kg, or leave it blank.');
    const bodyweight = d.bodyweight === '' ? null : Number(d.bodyweight);
    const data = { schemaVersion: 3, userId: user.uid, userName: nameFor(user.uid).slice(0, 60), name: d.name.trim() || 'Workout', notes: d.notes.trim(), date: dateOf(d.startedAt), startedAt: d.startedAt, endedAt, durationSec, bodyweight, exercises };
    const fresh = readLocal(user.uid);
    persist({ ...fresh, draft: null, bodyweight: bodyweight ?? fresh.bodyweight, outbox: { ...fresh.outbox, [d.id]: { type: 'put', data, token: uuid() } } });
    restUntil = 0; renderDraft(); flush(); showView('profile');
  } catch (e) { fail(e); }
});
$('save-routine').addEventListener('click', () => {
  try {
    const exercises = cleanExercises(false), name = prompt('Routine name:', local.draft.name || ''); if (!name?.trim()) return;
    if (name.trim().length > 60) throw new Error('Use a routine name up to 60 characters.');
    const uid = user.uid;
    setDoc(doc(privateRef(uid, 'routines'), 'r-' + encodeURIComponent(key(name))), { userId: uid, name: name.trim(), exercises, updatedAt: serverTimestamp() }).catch(e => { if (user?.uid === uid) fail(e); });
  } catch (e) { fail(e); }
});
document.querySelectorAll('[data-rest]').forEach(el => el.addEventListener('click', () => { restUntil = Date.now() + Number(el.dataset.rest) * 1000; tick(); }));
$('stop-rest').addEventListener('click', () => { restUntil = 0; $('rest-clock').textContent = 'Ready'; });
function tick() {
  if (local.draft) {
    const seconds = Math.max(0, Math.floor((Date.now() - local.draft.startedAt) / 1000)), v = total(local.draft);
    $('stopwatch').textContent = clock(seconds); $('session-volume').textContent = fmt(v) + ' kg'; $('live-density').textContent = seconds ? fmt(v / (seconds / 60)) + ' kg/min' : '—';
  }
  if (restUntil) { const seconds = Math.max(0, Math.ceil((restUntil - Date.now()) / 1000)); $('rest-clock').textContent = seconds ? seconds + 's' : 'Go!'; if (!seconds) { restUntil = 0; navigator.vibrate?.([120, 60, 120]); } }
}
setInterval(tick, 1000); document.addEventListener('visibilitychange', () => { tick(); if (!document.hidden) render(); });
// A single date filter is shared by the leaderboard, race track and race chart.
function rangeFor(mode, data = []) {
  const now = today();
  if (mode === 'day') return { start: now, end: shift(now, 1) };
  if (mode === 'week') return { start: monday(now), end: shift(monday(now), 7) };
  if (mode === 'month') { const start = now.slice(0, 7) + '-01', d = new Date(start + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); return { start, end: d.toISOString().slice(0, 10) }; }
  if (mode === 'comp') return { start: START, end: END };
  return { start: data.reduce((min, s) => s.date < min ? s.date : min, now), end: shift(now, 1) };
}
const inRange = (s, range) => s.date >= range.start && s.date < range.end;
const periodText = range => `${range.start} to ${shift(range.end, -1)} inclusive · Brisbane dates`;
function labelsFor(range) { const dates = []; for (let d = range.start; d < range.end; d = shift(d, 1)) dates.push(d); return dates; }
function density(data) {
  const timed = data.filter(s => Number.isFinite(s.durationSec) && s.durationSec > 0), seconds = timed.reduce((n, s) => n + s.durationSec, 0);
  return seconds ? timed.reduce((n, s) => n + total(s), 0) / (seconds / 60) : null;
}
function metric(container, label, value, note = '') { const card = element('div', '', 'metric'); card.append(element('small', label), element('strong', value)); if (note) card.append(element('small', note)); container.append(card); }
function completedSets(s, exerciseKey) { return s.exercises.filter(e => !exerciseKey || key(e.name) === exerciseKey).flatMap(e => e.sets.filter(t => t.complete && validSet(t))); }
function bestRatio(data, exerciseKey) {
  const ratios = data.filter(s => validBodyweight(s.bodyweight)).flatMap(s => completedSets(s, exerciseKey).map(t => Number(t.weight) / s.bodyweight));
  return ratios.length ? Math.max(...ratios) : null;
}
function prVelocity(data, exerciseKey, endDate, days) {
  const baseline = bestRatio(data.filter(s => s.date < shift(endDate, -days)), exerciseKey);
  const current = bestRatio(data.filter(s => s.date < endDate), exerciseKey);
  return baseline && current !== null ? (current / baseline - 1) * 100 : null;
}
function chartInto(existing, canvasId, labels, datasets) {
  document.querySelectorAll('.chart-warning').forEach(el => el.hidden = !!window.Chart);
  if (!window.Chart) return existing;
  if (existing) { existing.data = { labels, datasets }; existing.update('none'); return existing; }
  return new window.Chart($(canvasId), { type: 'line', data: { labels, datasets }, options: {
    responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'bottom', labels: { color: '#a8b4c4', boxWidth: 18 } } },
    scales: { x: { ticks: { color: '#a8b4c4', maxTicksLimit: 7 } }, y: { beginAtZero: true, title: { display: true, text: 'Volume (kg)', color: '#a8b4c4' }, ticks: { color: '#a8b4c4' } } }
  } });
}
function renderStats(mine) {
  const names = [...new Map(mine.flatMap(s => s.exercises.map(e => [key(e.name), e.name]))).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  if (!names.some(([k]) => k === selectedExercise)) selectedExercise = names[0]?.[0] || '';
  $('stats-exercises').replaceChildren(...names.map(([k, name]) => { const b = button(name, () => { selectedExercise = k; renderStats(mine); }, 'chip'); b.setAttribute('aria-pressed', String(k === selectedExercise)); return b; }));
  const range = rangeFor($('stats-range').value, mine), selected = mine.filter(s => inRange(s, range) && completedSets(s, selectedExercise).length);
  $('stats-period').textContent = periodText(range); $('stats-name').textContent = names.find(([k]) => k === selectedExercise)?.[1] || 'Log an exercise to see its history';
  const sets = selected.flatMap(s => completedSets(s, selectedExercise)), v = sets.reduce((n, s) => n + setVolume(s), 0), ratio = bestRatio(selected, selectedExercise);
  const anchor = range.end < shift(today(), 1) ? range.end : shift(today(), 1), el = $('exercise-metrics'); el.replaceChildren();
  metric(el, 'Total volume', fmt(v) + ' kg'); metric(el, 'Avg volume / session', selected.length ? fmt(v / selected.length) + ' kg' : 'N/A');
  metric(el, 'Session count', String(selected.length)); metric(el, 'Completed reps', fmt(sets.reduce((n, s) => n + Number(s.reps), 0)));
  metric(el, 'Best Strength Ratio', ratio === null ? 'N/A' : ratio.toFixed(2) + '×', 'External load / historical bodyweight');
  for (const days of [30, 90]) { const rate = range.start > today() || !selectedExercise ? null : prVelocity(mine, selectedExercise, anchor, days); metric(el, 'Relative PR · ' + days + ' days', rate === null ? 'N/A' : '+' + fmt(rate) + '%', 'Best ratio growth; historical baseline required'); }
  if (!$('stats').hidden) {
    const labels = labelsFor(range), values = labels.map(date => date > today() ? null : selected.filter(s => s.date === date).flatMap(s => completedSets(s, selectedExercise)).reduce((n, s) => n + setVolume(s), 0));
    exerciseChart = chartInto(exerciseChart, 'exercise-chart', labels, [{ label: 'Exercise volume', data: values, borderColor: COLORS[0], pointRadius: labels.length > 60 ? 0 : 3, borderWidth: 2 }]);
  }
}
$('stats-range').addEventListener('change', render);
function athletes(data) {
  return [...new Set([user.uid, ...profiles.map(p => p.id), ...data.map(s => s.userId)])].map(id => ({ id, name: nameFor(id) }));
}
function renderRace(data) {
  const people = athletes(data), selectedIds = local.selected || [user.uid], favorites = local.favorites || [];
  $('athletes').replaceChildren(...[...people].sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)) || a.name.localeCompare(b.name)).map(p => {
    const row = element('div', '', 'athlete-row'), label = element('label', '', 'inline'), check = element('input'); check.type = 'checkbox'; check.checked = selectedIds.includes(p.id);
    check.addEventListener('change', () => savePreferences({ selected: check.checked ? [...new Set([...selectedIds, p.id])] : selectedIds.filter(id => id !== p.id) }));
    label.append(check, element('span', p.name + (p.id === user.uid ? ' (you)' : '')));
    const star = button(favorites.includes(p.id) ? '★' : '☆', () => savePreferences({ favorites: favorites.includes(p.id) ? favorites.filter(id => id !== p.id) : [...favorites, p.id] }), 'star' + (favorites.includes(p.id) ? ' favorite' : ''));
    star.setAttribute('aria-label', 'Favorite ' + p.name); star.setAttribute('aria-pressed', String(favorites.includes(p.id))); row.append(label, star); return row;
  }));
  const range = rangeFor($('race-range').value, data), filtered = data.filter(s => inRange(s, range)); $('race-period').textContent = periodText(range);
  const ranked = people.map(p => { const ss = filtered.filter(s => s.userId === p.id); return { ...p, total: ss.reduce((n, s) => n + total(s), 0), count: ss.length, density: density(ss) }; }).sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
  const first = ranked[0], tied = ranked[1] && Math.abs(first.total - ranked[1].total) < .000001;
  $('leaderboard').replaceChildren(...ranked.map((p, i) => {
    const row = element('div', '', 'rank'), name = element('div', '', 'rank-name'); name.append(element('span', `${i + 1}. ${p.name}${p.id === user.uid ? ' (you)' : ''}`));
    if (i === 0 && first.total > 0 && !tied && ranked.length > 1) name.append(element('span', '♛', 'crown'));
    name.append(element('small', `${p.count} sessions · ${p.density === null ? 'Density N/A' : fmt(p.density) + ' kg/min'}`)); row.append(name, element('strong', fmt(p.total) + ' kg')); return row;
  }));
  $('leader-message').textContent = !first.total ? 'No volume in this timeframe yet.' : tied ? 'The leaders are tied.' : `${first.name} leads this timeframe.`;
  $('payout').textContent = $('race-range').value === 'comp' ? `Projected winner’s payout: ${currency(first.total / 1000)}${tied && first.total ? ' · tied; agree a tie-break' : ''}` : 'Payout applies only to the competition filter.';
  const chosen = ranked.filter(p => selectedIds.includes(p.id)), maximum = Math.max(0, ...chosen.map(p => p.total));
  $('race-track').replaceChildren(); if (!chosen.length) $('race-track').append(element('p', 'Select athletes in the drawer above.'));
  const colorFor = id => COLORS[people.findIndex(p => p.id === id) % COLORS.length];
  chosen.forEach(p => {
    const lane = element('div', '', 'lane'), title = element('div', '', 'lane-label'); title.append(element('span', p.name), element('strong', fmt(p.total) + ' kg'));
    const road = element('div', '', 'lane-road'), fill = element('div', '', 'lane-fill'), runner = element('span', '●', 'lane-runner'), percent = maximum ? p.total / maximum * 100 : 0;
    fill.style.width = percent + '%'; fill.style.background = colorFor(p.id) + '65'; runner.style.left = percent + '%'; runner.style.color = colorFor(p.id); road.append(fill, runner);
    lane.append(title, road, element('small', `${p.count} sessions · Avg ${p.count ? fmt(p.total / p.count) : '0'} kg/session · Density ${p.density === null ? 'N/A' : fmt(p.density) + ' kg/min'}`, 'hint')); $('race-track').append(lane);
  });
  if (!$('race').hidden) {
    const labels = labelsFor(range), cumulative = $('chart-mode').value === 'cumulative', datasets = [];
    chosen.forEach(p => {
      for (const ghost of [false, true]) {
        let sum = 0;
        const values = labels.map(date => {
          const sourceDate = ghost ? shift(date, -7) : date;
          const allowed = $('race-range').value !== 'comp' || (sourceDate >= START && sourceDate < END);
          const v = allowed ? data.filter(s => s.userId === p.id && s.date === sourceDate).reduce((n, s) => n + total(s), 0) : 0;
          sum += v; return sourceDate > today() ? null : cumulative ? sum : v;
        });
        datasets.push({ label: p.name + (ghost ? ' · −7d ghost' : ''), data: values, borderColor: colorFor(p.id) + (ghost ? '65' : ''), borderDash: ghost ? [5, 5] : [], borderWidth: ghost ? 1.5 : 2.5, pointRadius: labels.length > 30 || ghost ? 0 : 2 });
      }
    });
    raceChart = chartInto(raceChart, 'race-chart', labels, datasets);
  }
}
$('race-range').addEventListener('change', render); $('chart-mode').addEventListener('change', render);
function bossInfo(data) {
  const week = monday(today()), lifts = ['Deadlift', 'Squat', 'Bench Press'], index = ((Math.floor((Date.parse(week) - Date.parse('2026-10-26')) / (7 * DAY)) % 3) + 3) % 3, lift = lifts[index];
  const scores = data.filter(s => s.date >= week && s.date < shift(week, 7)).map(s => ({ id: s.userId, value: completedSets(s, key(lift)).reduce((n, t) => n + setVolume(t), 0) }));
  const best = Math.max(0, ...scores.map(s => s.value)); return { lift, best, winners: best ? [...new Set(scores.filter(s => Math.abs(s.value - best) < .000001).map(s => s.id))] : [] };
}
function streak(data, now = Date.now()) {
  const timed = data.filter(s => Number.isFinite(s.startedAt) && Number.isFinite(s.endedAt)).sort((a, b) => a.startedAt - b.startedAt); let days = new Set(), lastEnd = null;
  for (const s of timed) { if (lastEnd !== null && s.startedAt - lastEnd >= 2 * DAY) days = new Set(); days.add(s.date); lastEnd = Math.max(lastEnd || 0, s.endedAt); }
  return lastEnd !== null && now - lastEnd < 2 * DAY ? days.size : 0;
}
function renderHistory(mine) {
  const opened = new Set([...$('session-history').querySelectorAll('details[open]')].map(el => el.dataset.id)); $('session-history').replaceChildren();
  if (!mine.length) $('session-history').append(element('p', 'No sessions yet.'));
  mine.forEach(s => {
    const card = element('details', '', 'history-card'); card.dataset.id = s.id; card.open = opened.has(s.id);
    const summary = element('summary', s.name || 'Workout'), den = density([s]); summary.append(element('small', `${s.date} · ${fmt(total(s))} kg · ${s.durationSec == null ? 'Duration unknown' : clock(s.durationSec)} · ${den === null ? 'Density N/A' : fmt(den) + ' kg/min'} · BW ${s.bodyweight ? fmt(s.bodyweight) + ' kg' : 'N/A'}${s.pending ? ' · Pending sync' : ''}`));
    const list = element('ul'); s.exercises.forEach(ex => list.append(element('li', `${ex.groupName ? '[' + ex.groupName + '] ' : ''}${ex.name}: ${ex.sets.filter(t => t.complete).map(t => fmt(t.weight) + ' kg × ' + t.reps).join(' / ')} — ${fmt(volume(ex))} kg`)));
    card.append(summary, list); if (s.notes) card.append(element('p', s.notes));
    card.append(button('Delete session', () => { if (!confirm('Delete this session and every set?')) return; try { if (s.legacyIds?.length > 450) throw new Error('Legacy session too large for one delete batch.'); queue(s.id, { type: 'delete', ...(s.legacyIds ? { legacyIds: s.legacyIds } : {}) }); } catch (e) { fail(e); } }, 'danger')); $('session-history').append(card);
  });
}
function renderProfile(mine, boss) {
  $('profile-name').textContent = nameFor(user.uid); $('badges').replaceChildren(element('span', '🔥 ' + streak(mine) + ' training-day streak', 'badge'));
  if (boss.winners.includes(user.uid)) $('badges').append(element('span', '⚔ Boss Slayer · ' + boss.lift, 'badge'));
  const v = mine.reduce((n, s) => n + total(s), 0), den = density(mine), el = $('profile-metrics'); el.replaceChildren();
  metric(el, 'Lifetime volume', fmt(v) + ' kg'); metric(el, 'RPG weight', fmt(v / 6000) + ' 🐘', 'Elephant equivalents at ~6,000 kg'); metric(el, 'Session density', den === null ? 'N/A' : fmt(den) + ' kg/min', 'Timed sessions only; volume / total minutes');
  const daily = new Map(); mine.forEach(s => daily.set(s.date, (daily.get(s.date) || 0) + total(s))); const max = Math.max(1, ...Array.from({ length: 91 }, (_, i) => daily.get(shift(today(), -i)) || 0)); $('heatmap').replaceChildren();
  for (let i = 90; i >= 0; i--) { const date = shift(today(), -i), v = daily.get(date) || 0, label = `${date}: ${fmt(v)} kg`, square = button('', () => $('heatmap-detail').textContent = label, 'l' + (v ? Math.ceil(v / max * 4) : 0)); square.title = label; square.setAttribute('aria-label', label); $('heatmap').append(square); }
  const p = profiles.find(p => p.id === user.uid), changed = p?.nameChangedAt?.toMillis?.() || 0, next = changed + 7 * DAY;
  $('name-cooldown').textContent = changed && next > Date.now() ? 'Next username change: ' + new Date(next).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' }) : 'Username change available. Requires a connection.';
  $('rename').disabled = !!changed && next > Date.now(); if (document.activeElement !== $('profile-input')) $('profile-input').value = nameFor(user.uid);
  renderHistory(mine);
}
function render() {
  if (!user) return;
  const data = allSessions(), mine = data.filter(s => s.userId === user.uid), boss = bossInfo(data);
  $('welcome').textContent = `Let’s go, ${nameFor(user.uid)}.`;
  const names = [...new Map([...memory.map(e => e.name), ...mine.flatMap(s => s.exercises.map(e => e.name))].filter(n => typeof n === 'string' && n.trim()).map(n => [key(n), n])).values()].sort();
  $('quick-list').replaceChildren(...names.map(n => button(n, () => addExercise(n), 'chip'))); $('exercise-options').replaceChildren(...names.map(n => { const o = element('option'); o.value = n; return o; }));
  $('routines').replaceChildren(...routines.filter(r => Array.isArray(r.exercises)).map(r => button(r.name, () => startSession(r), 'chip')));
  $('boss-name').textContent = boss.lift; $('boss-result').textContent = boss.best ? `${boss.winners.map(nameFor).join(' & ')} · ${fmt(boss.best)} kg in one session` : 'Unclaimed this week. Log the named lift to challenge it.';
  renderStats(mine); renderRace(data); renderProfile(mine, boss); syncStatus();
}
$('profile-form').addEventListener('submit', async event => {
  event.preventDefault(); const uid = user.uid, name = $('profile-input').value.trim();
  if (!name || name.length > 40) return fail(new Error('Use 1–40 characters.')); if (!navigator.onLine) return fail(new Error('Connect to change your username.')); $('rename').disabled = true;
  try { await runTransaction(db, async tx => { const ref = doc(profilesRef, uid), snap = await tx.get(ref), p = snap.exists() ? snap.data() : {}; if (p.displayName === name) return; const changed = p.nameChangedAt?.toMillis?.() || 0; if (changed && Date.now() - changed < 7 * DAY) throw new Error('Wait seven days between username changes.'); tx.set(ref, { userId: uid, displayName: name, nameChangedAt: serverTimestamp(), updatedAt: serverTimestamp() }); }); clearError(); }
  catch (e) { fail(e); } finally { if (user?.uid === uid) render(); }
});
$('export').addEventListener('click', () => {
  const rows = [['Session','Date','Duration seconds','Bodyweight kg','Superset','Exercise','Set','Weight kg','Reps','Volume kg','Strength ratio','Session density kg/min','Sync']];
  allSessions().filter(s => s.userId === user.uid).forEach(s => s.exercises.forEach(ex => ex.sets.forEach((t, i) => { if (t.complete) rows.push([s.name,s.date,s.durationSec ?? '',s.bodyweight ?? '',ex.groupName,ex.name,i+1,t.weight,t.reps,setVolume(t),s.bodyweight ? t.weight/s.bodyweight : '',density([s]) ?? '',s.pending ? 'Pending' : 'Synced']); })));
  const cell = v => '"' + (typeof v === 'string' && /^\s*[=+@-]/.test(v) ? "'" + v : String(v ?? '')).replaceAll('"','""') + '"'; const blob = new Blob(['\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'volume-sets-' + today() + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
