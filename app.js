/* =====================================================================
   SENDIX — app.js (comentado)
   ---------------------------------------------------------------------
   - SPA sin framework: rutas por hash, estado en LocalStorage
   - Roles: empresa, transportista, sendix (nexo)
   - Módulos: navegación, auth, empresa, transportista, sendix, chat, tracking
   - Cada función tiene responsabilidad única y renderiza su vista
   ===================================================================== */
// Nexo + Chat 3 partes + Tracking global por envío (LocalStorage, flujo: SENDIX filtra -> Empresa selecciona)
const routes = ['login','home','publicar','mis-cargas','ofertas','mis-postulaciones','mis-envios','moderacion','conversaciones','resumen','chat','tracking'];
const SHIP_STEPS = ['pendiente','en-carga','en-camino','entregado'];

const state = {
  user: JSON.parse(localStorage.getItem('sendix.user') || 'null'),
  loads: JSON.parse(localStorage.getItem('sendix.loads') || '[]'),
  proposals: JSON.parse(localStorage.getItem('sendix.proposals') || '[]'), // {id, loadId, carrier, vehicle, price, status, shipStatus}
  messages: JSON.parse(localStorage.getItem('sendix.messages') || '[]'),   // {threadId, from, role, text, ts}
  trackingStep: localStorage.getItem('sendix.step') || 'pendiente',
  activeThread: null,
  activeShipmentProposalId: null,
  reads: JSON.parse(localStorage.getItem('sendix.reads') || '{}'), // { threadId: { [userName]: lastTs } }
};

function save(){
  localStorage.setItem('sendix.user', JSON.stringify(state.user));
  localStorage.setItem('sendix.reads', JSON.stringify(state.reads));
  localStorage.setItem('sendix.loads', JSON.stringify(state.loads));
  localStorage.setItem('sendix.proposals', JSON.stringify(state.proposals));
  localStorage.setItem('sendix.messages', JSON.stringify(state.messages));
  localStorage.setItem('sendix.step', state.trackingStep);
}

function genId(){ return Math.random().toString(36).slice(2,10); }
function threadIdFor(p){ return `${p.loadId}__${p.carrier}`; }

function computeUnread(threadId){
  const last = (state.reads[threadId] && state.reads[threadId][state.user?.name]) || 0;
  return state.messages.filter(m=>m.threadId===threadId && m.ts>last && m.from!==state.user?.name).length;
}
function unreadBadge(threadId){
  const u = computeUnread(threadId);
  return u ? `<span class="badge-pill">${u}</span>` : '';
}
function markThreadRead(threadId){
  if(!threadId) return;
  if(!state.reads[threadId]) state.reads[threadId] = {};
  state.reads[threadId][state.user?.name] = Date.now();
  save();
}

// Thread helpers by role
function threadsForCurrentUser(){
  if(!state.user) return [];
  if(state.user.role==='sendix'){
    return state.proposals.filter(p=>p.status==='approved');
  }
  if(state.user.role==='empresa'){
    const myLoadIds = state.loads.filter(l=>l.owner===state.user.name).map(l=>l.id);
    return state.proposals.filter(p=>myLoadIds.includes(p.loadId) && p.status==='approved');
  }
  if(state.user.role==='transportista'){
    return state.proposals.filter(p=>p.carrier===state.user.name && p.status==='approved');
  }
  return [];
}

// NAV
function navigate(route){
  if(route==='chat') route='conversaciones';
  if(!routes.includes(route)) route='login';
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelector(`[data-route="${route}"]`).classList.add('active');
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll(`.bottombar.visible .tab[data-nav="${route}"]`).forEach(t=>t.classList.add('active'));
  if(route!=='login') location.hash = route;

  if(route==='home') renderHome();
  if(route==='publicar'){ try{ requireRole('empresa'); renderLoads(true); }catch(e){} }
  if(route==='mis-cargas'){ try{ requireRole('empresa'); renderMyLoadsWithProposals(); }catch(e){} }
  if(route==='ofertas'){ try{ requireRole('transportista'); renderOffers(); }catch(e){} }
  if(route==='mis-postulaciones'){ try{ requireRole('transportista'); renderMyProposals(); }catch(e){} }
  if(route==='mis-envios'){ try{ requireRole('transportista'); renderShipments(); }catch(e){} }
  if(route==='moderacion'){ try{ requireRole('sendix'); renderInbox(); }catch(e){} }
  if(route==='conversaciones'){ renderThreads(); renderChat(); }
  if(route==='resumen'){ try{ requireRole('sendix'); renderMetrics(); }catch(e){} }
  if(route==='tracking') renderTracking();
}
function initNav(){
  document.querySelectorAll('[data-nav]').forEach(el=>el.addEventListener('click', ()=>navigate(el.dataset.nav)));
  document.getElementById('btn-start')?.addEventListener('click', ()=>{
    const r = state.user?.role==='empresa' ? 'publicar' : state.user?.role==='transportista' ? 'ofertas' : state.user?.role==='sendix' ? 'moderacion' : 'login';
    navigate(r);
  });
  window.addEventListener('hashchange', ()=>navigate(location.hash.replace('#','')||'login'));
}
function requireRole(role){
  if(!state.user || state.user.role!==role){
    alert('Necesitás el rol adecuado para esta sección.');
    navigate('login');
    throw new Error('role required');
  }
}

