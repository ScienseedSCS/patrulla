const db=supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
const LEVELS=[{min:0,name:'🥚 Vigilante Novato'},{min:50,name:'🐛 Rastreador'},{min:150,name:'🦟 Cazador de Criaderos'},{min:350,name:'🛡️ Guardián del Barrio'},{min:700,name:'🏆 Héroe Antimosquito'},{min:1200,name:'⭐ Referente Comunitario'}];
const REVIEWER_MIN=350;
let CURRENT_USER=null,PROFILE=null,ACTIONS=[],reportState={},dailyRead=0;
const $=id=>document.getElementById(id);

function showAuthMsg(t){$('authMsg').textContent=t;}
async function register(){
  const email=$('email').value.trim(),password=$('password').value,city=$('cityInput').value.trim();
  if(!email||!password)return showAuthMsg('Completá email y contraseña.');
  if(password.length<6)return showAuthMsg('La contraseña debe tener al menos 6 caracteres.');
  localStorage.setItem('pa_city',city);
  const{data,error}=await db.auth.signUp({email,password});
  if(error)return showAuthMsg(error.message);
  if(data.session){startApp(data.session.user);}
  else{showAuthMsg('Cuenta creada. Tocá "Ya tengo cuenta · Entrar".');}
}
async function login(){
  const email=$('email').value.trim(),password=$('password').value,city=$('cityInput').value.trim();
  if(!email||!password)return showAuthMsg('Completá email y contraseña.');
  localStorage.setItem('pa_city',city);
  const{data,error}=await db.auth.signInWithPassword({email,password});
  if(error)return showAuthMsg(error.message);
  if(data.session)startApp(data.session.user);
}
db.auth.onAuthStateChange((_e,s)=>{if(s)startApp(s.user);});
(async()=>{const{data}=await db.auth.getSession();if(data.session)startApp(data.session.user);})();

