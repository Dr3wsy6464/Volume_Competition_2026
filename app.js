import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendEmailVerification, reload, getIdToken, deleteUser, reauthenticateWithCredential, EmailAuthProvider } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, setDoc, serverTimestamp, runTransaction, writeBatch, getDoc, getDocFromServer, getDocsFromServer, query, where, limit, deleteDoc, clearIndexedDbPersistence, terminate } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAIz_p5UDLaD7gcTdKE-WXEbuoRL4TWSsM',
  authDomain: 'volume-competition.firebaseapp.com',
  projectId: 'volume-competition',
  storageBucket: 'volume-competition.firebasestorage.app',
  messagingSenderId: '681802026275',
  appId: '1:681802026275:web:a4ce78cdaed0f7045c5096'
};
const START = '2026-11-01', END = '2027-01-02'; // END is exclusive.
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
const referenceRef = collection(db, ...ROOT, 'sessionReferences');
const counterRef = collection(db, ...ROOT, 'sessionCounters');
const referenceTasks = new Set();
let referenceBackfill = false;
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
const inCompetition = s => inRange(s, compRange(selectedCompetition()));
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
let restUntil = 0, streamState = new Map();
let exerciseChart, raceChart;
const sending = new Set();
let entityType = '', entityId = '', statsMetric = 'volume';
const timeStates = {
  race: { mode: 'comp', anchor: today(), offset: 0, fixedWeek: true, fixedMonth: true, from: today(), to: today() },
  stats: { mode: 'all', anchor: today(), offset: 0, fixedWeek: true, fixedMonth: true, from: today(), to: today() }
};

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
  return { draft: normalizeDraft(value.draft), outbox: value.outbox || {}, bodyweight: value.bodyweight ?? '', unit: value.unit === 'lb' ? 'lb' : 'kg', selected: value.selected || [uid], favorites: value.favorites || [] };
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
    const credential = await action(auth, $('auth-email').value.trim(), $('auth-password').value);
    if (signup) await sendEmailVerification(credential.user);
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
    const snap = await tx.get(ref), p = snap.exists() ? snap.data() : {};
    if (!snap.exists() || !p.userId || !p.displayName || !p.nameChangedAt) tx.set(ref, {
      userId: u.uid, displayName: p.displayName || displayName.slice(0,40) || 'Athlete',
      nameChangedAt: p.nameChangedAt || serverTimestamp(), bio: p.bio || '', updatedAt: serverTimestamp()
    }, {merge:true});
  });
}
function watch(ref, label, assign, token) {
  unsubs.push(onSnapshot(ref, { includeMetadataChanges: true }, snap => {
    if (epoch !== token) return;
    try { assign(snap.docs.map(d => ({ ...d.data(), id: d.id }))); } catch(e) { fail(e,label+': '); return; }
    streamState.set(label, snap.metadata.fromCache ? 'cached' : 'synced');
    render();
    if (label === 'Sessions' || label === 'Legacy logs') ensureReferences();
  }, e => { if (epoch === token) { streamState.set(label, 'error'); fail(e, label + ': '); syncStatus(); } }));
}
// Legacy records remain in their original collection. No migration or double-counting.
function allSessions() {
  const result = new Map(sessions.map(s => [s.id, { ...s, source: 'sessions' }]));
  const groups = new Map();
  for (const w of legacy) {
    const ex = normalizeExercise({ name: w.exercise, weight: Number(w.weight), reps: Number(w.reps), sets: Number(w.sets) });
    if (!ex.name || !ex.sets.length || !ex.sets.every(validSet) || typeof w.userId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(w.date)) continue;
    const id = 'legacy:' + w.userId + ':' + w.date + ':' + key(w.session);
    if (!groups.has(id)) groups.set(id, { id, userId: w.userId, userName: w.userName, date: w.date, name: w.session || 'Legacy session', exercises: [], notes: '', source: 'legacy', legacyIds: [], durationSec: null, bodyweight: null, referenceCode: w.referenceCode || '' });
    groups.get(id).exercises.push(ex); groups.get(id).legacyIds.push(w.id);
  }
  for (const s of groups.values()) result.set(s.id, s);
  for (const [id, job] of Object.entries(local.outbox)) {
    if (job.replaces) result.delete(job.replaces);
    if (job.type === 'delete') result.delete(id);
    else result.set(id, { ...normalizeSession(job.data), id, source: 'sessions', pending: true, rejected: !!job.error });
  }
  return [...result.values()].sort((a, b) => b.date.localeCompare(a.date) || (b.startedAt || 0) - (a.startedAt || 0));
}
function syncStatus() {
  if (!user || !appReady) return;
  const jobs = Object.values(local.outbox), failed = jobs.filter(j => j.error).length;
  const loading = ['Sessions','Legacy logs','Profiles','Competitions','Entries','Awards','Bosses','Results','Archives'].filter(k=>!streamState.has(k));
  $('retry').hidden = !jobs.length;
  notice(`${loading.length ? 'Loading '+loading.join(', ')+'… · ' : ''}${navigator.onLine ? 'Online' : 'Offline'} · ${jobs.length ? jobs.length + ' change(s) waiting for server confirmation' : 'No pending session changes'}${failed ? ' · ' + failed + ' failed; retry from History' : ''}${[...streamState.values()].includes('error') ? ' · Some data could not be loaded' : [...streamState.values()].includes('cached') ? ' · Showing cached data' : ''}`);
}
function queue(id, job) {
  const fresh = readLocal(user.uid);
  const token = uuid();
  persist({ ...fresh, draft: local.draft, outbox: { ...fresh.outbox, [id]: { ...job, token } } });
  flush(); render();
}
function flush() {
  if (!user || !appReady || deleting || !navigator.onLine) return;
  const uid = user.uid;
  for (const [id, job] of Object.entries(local.outbox)) {
    const task = uid + ':' + id + ':' + job.token;
    if (sending.has(task) || job.error) continue;
    sending.add(task);
    let operation;
    if (job.type === 'put') {
      // A stable document ID makes retries idempotent.
      operation = (async () => {
        const referenceCode = job.data.referenceCode || await reserveReference(uid, id, job.data.date);
        const data = { ...job.data, referenceCode, updatedAt: serverTimestamp() };
        if (job.legacyIds) {
          const batch = writeBatch(db); batch.set(doc(sessionsRef, id), data);
          job.legacyIds.forEach(oldId => batch.delete(doc(legacyRef, oldId)));
          await batch.commit();
        } else await setDoc(doc(sessionsRef, id), data);
      })();
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
        if (fresh.outbox[id]?.token === job.token) { if (!['unavailable','deadline-exceeded','aborted','auth/network-request-failed'].includes(e.code)) fresh.outbox[id].error = e.message || 'Write failed'; persist({ ...fresh, draft: user?.uid === uid ? local.draft : fresh.draft }, uid); }
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
window.addEventListener('online', () => { referenceTasks.clear(); ensureReferences(); reserveDraftReference(); flush(); syncStatus(); });
setInterval(() => { if (user && navigator.onLine) flush(); }, 30000);
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
    const { selected, favorites, bodyweight, unit = 'kg' } = local;
    setDoc(doc(privateRef(uid, 'settings'), 'competition'), {
      userId: uid, selected, favorites, unit, bodyweight: validBodyweight(bodyweight) ? Number(bodyweight) : null,
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
  const draft = { id: uuid(), referenceCode: '', routineId: template?.id || '', editing: false, startedAt: Date.now(), name: template?.name || '', notes: '', bodyweight: local.bodyweight || latest?.bodyweight || '', groups, exercises, superset: groups.length > 0, activeGroup: '' };
  try { persist({ ...readLocal(user.uid), draft }); restUntil = 0; renderDraft(); reserveDraftReference(); showView('train'); }
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
  d.groups.push(group); d.superset = true; persistDraft(); renderDraft();
}
$('superset-mode').addEventListener('change', e => {
  local.draft.superset = e.target.checked;
  if (!e.target.checked) { local.draft.groups = []; local.draft.exercises.forEach(ex => { ex.groupId = ''; ex.groupName = ''; ex.collapsed = false; }); }
  persistDraft(); renderDraft();
});
$('new-superset').addEventListener('click', newGroup);
function addExercise(name = '') {
  const d = local.draft; if (!d) return;
  if (d.exercises.length >= LIMIT) return fail(new Error('Maximum 30 exercises per session.'));
  const groupId = '';
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
  return !name ? '' : !s ? 'First time — set your baseline.' : 'Last · ' + s.date + ': ' + s.exercises.filter(e => key(e.name) === key(name)).flatMap(e => e.sets.filter(t => t.complete).map(t => `${mass(t.weight)} × ${t.reps}`)).join(' / ');
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
  summary.append(element('span', mass(volume(ex)), 'summary-total'));
  card.append(summary);
  card.addEventListener('toggle', () => {
    const d = local.draft; if (!d || !d.exercises.includes(ex)) return;
    if (ex.collapsed !== !card.open) { ex.collapsed = !card.open; persistDraft(); }
  });
  const body = element('div', '', 'exercise-body'), tools = element('div', '', 'exercise-tools');
  const label = element('label', 'Exercise'), name = element('input');
  name.value = ex.name; name.maxLength = 100; name.setAttribute('list', 'exercise-options');
  const ghost = element('p', exerciseMetadata(ex.name), 'exercise-meta');
  name.addEventListener('input', () => { ex.name = name.value; summary.firstChild.textContent = name.value || 'New exercise'; ghost.textContent = exerciseMetadata(name.value); persistDraft(); });
  name.addEventListener('change', () => { remember(name.value); renderDraft(); }); label.append(name);
  const gl = element('label', 'Group'), select = element('select');
  const option = element('option', 'None'); option.value = ''; select.append(option);
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
  ['Set', 'Previous', 'Weight ('+unit()+')', 'Reps', ''].forEach(t => tr.append(element('th', t))); thead.append(tr); table.append(thead);
  const tbody = element('tbody');
  ex.sets.forEach((set, index) => {
    const row = element('tr'); row.append(element('td', String(index + 1)), element('td', previousSet(ex.name,index), 'previous-set'));
    ['weight', 'reps'].forEach(field => {
      const td = element('td'), input = element('input');
      Object.assign(input, { type: 'number', min: field === 'weight' ? .01 : 1, max: field === 'weight' ? displayKg(2000) : 1000, step: field === 'weight' ? 'any' : 1, value: field === 'weight' && set[field] !== '' ? inputMass(set[field]) : set[field] });
      input.inputMode = field === 'weight' ? 'decimal' : 'numeric'; input.disabled = set.complete;
      input.setAttribute('aria-label', `${ex.name || 'Exercise'} set ${index + 1} ${field}${field === 'weight' ? ' '+unit() : ''}`);
      input.addEventListener('input', () => { set[field] = input.value === '' ? '' : field === 'weight' ? fromDisplay(Number(input.value)) : Number(input.value); persistDraft(); });
      td.append(input); row.append(td);
    });
    const td = element('td'), done = button('✓', () => {
      if (!set.complete && (!ex.name.trim() || !validSet(set))) return fail(new Error('Enter an exercise name, positive external weight and whole reps before completing the set.'));
      set.complete = !set.complete; if (set.complete) remember(ex.name); updateCompletion(ex);
    }, set.complete ? 'done' : ''); done.setAttribute('aria-pressed', String(set.complete)); done.setAttribute('aria-label', 'Complete set ' + (index + 1));
    const controls = element('div', '', 'row-buttons');
    const remove = button('×', () => { ex.sets.splice(index, 1); updateCompletion(ex); }, 'delete-set'); remove.setAttribute('aria-label', 'Delete set ' + (index + 1));
    controls.append(done, remove); td.append(controls); row.append(td); tbody.append(row);
  }); table.append(tbody);
  const actions = element('div', '', 'set-actions');
  actions.append(button('＋ Add set', () => {
    if (ex.sets.length >= SET_LIMIT) return fail(new Error('Maximum 30 sets per exercise.'));
    ex.sets.push(blankSet(ex.sets.at(-1))); updateCompletion(ex);
  }));
  body.append(tools, ghost, table, actions); card.append(body); return card;
}
function renderDraft() {
  const d = local.draft;
  $('idle').hidden = !!d; $('active').hidden = !d; $('exercise-blocks').replaceChildren();
  if (!d) return;
  $('session-name').value = d.name; $('session-notes').value = d.notes; $('bodyweight').value = d.bodyweight === '' ? '' : inputMass(d.bodyweight); $('bodyweight-unit').textContent = unit(); $('bodyweight').min = displayKg(20); $('bodyweight').max = displayKg(500);
  $('superset-mode').checked = d.superset; $('new-superset').hidden = !d.superset;
  $('session-reference').textContent = d.referenceCode || '#' + dateOf(d.startedAt).replaceAll('-', '').slice(2) + '-… · pending sync';
  $('edit-times').hidden = !d.editing; $('finish').textContent = d.editing ? 'Save changes ✓' : 'Finish session ✓';
  $('discard').textContent = d.editing ? 'Cancel edit' : 'Discard';
  if (d.editing) { $('edit-start').value = localDateTime(d.startedAt); $('edit-end').value = localDateTime(d.endedAt); }
  $('session-routine').replaceChildren(element('option', 'None'));
  $('session-routine').firstChild.value = '';
  routines.forEach(r => { const o = element('option', r.name); o.value = r.id; $('session-routine').append(o); }); $('session-routine').value = d.routineId || '';
  const rendered = new Set();
  function renderGroup(group) {
    const members = d.exercises.filter(e => e.groupId === group.id);
    const card = element('details', '', 'superset' + (groupDone(group.id) ? ' completed' : '')); card.open = !group.collapsed;
    const summary = element('summary', group.name); summary.append(element('span', mass(members.reduce((n, e) => n + volume(e), 0)), 'summary-total')); card.append(summary);
    card.addEventListener('toggle', () => { if (local.draft?.groups.includes(group) && group.collapsed !== !card.open) { group.collapsed = !card.open; persistDraft(); } });
    const body = element('div', '', 'group-body'), label = element('label', 'Superset name', 'group-title'), input = element('input'); input.maxLength = 60; input.value = group.name;
    input.addEventListener('input', () => { group.name = input.value; summary.firstChild.textContent = input.value || 'Superset'; persistDraft(); }); label.append(input);
    const groupHead = element('div', '', 'group-heading'); groupHead.append(label, button('Delete group', () => {
      d.exercises.filter(e => e.groupId === group.id).forEach(e => { e.groupId = ''; e.groupName = ''; e.collapsed = false; });
      d.groups = d.groups.filter(g => g.id !== group.id); persistDraft(); renderDraft();
    }, 'danger')); body.append(groupHead);
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
$('bodyweight').addEventListener('input', e => { local.draft.bodyweight = e.target.value === '' ? '' : fromDisplay(Number(e.target.value)); persistDraft(); });
$('bodyweight').addEventListener('change', e => { if (local.draft.bodyweight === '' || validBodyweight(local.draft.bodyweight)) savePreferences({ bodyweight: local.draft.bodyweight }); });
function cleanExercises(requireComplete = true) {
  const d = local.draft;
  if (!d.exercises.length) throw new Error('Add an exercise first.');
  for (const g of d.groups) {
    const count = d.exercises.filter(e => e.groupId === g.id).length;
    if (count === 1) throw new Error('A superset needs two exercises. Add another or set its exercise’s group to None.');
  }
  return d.exercises.map(ex => {
    if (!ex.name.trim() || !ex.sets.length || !ex.sets.every(validSet) || (requireComplete && !complete(ex))) throw new Error('Complete every set, or remove unfinished sets/exercises.');
    return { id: ex.id, name: ex.name.trim(), groupId: ex.groupId, groupName: d.groups.find(g => g.id === ex.groupId)?.name.trim() || '', sets: ex.sets.map(s => ({ weight: Number(s.weight), reps: Number(s.reps), complete: requireComplete })) };
  });
}
$('finish').addEventListener('click', () => {
  if (!local.draft) return;
  try {
    const exercises = cleanExercises(), d = local.draft, endedAt = d.editing ? d.endedAt : Date.now(), durationSec = Math.floor((endedAt - d.startedAt) / 1000);
    if (!Number.isFinite(durationSec) || durationSec < 0 || durationSec > 604800 || endedAt > Date.now()) throw new Error('Check the session start time/device clock. Sessions must be under seven days.');
    if (d.bodyweight !== '' && !validBodyweight(d.bodyweight)) throw new Error('Bodyweight must be 20–500 kg, or leave it blank.');
    if (d.legacyIds && durationSec <= 0) throw new Error('Enter the legacy session’s start and end time before saving.');
    const bodyweight = d.bodyweight === '' ? null : Number(d.bodyweight);
    const data = { schemaVersion: 4, referenceCode: d.referenceCode || '', routineId: d.routineId || '', userId: user.uid, userName: nameFor(user.uid).slice(0, 60), name: d.name.trim() || 'Workout', notes: d.notes.trim(), date: dateOf(d.startedAt), startedAt: d.startedAt, endedAt, durationSec, bodyweight, exercises };
    const fresh = readLocal(user.uid);
    persist({ ...fresh, draft: null, bodyweight: bodyweight ?? fresh.bodyweight, outbox: { ...fresh.outbox, [d.id]: { type: 'put', data, token: uuid(), ...(d.legacyIds ? { legacyIds: d.legacyIds, replaces: d.replaces } : {}) } } });
    restUntil = 0; renderDraft(); flush(); $('history-drawer').open = true; showView('profile');
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
    const seconds = Math.max(0, Math.floor(((local.draft.editing ? local.draft.endedAt : Date.now()) - local.draft.startedAt) / 1000)), v = total(local.draft);
    $('stopwatch').textContent = clock(seconds); $('session-volume').textContent = mass(v); $('live-density').textContent = seconds ? mass(v / (seconds / 60)) + '/min' : '—';
  }
  if (restUntil) { const seconds = Math.max(0, Math.ceil((restUntil - Date.now()) / 1000)); $('rest-clock').textContent = seconds ? seconds + 's' : 'Go!'; if (!seconds) { restUntil = 0; navigator.vibrate?.([120, 60, 120]); } }
}
setInterval(tick, 1000); document.addEventListener('visibilitychange', () => { tick(); if (!document.hidden) render(); });
async function reserveReference(uid, sessionId, date) {
  const claim = doc(referenceRef, encodeURIComponent(sessionId + '_' + date));
  return runTransaction(db, async tx => {
    const existing = await tx.get(claim);
    if (existing.exists()) {
      if (existing.data().userId !== uid) throw new Error('Reference belongs to another athlete.');
      return existing.data().referenceCode;
    }
    const counter = doc(counterRef, date), snap = await tx.get(counter), number = (snap.exists() ? snap.data().value : 0) + 1;
    const referenceCode = '#' + date.replaceAll('-', '').slice(2) + '-' + number;
    tx.set(counter, { value: number, updatedAt: serverTimestamp() });
    tx.set(claim, { userId: uid, date, number, referenceCode, createdAt: serverTimestamp() });
    return referenceCode;
  });
}
function reserveDraftReference() {
  const d = local.draft, uid = user?.uid;
  if (!d || !uid || !appReady || deleting || d.referenceCode || !navigator.onLine) return;
  const date = dateOf(d.startedAt);
  reserveReference(uid, d.id, date).then(code => {
    if (user?.uid === uid && local.draft?.id === d.id && dateOf(local.draft.startedAt) === date) {
      local.draft.referenceCode = code; persistDraft(); $('session-reference').textContent = code;
    }
  }).catch(e => { if (e.code === 'permission-denied') fail(e, 'Session reference: '); });
}
async function ensureReferences() {
  if (!user || !appReady || deleting || !navigator.onLine || referenceBackfill) return;
  referenceBackfill = true;
  const uid = user.uid;
  const missing = allSessions().filter(s => s.userId === uid && !s.referenceCode && !s.pending).sort((a,b) => a.date.localeCompare(b.date) || (a.startedAt || 0) - (b.startedAt || 0));
  try {
    for (const s of missing) {
      if (user?.uid !== uid) break;
      const task = uid + ':' + s.id; if (referenceTasks.has(task)) continue; referenceTasks.add(task);
      try {
        const code = await reserveReference(uid, s.id, s.date), fields = { referenceCode: code, updatedAt: serverTimestamp() };
        if (s.legacyIds) { const batch = writeBatch(db); s.legacyIds.forEach(id => batch.set(doc(legacyRef, id), fields, { merge: true })); await batch.commit(); }
        else await setDoc(doc(sessionsRef, s.id), fields, { merge: true });
      } catch (e) { if (user?.uid === uid) fail(e, 'Reference backfill: '); }
    }
  } finally { referenceBackfill = false; }
}
function exerciseMetadata(name) {
  const ss = allSessions().filter(s => s.userId === user?.uid && s.id !== local.draft?.id && s.exercises.some(e => key(e.name) === key(name)));
  const sets = ss.flatMap(s => completedSets(s, key(name))), pr = sets.length ? Math.max(...sets.map(setVolume)) : null;
  const previousTotal = ss.length ? completedSets(ss[0], key(name)).reduce((n, set) => n + setVolume(set), 0) : null;
  return `Set Volume PR: ${pr === null ? '—' : mass(pr)} · Previous Total Volume: ${previousTotal === null ? '—' : mass(previousTotal)}`;
}
function localDateTime(ms) { return new Date(ms + 10 * 3600000).toISOString().slice(0, 19); }
$('session-routine').addEventListener('change', e => { local.draft.routineId = e.target.value; persistDraft(); });
for (const [id, field] of [['edit-start', 'startedAt'], ['edit-end', 'endedAt']]) $(id).addEventListener('change', e => {
  const value = Date.parse(e.target.value + '+10:00'); if (!Number.isFinite(value)) return fail(new Error('Enter a valid Brisbane date/time.'));
  const d = local.draft, oldDate = dateOf(d.startedAt); d[field] = value;
  if (dateOf(d.startedAt) !== oldDate) { d.referenceCode = ''; reserveDraftReference(); }
  persistDraft(); tick();
});
function addMonths(date, n) {
  const d = new Date(date + 'T00:00:00Z'), day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return d.toISOString().slice(0, 10);
}
function period(which, data = []) {
  const t = timeStates[which], anchor = t.anchor;
  if (t.mode === 'day') { const start = shift(anchor, t.offset); return { start, end: shift(start, 1) }; }
  if (t.mode === 'week') { const start = shift(t.fixedWeek ? monday(anchor) : anchor, t.offset * 7); return { start, end: shift(start, 7) }; }
  if (t.mode === 'month') { const base = t.fixedMonth ? anchor.slice(0, 7) + '-01' : anchor; return { start: addMonths(base, t.offset), end: addMonths(base, t.offset + 1) }; }
  if (t.mode === 'custom') return { start: t.from, end: shift(t.to, 1) };
  if (t.mode === 'comp') return compRange(selectedCompetition());
  return { start: data.reduce((min, s) => s.date < min ? s.date : min, today()), end: shift(today(), 1) };
}
const inRange = (s, range) => s.date >= range.start && s.date < range.end;
function dayLabel(date, weekday = false) { return new Date(date + 'T00:00:00Z').toLocaleDateString('en-AU', { timeZone: 'UTC', ...(weekday ? { weekday: 'short' } : {}), day: '2-digit', month: 'short' }); }
function renderTimeframe(which) {
  const t = timeStates[which], r = period(which, allSessions()), host = $(which + '-timeframe'); host.replaceChildren(); host.className = 'timeframe';
  const top = element('div', '', 'timeframe-top'), select = element('select'); select.setAttribute('aria-label', which + ' timeframe');
  [['day','Day'],['week','Week'],['month','Month'],['all','All Time'],['custom','Custom range'],['comp','Selected competition']].forEach(([v,n]) => { const o=element('option',n); o.value=v; select.append(o); }); select.value=t.mode;
  select.addEventListener('change',()=>{t.mode=select.value;t.offset=0;renderTimeframe(which);render();});
  const nav=element('div','','period-nav');
  function move(dir){ if(t.mode==='custom'){const span=Math.round((Date.parse(r.end)-Date.parse(r.start))/DAY);t.from=shift(t.from,dir*span);t.to=shift(t.to,dir*span);}else t.offset+=dir;renderTimeframe(which);render(); }
  const prev=button('‹',()=>move(-1)), next=button('›',()=>move(1));prev.setAttribute('aria-label','Previous period');next.setAttribute('aria-label','Next period');prev.disabled=next.disabled=['all','comp'].includes(t.mode);
  const label=t.mode==='day'?dayLabel(r.start,true):t.mode==='month'&&t.fixedMonth?new Date(r.start+'T00:00:00Z').toLocaleDateString('en-AU',{month:'long',year:'numeric',timeZone:'UTC'}):t.mode==='all'?'All Time':dayLabel(r.start)+' – '+dayLabel(shift(r.end,-1))+' '+r.start.slice(0,4);
  nav.append(prev,element('strong',label),next);top.append(select,nav);host.append(top);
  const options=element('div','','timeframe-options');
  if(['week','month'].includes(t.mode)){
    const fixed=element('label','','inline'),check=element('input');check.type='checkbox';const field=t.mode==='week'?'fixedWeek':'fixedMonth';check.checked=t[field];
    check.addEventListener('change',()=>{t[field]=check.checked;t.offset=0;renderTimeframe(which);render();});fixed.append(check,element('span',t.mode==='week'?'Fixed weeks (Mon–Sun)':'Fixed calendar months'));options.append(fixed);
  }
  if(['day','week','month'].includes(t.mode)){
    const label=element('label','Period anchor'),input=element('input');input.type='date';input.value=t.anchor;input.className='anchor-input';input.addEventListener('change',()=>{if(!input.value)return;t.anchor=input.value;t.offset=0;renderTimeframe(which);render();});label.append(input);options.append(label);
  }
  if(t.mode==='custom'){
    const fields=element('div','','date-fields');for(const [field,text]of[['from','From'],['to','Through']]){const label=element('label',text),input=element('input');input.type='date';input.value=t[field];input.addEventListener('change',()=>{if(!input.value)return;const prior=t[field];t[field]=input.value;if(t.from>t.to){t[field]=prior;input.value=prior;return fail(new Error('Range start must not be after its end.'));}renderTimeframe(which);render();});label.append(input);fields.append(label);}options.append(fields);
  }
  if(options.children.length)host.append(options);
}
function labelsFor(r){const dates=[];for(let d=r.start;d<r.end;d=shift(d,1))dates.push(d);return dates;}
function completedSets(s,exerciseKey){return s.exercises.filter(e=>!exerciseKey||key(e.name)===exerciseKey).flatMap(e=>e.sets.filter(t=>t.complete&&validSet(t)));}
function density(data){const timed=data.filter(s=>Number.isFinite(s.durationSec)&&s.durationSec>0),seconds=timed.reduce((n,s)=>n+s.durationSec,0);return seconds?timed.reduce((n,s)=>n+total(s),0)/(seconds/60):null;}
function metricValue(data,metric){
  const sets=data.flatMap(s=>completedSets(s)),v=sets.reduce((n,s)=>n+setVolume(s),0);
  if(metric==='volume')return v;if(metric==='reps')return sets.reduce((n,s)=>n+Number(s.reps),0);
  if(metric==='average')return data.length?v/data.length:0;if(metric==='density')return density(data);
  if(metric==='duration'){const timed=data.filter(s=>Number.isFinite(s.durationSec));return timed.length?timed.reduce((n,s)=>n+s.durationSec,0)/60:null;}
  if(metric==='bodyweight'){const known=data.filter(s=>validBodyweight(s.bodyweight)).sort((a,b)=>(b.startedAt||Date.parse(b.date))-(a.startedAt||Date.parse(a.date)));return known[0]?.bodyweight??null;}
  if(metric==='pr')return sets.length?Math.max(...sets.map(setVolume)):null;
  if(metric==='ratio'){const ratios=data.filter(s=>validBodyweight(s.bodyweight)).flatMap(s=>completedSets(s).map(t=>setVolume(t)/s.bodyweight));return ratios.length?Math.max(...ratios):null;}
  return null;
}
const metricNames={volume:'Total Volume',reps:'Completed Reps',bodyweight:'Body Weight',ratio:'Strength Ratio',pr:'Set Volume PR',density:'Session Density',average:'Average Volume per Session',duration:'Session Duration'};
const units = new Proxy({}, {get: (_,m) => ['volume','pr','bodyweight'].includes(m)?unit():m==='density'?unit()+'/min':m==='average'?unit()+'/session':m==='reps'?'reps':m==='ratio'?'×':'min'});
function metricDisplay(v,m){return v === null ? null : ['volume','pr','bodyweight','density','average'].includes(m)?displayKg(v):v;}
function valueText(v,metric){return v===null?'N/A':fmt(metricDisplay(v,metric))+' '+units[metric];}
function metric(container,label,value,note=''){const card=element('div','','metric');card.append(element('small',label),element('strong',value));if(note)card.append(element('small',note));container.append(card);}
function chartInto(existing,id,labels,datasets,metric){
  document.querySelectorAll('.chart-warning').forEach(el=>el.hidden=!!window.Chart);if(!window.Chart)return existing;
  datasets=datasets.map(d=>({...d,data:d.data.map(v=>metricDisplay(v,metric)),previous:d.previous?.map(v=>metricDisplay(v,metric))}));
  const options={responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'bottom',labels:{color:'#a8b4c4',usePointStyle:true,pointStyle:'circle',boxWidth:8,boxHeight:8,filter:item=>!datasets[item.datasetIndex].ghost},onClick:(event,item,legend)=>{const c=legend.chart,uid=c.data.datasets[item.datasetIndex].athleteId,show=!c.isDatasetVisible(item.datasetIndex);c.data.datasets.forEach((d,i)=>{if(d.athleteId===uid)c.setDatasetVisibility(i,show);});c.update();}},tooltip:{filter:ctx=>!ctx.dataset.ghost,callbacks:{label:ctx=>{const value=ctx.raw;if(value===null)return ctx.dataset.label+': N/A';const previous=ctx.dataset.previous?.[ctx.dataIndex];const diff=previous==null?'N/A vs last week':(value-previous>=0?'+':'')+fmt(value-previous)+' '+units[metric]+' vs last week';return ctx.dataset.label+': '+fmt(value)+' '+units[metric]+(ctx.dataset.previous?' ('+diff+')':'');}}}},scales:{x:{ticks:{color:'#a8b4c4',maxTicksLimit:7}},y:{beginAtZero:true,title:{display:true,text:metricNames[metric]+' ('+units[metric]+')',color:'#a8b4c4'},ticks:{color:'#a8b4c4'}}}};
  if(existing){existing.data={labels,datasets};existing.options=options;existing.update('none');return existing;}
  return new window.Chart($(id),{type:'line',data:{labels,datasets},options});
}
function statsData(mine){
  if(entityType==='exercises'&&entityId)return mine.map(s=>({...s,exercises:s.exercises.filter(e=>key(e.name)===entityId)})).filter(s=>s.exercises.length);
  if(entityType==='sessions'&&entityId)return mine.filter(s=>s.id===entityId);
  if(entityType==='routines'&&entityId)return mine.filter(s=>s.routineId===entityId);
  return mine;
}
document.querySelectorAll('[data-entity]').forEach(el=>el.addEventListener('click',()=>{entityType=entityType===el.dataset.entity?'':el.dataset.entity;entityId='';$('entity-search').value='';render();}));
$('entity-search').addEventListener('input',render);
function renderStats(mine){
  document.querySelectorAll('[data-entity]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.entity===entityType)));
  $('entity-search').hidden=!entityType;$('entity-list').hidden=!entityType;
  let entities=[];
  if(entityType==='exercises')entities=[...new Map(mine.flatMap(s=>s.exercises.map(e=>[key(e.name),e.name]))).entries()].map(([id,name])=>({id,name,detail:''}));
  if(entityType==='sessions')entities=mine.map(s=>({id:s.id,name:(s.referenceCode||'Reference pending')+' · '+s.name,detail:s.date+' · '+mass(total(s))}));
  if(entityType==='routines')entities=routines.map(r=>({id:r.id,name:r.name,detail:mine.filter(s=>s.routineId===r.id).length+' linked sessions'}));
  if(entityId&&!entities.some(e=>e.id===entityId))entityId='';
  const search=key($('entity-search').value);$('entity-list').replaceChildren(...entities.filter(e=>key(e.name+' '+e.detail).includes(search)).map(e=>{const b=button(e.name,()=>{entityId=entityId===e.id?'':e.id;render();});if(e.detail)b.append(element('small',e.detail));b.setAttribute('aria-pressed',String(e.id===entityId));return b;}));
  if(entityType&&!$('entity-list').children.length)$('entity-list').append(element('p','No matching '+entityType+'.'));
  const title=entities.find(e=>e.id===entityId)?.name||'Overall training';$('stats-name').textContent=title;
  const scoped=statsData(mine),range=period('stats',mine),filtered=scoped.filter(s=>inRange(s,range));$('metric-chips').replaceChildren();
  for(const m of ['volume','reps','bodyweight','ratio','pr']){const chip=button('',()=>{statsMetric=m;render();},'metric');chip.append(element('small',metricNames[m]),element('strong',valueText(metricValue(filtered,m),m)));chip.setAttribute('aria-pressed',String(statsMetric===m));$('metric-chips').append(chip);}
  if(!$('stats').hidden){const labels=labelsFor(range),values=labels.map(date=>date>today()?null:metricValue(scoped.filter(s=>s.date===date),statsMetric));exerciseChart=chartInto(exerciseChart,'exercise-chart',labels,[{label:title,athleteId:'personal',data:values,borderColor:'#bdf56b',pointRadius:labels.length>90?1:3,borderWidth:2}],statsMetric);}
}
function athletes(data){return[...new Set([user.uid,...profiles.map(p=>p.id),...data.map(s=>s.userId)])].map(id=>({id,name:nameFor(id)}));}
function athleteColor(id,people,fade=false){const index=[...people].sort((a,b)=>a.id.localeCompare(b.id)).findIndex(p=>p.id===id);return `hsla(${(index*137.508+85)%360},85%,68%,${fade ? 0.3 : 1})`;}
function ask(message){return new Promise(resolve=>{const dialog=$('confirm-dialog');$('confirm-text').textContent=message;dialog.returnValue='cancel';dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true});dialog.showModal();});}
async function editSession(s){
  if(local.draft&&!await ask('Replace your unfinished session with this session editor?'))return;
  if(s.pending)return fail(new Error('Wait for this session to sync before editing it.'));
  const id=s.source==='legacy'?uuid():s.id,exercises=s.exercises.map(e=>({...e,id:uuid(),collapsed:false,sets:e.sets.map(t=>({...t}))}));
  const groups=[...new Map(exercises.filter(e=>e.groupId).map(e=>[e.groupId,{id:e.groupId,name:e.groupName||'Superset',collapsed:false}])).values()];
  const startedAt=s.startedAt||Date.parse(s.date+'T12:00:00+10:00'),endedAt=s.endedAt||startedAt;
  const draft={id,editing:true,referenceCode:s.referenceCode||'',routineId:s.routineId||'',startedAt,endedAt,name:s.name||'Workout',notes:s.notes||'',bodyweight:s.bodyweight??'',groups,exercises,superset:groups.length>0,...(s.legacyIds?{legacyIds:s.legacyIds,replaces:s.id}:{})};
  try{persist({...readLocal(user.uid),draft});renderDraft();showView('train');if(s.durationSec===null)notice('Legacy session: set the actual start/end time before saving.');}catch(e){fail(e);}
}
function renderHistory(mine){
  const opened=new Set([...$('session-history').querySelectorAll('details[open]')].map(el=>el.dataset.id));$('session-history').replaceChildren();
  if(!mine.length)$('session-history').append(element('p','No sessions yet.'));
  mine.forEach(s=>{const card=element('details','','history-card');card.dataset.id=s.id;card.open=opened.has(s.id);const summary=element('summary',(s.referenceCode||'Reference pending sync')+' · '+(s.name||'Workout')),den=density([s]);summary.append(element('small',`${s.date} · ${s.durationSec==null?'Duration unknown':clock(s.durationSec)} · ${mass(total(s))} · ${den===null?'Density N/A':mass(den)+'/min'}${s.pending?' · Pending sync':''}`));const list=element('ul');s.exercises.forEach(ex=>list.append(element('li',`${ex.groupName?'['+ex.groupName+'] ':''}${ex.name}: ${ex.sets.filter(t=>t.complete).map(t=>mass(t.weight)+' × '+t.reps).join(' / ')} — ${mass(volume(ex))}`)));const buttons=element('div','','history-buttons');buttons.append(button('Edit session',()=>editSession(s)),button('Delete session',async()=>{if(!await ask('Delete '+(s.referenceCode||s.name)+' and every exercise/set?'))return;try{if(s.legacyIds?.length>450)throw new Error('Legacy session too large for one batch.');queue(s.id,{type:'delete',...(s.legacyIds?{legacyIds:s.legacyIds}:{})});}catch(e){fail(e);}},'danger'));card.append(summary,list);if(s.notes)card.append(element('p',s.notes));card.append(buttons);$('session-history').append(card);});
}
function render() {
  if (!user || !appReady || deleting) return;
  const data = allSessions(), mine = data.filter(s => s.userId === user.uid);
  $('welcome').textContent = `Let’s go, ${nameFor(user.uid)}.`;
  const names = [...new Map([...memory.map(e => e.name), ...mine.flatMap(s => s.exercises.map(e => e.name))].filter(n => typeof n === 'string' && n.trim()).map(n => [key(n), n])).values()].sort();
  $('quick-list').replaceChildren(...names.map(n => button(n, () => addExercise(n), 'chip'))); $('exercise-options').replaceChildren(...names.map(n => { const o = element('option'); o.value = n; return o; }));
  $('routines').replaceChildren(...routines.filter(r => Array.isArray(r.exercises)).map(r => button(r.name, () => startSession(r), 'chip')));
  renderStats(mine); renderRace(data); renderProfile(mine); renderCompetitions(); renderAwards(data); renderGoals(); renderAdmin(); renderHistoryRecords(data); syncStatus(); scheduleFinalisation();
}
$('profile-form').addEventListener('submit', async event => {
  event.preventDefault(); const uid = user.uid, name = $('profile-input').value.trim();
  if (!name || name.length > 40) return fail(new Error('Use 1–40 characters.')); if (!navigator.onLine) return fail(new Error('Connect to change your username.')); $('rename').disabled = true;
  try { await runTransaction(db, async tx => { const ref = doc(profilesRef, uid), snap = await tx.get(ref), p = snap.exists() ? snap.data() : {}; if (p.displayName === name) return; const changed = p.nameChangedAt?.toMillis?.() || 0; if (changed && Date.now() - changed < 7 * DAY) throw new Error('Wait seven days between username changes.'); tx.set(ref, { userId: uid, displayName: name, nameChangedAt: serverTimestamp(), updatedAt: serverTimestamp() }, {merge:true}); }); clearError(); }
  catch (e) { fail(e); } finally { if (user?.uid === uid) render(); }
});
$('export').addEventListener('click', () => {
  const rows = [['Reference','Session','Date','Duration seconds','Bodyweight '+unit(),'Superset','Exercise','Set','Weight '+unit(),'Reps','Volume '+unit(),'Strength ratio','Session density '+unit()+'/min','Sync']];
  allSessions().filter(s => s.userId === user.uid).forEach(s => s.exercises.forEach(ex => ex.sets.forEach((t, i) => { if (t.complete) rows.push([s.referenceCode || '',s.name,s.date,s.durationSec ?? '',s.bodyweight == null ? '' : displayKg(s.bodyweight),ex.groupName,ex.name,i+1,displayKg(t.weight),t.reps,displayKg(setVolume(t)),s.bodyweight ? setVolume(t)/s.bodyweight : '',density([s]) == null ? '' : displayKg(density([s])),s.pending ? 'Pending' : 'Synced']); })));
  const cell = v => '"' + (typeof v === 'string' && /^\s*[=+@-]/.test(v) ? "'" + v : String(v ?? '')).replaceAll('"','""') + '"'; const blob = new Blob(['\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'volume-sets-' + today() + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// All editable thresholds are kilograms. Display preferences never affect calculations.
const ADMIN_EMAIL = 'werd6464@gmail.com';
const EARLY_BIRD_HOUR = 8; // Brisbane time, exclusive.
const DEFAULT_REQUIRE_APPROVAL = true;
const KG_TO_LB = 2.2046226218487757;
const EOY_ID = 'eoy-2026';
const LEVELS = [[0,'Rookie'],[15000,'Beginner'],[50000,'Regular'],[100000,'Grinder'],[200000,'Iron Apprentice'],[350000,'Lifter'],[550000,'Dedicated'],[800000,'Veteran'],[1100000,'Warrior'],[1500000,'Elite'],[2000000,'Champion'],[2750000,'Titan'],[3750000,'Colossus'],[5000000,'Legend'],[7500000,'Mythic']];
const MILESTONES = [
  {id:'first',name:'First lift',type:'sessions',target:1},
  {id:'sessions25',name:'Showing up',type:'sessions',target:25},
  {id:'sessions100',name:'Century club',type:'sessions',target:100},
  {id:'volume100k',name:'100 tonnes',type:'volume',target:100000},
  {id:'volume1m',name:'Million kilograms',type:'volume',target:1000000},
  {id:'streak7',name:'One week strong',type:'streak',target:7},
  {id:'streak30',name:'Unbroken month',type:'streak',target:30},
  {id:'session10k',name:'Ten-tonne session',type:'session',target:10000}
];
const refFor = type => collection(db, ...ROOT, type);
const competitionsRef=refFor('competitions'), entriesRef=refFor('entries'), awardsRef=refFor('awards'), bossesRef=refFor('bosses'), resultsRef=refFor('results'), archivesRef=refFor('archives');
const accessRef=collection(db,'access'), configRef=doc(db,'config','app');
let competitions=[],entries=[],awards=[],bosses=[],results=[],archives=[],goals=[],accounts=[];
let config={requireApproval:DEFAULT_REQUIRE_APPROVAL},access=null,appReady=false,deleting=false,authStops=[],activeComp='',selectedWeek=monday(today());
let finalising=false,finalTimer=0,finalAttempt='',adminEdit='',openAthlete='';
const unit=()=>local.unit==='lb'?'lb':'kg';
const displayKg=kg=>Number(kg)*(unit()==='lb'?KG_TO_LB:1);
const fromDisplay=n=>Number(n)/(unit()==='lb'?KG_TO_LB:1);
const mass=kg=>fmt(displayKg(kg))+' '+unit();
const inputMass=kg=>Number(displayKg(kg).toFixed(6));
const isAdmin=()=>!!user?.emailVerified&&user.email?.toLowerCase()===ADMIN_EMAIL;
const sumVolume=data=>data.reduce((n,s)=>n+total(s),0);
const selectedCompetition=()=>competitions.find(c=>c.id===activeComp);
const compRange=c=>c?{start:c.start,end:shift(c.end,1)}:{start:today(),end:today()};
const member=(uid,cid)=>entries.find(e=>e.userId===uid&&e.competitionId===cid);
const participants=c=>c?entries.filter(e=>e.competitionId===c.id&&e.eligible&&e.optedIn).map(e=>e.userId):[];
const ownComps=()=>competitions.filter(c=>participants(c).includes(user.uid));
const streamOK=()=>['Sessions','Legacy logs','Profiles','Competitions','Entries','Awards','Bosses','Results','Archives'].every(k=>streamState.get(k)==='synced');
const action=fn=>async()=>{try{clearError();await fn();}catch(e){fail(e);}};
function previousSet(name,index){
  const s=allSessions().find(s=>s.userId===user.uid&&s.id!==local.draft?.id&&s.exercises.some(e=>key(e.name)===key(name)));
  const set=s?.exercises.filter(e=>key(e.name)===key(name)).flatMap(e=>e.sets.filter(t=>t.complete))[index];
  return set?fmt(displayKg(set.weight))+'×'+set.reps:'—';
}
function levelOf(kg){let i=LEVELS.findLastIndex(([min])=>kg>=min);return Math.max(0,i);}
function progressCard(title,value,target,format=fmt){
  const box=element('div','','progress-card'),bar=element('progress');bar.max=target||1;bar.value=Math.min(target||1,Math.max(0,value));
  box.append(element('strong',title),element('small',format(value)+' / '+format(target)),bar);return box;
}
function levelCard(kg){
  const i=levelOf(kg),[min,name]=LEVELS[i],next=LEVELS[i+1]?.[0],box=progressCard('Level '+(i+1)+' · '+name+' = '+fmt(displayKg(min))+(next?'–'+fmt(displayKg(next)):'+')+' '+unit().toUpperCase(),next?kg-min:1,next?next-min:1,mass);
  box.lastChild.previousSibling.textContent=mass(kg)+(next?' lifetime · '+mass(next-kg)+' to '+LEVELS[i+1][1]:' lifetime · Maximum level');return box;
}
// Calendar-day streaks: one automatic rest-day bridge per Monday–Sunday week.
// A bridge preserves the streak but does not add a training day to its count.
function streakInfo(data,asOf=today()){
  const days=new Set(data.filter(s=>s.date<=asOf&&total(s)>0).map(s=>s.date));
  const first=[...days].sort()[0];if(!first)return{current:0,best:0,used:false};
  let count=0,best=0,week='',used=false;
  for(let d=first;d<=asOf;d=shift(d,1)){
    const w=monday(d);if(w!==week){week=w;used=false;}
    if(days.has(d)){count++;best=Math.max(best,count);}
    else if(d<asOf&&count){if(!used)used=true;else count=0;}
  }
  return{current:count,best,used};
}
function rankings(c,data=allSessions()){
  const ids=participants(c),range=compRange(c);
  const rows=ids.map(id=>{const ss=data.filter(s=>s.userId===id&&inRange(s,range));return{id,name:nameFor(id),total:sumVolume(ss),ss};}).sort((a,b)=>b.total-a.total||a.id.localeCompare(b.id));
  return rows.map(p=>({...p,rank:1+rows.filter(r=>r.total>p.total+1e-8).length}));
}
function balance(c,uid,data=allSessions()){
  const saved=results.filter(r=>r.periodId==='comp-'+c.id),ranked=rankings(c,data);
  if(saved.some(r=>r.userId===uid))return saved.find(r=>r.userId===uid).balanceKgCash||0;
  if(!c.cash||!ranked.some(r=>r.id===uid)||ranked.length<2)return 0;
  const max=ranked[0].total,winners=ranked.filter(r=>Math.abs(r.total-max)<1e-8),losers=ranked.length-winners.length;
  if(!losers||!max)return 0;
  return winners.some(r=>r.id===uid)?max/1000/winners.length:-max/1000/losers;
}
function stopStreams(){unsubs.forEach(fn=>fn());unsubs=[];streamState.clear();appReady=false;$('app-view').hidden=true;}
function gate(title,message){$('app-view').hidden=true;$('gate').hidden=false;$('gate-title').textContent=title;$('gate-message').textContent=message;$('verify-send').hidden=!!user?.emailVerified;$('gate-delete').hidden=!user;}
function evaluateAccess(token){
  if(token!==epoch||!user)return;
  if(access?.status==='deleting'||localStorage.getItem('volunation-delete:'+user.uid)){
    stopStreams();gate('Finish account deletion','Your account is locked for deletion. Use Delete account to resume cleanup while online.');return;
  }
  const allowed=isAdmin()||(access&&access.status!=='rejected'&&(access.status==='approved'||config.requireApproval===false));
  if(!allowed){if(appReady)stopStreams();gate(access?.status==='rejected'?'Account not approved':'Waiting for approval',access?.status==='rejected'?'The admin declined access. Contact the admin or delete this account.':'Your email is verified. The admin must approve this account before you can use VOLUNATION.');return;}
  if(appReady)return;
  appReady=true;$('gate').hidden=true;$('app-view').hidden=false;
  try{local=readLocal(user.uid);}catch(e){fail(e);}
  renderDraft();
  watch(sessionsRef,'Sessions',v=>sessions=v.filter(s=>typeof s.date==='string'&&Array.isArray(s.exercises)).map(normalizeSession),token);
  watch(legacyRef,'Legacy logs',v=>legacy=v,token);watch(profilesRef,'Profiles',v=>profiles=v,token);
  watch(privateRef(user.uid,'routines'),'Routines',v=>routines=v,token);watch(privateRef(user.uid,'exercises'),'Exercise memory',v=>memory=v,token);
  watch(privateRef(user.uid,'goals'),'Goals',v=>goals=v,token);
  for(const [ref,label,assign]of[[competitionsRef,'Competitions',v=>competitions=v],[entriesRef,'Entries',v=>entries=v],[awardsRef,'Awards',v=>awards=v],[bossesRef,'Bosses',v=>bosses=v],[resultsRef,'Results',v=>results=v],[archivesRef,'Archives',v=>archives=v]])watch(ref,label,assign,token);
  watch(privateRef(user.uid,'settings'),'Preferences',v=>{
    const p=v.find(x=>x.id==='competition');if(!p)return;
    const before=unit();persist({...readLocal(user.uid),unit:p.unit==='lb'?'lb':'kg',selected:p.selected||[user.uid],favorites:p.favorites||[],bodyweight:p.bodyweight??'',draft:local.draft});if(before!==unit())renderDraft();
  },token);
  if(isAdmin())watch(accessRef,'Approvals',v=>accounts=v,token);
  ensureProfile(user,signupName||user.displayName||'Athlete').catch(e=>fail(e,'Profile: '));
  renderTimeframe('race');renderTimeframe('stats');render();flush();
}
async function initialiseGate(u){
  const token=++epoch;authStops.forEach(fn=>fn());authStops=[];stopStreams();
  user=u;sessions=[];legacy=[];profiles=[];routines=[];memory=[];competitions=[];entries=[];awards=[];bosses=[];results=[];archives=[];goals=[];accounts=[];access=null;activeComp='';finalAttempt='';
  exerciseChart?.destroy();raceChart?.destroy();exerciseChart=raceChart=null;
  local={draft:null,outbox:{},unit:'kg',selected:u?[u.uid]:[],favorites:[],bodyweight:''};
  $('auth-view').hidden=!!u;$('logout').hidden=!u;$('gate').hidden=!u;$('app-view').hidden=true;
  if(!u){notice('Sign in to start lifting.');return;}
  if(!u.emailVerified){gate('Verify your email','Open the verification email, then return and press “I have verified / Refresh”. No workout data is available until verification.');return;}
  gate('Checking access…','Loading account approval. If this fails, check your connection and published Firestore rules.');
  try{
    if(isAdmin()&&navigator.onLine){
      await runTransaction(db,async tx=>{const cfg=await tx.get(configRef),c=await tx.get(doc(competitionsRef,EOY_ID));if(!cfg.exists())tx.set(configRef,{requireApproval:DEFAULT_REQUIRE_APPROVAL});if(!c.exists())tx.set(doc(competitionsRef,EOY_ID),{name:'The 62-day EOY Push',start:START,end:'2027-01-01',endAt:Date.parse('2027-01-02T00:00:00+10:00'),cash:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});});
    }
    if(navigator.onLine&&!localStorage.getItem('volunation-delete:'+u.uid))await runTransaction(db,async tx=>{const r=doc(accessRef,u.uid),s=await tx.get(r);if(!s.exists())tx.set(r,{userId:u.uid,email:u.email.toLowerCase(),status:isAdmin()?'approved':'pending',createdAt:serverTimestamp()});});
    if(token!==epoch)return;
    authStops.push(onSnapshot(configRef,s=>{config=s.exists()?s.data():{requireApproval:DEFAULT_REQUIRE_APPROVAL};evaluateAccess(token);},e=>fail(e,'Approval settings: ')));
    authStops.push(onSnapshot(doc(accessRef,u.uid),s=>{access=s.exists()?s.data():null;evaluateAccess(token);},e=>fail(e,'Account approval: ')));
  }catch(e){fail(e,'Account setup: ');gate('Connection or setup required','Could not check your account. Publish the supplied rules and reconnect, then press Refresh.');}
}
$('verify-send').onclick=action(async()=>{await sendEmailVerification(user);$('gate-message').textContent='Verification email sent. Check your inbox and spam folder.';});
$('verify-refresh').onclick=action(async()=>{await reload(user);await getIdToken(user,true);await initialiseGate(user);});
$('unit-select').onchange=()=>{savePreferences({unit:$('unit-select').value});renderDraft();render();};
$('bio-form').onsubmit=async e=>{e.preventDefault();try{await setDoc(doc(profilesRef,user.uid),{userId:user.uid,bio:$('bio').value.trim(),updatedAt:serverTimestamp()},{merge:true});notice('Bio saved.');}catch(err){fail(err);}};
function ensureCompetitionSelection(){
  const old=activeComp,mine=ownComps();if(!mine.some(c=>c.id===activeComp))activeComp=mine.find(c=>c.end>=today())?.id||mine[0]?.id||'';if(old!==activeComp){renderTimeframe('race');renderTimeframe('stats');}
}
function renderCompetitions(){
  const old=activeComp;ensureCompetitionSelection();
  const select=$('competition-select');select.replaceChildren();
  if(!ownComps().length){const o=element('option','No competitions joined');o.value='';select.append(o);}
  ownComps().forEach(c=>{const o=element('option',c.name);o.value=c.id;select.append(o);});select.value=activeComp;
  const goalSelection=$('goal-comp').value;$('goal-comp').replaceChildren(...ownComps().map(c=>{const o=element('option',c.name);o.value=c.id;return o;}));if(ownComps().some(c=>c.id===goalSelection))$('goal-comp').value=goalSelection;
  const host=$('competition-joins');host.replaceChildren();
  const eligible=competitions.filter(c=>member(user.uid,c.id)?.eligible&&c.end>=today());
  if(!eligible.length)host.append(element('p',streamState.has('Competitions')?'No open competition invitations. The admin controls eligibility.':'Loading competitions…'));
  eligible.forEach(c=>{const m=member(user.uid,c.id),row=element('div','','rank');row.append(element('span',c.name+' · '+c.start+' to '+c.end+' inclusive'),button(m.optedIn?'Opt out':'Join competition',action(async()=>{
    if(m.optedIn&&!await ask('Opt out of '+c.name+'? Your workouts remain saved.'))return;
    await setDoc(doc(entriesRef,m.id),{optedIn:!m.optedIn,updatedAt:serverTimestamp()},{merge:true});
  }),m.optedIn?'':'primary'));host.append(row);});
  if(old!==activeComp){renderTimeframe('race');renderTimeframe('stats');}
}
$('competition-select').onchange=()=>{activeComp=$('competition-select').value;renderTimeframe('race');renderTimeframe('stats');render();};
function publicButton(uid){return button(nameFor(uid)+(uid===user.uid?' (you)':''),()=>showAthlete(uid),'name-button');}
function renderRace(data){
  ensureCompetitionSelection();const people=athletes(data),selected=local.selected||[user.uid],fav=local.favorites||[],c=selectedCompetition(),ids=participants(c),compRanks=rankings(c,data),week=monday(today());
  const enriched=people.map(p=>{const ss=data.filter(s=>s.userId===p.id);return{...p,ss,weekly:sumVolume(ss.filter(s=>s.date>=week&&s.date<shift(week,7))),lifetime:sumVolume(ss),density:density(ss)||0,rank:compRanks.find(r=>r.id===p.id)?.rank||Infinity};});
  const mode=$('athlete-filter').value,search=key($('athlete-search').value),sort=$('athlete-sort').value;
  const shown=enriched.filter(p=>key(p.name).includes(search)&&(mode==='all'||mode==='starred'&&fav.includes(p.id)||mode==='comp'&&ids.includes(p.id)||mode==='active'&&p.ss.some(s=>s.date>=week&&s.date<=today()))).sort((a,b)=>sort==='rank'?a.rank-b.rank:sort==='level'?levelOf(b.lifetime)-levelOf(a.lifetime)||b.lifetime-a.lifetime:b[sort]-a[sort]);
  $('athletes').replaceChildren(...shown.map(p=>{const row=element('div','','athlete-row'),check=element('input');check.type='checkbox';check.checked=selected.includes(p.id);check.setAttribute('aria-label','Compare '+p.name);check.onchange=()=>savePreferences({selected:check.checked?[...new Set([...local.selected,p.id])]:local.selected.filter(id=>id!==p.id)});
    const info=element('div','','athlete-info');info.append(publicButton(p.id),element('small',mass(p.lifetime)+' lifetime · '+mass(p.density)+'/min · L'+(levelOf(p.lifetime)+1)+' · Comp '+(p.rank===Infinity?'—':'#'+p.rank)));
    const star=button(fav.includes(p.id)?'★':'☆',()=>savePreferences({favorites:fav.includes(p.id)?fav.filter(x=>x!==p.id):[...fav,p.id]}),'star'+(fav.includes(p.id)?' favorite':''));star.setAttribute('aria-label','Favorite '+p.name);row.append(check,info,star);return row;}));
  if(!shown.length)$('athletes').append(element('p',streamState.has('Profiles')?'No matching athletes.':'Loading athletes…'));
  const range=period('race',data),inComp=timeStates.race.mode==='comp',filtered=data.filter(s=>inRange(s,range));
  const ranked=people.filter(p=>selected.includes(p.id)&&(!inComp||ids.includes(p.id))).map(p=>{const ss=filtered.filter(s=>s.userId===p.id);return{...p,ss,total:sumVolume(ss)};}).sort((a,b)=>b.total-a.total);
  $('leaderboard').replaceChildren(...ranked.map(p=>{const row=element('div','','rank'),name=element('div','','rank-name'),rank=1+ranked.filter(r=>r.total>p.total+1e-8).length;name.append(publicButton(p.id),element('small','#'+rank+' · '+p.ss.length+' sessions · '+valueText(density(p.ss),'density')));if(rank===1&&p.total>0)name.append(element('span','♛','crown'));row.append(name,element('strong',mass(p.total)));return row;}));
  $('leader-message').textContent=ranked.length?'Selected athletes'+(inComp?' · joined competition members only':''):'Select athletes'+(inComp?' and join a competition':'')+' to compare.';
  $('payout').textContent=c?.cash?'Money uses the full competition membership, regardless of comparison checkboxes. Your '+(c.end<today()?'balance':'projected balance')+': '+currency(balance(c,user.uid,data)):'No cash prize for this selection.';
  $('race-track').replaceChildren();const max=ranked[0]?.total||0;
  ranked.forEach(p=>{const lane=element('div','','lane'),heading=element('div','','lane-label'),road=element('div','','lane-road'),fill=element('div','','lane-fill');heading.append(publicButton(p.id),element('strong',mass(p.total)));fill.style.width=(max?p.total/max*100:0)+'%';fill.style.background=athleteColor(p.id,people);road.append(fill);lane.append(heading,road,element('small',p.ss.length+' sessions · '+valueText(density(p.ss),'density')+' · '+valueText(metricValue(p.ss,'duration'),'duration')));$('race-track').append(lane);});
  if(!ranked.length)$('race-track').append(element('p','No athletes selected for this view.'));
  const labels=labelsFor(range),m=$('race-metric').value,datasets=[];
  ranked.forEach(p=>{const own=data.filter(s=>s.userId===p.id),previous=labels.map(d=>{const source=shift(d,-7);return metricValue(own.filter(s=>s.date===source&&(!inComp||inRange(s,range))),m);});datasets.push({label:p.name,athleteId:p.id,data:labels.map(d=>d>today()?null:metricValue(own.filter(s=>s.date===d),m)),previous,borderColor:athleteColor(p.id,people),borderWidth:2.5,pointRadius:labels.length>90?1:3},{label:p.name,athleteId:p.id,data:previous,ghost:true,borderColor:athleteColor(p.id,people,true),borderDash:[5,5],pointRadius:0});});
  const personal=bestPeriod(data.filter(s=>s.userId===user.uid),$('personal-ghost').value);
  if(personal&&ranked.some(p=>p.id===user.uid))datasets.push({label:'You · best '+$('personal-ghost').value+' ('+personal.start+')',athleteId:'personal-best',data:labels.map((d,i)=>{const source=shift(personal.start,i);return source<personal.end?metricValue(personal.ss.filter(s=>s.date===source),m):null;}),borderColor:'#ffffff',borderDash:[2,4],pointRadius:0});
  if(!$('race').hidden)raceChart=chartInto(raceChart,'race-chart',labels,datasets,m);
  renderRaceData(ranked,data,range,m,personal);
}
function bestPeriod(data,type){
  if(type==='none')return null;const groups=new Map();
  data.forEach(s=>{const start=type==='week'?monday(s.date):s.date.slice(0,7)+'-01',end=type==='week'?shift(start,7):addMonths(start,1);if(end>today())return;const g=groups.get(start)||{start,end,ss:[]};g.ss.push(s);groups.set(start,g);});
  return [...groups.values()].sort((a,b)=>sumVolume(b.ss)-sumVolume(a.ss))[0]||null;
}
function renderRaceData(ranked,data,range,metricName,personal){
  const host=$('race-data');host.replaceChildren();const dates=[...new Set(data.filter(s=>inRange(s,range)&&ranked.some(p=>p.id===s.userId)).map(s=>s.date))].sort().reverse();
  if(!dates.length)host.append(element('p','No sessions in this comparison.'));
  if($('personal-ghost').value!=='none')host.append(element('p',personal?'Personal ghost: '+personal.start+' to '+shift(personal.end,-1)+'. Aligned to the start of this graph.':'No completed personal period available, or you are not selected.'));
  dates.forEach(date=>{const d=element('details','','history-card');d.append(element('summary',date));ranked.forEach(p=>{
    const own=data.filter(s=>s.userId===p.id&&s.date===date),before=data.filter(s=>s.userId===p.id&&s.date===shift(date,-7)),v=metricValue(own,metricName),pv=metricValue(before,metricName);
    d.append(element('strong',p.name+' · '+valueText(v,metricName)+(v!==null&&pv!==null?' ('+(v-pv>=0?'+':'')+valueText(v-pv,metricName)+' vs last week)':'')));
    if(!own.length)d.append(element('p','No sessions.'));own.forEach(s=>d.append(element('p',(s.referenceCode||s.name)+' · '+mass(total(s))+' · '+valueText(density([s]),'density')+' · '+valueText(metricValue([s],'duration'),'duration'))));
  });host.append(d);});
}
for(const id of ['athlete-search','athlete-filter','athlete-sort','race-metric','personal-ghost'])$(id).addEventListener(id==='athlete-search'?'input':'change',render);
function weekScores(data,week,boss){
  const current=data.filter(s=>s.date>=week&&s.date<shift(week,7)),prior=data.filter(s=>s.date>=shift(week,-7)&&s.date<week);
  const ids=[...new Set(current.map(s=>s.userId))];
  return ids.map(id=>{const ss=current.filter(s=>s.userId===id);return{id,volume:sumVolume(ss),improved:sumVolume(ss)-sumVolume(prior.filter(s=>s.userId===id)),consistent:new Set(ss.map(s=>s.date)).size,early:ss.filter(s=>Number.isFinite(s.startedAt)&&new Date(s.startedAt+10*3600000).getUTCHours()<EARLY_BIRD_HOUR).length,boss:!boss?0:ss.reduce((n,s)=>n+completedSets(s,key(boss||'')).reduce((v,t)=>v+setVolume(t),0),0)};});
}
const AWARD_TYPES=[['improved','Most Improved'],['consistent','Most Consistent'],['early','Early Bird'],['boss','Boss Slayer']];
function winners(scores,type){const max=Math.max(0,...scores.map(s=>s[type]));return max>0?scores.filter(s=>Math.abs(s[type]-max)<1e-8):[];}
function renderWeekControl(){
  const host=$('week-control');host.replaceChildren();const c=selectedCompetition(),start=monday(c?.start||allSessions().at(-1)?.date||today()),end=monday(c?.end||today());
  if(selectedWeek<start||selectedWeek>end)selectedWeek=Math.max(Date.parse(start),Math.min(Date.parse(monday(today())),Date.parse(end)));if(typeof selectedWeek==='number')selectedWeek=new Date(selectedWeek).toISOString().slice(0,10);
  const select=element('select');select.setAttribute('aria-label','Awards and weekly duel week');
  for(let w=start;w<=end;w=shift(w,7)){const o=element('option',dayLabel(w)+' – '+dayLabel(shift(w,6))+' '+w.slice(0,4));o.value=w;select.append(o);}select.value=selectedWeek;
  select.onchange=()=>{selectedWeek=select.value;render();};
  const nav=element('div','','period-nav');const prev=button('‹',()=>{selectedWeek=shift(selectedWeek,-7);render();}),next=button('›',()=>{selectedWeek=shift(selectedWeek,7);render();});prev.disabled=selectedWeek<=start;next.disabled=selectedWeek>=end;prev.setAttribute('aria-label','Previous awards week');next.setAttribute('aria-label','Next awards week');nav.append(prev,select,next);host.append(nav);
}
function renderAwards(data){
  renderWeekControl();const week=selectedWeek,boss=bosses.find(b=>b.id===week),scores=weekScores(data,week,boss?.exercise),closed=shift(week,7)<=today(),final=archives.some(a=>a.id==='week-'+week);
  $('boss-name').textContent=boss?.exercise||'Boss selection pending';$('boss-result').textContent=boss?'Weekly total for this exercise · '+(closed?(final?'Finalised':'Awaiting admin finalisation'):'In progress'):'The verified admin selects and saves a random logged exercise when opening the app. No fixed exercise list.';
  $('boss-scores').replaceChildren(...athletes(data).filter(p=>local.selected.includes(p.id)).map(p=>element('p',p.name+' · '+mass(scores.find(s=>s.id===p.id)?.boss||0))));
  const host=$('weekly-awards');host.replaceChildren(element('h2','Weekly awards'),element('p',(closed?(final?'Final results':'Provisional · waiting for admin'):'In progress · winners not yet awarded')+' · All athletes · Early Bird before '+EARLY_BIRD_HOUR+':00 Brisbane'));
  AWARD_TYPES.forEach(([type,title])=>{const earned=awards.filter(a=>a.week===week&&a.type===type),win=final?earned.map(a=>a.userId):winners(scores,type).map(s=>s.id);host.append(element('p',title+': '+(win.length?win.map(nameFor).join(' & '):'No qualifying activity')));});
  const c=selectedCompetition(),ids=participants(c),r=compRange(c);let tally=new Map(ids.map(id=>[id,0]));
  function duel(w){const from=w<r.start?r.start:w,to=shift(w,7)>r.end?r.end:shift(w,7),ss=data.filter(s=>s.date>=from&&s.date<to&&ids.includes(s.userId));const rows=ids.map(id=>({id,volume:sumVolume(ss.filter(s=>s.userId===id))})).sort((a,b)=>b.volume-a.volume);return{rows,end:to,finished:to<=today(),tie:rows.length>1&&Math.abs(rows[0].volume-rows[1].volume)<1e-8};}
  if(!c||ids.length<2){$('duel-banner').textContent='Join a competition with at least two athletes for weekly duels.';return;}
  for(let w=monday(c.start);w<r.end;w=shift(w,7)){const d=duel(w);if(d.finished&&!d.tie&&d.rows[0]?.volume>0)tally.set(d.rows[0].id,tally.get(d.rows[0].id)+1);}
  const d=duel(week),message=!d.finished?'In progress':!d.rows[0]?.volume?'No training recorded':d.tie?'Tied week':nameFor(d.rows[0].id)+' won by '+mass(d.rows[0].volume-(d.rows[1]?.volume||0));
  $('duel-banner').textContent=message+' · Weekly wins: '+[...tally].map(([id,n])=>nameFor(id)+' '+n).join(' – ');
}
function summaryFor(data){
  const heavy=[...data].sort((a,b)=>total(b)-total(a))[0],ex=new Map();data.forEach(s=>s.exercises.forEach(e=>ex.set(key(e.name),{name:e.name,volume:(ex.get(key(e.name))?.volume||0)+volume(e)})));
  const most=[...ex.values()].sort((a,b)=>b.volume-a.volume)[0];
  return{volumeKg:sumVolume(data),sessions:data.length,longestStreak:streakInfo(data,data.map(s=>s.date).sort().at(-1)||today()).best,heaviestKg:heavy?total(heavy):0,heaviestDate:heavy?.date||'',heaviestReference:heavy?.referenceCode||'',mostExercise:most?.name||'',mostExerciseKg:most?.volume||0};
}
function recapCard(title,r){
  const box=element('div','','history-card');box.append(element('h3',title+(r.rank?' · #'+r.rank:'')),element('p',mass(r.volumeKg)+' · '+r.sessions+' sessions · longest streak '+r.longestStreak+' training days'),element('p','Heaviest session: '+mass(r.heaviestKg)+' · '+(r.heaviestDate||'—')+' '+r.heaviestReference),element('p','Most lifted: '+(r.mostExercise||'—')+' · '+mass(r.mostExerciseKg)));
  if(r.badges?.length)box.append(element('p','Badges: '+r.badges.join(', ')));return box;
}
function milestoneValue(m,data){return m.type==='volume'?sumVolume(data):m.type==='sessions'?data.length:m.type==='streak'?streakInfo(data).best:Math.max(0,...data.map(total));}
function milestoneDate(m,data){const sorted=[...data].sort((a,b)=>a.date.localeCompare(b.date));for(let i=0;i<sorted.length;i++)if(milestoneValue(m,sorted.slice(0,i+1))>=m.target)return sorted[i].date;return null;}
function fillAchievements(host,uid,data,withProgress=false){
  host.replaceChildren();const earned=awards.filter(a=>a.userId===uid).sort((a,b)=>(b.date||b.week).localeCompare(a.date||a.week));
  if(!earned.length)host.append(element('p','No saved badges yet. Milestones unlock from training; the admin saves permanent awards on their next visit.'));
  earned.forEach(a=>host.append(element('span',a.name+' · '+(a.week?'week '+a.week:a.date),'badge')));
  for(const c of competitions){const own=rankings(c).find(r=>r.id===uid),record=results.find(r=>r.userId===uid&&r.periodId==='comp-'+c.id);if(record||own)host.append(element('p',c.name+' · #'+(record?.rank||own.rank)+' · '+mass(record?.volumeKg??own.total)+(record?' · Final':c.end>=today()?' · In progress':' · Awaiting finalisation')));}
  if(withProgress){const box=$('milestones');box.replaceChildren(element('h3','Milestone progress'));MILESTONES.forEach(m=>{const v=milestoneValue(m,data),saved=earned.some(a=>a.milestoneId===m.id);box.append(progressCard(m.name+(saved?' · Earned':v>=m.target?' · Unlocked, awaiting save':''),v,m.target,['volume','session'].includes(m.type)?mass:fmt));});}
}
function profileMetrics(host,uid,data){
  const c=selectedCompetition(),rank=rankings(c).find(r=>r.id===uid)?.rank,heavy=[...data].sort((a,b)=>total(b)-total(a))[0];host.replaceChildren();
  metric(host,'Total sessions completed',String(data.length));metric(host,'Competition rank',rank?'#'+rank:'—',c?.name||'No selected competition');metric(host,'Lifetime volume',mass(sumVolume(data)));metric(host,'Average session density',valueText(density(data),'density'),'Volume / total known minutes');metric(host,'Highest volume session',heavy?mass(total(heavy)):'—',heavy?heavy.date+' · '+(heavy.referenceCode||'Reference pending'):'No sessions');
}
function renderProfile(mine){
  $('profile-name').textContent=nameFor(user.uid);const st=streakInfo(mine);$('badges').replaceChildren(element('span','🔥 '+st.current+' training-day streak','badge'),element('span','Freeze '+(st.used?'used':'available')+' this week','badge'));
  $('dashboard-streak').textContent='🔥 '+st.current+' training days · Weekly freeze '+(st.used?'used':'available');
  profileMetrics($('profile-metrics'),user.uid,mine);$('profile-level').replaceChildren(levelCard(sumVolume(mine)));
  $('comp-balances').replaceChildren();ownComps().filter(c=>c.cash).forEach(c=>{const b=balance(c,user.uid);$('comp-balances').append(element('p',c.name+' · '+(c.end>=today()?'Projected: ':'')+(b>0?'Win ':b<0?'Owe ':'Balance ')+currency(Math.abs(b))+(participants(c).length<2?' · Awaiting another athlete':'')));});
  fillAchievements($('achievements'),user.uid,mine,true);
  const p=profiles.find(p=>p.id===user.uid),changed=p?.nameChangedAt?.toMillis?.()||0;
  $('name-cooldown').textContent=changed+7*DAY>Date.now()?'Next username change: '+dateOf(changed+7*DAY):'Username change available.';$('rename').disabled=changed+7*DAY>Date.now();
  if(document.activeElement!==$('profile-input'))$('profile-input').value=nameFor(user.uid);if(document.activeElement!==$('bio'))$('bio').value=p?.bio||'';$('unit-select').value=unit();
  const daily=new Map();mine.forEach(s=>daily.set(s.date,(daily.get(s.date)||0)+total(s)));const max=Math.max(1,...daily.values());$('heatmap').replaceChildren();for(let i=90;i>=0;i--){const d=shift(today(),-i),v=daily.get(d)||0,label=d+': '+mass(v),sq=button('',()=>$('heatmap-detail').textContent=label,'l'+(v?Math.ceil(v/max*4):0));sq.title=label;sq.setAttribute('aria-label',label);$('heatmap').append(sq);}renderHistory(mine);
  if(openAthlete&&$('athlete-dialog').open)fillAthlete(openAthlete);
}
function fillAthlete(uid){const data=allSessions().filter(s=>s.userId===uid),p=profiles.find(p=>p.id===uid),host=$('athlete-detail');host.replaceChildren(element('h2',nameFor(uid)),element('p',p?.bio||'No bio yet.'));const metrics=element('div','','metrics');profileMetrics(metrics,uid,data);host.append(metrics,levelCard(sumVolume(data)));const badges=element('div','','chips');fillAchievements(badges,uid,data);host.append(badges);}
function showAthlete(uid){openAthlete=uid;fillAthlete(uid);if(!$('athlete-dialog').open)$('athlete-dialog').showModal();}
function goalProgress(g){const mine=allSessions().filter(s=>s.userId===user.uid),w=monday(today()),c=competitions.find(c=>c.id===g.competitionId),data=g.type==='competitionVolume'?mine.filter(s=>inRange(s,compRange(c))):mine.filter(s=>s.date>=w&&s.date<shift(w,7));return g.type==='weeklySessions'?data.length:sumVolume(data);}
function renderGoals(){
  const host=$('goals'),compact=$('dashboard-goals');host.replaceChildren(element('h3','Your goals'));compact.replaceChildren();
  if(!goals.length){host.append(element('p',streamState.has('Goals')?'Set a goal below.':'Loading goals…'));compact.append(element('p','Set weekly goals in Profile → Achievements.'));}
  goals.forEach(g=>{const name=g.type==='weeklySessions'?'Sessions this week':g.type==='weeklyVolume'?'Volume this week':'Competition target · '+(competitions.find(c=>c.id===g.competitionId)?.name||'Unavailable'),format=g.type==='weeklySessions'?fmt:mass,value=goalProgress(g),card=progressCard(name,value,g.target,format);card.append(button('Remove goal',action(async()=>{if(await ask('Remove this goal?'))await deleteDoc(doc(privateRef(user.uid,'goals'),g.id));}),'danger'));host.append(card);if(g.type!=='competitionVolume')compact.append(progressCard(name,value,g.target,format));});
}
$('goal-form').onsubmit=async e=>{e.preventDefault();try{const type=$('goal-type').value,n=Number($('goal-target').value),competitionId=type==='competitionVolume'?$('goal-comp').value:'';if(!(n>0)||!Number.isFinite(n)||type==='weeklySessions'&&!Number.isInteger(n)||type==='competitionVolume'&&!competitionId)throw new Error('Enter a positive target and choose a competition when required.');await setDoc(doc(privateRef(user.uid,'goals'),uuid()),{userId:user.uid,type,target:type==='weeklySessions'?n:fromDisplay(n),competitionId,createdAt:serverTimestamp()});$('goal-form').reset();}catch(err){fail(err);}};
function renderHistoryRecords(data){
  const host=$('comp-history');host.replaceChildren();const ended=competitions.filter(c=>c.end<today());if(!ended.length)host.append(element('p','No competitions have ended yet.'));
  ended.forEach(c=>{const d=element('details','','history-card'),stored=results.filter(r=>r.periodId==='comp-'+c.id).sort((a,b)=>a.rank-b.rank),final=archives.some(a=>a.id==='comp-'+c.id);d.append(element('summary',c.name+' · '+(final?'Final':'Waiting for admin finalisation')));if(final){if(!stored.length)d.append(element('p','No retained participant results.'));stored.forEach(r=>d.append(recapCard(nameFor(r.userId)+(r.rank===1?' ♛':''),r)));}else rankings(c,data).forEach(r=>d.append(recapCard(r.name+' · provisional',{...summaryFor(r.ss),rank:r.rank,badges:awards.filter(a=>a.userId===r.id&&a.date>=c.start&&a.date<=c.end).map(a=>a.name+' · '+(a.week||a.date))})));host.append(d);});
  const month=$('recap-month').value||today().slice(0,7),start=month+'-01',end=addMonths(start,1),saved=results.find(r=>r.periodId==='month-'+month&&r.userId===user.uid),mine=data.filter(s=>s.userId===user.uid&&s.date>=start&&s.date<end),recap=saved||{...summaryFor(mine),badges:awards.filter(a=>a.userId===user.uid&&a.date>=start&&a.date<end).map(a=>a.name+' · '+(a.week||a.date))};
  $('monthly-recap').replaceChildren(recapCard(month+(saved?' · Saved':end<=today()?' · Provisional, awaiting admin':' · In progress'),recap));
  const records=$('records');records.replaceChildren();const champions=results.filter(r=>r.kind==='comp'&&r.rank===1);records.append(element('h3','Past champions'));if(!champions.length)records.append(element('p','No finalised champions yet.'));champions.forEach(r=>records.append(element('p',(competitions.find(c=>'comp-'+c.id===r.periodId)?.name||r.periodId)+' · '+nameFor(r.userId)+' · '+mass(r.volumeKg))));
  const heavy=[...data].sort((a,b)=>total(b)-total(a))[0];records.append(element('h3','Heaviest session ever'),element('p',heavy?nameFor(heavy.userId)+' · '+mass(total(heavy))+' · '+heavy.date+' · '+(heavy.referenceCode||'Reference pending'):'No sessions recorded.'));
  const streaks=athletes(data).map(p=>({...p,best:streakInfo(data.filter(s=>s.userId===p.id)).best})).sort((a,b)=>b.best-a.best);streaks.forEach(p=>p.rank=1+streaks.filter(x=>x.best>p.best).length);records.append(element('h3','Longest streaks · Top 20 and you'));streaks.filter((p,i)=>i<20||p.id===user.uid).forEach(p=>records.append(element('p','#'+p.rank+' '+p.name+(p.id===user.uid?' (you)':'')+' · '+p.best+' training days')));
}
$('recap-month').value=today().slice(0,7);$('recap-month').onchange=render;
function populateCompetitionEditor(){
  const c=competitions.find(c=>c.id===adminEdit);$('comp-name').value=c?.name||'';$('comp-start').value=c?.start||today();$('comp-end').value=c?.end||shift(today(),30);
}
function renderAdmin(){
  $('admin-panel').hidden=!isAdmin();if(!isAdmin())return;$('require-approval').checked=config.requireApproval!==false;
  $('approvals').replaceChildren();const pending=accounts.filter(a=>a.status==='pending');if(!pending.length)$('approvals').append(element('p',streamState.has('Approvals')?'No pending approvals.':'Loading approvals…'));
  pending.forEach(a=>{const row=element('div','','rank');row.append(element('span',a.email),button('Approve',action(()=>setDoc(doc(accessRef,a.id),{status:'approved'},{merge:true})),'primary'),button('Reject',action(async()=>{if(await ask('Reject access for '+a.email+'?'))await setDoc(doc(accessRef,a.id),{status:'rejected'},{merge:true});}),'danger'));$('approvals').append(row);});
  const select=$('admin-comp');select.replaceChildren();const fresh=element('option','Create new competition');fresh.value='';select.append(fresh);competitions.forEach(c=>{const o=element('option',c.name);o.value=c.id;select.append(o);});select.value=adminEdit;
  const host=$('eligibility');host.replaceChildren();const c=competitions.find(c=>c.id===adminEdit);if(!c){host.append(element('p','Save or select a competition to manage eligibility.'));return;}
  host.append(element('h3','Eligible athletes · '+c.name));athletes(allSessions()).forEach(p=>{const m=member(p.id,c.id),check=element('input'),label=element('label','','inline');check.type='checkbox';check.checked=!!m?.eligible;check.disabled=c.end<today();check.onchange=action(async()=>{await setDoc(doc(entriesRef,c.id+'_'+p.id),{userId:p.id,competitionId:c.id,eligible:check.checked,optedIn:check.checked?!!m?.optedIn:false,updatedAt:serverTimestamp()});});label.append(check,element('span',p.name+(m?.optedIn?' · joined':'')));host.append(label);});
}
$('admin-comp').onchange=()=>{adminEdit=$('admin-comp').value;populateCompetitionEditor();renderAdmin();};
$('require-approval').onchange=action(async()=>{await setDoc(configRef,{requireApproval:$('require-approval').checked});});
$('competition-form').onsubmit=async e=>{e.preventDefault();try{const name=$('comp-name').value.trim(),start=$('comp-start').value,end=$('comp-end').value;if(!name||start>end||!start||!end||end<today())throw new Error('Enter a name and valid inclusive dates. The end must not be in the past.');const id=adminEdit||uuid(),existing=competitions.find(c=>c.id===id);if(existing&&existing.end<today())throw new Error('An ended competition is locked.');if(Date.parse(end)-Date.parse(start)>5*366*DAY)throw new Error('Limit each competition to five years.');await setDoc(doc(competitionsRef,id),{name,start,end,endAt:Date.parse(shift(end,1)+'T00:00:00+10:00'),cash:id===EOY_ID,...(!existing?{createdAt:serverTimestamp()}:{}),updatedAt:serverTimestamp()},{merge:true});adminEdit=id;notice('Competition saved. Select eligible athletes below.');}catch(err){fail(err);}};
function scheduleFinalisation(){
  if(!isAdmin()||!streamOK()||!navigator.onLine||finalising||Object.keys(local.outbox).length)return;
  const key=today();if(finalAttempt===key)return;clearTimeout(finalTimer);finalTimer=setTimeout(()=>{finalAttempt=key;finalise().catch(e=>fail(e,'Finalisation: '));},1500);
}
async function saveBatch(items){
  for(let i=0;i<items.length;i+=150){const b=writeBatch(db);items.slice(i,i+150).forEach(([ref,data])=>b.set(ref,data));await b.commit();}
}
async function ensureBoss(week,data){
  const existing=bosses.find(b=>b.id===week);if(existing)return existing.exercise;
  // Pick from names logged before the week. On first setup, use available names.
  const before=data.filter(s=>s.date<week),pool=before.length?before:data;
  const names=[...new Map(pool.flatMap(s=>s.exercises.map(e=>[key(e.name),e.name.trim()]))).values()].filter(Boolean).sort();if(!names.length)return '';
  const random=new Uint32Array(1);crypto.getRandomValues(random);const exercise=names[Math.floor(random[0]/4294967296*names.length)],ref=doc(bossesRef,week);
  return runTransaction(db,async tx=>{const snap=await tx.get(ref);if(snap.exists())return snap.data().exercise;tx.set(ref,{exercise,week,createdAt:serverTimestamp()});return exercise;});
}
async function finalise(){
  if(finalising)return;if(!isAdmin()||!navigator.onLine||!streamOK())throw new Error('Wait for all data to sync online before finalising.');
  if(Object.keys(local.outbox).length)throw new Error('Sync your pending sessions first.');
  finalising=true;$('finalise').disabled=true;$('admin-status').textContent='Saving completed awards and recaps. Keep this page open…';
  try{
    const data=allSessions().filter(s=>!s.pending&&accounts.find(a=>a.id===s.userId)?.status!=='deleting'),allPeople=athletes(data).filter(p=>accounts.find(a=>a.id===p.id)?.status!=='deleting');
    await ensureBoss(monday(today()),data);
    const earliest=data.map(s=>s.date).sort()[0]||today();
    for(let week=monday(earliest);shift(week,7)<=today();week=shift(week,7)){
      const archive=doc(archivesRef,'week-'+week);if((await getDocFromServer(archive)).exists())continue;
      const boss=await ensureBoss(week,data),scores=weekScores(data,week,boss),writes=[];
      for(const [type,name]of AWARD_TYPES){if(type==='boss'&&!boss)continue;for(const winner of winners(scores,type))writes.push([doc(awardsRef,'week-'+week+'-'+type+'-'+winner.id),{userId:winner.id,type,name:name+(type==='boss'?' · '+boss:''),week,date:shift(week,6),value:winner[type],createdAt:serverTimestamp()}]);}
      await saveBatch(writes);await setDoc(archive,{kind:'week',start:week,end:shift(week,6),completedAt:serverTimestamp()});
    }
    for(const p of allPeople){const mine=data.filter(s=>s.userId===p.id);for(const m of MILESTONES){if(milestoneValue(m,mine)<m.target)continue;const ref=doc(awardsRef,'milestone-'+m.id+'-'+p.id);if((await getDocFromServer(ref)).exists())continue;await setDoc(ref,{userId:p.id,type:'milestone',milestoneId:m.id,name:m.name,date:milestoneDate(m,mine),createdAt:serverTimestamp()});}}
    // Read award acknowledgements before recording the badge list in recaps.
    const earned=(await getDocsFromServer(awardsRef)).docs.map(d=>d.data());
    const periods=competitions.filter(c=>c.end<today()).map(c=>({id:'comp-'+c.id,kind:'comp',start:c.start,end:c.end,c,ids:participants(c)}));
    for(let start=earliest.slice(0,7)+'-01';addMonths(start,1)<=today();start=addMonths(start,1))periods.push({id:'month-'+start.slice(0,7),kind:'month',start,end:shift(addMonths(start,1),-1),ids:allPeople.filter(p=>data.some(s=>s.userId===p.id&&s.date>=start&&s.date<addMonths(start,1))).map(p=>p.id)});
    for(const period of periods){const archive=doc(archivesRef,period.id);if((await getDocFromServer(archive)).exists())continue;const rows=period.ids.map(id=>{const ss=data.filter(s=>s.userId===id&&s.date>=period.start&&s.date<=period.end);return{id,...summaryFor(ss)};});
      await saveBatch(rows.map(row=>{const rank=1+rows.filter(r=>r.volumeKg>row.volumeKg+1e-8).length,{id,...stats}=row;return[doc(resultsRef,period.id+'_'+id),{userId:id,periodId:period.id,kind:period.kind,start:period.start,end:period.end,rank,...stats,balanceKgCash:period.c?balance(period.c,id,data):0,badges:earned.filter(a=>a.userId===id&&a.date>=period.start&&a.date<=period.end).map(a=>a.name+' · '+(a.week||a.date)),createdAt:serverTimestamp()}];}));
      await setDoc(archive,{kind:period.kind,start:period.start,end:period.end,completedAt:serverTimestamp()});
    }
    $('admin-status').textContent='Completed awards and recaps saved. Live periods remain in progress.';
  }finally{finalising=false;$('finalise').disabled=false;}
}
$('finalise').onclick=action(finalise);
function openDelete(){ if(!user.emailVerified){gate('Verify before deleting','Verify your email first so all existing workout data can be found and removed safely.');return;} $('delete-confirm').value='';$('delete-password').value='';$('delete-progress').textContent='';$('delete-dialog').showModal(); }
$('delete-account').onclick=openDelete;$('gate-delete').onclick=openDelete;$('cancel-delete').onclick=()=>{if(!deleting)$('delete-dialog').close();};
$('delete-dialog').addEventListener('cancel',e=>{if(deleting)e.preventDefault();});
async function eraseQuery(ref){
  for(;;){const snap=await getDocsFromServer(query(ref,limit(100)));if(snap.empty)return;const b=writeBatch(db);snap.docs.forEach(d=>b.delete(d.ref));await b.commit();}
}
$('delete-form').onsubmit=async e=>{
  e.preventDefault();if($('delete-confirm').value!=='DELETE')return $('delete-progress').textContent='Type DELETE exactly to confirm.';
  if(!navigator.onLine)return $('delete-progress').textContent='Reconnect before deleting.';
  const u=user,uid=u.uid;deleting=true;$('confirm-delete').disabled=true;$('cancel-delete').disabled=true;
  try{
    await reauthenticateWithCredential(u,EmailAuthProvider.credential(u.email,$('delete-password').value));$('delete-password').value='';
    // Block further writes from every tab before starting resumable, owner-only cleanup.
    if(u.emailVerified){await runTransaction(db,async tx=>{const ref=doc(accessRef,uid),snap=await tx.get(ref);tx.set(ref,snap.exists()?{status:'deleting'}:{userId:uid,email:u.email.toLowerCase(),status:'deleting',createdAt:serverTimestamp()},{merge:true});});}
    localStorage.setItem('volunation-delete:'+uid,'1');stopStreams();clearTimeout(finalTimer);local.outbox={};local.draft=null;localStorage.removeItem(storageKey(uid));
    $('delete-progress').textContent='Removing workouts, profile, private data and competition records…';
    if(u.emailVerified){
      for(const ref of [sessionsRef,legacyRef,referenceRef,entriesRef,awardsRef,resultsRef])await eraseQuery(query(ref,where('userId','==',uid)));
      for(const type of ['routines','exercises','settings','goals'])await eraseQuery(privateRef(uid,type));
      await deleteDoc(doc(profilesRef,uid));await deleteDoc(doc(db,'users',uid));
      // Keep the deleting marker until Auth deletion succeeds so interruptions can resume.
      await deleteDoc(doc(accessRef,uid));
    }
    $('delete-progress').textContent='Removing login…';await deleteUser(u);localStorage.removeItem('volunation-delete:'+uid);$('delete-dialog').close();notice('Account and personal records deleted.');
    try{await terminate(db);await clearIndexedDbPersistence(db);}catch{notice('Account deleted. Close other VOLUNATION tabs and clear this site’s browser data to remove offline caches.');}
    $('auth-submit').disabled=true;$('auth-toggle').disabled=true;$('status').textContent+=' Refresh to use another account.';
  }catch(err){$('delete-progress').textContent='Deletion did not finish: '+(err.message||err.code)+'. Stay online and retry. Completed deletions cannot be undone.';fail(err);}
  finally{deleting=false;$('confirm-delete').disabled=false;$('cancel-delete').disabled=false;}
};
// Register after constants and UI handlers exist, including during restored sessions.
populateCompetitionEditor();
onAuthStateChanged(auth,u=>{initialiseGate(u).catch(e=>fail(e));});