// AUTH
function initLogin(){
  const form = document.getElementById('login-form');
  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    state.user = { name: data.name.trim(), role: data.role };
    save(); updateChrome(); navigate('home');
  });
}
function updateChrome(){
  const badge = document.getElementById('user-badge');
  if(state.user){
    badge.innerHTML = `<span class="badge">${state.user.name} · ${state.user.role}</span> <button class="btn btn-ghost" id="logout">Salir</button>`;
  } else badge.textContent='';
  document.getElementById('logout')?.addEventListener('click', ()=>{ state.user=null; save(); updateChrome(); navigate('login'); });
  document.getElementById('nav-empresa').classList.toggle('visible', state.user?.role==='empresa');
  document.getElementById('nav-transportista').classList.toggle('visible', state.user?.role==='transportista');
  document.getElementById('nav-sendix').classList.toggle('visible', state.user?.role==='sendix');
}

// EMPRESA
function addLoad(load){
  const id = genId();
  state.loads.unshift({ ...load, id, owner: state.user.name, createdAt: new Date().toISOString() });
  save();
}
function renderLoads(onlyMine=false){
  const ul = document.getElementById('loads-list');
  const data = onlyMine ? state.loads.filter(l=>l.owner===state.user?.name) : state.loads;
  ul.innerHTML = data.length ? data.map(l=>`
    <li>
      <div class="row"><strong>${l.origen} ➜ ${l.destino}</strong><span>${new Date(l.createdAt).toLocaleDateString()}</span></div>
      <div class="muted">Tipo: ${l.tipo} · Tamaño: ${l.tamano||'-'} · Fecha: ${l.fecha} · Por: ${l.owner}</div>
      <div class="row"><button class="btn btn-ghost" data-view="${l.id}">Ver propuestas</button></div>
    </li>`).join('') : '<li class="muted">No hay cargas.</li>';
  ul.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click', ()=>{ navigate('mis-cargas'); renderMyLoadsWithProposals(b.dataset.view); }));
}
function initPublishForm(){
  const form = document.getElementById('publish-form');
  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    if(state.user?.role!=='empresa'){ alert('Ingresá como Empresa.'); return; }
    const data = Object.fromEntries(new FormData(form).entries());
    addLoad(data); form.reset(); alert('¡Publicada! Esperá postulaciones que Sendix moderará.'); navigate('mis-cargas');
  });
}
function renderMyLoadsWithProposals(focus){
  const ul = document.getElementById('my-loads-with-proposals');
  const mine = state.loads.filter(l=>l.owner===state.user?.name);
  ul.innerHTML = mine.length ? mine.map(l=>{
    const filtered = state.proposals.filter(p=>p.loadId===l.id && p.status==='filtered');
    const block = filtered.length ? filtered.map(p=>{
      const threadId = threadIdFor(p);
      const lastMsg = [...state.messages].reverse().find(m=>m.threadId===threadId);
      return `<li class="row">
        <div><strong>${p.carrier}</strong> <span class="muted">(${p.vehicle})</span></div>
        <div class="row">
          <span class="badge">Filtrada por SENDIX</span>
          <strong>$${p.price.toLocaleString('es-AR')}</strong>
          <button class="btn btn-primary" data-select-win="${p.id}">Seleccionar</button>
        </div>
        <div class="muted" style="flex-basis:100%">${lastMsg ? 'Último: '+new Date(lastMsg.ts).toLocaleString()+' · '+lastMsg.from+': '+lastMsg.text : 'Aún sin chat (se habilita al seleccionar).'}</div>
      </li>`;
    }).join('') : '<li class="muted">Sin propuestas filtradas por SENDIX aún.</li>';
    return `<li id="load-${l.id}">
      <div class="row"><strong>${l.origen} ➜ ${l.destino}</strong><span>${new Date(l.createdAt).toLocaleDateString()}</span></div>
      <div class="muted">Tipo: ${l.tipo} · Tamaño: ${l.tamano||'-'} · Fecha: ${l.fecha}</div>
      <div class="mt"><strong>Propuestas filtradas por SENDIX</strong></div>
      <ul class="list">`+block+`</ul></li>`;
  }).join('') : '<li class="muted">No publicaste cargas.</li>';
  if(focus) document.getElementById('load-'+focus)?.scrollIntoView({behavior:'smooth'});
  ul.querySelectorAll('[data-select-win]')?.forEach(b=>b.addEventListener('click', ()=>{
    const id = b.dataset.selectWin;
    const winner = state.proposals.find(x=>x.id===id);
    if(!winner) return;
    // Approve winner, reject others for same load
    state.proposals.forEach(pp=>{
      if(pp.loadId===winner.loadId){
        if(pp.id===winner.id){ pp.status='approved'; pp.shipStatus = pp.shipStatus || 'pendiente'; }
        else if(pp.status!=='approved'){ pp.status='rejected'; }
      }
    });
    save();
    alert('Propuesta seleccionada. Se habilitó chat y tracking del envío.');
    openChatByProposalId(winner.id);
  }));
}