async function startApp(user){
  CURRENT_USER=user;
  $('authScreen').hidden=true;$('appMain').hidden=false;$('bottomNav').hidden=false;
  await ensureProfile();loadIncidence();loadActions();renderProgress();refreshLearnCounters();
}
async function ensureProfile(){
  let{data}=await db.from('profiles').select('*').eq('id',CURRENT_USER.id).single();
  if(!data){const city=localStorage.getItem('pa_city')||'';await db.from('profiles').insert({id:CURRENT_USER.id,username:CURRENT_USER.email.split('@')[0],city});({data}=await db.from('profiles').select('*').eq('id',CURRENT_USER.id).single());}
  PROFILE=data;updatePointsUI();
}
function updatePointsUI(){$('pointsCounter').textContent=(PROFILE.points||0)+' pts';}
async function addPoints(pts){
  const np=(PROFILE.points||0)+pts,lvl=LEVELS.filter(l=>np>=l.min).length;
  await db.from('profiles').update({points:np,level:lvl}).eq('id',CURRENT_USER.id);
  PROFILE.points=np;PROFILE.level=lvl;updatePointsUI();renderProgress();
}
function nav(view){
  ['incidence','report','review','learn','progress'].forEach(v=>$('view-'+v).hidden=(v!==view));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  if(view==='review')loadReview();if(view==='learn')backToLearn();if(view==='progress'){renderProgress();loadLeaderboard();}
}
async function loadIncidence(){
  const{data}=await db.from('incidence').select('*').order('updated_at',{ascending:false}).limit(10);
  const box=$('incidenceBox');
  if(!data||!data.length){box.innerHTML='<div class="card">Sin datos de incidencia por ahora.</div>';return;}
  box.innerHTML=data.map(i=>'<div class="card incidence-item risk-'+i.risk_level+'"><span class="risk-badge">'+(i.risk_level||'').toUpperCase()+'</span><h3 style="margin:6px 0">'+i.city+'</h3><div class="small">Casos esta semana: <b>'+i.cases_week+'</b></div><p style="margin-top:6px">'+(i.message||'')+'</p></div>').join('');
}
async function loadActions(){
  const{data}=await db.from('action_types').select('*').order('sort_order');ACTIONS=data||[];
  $('actionsGrid').innerHTML=ACTIONS.map(a=>'<div class="action-card '+(a.id==='house_tour'?'star':'')+'" onclick="startReport(\''+a.id+'\')">'+(a.id==='house_tour'?'<span class="star-tag">★ destacada</span>':'')+'<div class="action-ico">'+a.icon+'</div><h4>'+a.title+'</h4><span class="badge">'+a.location+'</span><span class="pts">+'+a.points+' pts</span></div>').join('');
}
function startReport(id){reportState={action:ACTIONS.find(x=>x.id===id),file:null};renderStep1();openModal();}
function renderStep1(){const a=reportState.action;setModal('<div class="step-ind">Paso 1 de 3</div><div class="step-ico">'+a.icon+'</div><h2 style="text-align:center">'+a.title+'</h2><p style="text-align:center;margin:8px 0">'+a.description+'</p><div style="text-align:center;margin:10px 0"><span class="badge">'+a.location+'</span><span class="badge">'+a.kind+'</span><span class="pts">+'+a.points+' pts</span></div><p class="small" style="text-align:center">Vas a completar esta acción y sacar una foto que lo demuestre.</p><button class="btn-primary" onclick="renderStep2()">Entendido, continuar</button>');}
function renderStep2(){setModal('<div class="step-ind">Paso 2 de 3</div><h2>Sacá la foto</h2><p class="small">Sacá una foto que muestre la acción completada.</p><input type="file" id="reportPhoto" accept="image/*" capture="environment" onchange="onPhoto(event)"><div id="thumbBox"></div><button class="btn-outline" onclick="renderStep1()">← Volver</button><button class="btn-primary" id="toStep3" onclick="renderStep3()" disabled style="opacity:.5">Continuar</button>');}
function onPhoto(e){const f=e.target.files[0];if(!f)return;reportState.file=f;$('thumbBox').innerHTML='<img src="'+URL.createObjectURL(f)+'" class="thumb"><div class="small">✔ Foto lista</div>';const b=$('toStep3');b.disabled=false;b.style.opacity=1;}
function renderStep3(){const a=reportState.action,u=reportState.file?URL.createObjectURL(reportState.file):'';setModal('<div class="step-ind">Paso 3 de 3</div><h2>Contexto y enviar</h2>'+(u?'<img src="'+u+'" class="thumb">':'')+'<label class="small">Agregá contexto (opcional)</label><textarea id="reportNote" placeholder="Contá algo sobre este reporte (opcional). Ej: Di vuelta 3 baldes del patio"></textarea><button class="btn-outline" onclick="renderStep2()">← Volver</button><button class="btn-primary" onclick="submitReport()">Enviar reporte (+'+a.points+' pts)</button><div id="reportMsg" class="msg"></div>');}
async function submitReport(){
  const a=reportState.action,note=$('reportNote').value.trim(),file=reportState.file,msg=$('reportMsg');msg.textContent='Subiendo...';
  try{let photoUrl=null;if(file){const path=CURRENT_USER.id+'/'+Date.now()+'_'+file.name;const{error:e}=await db.storage.from('reports').upload(path,file);if(e)throw e;photoUrl=db.storage.from('reports').getPublicUrl(path).data.publicUrl;}
  await db.from('reports').insert({user_id:CURRENT_USER.id,action_type:a.id,city:PROFILE.city,photo_url:photoUrl,note,points_awarded:a.points,status:'pendiente'});
  await addPoints(a.points);
  setModal('<div style="text-align:center;padding:20px"><div class="step-ico">🎉</div><h2>¡Reporte enviado!</h2><p>Sumaste <b>+'+a.points+' pts</b>. La comunidad lo va a revisar.</p><button class="btn-primary" onclick="closeModal()">Listo</button></div>');
  }catch(err){msg.textContent='Error: '+err.message;}
}
async function loadReview(){
  const box=$('reviewContent');
  if((PROFILE.points||0)<REVIEWER_MIN){box.innerHTML='<div class="card locked"><div class="big">🔒</div><h3>Rol Revisor bloqueado</h3><p>Alcanzá el nivel <b>🛡️ Guardián del Barrio</b> (350 pts) para desbloquear el rol de Revisor y ganar puntos ayudando a validar reportes de tu comunidad.</p></div>';return;}
  const{data}=await db.from('reports').select('*, action_types(title,icon)').eq('status','pendiente').neq('user_id',CURRENT_USER.id).order('created_at',{ascending:false}).limit(20);
  let html='<div class="card"><span class="badge">✔ Rol Revisor desbloqueado</span><p style="margin-top:8px">Abrí cada reporte, mirá la foto y la nota, y votá si la acción se hizo bien. Ganás <b>+3 pts</b> por revisión.</p></div>';
  if(!data||!data.length){html+='<div class="card">No hay reportes pendientes por ahora. ¡Volvé más tarde!</div>';}
  else{html+='<div class="stack">'+data.map(r=>'<div class="card review-item"><div class="review-thumb">'+((r.action_types&&r.action_types.icon)||'📷')+'</div><div style="flex:1"><b>'+((r.action_types&&r.action_types.title)||r.action_type)+'</b><div class="small">'+(r.city||'-')+'</div></div><button class="btn-outline" style="width:auto;padding:8px 12px" onclick=\'openReviewModal('+JSON.stringify(r).replace(/'/g,"&#39;")+')\'>Ver</button></div>').join('')+'</div>';}
  box.innerHTML=html;
}
function openReviewModal(r){setModal('<div class="modal-photo">'+(r.photo_url?'<img src="'+r.photo_url+'" style="width:100%;height:100%;object-fit:cover;border-radius:12px">':'📷')+'</div><h2>'+((r.action_types&&r.action_types.title)||r.action_type)+'</h2><div class="small">👤 '+(r.city||'-')+'</div>'+(r.note?'<div class="note-box">📝 '+r.note+'</div>':'<div class="small" style="margin:10px 0">Sin nota de contexto.</div>')+'<div class="vote-row"><button class="v-ok" onclick="voteReport('+r.id+',\'correcto\')">✅ Correcto</button><button class="v-doubt" onclick="voteReport('+r.id+',\'dudoso\')">❓ Dudoso</button><button class="v-no" onclick="voteReport('+r.id+',\'no_corresponde\')">⚠️ No corresponde</button></div>');openModal();}
async function voteReport(id,vote){const{error}=await db.from('report_reviews').insert({report_id:id,reviewer_id:CURRENT_USER.id,vote});if(error){alert('Ya revisaste este reporte o hubo un error.');return;}await addPoints(3);closeModal();loadReview();}
function backToLearn(){$('learnMenu').hidden=false;$('tipsView').hidden=true;$('quizzesView').hidden=true;}
async function refreshLearnCounters(){const{count:t}=await db.from('tip_reads').select('*',{count:'exact',head:true}).eq('user_id',CURRENT_USER.id);const{count:q}=await db.from('quiz_answers').select('*',{count:'exact',head:true}).eq('user_id',CURRENT_USER.id).eq('is_correct',true);$('tipsCount').textContent=(t||0)+' leídos';$('quizCount').textContent=(q||0)+' resueltos';}
async function openTips(){
  $('learnMenu').hidden=true;$('tipsView').hidden=false;
  const{data:tips}=await db.from('tips').select('*').order('sort_order');
  const{data:reads}=await db.from('tip_reads').select('tip_id').eq('user_id',CURRENT_USER.id);
  const readIds=new Set((reads||[]).map(r=>r.tip_id));
  updateDailyBar(5-(tips||[]).filter(t=>!readIds.has(t.id)).slice(0,5).length);
  const cats={};(tips||[]).forEach(t=>{(cats[t.category]=cats[t.category]||[]).push(t);});
  let html='';Object.keys(cats).forEach(cat=>{html+='<div class="cat-title">'+cat+'</div>';cats[cat].forEach(t=>{html+='<div class="tip '+(readIds.has(t.id)?'read':'')+'" id="tip-'+t.id+'"><div class="tip-head" onclick="toggleTip('+t.id+')"><h4>'+t.title+'</h4><span>+</span></div><div class="tip-body">'+t.content+'</div></div>';});});
  $('tipsList').innerHTML=html;
}
async function toggleTip(id){const el=$('tip-'+id);el.classList.toggle('open');if(el.classList.contains('open')&&!el.classList.contains('read')){const{error}=await db.from('tip_reads').insert({user_id:CURRENT_USER.id,tip_id:id});if(!error){el.classList.add('read');await addPoints(2);refreshLearnCounters();bumpDaily();}}}
function updateDailyBar(n){dailyRead=n;renderDaily();}
function bumpDaily(){if(dailyRead<5){dailyRead++;renderDaily();}}
function renderDaily(){const f=$('dailyFill'),l=$('dailyLabel');if(f)f.style.width=(dailyRead/5*100)+'%';if(l)l.textContent=dailyRead+'/5 leídos';}
async function openQuizzes(){
  $('learnMenu').hidden=true;$('quizzesView').hidden=false;
  const{data:quizzes}=await db.from('quizzes').select('*');
  const{data:answered}=await db.from('quiz_answers').select('quiz_id').eq('user_id',CURRENT_USER.id);
  const done=new Set((answered||[]).map(a=>a.quiz_id));const pend=(quizzes||[]).filter(q=>!done.has(q.id));
  const box=$('quizzesList');
  if(!pend.length){box.innerHTML='<div class="card">¡Completaste todos los quizzes! 🎓</div>';return;}
  box.innerHTML=pend.map(q=>'<div class="card" id="quiz-'+q.id+'"><h4 style="font-weight:700;margin-bottom:8px">'+q.question+'</h4>'+q.options.map((o,i)=>'<button class="quiz-opt" onclick="answerQuiz('+q.id+','+i+','+q.correct_index+',this)">'+o+'</button>').join('')+'<div class="quiz-feedback" id="qf-'+q.id+'" hidden></div></div>').join('');
}
async function answerQuiz(qid,chosen,correct,btn){
  const card=$('quiz-'+qid),opts=card.querySelectorAll('.quiz-opt');opts.forEach(o=>o.disabled=true);
  const ok=chosen===correct;opts[correct].classList.add('correct');if(!ok)btn.classList.add('wrong');
  const{error}=await db.from('quiz_answers').insert({user_id:CURRENT_USER.id,quiz_id:qid,is_correct:ok});
  const{data:q}=await db.from('quizzes').select('tip').eq('id',qid).single();
  const fb=$('qf-'+qid);fb.hidden=false;
  if(ok&&!error){await addPoints(5);fb.innerHTML='✅ <b>¡Correcto! +5 pts</b><br>'+((q&&q.tip)||'');refreshLearnCounters();}
  else{fb.innerHTML='❌ <b>Incorrecto.</b><br>'+((q&&q.tip)||'');}
}
function renderProgress(){
  if(!PROFILE)return;const box=$('progressBox');if(!box)return;
  const pts=PROFILE.points||0,cur=LEVELS.filter(l=>pts>=l.min).pop(),next=LEVELS.find(l=>l.min>pts);
  const pct=next?Math.min(100,(pts-cur.min)/(next.min-cur.min)*100):100;
  box.innerHTML='<div class="card"><div class="level-name">'+cur.name+'</div><div class="small">'+pts+' puntos</div><div class="bar"><div class="fill" style="width:'+pct+'%"></div></div>'+(next?'<div class="small">Faltan <b>'+(next.min-pts)+' pts</b> para '+next.name+'</div>':'<div class="small">¡Nivel máximo alcanzado! 🏆</div>')+'<div class="stats"><div class="stat"><b id="stReports">-</b><span>Reportes</span></div><div class="stat"><b id="stTips">-</b><span>Tips leídos</span></div><div class="stat"><b id="stReviews">-</b><span>Revisiones</span></div></div></div>';
  loadStats();
}
async function loadStats(){
  const{count:r}=await db.from('reports').select('*',{count:'exact',head:true}).eq('user_id',CURRENT_USER.id);
  const{count:t}=await db.from('tip_reads').select('*',{count:'exact',head:true}).eq('user_id',CURRENT_USER.id);
  const{count:rv}=await db.from('report_reviews').select('*',{count:'exact',head:true}).eq('reviewer_id',CURRENT_USER.id);
  const set=(id,v)=>{const e=$(id);if(e)e.textContent=v||0;};
  set('stReports',r);set('stTips',t);set('stReviews',rv);
}
async function loadLeaderboard(){
  const{data}=await db.from('profiles').select('username,points,city').order('points',{ascending:false}).limit(10);
  const box=$('leaderboard');if(!box)return;if(!data){box.innerHTML='';return;}
  box.innerHTML=data.map((u,i)=>'<div class="card lb-item '+(u.username===PROFILE.username?'me':'')+'"><span class="lb-pos">'+(i+1)+'</span><span style="flex:1">'+u.username+'</span><b>'+u.points+' pts</b></div>').join('');
}
function openModal(){$('modal').hidden=false;}
function closeModal(){$('modal').hidden=true;}
function setModal(html){$('modalContent').innerHTML=html;}

$('btnRegister').addEventListener('click',register);
$('btnLogin').addEventListener('click',login);
$('modalClose').addEventListener('click',closeModal);
$('cardTips').addEventListener('click',openTips);
$('cardQuizzes').addEventListener('click',openQuizzes);
document.querySelectorAll('.backLearn').forEach(b=>b.addEventListener('click',backToLearn));
document.querySelectorAll('.nav-btn').forEach(b=>b.addEventListener('click',()=>nav(b.dataset.view)));
