import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import {getAuth,createUserWithEmailAndPassword,signInWithEmailAndPassword,onAuthStateChanged,signOut,updateProfile,setPersistence,browserLocalPersistence,browserSessionPersistence} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import {getFirestore,collection,doc,setDoc,deleteDoc,onSnapshot,serverTimestamp} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

const firebaseConfig = {
 apiKey:'AIzaSyB3gR2Lu5Lj0OLVgv83Qdu2DGMqCThL0wg',authDomain:'volume-competition.firebaseapp.com',
 projectId:'volume-competition',storageBucket:'volume-competition.firebasestorage.app',
 messagingSenderId:'681802026275',appId:'1:681802026275:web:a4ce78cdaed0f7045c5096',measurementId:'G-0PZJJ53CR9'
};
// End is exclusive. Change to 2027-01-02 to include New Year's Day.
const START='2026-11-01', END='2027-01-01';
// Preserve the original app's collection. No workout migration required.
const ROOT=['artifacts','volume-challenge-app','public','data'];
const $=id=>document.getElementById(id);
const num=n=>Number(n).toLocaleString('en-AU',{maximumFractionDigits:2});
const money=n=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(n);
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Brisbane',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const nameOf=u=>u?.displayName?.trim() || 'Athlete';
const eligible=w=>w.date>=START && w.date<END;
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
let user=null,signup=false,busy=false,ready=false,workouts=[],profiles=[],unsubs=[],chart=null,workoutsReady=false;
let pendingName='',generation=0;
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
const workoutRef=collection(db,...ROOT,'workouts'),profileRef=collection(db,...ROOT,'profiles');
const messages={
 'auth/email-already-in-use':'That email already has an account. Sign in instead.',
 'auth/invalid-email':'Enter a valid email address.',
 'auth/weak-password':'Choose a stronger password (at least six characters, or the project password policy).',
 'auth/password-does-not-meet-requirements':'Your password does not meet this project’s password policy.',
 'auth/invalid-credential':'Email or password is incorrect.',
 'auth/wrong-password':'Email or password is incorrect.',
 'auth/user-not-found':'Email or password is incorrect.',
 'auth/operation-not-allowed':'Enable Email/Password in Firebase Authentication → Sign-in method.',
 'auth/unauthorized-domain':'Add this site’s hostname in Firebase Authentication → Settings → Authorized domains.',
 'auth/too-many-requests':'Too many attempts. Wait a little before trying again.',
 'auth/network-request-failed':'Network request failed. Check your connection.',
 'permission-denied':'Firestore denied access. Check the published rules, collection paths and any test-mode expiry.',
 'unavailable':'Firestore is unavailable. Check your connection.'
};
function errorText(e){return messages[e?.code] || `${e?.message || 'Unexpected error'}${e?.code?' ('+e.code+')':''}`;}
function showError(e,prefix=''){console.error(e);$('error').textContent=prefix+errorText(e);$('error').hidden=false;}
function clearError(){$('error').hidden=true;$('error').textContent='';}
function status(s){$('status').textContent=s;}
function authButtons(){ $('auth-submit').disabled=busy||!ready;$('auth-toggle').disabled=busy;$('auth-submit').textContent=busy?'Please wait…':signup?'Create account':'Sign in';}
function text(tag,value,className=''){const e=document.createElement(tag);e.textContent=value;e.className=className;return e;}
$('auth-toggle').addEventListener('click',()=>{
 signup=!signup;clearError();$('name-label').hidden=!signup;$('name').required=signup;
 $('password').minLength=signup?6:1;$('password').autocomplete=signup?'new-password':'current-password';
 $('auth-title').textContent=signup?'Join the competition':'Welcome back';
 $('auth-toggle').textContent=signup?'Already registered? Sign in':'New here? Sign up';authButtons();
});
$('auth-form').addEventListener('submit',async e=>{
 e.preventDefault();if(busy||!ready)return;clearError();busy=true;authButtons();
 const email=$('email').value.trim(),password=$('password').value;
 pendingName=signup?$('name').value.trim():'';
 try{
  if(signup){
   if(!pendingName)throw new Error('Enter a display name.');
   const credential=await createUserWithEmailAndPassword(auth,email,password);
   // Account creation signs in automatically; profile failure must not undo that success.
   try{await updateProfile(credential.user,{displayName:pendingName});await saveProfile(credential.user,pendingName);}
   catch(err){showError(err,'Account created, but profile could not be saved. You can still log workouts. ');}
   render();status('Account created. Ready to log.');
  }else{await signInWithEmailAndPassword(auth,email,password);status('Signed in.');}
  $('password').value='';
 }catch(err){showError(err);}finally{busy=false;pendingName='';authButtons();}
});
async function saveProfile(u,displayName=nameOf(u)){
 await setDoc(doc(profileRef,u.uid),{displayName:displayName||'Athlete',updatedAt:serverTimestamp()},{merge:true});
}
$('logout').addEventListener('click',async()=>{try{await signOut(auth);clearError();status('Signed out.');}catch(err){showError(err);}});
function cleanup(){unsubs.forEach(fn=>fn());unsubs=[];workouts=[];profiles=[];workoutsReady=false;if(chart){chart.destroy();chart=null;} }
function normalize(d){
 const w=d.data(),weight=Number(w.weight),reps=Number(w.reps),sets=Number(w.sets);
 if(typeof w.userId!=='string'||!validDate(w.date)||!Number.isFinite(weight)||weight<=0||weight>2000||!Number.isInteger(reps)||reps<1||reps>1000||!Number.isInteger(sets)||sets<1||sets>100)return null;
 return {...w,id:d.id,exercise:typeof w.exercise==='string'?w.exercise:'Exercise',notes:typeof w.notes==='string'?w.notes:'',session:typeof w.session==='string'?w.session:'',userName:typeof w.userName==='string'?w.userName:'Athlete',weight,reps,sets,volume:weight*reps*sets};
}
onAuthStateChanged(auth,u=>{
 const token=++generation;cleanup();user=u;$('dashboard').hidden=!u;$('auth-view').hidden=!!u;$('logout').hidden=!u;
 if(!u){status('Sign in or create an account.');$('history').replaceChildren();$('ranks').replaceChildren();return;}
 $('date').value=today();dateHint();render();status('Loading saved workouts…');
 unsubs.push(onSnapshot(workoutRef,{includeMetadataChanges:true},snapshot=>{
  if(token!==generation)return;
  workouts=snapshot.docs.map(normalize).filter(Boolean).sort((a,b)=>b.date.localeCompare(a.date)||(Number(b.timestamp)||0)-(Number(a.timestamp)||0));
  workoutsReady=true;status(snapshot.metadata.hasPendingWrites?'Saving changes — keep this page open.':snapshot.metadata.fromCache?'Showing cached data. Waiting for server connection…':'Workouts synced.');render();
 },err=>{if(token!==generation)return;workoutsReady=false;status('Workout sync failed.');showError(err);render();}));
 unsubs.push(onSnapshot(profileRef,snapshot=>{if(token!==generation)return;profiles=snapshot.docs.map(d=>({id:d.id,...d.data()}));render();},err=>{if(token===generation)showError(err,'Profile sync failed; names use available workout metadata. ');}));
 // Do not race an incomplete registration profile with the requested name.
 if(!pendingName)saveProfile(u).catch(err=>{if(token===generation)showError(err,'Profile could not be saved. ');});
},err=>showError(err));
try{await setPersistence(auth,browserLocalPersistence);}catch(err){
 try{await setPersistence(auth,browserSessionPersistence);status('Session persistence only: sign in again after closing this tab.');}
 catch(second){showError(second,'Browser storage is restricted. ');}
}
ready=true;authButtons();
for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>{
 const id=button.dataset.tab;document.querySelectorAll('.tab').forEach(el=>el.hidden=el.id!==id);
 document.querySelectorAll('[data-tab]').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));render();
});
function preview(){const v=Number($('weight').value)*Number($('reps').value)*Number($('sets').value);$('preview').textContent=num(Number.isFinite(v)&&v>0?v:0)+' kg';}
['weight','reps','sets'].forEach(id=>$(id).addEventListener('input',preview));
function dateHint(){$('date-hint').textContent=eligible({date:$('date').value})?'Counts toward the competition.':'Practice / out-of-period entry: saved in history, excluded from the competition.';}
$('date').addEventListener('change',dateHint);
$('workout-form').addEventListener('submit',async e=>{
 e.preventDefault();if(!user||$('save').disabled)return;clearError();
 const u=user,exercise=$('exercise').value.trim(),weight=Number($('weight').value),reps=Number($('reps').value),sets=Number($('sets').value),date=$('date').value;
 if(!exercise||!Number.isFinite(weight)||weight<=0||weight>2000||!Number.isInteger(reps)||reps<1||reps>1000||!Number.isInteger(sets)||sets<1||sets>100||!validDate(date)||date>today()){showError(new Error('Enter an exercise, a positive external load, whole reps and sets, and a valid date no later than today.'));return;}
 $('save').disabled=true;$('save').textContent='Saving…';status('Saving — wait for confirmation before closing this page.');
 try{
  await setDoc(doc(workoutRef),{userId:u.uid,userName:pendingName||nameOf(u),exercise,weight,reps,sets,volume:weight*reps*sets,date,notes:$('notes').value.trim(),session:$('session').value.trim(),timestamp:Date.now(),createdAt:serverTimestamp()});
  if(user?.uid===u.uid){status(`Saved ${num(weight*reps*sets)} kg.`);$('notes').value='';$('exercise').focus();}
 }catch(err){showError(err,'Workout was not saved. ');}finally{$('save').disabled=false;$('save').textContent='Save volume';}
});
function athletes(){
 const map=new Map(profiles.map(p=>[p.id,{id:p.id,name:p.displayName||'Athlete',total:0,daily:new Map()}]));
 if(user&&!map.has(user.uid))map.set(user.uid,{id:user.uid,name:pendingName||nameOf(user),total:0,daily:new Map()});
 for(const w of workouts){if(!map.has(w.userId))map.set(w.userId,{id:w.userId,name:w.userName||'Athlete',total:0,daily:new Map()});if(eligible(w)){const a=map.get(w.userId);a.total+=w.volume;a.daily.set(w.date,(a.daily.get(w.date)||0)+w.volume);}}
 return [...map.values()].sort((a,b)=>b.total-a.total||a.id.localeCompare(b.id));
}
function render(){
 if(!user)return;$('greeting').textContent=`LET’S GO, ${pendingName||nameOf(user)}`;
 const people=athletes(),total=people.reduce((s,p)=>s+p.total,0);$('ranks').replaceChildren();$('comparison').replaceChildren();
 const colors=['#75ecc1','#7bb5ff','#ffc775','#d4a5ff'];
 people.forEach((p,i)=>{
  const row=text('div','','rank');const who=text('div');who.append(text('strong',`${i+1}. ${p.name}${p.id===user.uid?' (you)':''}`));row.append(who,text('strong',num(p.total)+' kg'));$('ranks').append(row);
  const bar=document.createElement('div');bar.style.width=(total?p.total/total*100:100/people.length)+'%';bar.style.background=colors[i%colors.length];bar.title=p.name+': '+num(p.total)+' kg';$('comparison').append(bar);
 });
 const first=people[0],second=people[1],tied=first&&second&&Math.abs(first.total-second.total)<0.000001;
 $('race').textContent=!workoutsReady?'Waiting for workout sync…':!total?'The race starts with your first competition lift.':people.length<2?'Waiting for your opponent to register.':tied?'The leaders are tied.':`${first.name} leads by ${num(first.total-second.total)} kg.`;
 $('payout').textContent=total?`Winner’s payout at current volume: ${money(first.total/1000)}.${tied?' Tie: agree a tie-break before awarding a payout.':''} Final only after the competition closes.`:'Winner’s payout = their total competition volume ÷ 1,000 (AUD).';
 renderProfile();if(!$('leaderboard').hidden)renderChart(people,colors);
}
function renderProfile(){
 const mine=workouts.filter(w=>w.userId===user.uid),scored=mine.filter(eligible),ex=new Map(),days=new Map(),sessions=new Map();let total=0;
 for(const w of scored){total+=w.volume;const key=w.exercise.trim().toLowerCase();const prev=ex.get(key)||{name:w.exercise,total:0};prev.total+=w.volume;ex.set(key,prev);days.set(w.date,(days.get(w.date)||0)+w.volume);const sk=w.date+'|'+w.session.trim().toLowerCase();sessions.set(sk,(sessions.get(sk)||0)+w.volume);}
 const best=[...ex.values()].sort((a,b)=>b.total-a.total)[0],day=[...days].sort((a,b)=>b[1]-a[1])[0];
 $('stats').replaceChildren();for(const [label,value,detail] of [['Competition volume',num(total)+' kg','External load only'],['Highest volume exercise',best?.name||'—',best?num(best.total)+' kg':'No competition entries'],['Average session volume',num(sessions.size?total/sessions.size:0)+' kg','Grouped by date + session label'],['Most productive day',day?.[0]||'—',day?num(day[1])+' kg':'No competition entries']]){const c=text('div','','card');c.append(text('div',label,'stat-label'),text('div',value,'stat-value'),text('div',detail,'hint'));$('stats').append(c);}
 $('history').replaceChildren();$('export').disabled=!workoutsReady||!mine.length;
 if(!mine.length)$('history').append(text('p',workoutsReady?'No workouts logged yet.':'Waiting for workout data…'));
 for(const w of mine){const row=text('article','','entry'),body=text('div');body.append(text('strong',w.exercise),text('p',`${w.date}${w.session?' · '+w.session:''} · ${num(w.weight)} kg × ${w.reps} × ${w.sets} = ${num(w.volume)} kg${eligible(w)?'':' · Outside competition'}`));if(w.notes)body.append(text('p',w.notes));const del=text('button','Delete');del.type='button';del.setAttribute('aria-label',`Delete ${w.exercise} on ${w.date}`);del.addEventListener('click',async()=>{if(!confirm(`Delete ${w.exercise} (${num(w.volume)} kg)?`))return;del.disabled=true;try{await deleteDoc(doc(workoutRef,w.id));}catch(err){showError(err);del.disabled=false;}});row.append(body,del);$('history').append(row);}
 $('exercises').replaceChildren(...[...new Set(mine.map(w=>w.exercise))].sort().map(value=>{const o=document.createElement('option');o.value=value;return o;}));
}
function renderChart(people,colors){
 if(!window.Chart){$('chart-error').hidden=false;return;}$('chart-error').hidden=true;
 const labels=[];for(let d=new Date(START+'T00:00:00Z');d.toISOString().slice(0,10)<END;d.setUTCDate(d.getUTCDate()+1))labels.push(d.toISOString().slice(0,10));
 const cumulative=$('chart-mode').value==='cumulative';
 const datasets=people.map((p,i)=>{let sum=0;return {label:p.name+(p.id===user.uid?' (you)':''),data:labels.map(date=>{const v=p.daily.get(date)||0;sum+=v;return date>today()?null:cumulative?sum:v;}),borderColor:colors[i%colors.length],pointRadius:0,borderWidth:2,tension:0};});
 if(chart){chart.data={labels,datasets};chart.update('none');return;}
 try{chart=new window.Chart($('chart'),{type:'line',data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#c9d5e4'}}},scales:{x:{ticks:{color:'#aab8cb',maxTicksLimit:6}},y:{beginAtZero:true,title:{display:true,text:'Volume (kg)',color:'#aab8cb'},ticks:{color:'#aab8cb'}}}}});}catch(err){console.error(err);$('chart-error').hidden=false;}
}
$('chart-mode').addEventListener('change',render);
$('export').addEventListener('click',()=>{
 if(!user)return;const rows=[['Date','Exercise','Weight (kg)','Reps','Sets','Volume (kg)','Session','Notes','Counts in competition']];
 for(const w of workouts.filter(w=>w.userId===user.uid))rows.push([w.date,w.exercise,w.weight,w.reps,w.sets,w.volume,w.session,w.notes,eligible(w)?'Yes':'No']);
 // Quote all fields and neutralize spreadsheet formula prefixes in text cells.
 const cell=v=>'"'+(typeof v==='string'&&/^[\s]*[=+@-]/.test(v)?"'"+v:String(v)).replaceAll('"','""')+'"';
 const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='volume-history-'+today()+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
window.addEventListener('offline',()=>status('Offline. Writes may remain pending; keep this page open until synced.'));
window.addEventListener('online',()=>status('Connection restored. Waiting for sync…'));