// TRANSPORTISTA
function renderOffers(){
  const ul = document.getElementById('offers-list');
  // Excluir mis propias cargas y las que ya tienen una propuesta aprobada
  const approvedByLoad = new Set(state.proposals.filter(p=>p.status==='approved').map(p=>p.loadId));
  const offers = state.loads.filter(l=>l.owner!==state.user?.name && !approvedByLoad.has(l.id));

  ul.innerHTML = offers.length
    ? offers.map(l=>{
        const alreadyApplied = state.proposals.some(p=>p.loadId===l.id && p.carrier===state.user?.name);
        const formHtml = alreadyApplied
          ? `<div class="row"><span class="badge">Ya te postulaste</span></div>`
          : `<form class="row" data-apply="${l.id}">
               <input name="vehicle" placeholder="Vehículo" required autocomplete="off"/>
               <input name="price" type="number" min="0" step="100" placeholder="Precio (ARS)" required autocomplete="off"/>
               <button class="btn btn-primary">Postularse</button>
             </form>`;
        return `<li>
          <div class="row">
            <strong>${l.origen} ➜ ${l.destino}</strong>
            <span>${new Date(l.createdAt).toLocaleDateString()}</span>
          </div>
          <div class="muted">Tipo: ${l.tipo} · Tamaño: ${l.tamano||'-'} · Fecha: ${l.fecha} · Empresa: ${l.owner}</div>
          ${formHtml}
        </li>`;
      }).join('')
    : '<li class="muted">No hay ofertas (o ya fueron adjudicadas).</li>';

  ul.querySelectorAll('[data-apply]').forEach(form=>form.addEventListener('submit', e=>{
    e.preventDefault();
    const id = form.dataset.apply;
    const alreadyApplied = state.proposals.some(p=>p.loadId===id && p.carrier===state.user?.name);
    const hasApproved = state.proposals.some(p=>p.loadId===id && p.status==='approved');
    if(hasApproved){ alert('Esta carga ya fue adjudicada.'); renderOffers(); return; }
    if(alreadyApplied){ alert('Solo podés postularte una vez a cada carga.'); renderOffers(); return; }
    const data = Object.fromEntries(new FormData(form).entries());
    state.proposals.unshift({
      id: genId(), loadId:id, carrier: state.user.name,
      vehicle: data.vehicle, price: Number(data.price),
      status: 'pending', shipStatus: 'pendiente', createdAt: new Date().toISOString()
    });
    save(); alert('¡Postulación enviada! Queda en revisión por SENDIX.'); renderOffers();
  }));
}
function renderMyProposals(){
  const ul = document.getElementById('my-proposals');
  const mine = state.proposals.filter(p=>p.carrier===state.user?.name);
  ul.innerHTML = mine.length ? mine.map(p=>{
    const l = state.loads.find(x=>x.id===p.loadId);
    const badge = p.status==='approved' ? 'Aprobada' : p.status==='rejected' ? 'Rechazada' : p.status==='filtered' ? 'Filtrada' : 'En revisión';
    const canChat = p.status==='approved';
    return `<li class="row">
      <div>
        <div><strong>${l?.origen} ➜ ${l?.destino}</strong></div>
        <div class="muted">Para: ${l?.owner} · ${l?.tipo} · Tamaño: ${l?.tamano||'-'} · ${l?.fecha}</div>
      </div>
      <div class="row">
        <span class="badge">${badge}</span>
        <strong>$${p.price.toLocaleString('es-AR')}</strong>
        ${canChat ? `<button class="btn" data-chat="${p.id}">Chat</button>` : ''}
      </div>
    </li>`;
  }).join('') : '<li class="muted">Sin postulaciones.</li>';
  ul.querySelectorAll('[data-chat]').forEach(b=>b.addEventListener('click', ()=>openChatByProposalId(b.dataset.chat)));
}

// Envíos del transportista (tracking por envío)
function renderShipments(){
  const ul = document.getElementById('shipments');
  const mine = state.proposals.filter(p=>p.carrier===state.user?.name && p.status==='approved');
  ul.innerHTML = mine.length ? mine.map(p=>{
    const l = state.loads.find(x=>x.id===p.loadId);
    return `<li>
      <div class="row">
        <strong>${l?.origen} ➜ ${l?.destino}</strong>
        <span class="badge">${p.shipStatus||'pendiente'}</span>
      </div>
      <div class="muted">Cliente: ${l?.owner} · ${l?.tipo} · Tamaño: ${l?.tamano||'-'} · ${l?.fecha} · Precio: $${p.price.toLocaleString('es-AR')}</div>
      <div class="row">
        <select data-ship="${p.id}">
          ${SHIP_STEPS.map(s=>`<option value="${s}" ${s===(p.shipStatus||'pendiente')?'selected':''}>${s}</option>`).join('')}
        </select>
        <button class="btn" data-save-ship="${p.id}">Actualizar estado</button>
        <button class="btn" data-chat="${p.id}">Abrir chat ${unreadBadge(threadIdFor(p))}</button>
      </div>
    </li>`;
  }).join('') : '<li class="muted">No tenés envíos aprobados aún.</li>';
  ul.querySelectorAll('[data-save-ship]').forEach(b=>b.addEventListener('click', ()=>{
    const id = b.dataset.saveShip;
    const sel = document.querySelector(`select[data-ship="${id}"]`);
    const p = state.proposals.find(x=>x.id===id);
    if(p){ p.shipStatus = sel.value; save(); renderShipments(); alert('Estado actualizado'); }
  }));
  ul.querySelectorAll('[data-chat]').forEach(b=>b.addEventListener('click', ()=>openChatByProposalId(b.dataset.chat)));
}

// SENDIX: Moderación (filtrar) + acceso a chat de aprobados (cuando la empresa elija)
function renderInbox(){
  const ul = document.getElementById('inbox');
  const pending = state.proposals.filter(p=>p.status==='pending');
  const filteredList = state.proposals.filter(p=>p.status==='filtered');
  ul.innerHTML = `<h3>Pendientes</h3>` + (pending.length ? pending.map(p=>{
    const l = state.loads.find(x=>x.id===p.loadId);
    return `<li>
      <div class="row"><strong>${p.carrier}</strong> <span class="muted">(${p.vehicle})</span> <strong>$${p.price.toLocaleString('es-AR')}</strong></div>
      <div class="muted">Carga: ${l?.origen} ➜ ${l?.destino} · ${l?.tipo} · Tamaño: ${l?.tamano||'-'} · ${l?.fecha} · Empresa: ${l?.owner}</div>
      <div class="actions">
        <button class="btn btn-primary" data-filter="${p.id}">Filtrar</button>
        <button class="btn" data-reject="${p.id}">Rechazar</button>
      </div>
    </li>`;
  }).join('') : '<li class="muted">No hay propuestas pendientes.</li>');
  ul.innerHTML += `<h3 class='mt'>Filtradas por SENDIX</h3>` + (filteredList.length ? filteredList.map(p=>{
    const l = state.loads.find(x=>x.id===p.loadId);
    return `<li>
      <div class="row"><strong>${p.carrier}</strong> <span class="muted">(${p.vehicle})</span> <strong>$${p.price.toLocaleString('es-AR')}</strong></div>
      <div class="muted">Carga: ${l?.origen} ➜ ${l?.destino} · ${l?.tipo} · Tamaño: ${l?.tamano||'-'} · ${l?.fecha} · Empresa: ${l?.owner}</div>
      <div class="actions">
        <span class="badge">Filtrada</span>
        <button class="btn" data-unfilter="${p.id}">Quitar filtro</button>
      </div>
    </li>`;
  }).join('') : '<li class="muted">No hay propuestas filtradas.</li>');

  ul.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click', ()=>{
    const id = b.dataset.filter;
    const p = state.proposals.find(x=>x.id===id);
    if(p){ p.status='filtered'; save(); renderInbox(); alert('Marcada como FILTRADA. La empresa decidirá.'); }
  }));
  ul.querySelectorAll('[data-unfilter]').forEach(b=>b.addEventListener('click', ()=>{
    const id=b.dataset.unfilter; const p=state.proposals.find(x=>x.id===id);
    if(p){ p.status='pending'; save(); renderInbox(); }
  }));
  ul.querySelectorAll('[data-reject]').forEach(b=>b.addEventListener('click', ()=>{
    const id = b.dataset.reject; const p = state.proposals.find(x=>x.id===id);
    if(p){ p.status='rejected'; save(); renderInbox(); }
  }));
}

// SENDIX/Empresa/Transportista: lista de chats aprobados
function renderThreads(){
  const navBadge = document.getElementById('nav-unread');
  const myThreads = threadsForCurrentUser();
  const totalUnread = myThreads.map(p=>computeUnread(threadIdFor(p))).reduce((a,b)=>a+b,0);
  if(navBadge){ navBadge.style.display = totalUnread? 'inline-block':'none'; navBadge.textContent = totalUnread; }
  const ul = document.getElementById('threads');
  const q = (document.getElementById('chat-search')?.value||'').toLowerCase();
  const items = myThreads.map(p=>{
    const l = state.loads.find(x=>x.id===p.loadId);
    const title = `${l?.origen} → ${l?.destino}`;
    const sub = `Emp: ${l?.owner} · Transp: ${p.carrier} · Tam: ${l?.tamano||'-'}`;
    const unread = computeUnread(threadIdFor(p));
    const match = (title+' '+sub).toLowerCase().includes(q);
    return {p, l, title, sub, unread, match};
  }).filter(x=>x.match);
  ul.innerHTML = items.length ? items.map(({p, l, title, sub, unread})=>`
    <li class="thread-item" data-chat="${p.id}">
      <div class="avatar">${(l?.owner||'?')[0]||'?'}</div>
      <div>
        <div class="thread-title">${title}</div>
        <div class="thread-sub">${sub} · ${p.shipStatus||'pendiente'}</div>
      </div>
      <div class="thread-badge">${unread?`<span class="badge-pill">${unread}</span>`:''}</div>
    </li>
  `).join('') : '<li class="muted" style="padding:12px">Sin conversaciones</li>';
  ul.querySelectorAll('[data-chat]').forEach(li=>li.addEventListener('click', ()=>openChatByProposalId(li.dataset.chat)));
  document.getElementById('chat-search')?.addEventListener('input', ()=>renderThreads());
}

// Resumen métricas (demo)
function renderMetrics(){
  const tLoads = state.loads.length;
  const tProps = state.proposals.length;
  const approved = state.proposals.filter(p=>p.status==='approved').length;
  const rejected = state.proposals.filter(p=>p.status==='rejected').length;
  const pending = state.proposals.filter(p=>p.status==='pending').length;
  const filtered = state.proposals.filter(p=>p.status==='filtered').length;
  document.getElementById('m-total-loads').textContent = tLoads;
  document.getElementById('m-total-proposals').textContent = tProps;
  document.getElementById('m-approved').textContent = approved;
  document.getElementById('m-rejected').textContent = rejected;
  document.getElementById('m-pending').textContent = pending;
  document.getElementById('m-filtered').textContent = filtered;
}

// Chat (mediación) — por hilo (loadId + carrier) con SENDIX como 3er participante
function openChatByProposalId(propId){
  const p = state.proposals.find(x=>x.id===propId);
  state.activeThread = p ? threadIdFor(p) : null;
  save();
  navigate('conversaciones');
  if(state.activeThread) markThreadRead(state.activeThread);
  renderThreads();
  renderChat();
}
function renderChat(){
  const box = document.getElementById('chat-box');
  const topic = document.getElementById('chat-topic');
  const title = document.getElementById('chat-title');
  if(!state.activeThread){ box.innerHTML = '<div class="muted">Elegí una conversación.</div>'; title.textContent='Elegí una conversación'; topic.textContent=''; return; }
  const p = state.proposals.find(x=>threadIdFor(x)===state.activeThread);
  if(!p){ box.innerHTML='<div class="muted">Conversación no disponible.</div>'; return; }
  const l = state.loads.find(x=>x.id===p.loadId);
  title.textContent = `${l.origen} → ${l.destino}`;
  topic.textContent = `Empresa: ${l.owner} · Transportista: ${p.carrier} · Tamaño: ${l.tamano||'-'} · Nexo: SENDIX`;
  const msgs = state.messages.filter(m=>m.threadId===state.activeThread).sort((a,b)=>a.ts-b.ts);
  box.innerHTML = msgs.map(m=>`<div class="bubble ${m.from===state.user?.name?'me':'other'}"><strong>${m.from} (${m.role})</strong><br>${m.text}<br><span class="muted" style="font-size:11px">${new Date(m.ts).toLocaleString()}</span></div>`).join('') || '<div class="muted">Sin mensajes aún.</div>';
  box.scrollTop = box.scrollHeight;
  markThreadRead(state.activeThread);
  const form = document.getElementById('chat-form');
  form.onsubmit = (e)=>{
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if(!data.message.trim()) return;
    state.messages.push({ threadId: state.activeThread, from: state.user.name, role: state.user.role, text: data.message.trim(), ts: Date.now() });
    save();
    form.reset();
    renderChat(); markThreadRead(state.activeThread); renderThreads();
  };
  document.getElementById('open-related-tracking').onclick = ()=>{
    state.activeShipmentProposalId = p.id;
    navigate('tracking');
  };
}

function setTruckPositionByStep(step){
  const idx = SHIP_STEPS.indexOf(step);
  const pct = idx <= 0 ? 0 : idx >= SHIP_STEPS.length-1 ? 100 : (idx/(SHIP_STEPS.length-1))*100;
  const truck = document.getElementById('truck');
  if(truck){
    truck.classList.add('moving');
    truck.style.left = pct + '%';
    setTimeout(()=>truck.classList.remove('moving'), 700);
  }
}
function updateTrackingDots(step){
  const idx = SHIP_STEPS.indexOf(step);
  document.querySelectorAll('.dot').forEach(d=>d.classList.remove('active'));
  document.querySelectorAll('.dot').forEach(d=>{
    const s = d.getAttribute('data-step');
    if (SHIP_STEPS.indexOf(s) <= idx) d.classList.add('active');
  });
}

// Tracking global por envío
function renderTracking(){
  const select = document.getElementById('tracking-shipment-select');
  const hint = document.getElementById('tracking-role-hint');
  const actions = document.getElementById('tracking-actions');
  const onlyActive = document.getElementById('tracking-only-active');
  const search = document.getElementById('tracking-search');

  let options = [];
  if(state.user?.role==='transportista'){
    options = state.proposals.filter(p=>p.carrier===state.user.name && p.status==='approved');
    hint.textContent = options.length ? 'Podés actualizar el estado del envío seleccionado.' : 'No tenés envíos aprobados.';
  } else if(state.user?.role==='empresa'){
    const myLoadIds = state.loads.filter(l=>l.owner===state.user.name).map(l=>l.id);
    options = state.proposals.filter(p=>myLoadIds.includes(p.loadId) && p.status==='approved');
    hint.textContent = options.length ? 'Vista de estado. Solo lectura.' : 'No hay envíos aprobados aún.';
  } else if(state.user?.role==='sendix'){
    options = state.proposals.filter(p=>p.status==='approved');
    hint.textContent = options.length ? 'Vista de nexo. Solo lectura.' : 'No hay envíos aprobados.';
  }

  const activeFilter = (p)=> (p.shipStatus||'pendiente') !== 'entregado';
  let filtered = options.filter(p => onlyActive?.checked ? activeFilter(p) : true);

  const q = (search?.value||'').toLowerCase();
  if(q){
    filtered = filtered.filter(p=>{
      const l = state.loads.find(x=>x.id===p.loadId);
      const text = `${l?.origen||''} ${l?.destino||''} ${p.carrier||''} ${l?.owner||''}`.toLowerCase();
      return text.includes(q);
    });
  }

  if(!filtered.length){
    state.activeShipmentProposalId = null;
  } else if(!state.activeShipmentProposalId || !filtered.find(p=>p.id===state.activeShipmentProposalId)){
    state.activeShipmentProposalId = filtered[0].id;
  }

  select.innerHTML = filtered.map(p=>{
    const l = state.loads.find(x=>x.id===p.loadId);
    return `<option value="${p.id}" ${state.activeShipmentProposalId===p.id?'selected':''}>${l?.origen} → ${l?.destino} · ${p.carrier} · ${p.shipStatus||'pendiente'}</option>`;
  }).join('');

  const ul = document.getElementById('tracking-list');
  ul.innerHTML = filtered.length ? filtered.map(p=>{
    const l = state.loads.find(x=>x.id===p.loadId);
    const threadId = threadIdFor(p);
    const unread = computeUnread(threadId);
    return `<li class="row">
      <div>
        <div><strong>${l?.origen} → ${l?.destino}</strong> · <span class="badge">${p.shipStatus||'pendiente'}</span></div>
        <div class="muted">Emp: ${l?.owner} · Transp: ${p.carrier} · Tamaño: ${l?.tamano||'-'}</div>
      </div>
      <div class="row">
        <button class="btn" data-select="${p.id}">Ver</button>
        <button class="btn" data-chat="${p.id}">Chat ${unread?`<span class='badge-pill'>${unread}</span>`:''}</button>
      </div>
    </li>`;
  }).join('') : '<li class="muted">No hay envíos para mostrar.</li>';
  ul.querySelectorAll('[data-select]').forEach(b=>b.addEventListener('click', ()=>{ state.activeShipmentProposalId = b.dataset.select; save(); renderTracking(); }));
  ul.querySelectorAll('[data-chat]').forEach(b=>b.addEventListener('click', ()=>openChatByProposalId(b.dataset.chat)));

  const current = state.proposals.find(p=>p.id===state.activeShipmentProposalId);
  const shipStep = current?.shipStatus || 'pendiente';
  updateTrackingDots(shipStep); setTruckPositionByStep(shipStep);

  const canEdit = state.user?.role==='transportista' && !!current && current.carrier===state.user.name;
  if(actions) actions.style.display = canEdit ? 'flex' : 'none';

  document.querySelector('[data-advance]').onclick = ()=>{
    if(!current) return;
    const idx = SHIP_STEPS.indexOf(current.shipStatus||'pendiente');
    current.shipStatus = SHIP_STEPS[Math.min(idx+1, SHIP_STEPS.length-1)];
    state.trackingStep = current.shipStatus;
    save(); renderTracking();
  };
  document.querySelector('[data-reset]').onclick = ()=>{
    if(!current) return;
    current.shipStatus = 'pendiente';
    state.trackingStep = current.shipStatus;
    save(); renderTracking();
  };
  document.getElementById('tracking-open-chat').onclick = ()=>{ if(current) openChatByProposalId(current.id); };
  select.onchange = ()=>{ state.activeShipmentProposalId = select.value; const cur = state.proposals.find(p=>p.id===state.activeShipmentProposalId); state.trackingStep = cur?.shipStatus || 'pendiente'; save(); renderTracking(); };
  onlyActive?.addEventListener('change', ()=>renderTracking());
  search?.addEventListener('input', ()=>renderTracking());
}

// Home visibility by role
function renderHome(){
  const navBadge = document.getElementById('nav-unread');
  if(state.user?.role==='sendix' && navBadge){ const totalUnread = state.proposals.filter(p=>p.status==='approved').map(p=>computeUnread(threadIdFor(p))).reduce((a,b)=>a+b,0); navBadge.style.display = totalUnread? 'inline-block':'none'; navBadge.textContent = totalUnread; }
  document.getElementById('cards-empresa').style.display = state.user?.role==='empresa' ? 'grid' : 'none';
  document.getElementById('cards-transportista').style.display = state.user?.role==='transportista' ? 'grid' : 'none';
  document.getElementById('cards-sendix').style.display = state.user?.role==='sendix' ? 'grid' : 'none';
}

// Init
document.addEventListener('DOMContentLoaded', ()=>{
  initNav(); initLogin(); initPublishForm(); updateChrome();
  const start = state.user ? (location.hash.replace('#','')||'home') : 'login';
  navigate(start);
});
