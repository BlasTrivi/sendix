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

// Actualiza la variable CSS --bbar-h según la barra inferior visible
function updateBottomBarHeight(){
  try{
    const root = document.documentElement;
    const safeBottomRaw = getComputedStyle(root).getPropertyValue('--safe-bottom').trim();
    const safeBottom = parseFloat(safeBottomRaw || '0') || 0;
    const bar = document.querySelector('.bottombar.visible');
    let h = 0;
    if(bar){
      const rect = bar.getBoundingClientRect();
      h = Math.max(0, Math.round(rect.height - safeBottom));
    }
    // Guardrail: valores razonables (0-200px)
    if(!(h >= 0 && h <= 200)) h = 64;
    root.style.setProperty('--bbar-h', h + 'px');
  }catch(e){
    // Fallback silencioso (no bloquear la app)
  }
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
  // Marcar en body la ruta activa para estilos específicos (p.ej. conversaciones)
  document.body.classList.toggle('route-conversaciones', route==='conversaciones');
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
  // Permitir que las tarjetas del home sean clickeables en toda su superficie
  document.addEventListener('click', (e)=>{
    const target = e.target.closest('.card[data-nav]');
    if(target){
      // Evitar doble navegación si se hizo click en el botón interno
      if(e.target.closest('button')) return;
      navigate(target.dataset.nav);
    }
  });
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
  // Recalcular altura de la barra inferior cuando cambie la visibilidad por rol
  updateBottomBarHeight();
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
  const preview = document.getElementById('publish-preview');
  function updatePreview() {
    const data = Object.fromEntries(new FormData(form).entries());
    if(data.origen || data.destino || data.tipo || data.tamano || data.fecha) {
      preview.style.display = 'block';
      preview.innerHTML = `
        <strong>Resumen de carga:</strong><br>
        <span>📍 <b>Origen:</b> ${data.origen||'-'}</span><br>
        <span>🎯 <b>Destino:</b> ${data.destino||'-'}</span><br>
        <span>📦 <b>Tipo:</b> ${data.tipo||'-'}</span><br>
        <span>📏 <b>Tamaño:</b> ${data.tamano||'-'}</span><br>
        <span>📅 <b>Fecha:</b> ${data.fecha||'-'}</span>
      `;
    } else {
      preview.style.display = 'none';
      preview.innerHTML = '';
    }
  }
  form.addEventListener('input', updatePreview);
  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    if(state.user?.role!=='empresa'){ alert('Ingresá como Empresa.'); return; }
    const data = Object.fromEntries(new FormData(form).entries());
    addLoad(data);
    form.reset();
    updatePreview();
    alert('¡Publicada! Esperá postulaciones que Sendix moderará.');
    navigate('mis-cargas');
  });
  updatePreview();
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
    if(p){
      const prev = p.shipStatus || 'pendiente';
      const next = sel.value;
      p.shipStatus = next;
      save();
      if(next==='entregado' && prev!=='entregado'){
        notifyDelivered(p);
      }
      renderShipments();
      alert('Estado actualizado');
    }
  }));
  ul.querySelectorAll('[data-chat]').forEach(b=>b.addEventListener('click', ()=>openChatByProposalId(b.dataset.chat)));
}

// SENDIX: Moderación (filtrar) + acceso a chat de aprobados (cuando la empresa elija)
function renderInbox(){
  const ul = document.getElementById('inbox');
  // Solo propuestas que no han sido filtradas ni rechazadas
  const pending = state.proposals.filter(p=>p.status==='pending');
  // Propuestas que han sido filtradas por SENDIX y no han sido aprobadas ni rechazadas
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
    if(p && p.status==='pending'){ p.status='filtered'; save(); renderInbox(); alert('Marcada como FILTRADA. La empresa decidirá.'); }
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
  // Marcar todo como leído
  document.getElementById('mark-all-read')?.addEventListener('click', ()=>{
    threadsForCurrentUser().forEach(p=>markThreadRead(threadIdFor(p)));
    renderThreads();
  });
}

// Notificación al entregar: mensaje del sistema en el hilo para la empresa y resto de participantes
function notifyDelivered(proposal){
  const l = state.loads.find(x=>x.id===proposal.loadId);
  const threadId = threadIdFor(proposal);
  const text = `🚚 Entrega confirmada: ${l?.origen||''} → ${l?.destino||''} por ${proposal.carrier}.`;
  state.messages.push({ threadId, from: 'Sistema', role: 'sendix', text, ts: Date.now() });
  save();
  // Actualizar badges si el usuario está viendo conversaciones
  const currentRoute = location.hash.replace('#','')||'home';
  if(currentRoute==='conversaciones'){ renderThreads(); }
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
  const typing = document.getElementById('typing-indicator');
  const replyBar = document.getElementById('reply-bar');
  const replySnippet = document.getElementById('reply-snippet');
  const attachPreviews = document.getElementById('attach-previews');
  const contextMenu = document.getElementById('context-menu');
  const chatForm = document.getElementById('chat-form');
  if(!state.activeThread){
    box.innerHTML = '<div class="muted">Elegí una conversación.</div>';
    title.textContent='Elegí una conversación'; topic.textContent='';
    typing.style.display='none'; replyBar.style.display='none'; attachPreviews.style.display='none';
    chatForm.style.display='none';
    return;
  }
  chatForm.style.display='flex';
  const p = state.proposals.find(x=>threadIdFor(x)===state.activeThread);
  if(!p){ box.innerHTML='<div class="muted">Conversación no disponible.</div>'; return; }
  const l = state.loads.find(x=>x.id===p.loadId);
  title.textContent = `${l.origen} → ${l.destino}`;
  topic.textContent = `Empresa: ${l.owner} · Transportista: ${p.carrier} · Tamaño: ${l.tamano||'-'} · Nexo: SENDIX`;
  const msgs = state.messages.filter(m=>m.threadId===state.activeThread).sort((a,b)=>a.ts-b.ts);
  box.innerHTML = msgs.map(m=>{
    const reply = m.replyTo ? msgs.find(x=>x.ts===m.replyTo) : null;
    const replyHtml = reply ? `<div class="bubble-reply"><strong>${reply.from}</strong>: ${escapeHtml(reply.text).slice(0,120)}${reply.text.length>120?'…':''}</div>` : '';
    const atts = Array.isArray(m.attach)||m.attach? (m.attach||[]) : [];
    const attHtml = atts.length? `<div class="attachments">${atts.map(src=>`<img src="${src}" alt="adjunto"/>`).join('')}</div>` : '';
    return `<div class="bubble ${m.from===state.user?.name?'me':'other'}" data-ts="${m.ts}">
      ${replyHtml}
      <strong>${escapeHtml(m.from)} (${escapeHtml(m.role)})</strong><br>${linkify(escapeHtml(m.text))}
      ${attHtml}
      <br><span class="muted" style="font-size:11px">${new Date(m.ts).toLocaleString()}</span>
    </div>`;
  }).join('') || '<div class="muted">Sin mensajes aún.</div>';
  box.scrollTop = box.scrollHeight;
  markThreadRead(state.activeThread);
  const form = document.getElementById('chat-form');
  const ta = document.getElementById('chat-textarea');
  // Autosize textarea
  function autoresize(){ if(!ta) return; ta.style.height='auto'; ta.style.height = Math.min(160, Math.max(40, ta.scrollHeight)) + 'px'; }
  ta?.addEventListener('input', ()=>{ autoresize(); showTyping(); });
  autoresize();

  // Enviar con Enter, saltos con Shift+Enter
  ta?.addEventListener('keydown', (e)=>{
    if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); form.requestSubmit(); }
  });

  // (quick replies removidos)

  // Adjuntos
  const btnAttach = document.getElementById('btn-attach');
  const inputAttach = document.getElementById('file-attach');
  let tempAttach = [];
  btnAttach?.addEventListener('click', ()=> inputAttach?.click());
  inputAttach?.addEventListener('change', ()=>{
    const files = Array.from(inputAttach.files||[]);
    tempAttach = [];
    attachPreviews.innerHTML = '';
    files.slice(0,6).forEach(f=>{
      const url = URL.createObjectURL(f);
      tempAttach.push(url);
      const img = document.createElement('img');
      img.src = url; img.alt='adjunto';
      attachPreviews.appendChild(img);
    });
    attachPreviews.style.display = tempAttach.length? 'flex':'none';
  });

  // Reply a mensaje
  let replyToTs = null;
  function setReply(m){ replyToTs = m?.ts||null; if(replyToTs){ replyBar.style.display='flex'; replySnippet.textContent = m.text.slice(0,120); } else { replyBar.style.display='none'; replySnippet.textContent=''; } }
  document.getElementById('reply-cancel')?.addEventListener('click', ()=> setReply(null));
  // Menú contextual sobre mensajes
  box.querySelectorAll('.bubble')?.forEach(bub=>{
    bub.addEventListener('contextmenu', (e)=>{
      e.preventDefault();
      const ts = Number(bub.dataset.ts);
      const msg = msgs.find(x=>x.ts===ts);
      if(!msg) return;
      openContextMenu(e.pageX, e.pageY, msg);
    });
    // En móvil: long press
    let t; let startX=0; let startY=0; let swiped=false;
    const THRESH=56;
    bub.addEventListener('touchstart', (e)=>{
      swiped=false; startX=e.touches[0].clientX; startY=e.touches[0].clientY;
      t=setTimeout(()=>{ const ts=Number(bub.dataset.ts); const msg=msgs.find(x=>x.ts===ts); if(msg) openContextMenu(e.touches[0].pageX, e.touches[0].pageY, msg); }, 550);
    }, {passive:true});
    bub.addEventListener('touchmove', (e)=>{
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if(Math.abs(dy) > 30) { clearTimeout(t); return; }
      if(dx > 8 && !swiped){ bub.style.transform = `translateX(${Math.min(dx, THRESH)}px)`; }
      if(dx > THRESH && !swiped){
        swiped=true; clearTimeout(t);
        const ts=Number(bub.dataset.ts); const msg=msgs.find(x=>x.ts===ts); if(msg) setReply(msg);
        bub.style.transform = '';
      }
    }, {passive:true});
    bub.addEventListener('touchend', ()=>{ clearTimeout(t); bub.style.transform=''; });
  });

  function openContextMenu(x,y,msg){
    contextMenu.style.display='grid';
    contextMenu.style.left = x+'px';
    contextMenu.style.top = y+'px';
    const off = (ev)=>{ if(!contextMenu.contains(ev.target)) { contextMenu.style.display='none'; document.removeEventListener('click', off); } };
    document.addEventListener('click', off);
    contextMenu.querySelector('[data-action="reply"]').onclick = ()=>{ setReply(msg); contextMenu.style.display='none'; };
    contextMenu.querySelector('[data-action="copy"]').onclick = ()=>{ navigator.clipboard?.writeText(msg.text); contextMenu.style.display='none'; };
    contextMenu.querySelector('[data-action="delete"]').onclick = ()=>{
      // eliminar localmente (solo para mí): en demo, borramos del array
      const idx = state.messages.findIndex(m=>m.ts===msg.ts && m.threadId===state.activeThread);
      if(idx>=0){ state.messages.splice(idx,1); save(); renderChat(); }
      contextMenu.style.display='none';
    };
  }

  form.onsubmit = (e)=>{
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const text = String(data.message||'').trim();
    if(!text) return;
    const msg = { threadId: state.activeThread, from: state.user.name, role: state.user.role, text, ts: Date.now() };
    if(replyToTs) msg.replyTo = replyToTs;
    if(tempAttach.length) msg.attach = [...tempAttach];
    state.messages.push(msg);
    save();
    form.reset(); autoresize(); hideTyping(); setReply(null);
    tempAttach.splice(0); attachPreviews.innerHTML=''; attachPreviews.style.display='none'; inputAttach.value='';
    renderChat(); markThreadRead(state.activeThread); renderThreads();
  };
  document.getElementById('open-related-tracking').onclick = ()=>{
    state.activeShipmentProposalId = p.id;
    navigate('tracking');
  };
}

// Indicador de escritura (simulado local)
let typingTimeout;
function showTyping(){
  const el = document.getElementById('typing-indicator');
  if(!el) return;
  el.style.display = 'block';
  el.textContent = 'Escribiendo…';
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(hideTyping, 1200);
}
function hideTyping(){
  const el = document.getElementById('typing-indicator');
  if(!el) return;
  el.style.display = 'none';
}

// (limpieza) funciones de tracking antiguas removidas

// Tracking global por envío
function renderTracking(){
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

  const ul = document.getElementById('tracking-list');
  ul.innerHTML = filtered.length ? filtered.map(p=>{
    const l = state.loads.find(x=>x.id===p.loadId);
    const threadId = threadIdFor(p);
    const unread = computeUnread(threadId);
    const chipClass = (p.shipStatus==='entregado') ? 'ok' : (p.shipStatus==='en-camino'?'':'warn');
    return `<li>
      <div class="row">
        <div class="title">${l?.origen} → ${l?.destino}</div>
        <span class="chip ${chipClass}">${p.shipStatus||'pendiente'}</span>
      </div>
      <div class="row subtitle">
        <div>Emp: ${l?.owner} · Transp: ${p.carrier} · Tam: ${l?.tamano||'-'}</div>
        <div class="row" style="gap:8px">
          <button class="btn" data-select="${p.id}">Ver</button>
          <button class="btn" data-chat="${p.id}">Chat ${unread?`<span class='badge-pill'>${unread}</span>`:''}</button>
        </div>
      </div>
    </li>`;
  }).join('') : '<li class="muted">No hay envíos para mostrar.</li>';
  ul.querySelectorAll('[data-select]').forEach(b=>b.addEventListener('click', ()=>{ state.activeShipmentProposalId = b.dataset.select; save(); renderTracking(); }));
  ul.querySelectorAll('[data-chat]').forEach(b=>b.addEventListener('click', ()=>openChatByProposalId(b.dataset.chat)));

  // Tracking visual (SVG animado)
  const current = state.proposals.find(p=>p.id===state.activeShipmentProposalId);
  const mapBox = document.getElementById('tracking-map');
  if(mapBox){
    mapBox.innerHTML = '';
    if(current){
      const l = state.loads.find(x=>x.id===current.loadId);
      const stepNames = ['pendiente','en-carga','en-camino','entregado'];
      const idxTarget = stepNames.indexOf(current.shipStatus||'pendiente');
      // SVG con fondo tipo mapa y animación de camión
      mapBox.innerHTML = `
        <svg id="svg-tracking" viewBox="0 0 600 180" width="100%" height="180" style="background: linear-gradient(135deg,#eaf1f6 60%,#cfe5e8 100%); border-radius:16px;">
          <defs>
            <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="3" stdDeviation="2" flood-color="#0E2F44" flood-opacity=".25"/>
            </filter>
          </defs>
          <rect x="40" y="90" width="520" height="12" rx="6" fill="#d0e6f7" stroke="#b3cde0" />
          <polyline points="40,96 120,60 200,96 280,60 360,96 440,60 560,96" fill="none" stroke="#3AAFA9" stroke-width="4" stroke-dasharray="8 6" />
          <circle class="tracking-step ${idxTarget>0?'done':idxTarget===0?'active':''}" cx="40" cy="96" r="16" fill="#fff" stroke="#0E2F44" stroke-width="3" />
          <circle class="tracking-step ${idxTarget>1?'done':idxTarget===1?'active':''}" cx="200" cy="96" r="16" fill="#fff" stroke="#0E2F44" stroke-width="3" />
          <circle class="tracking-step ${idxTarget>2?'done':idxTarget===2?'active':''}" cx="360" cy="96" r="16" fill="#fff" stroke="#0E2F44" stroke-width="3" />
          <circle class="tracking-step ${idxTarget>3?'done':idxTarget===3?'active':''}" cx="560" cy="96" r="16" fill="#fff" stroke="#0E2F44" stroke-width="3" />
          <text x="40" y="140" text-anchor="middle" font-size="15" fill="#5A6C79">${l?.origen || 'Origen'}</text>
          <text x="200" y="140" text-anchor="middle" font-size="15" fill="#5A6C79">En carga</text>
          <text x="360" y="140" text-anchor="middle" font-size="15" fill="#5A6C79">En camino</text>
          <text x="560" y="140" text-anchor="middle" font-size="15" fill="#5A6C79">${l?.destino || 'Destino'}</text>
          <!-- Camión inline (grupo) centrado en su posición con transform -->
          <g id="tracking-truck" transform="translate(40,96)" filter="url(#shadow)">
            <!-- Chasis -->
            <rect x="-22" y="-12" width="30" height="18" rx="3" fill="#0E2F44" />
            <!-- Cabina -->
            <rect x="8" y="-10" width="20" height="14" rx="2" fill="#3AAFA9" />
            <rect x="8" y="-10" width="7" height="10" fill="#ffffff" opacity="0.9" />
            <!-- Ruedas -->
            <circle cx="-10" cy="6" r="5" fill="#333" />
            <circle cx="12" cy="6" r="5" fill="#333" />
            <circle cx="-10" cy="6" r="2" fill="#888" />
            <circle cx="12" cy="6" r="2" fill="#888" />
          </g>
        </svg>
      `;
      // Animación JS para mover el camión
      setTimeout(()=>{
        const truck = document.getElementById('tracking-truck');
        if(truck){
          const steps = [40, 200, 360, 560];
          const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          // Animar desde el paso previo guardado hacia el actual (por envío)
          const lastId = mapBox.dataset.prevId || '';
          let startIdx = parseInt(mapBox.dataset.prevIdx||'0');
          if(lastId !== current.id) startIdx = 0;
          const endIdx = idxTarget < 0 ? 0 : idxTarget;
          const startX = steps[Math.max(0, Math.min(steps.length-1, startIdx))];
          const endX = steps[Math.max(0, Math.min(steps.length-1, endIdx))];
          // Guardar como nuevo punto de partida para la siguiente transición
          mapBox.dataset.prevIdx = String(endIdx);
          mapBox.dataset.prevId = current.id;

          const pathY = 96; // línea central de los hitos
          const amplitude = reduceMotion ? 6 : 18; // altura de la onda senoidal
          const cycles = reduceMotion ? 1 : 2.2; // cantidad de ondas en el trayecto
          const totalFrames = reduceMotion ? 30 : 60;
          let frame = 0;
          const easeInOut = (t)=> t<0.5 ? 2*t*t : -1+(4-2*t)*t; // suavizado
          function animate(){
            frame++;
            const t = Math.min(frame/totalFrames, 1);
            const te = easeInOut(t);
            const x = startX + (endX-startX)*te;
            const yOffset = amplitude * Math.sin(2*Math.PI*cycles*te);
            const y = pathY + yOffset;
            // Rotación leve según la pendiente de la onda: dy/dx
            let angle = 0;
            if(!reduceMotion){
              const dYdX = (amplitude * (2*Math.PI*cycles) * Math.cos(2*Math.PI*cycles*te)) / Math.max(1, Math.abs(endX-startX));
              angle = Math.atan2(dYdX, 1) * (180/Math.PI);
              angle = Math.max(-18, Math.min(18, angle));
            }
            truck.setAttribute('transform', `translate(${x},${y}) rotate(${angle})`);
            if(frame < totalFrames) requestAnimationFrame(animate);
          }
          if(Math.abs(endX-startX) < 0.5){
            // Pequeña oscilación en el lugar
            const wiggleFrames = 35; let f=0;
            function wiggle(){
              f++;
              const t = f/wiggleFrames;
              const y = pathY + (amplitude/2) * Math.sin(2*Math.PI*1*t);
              truck.setAttribute('transform', `translate(${endX},${y}) rotate(0)`);
              if(f<wiggleFrames) requestAnimationFrame(wiggle);
            }
            wiggle();
          } else {
            animate();
          }
        }
      }, 100);
    }
  }

  const canEdit = state.user?.role==='transportista' && !!current && current.carrier===state.user.name;
  if(actions) actions.style.display = canEdit ? 'flex' : 'none';

  document.querySelector('[data-advance]').onclick = ()=>{
    if(!current) return;
    const prev = current.shipStatus || 'pendiente';
    const idx = SHIP_STEPS.indexOf(prev);
    const next = SHIP_STEPS[Math.min(idx+1, SHIP_STEPS.length-1)];
    current.shipStatus = next;
    state.trackingStep = next;
    save();
    if(next==='entregado' && prev!=='entregado'){
      notifyDelivered(current);
    }
    renderTracking();
  };
  document.querySelector('[data-reset]').onclick = ()=>{
    if(!current) return;
    current.shipStatus = 'pendiente';
    state.trackingStep = current.shipStatus;
    save(); renderTracking();
  };
  document.getElementById('tracking-open-chat').onclick = ()=>{ if(current) openChatByProposalId(current.id); };
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

  // Badges por rol
  if(state.user?.role==='empresa'){
    const myLoads = state.loads.filter(l=>l.owner===state.user.name).length;
    const myApproved = state.proposals.filter(p=>state.loads.find(l=>l.id===p.loadId && l.owner===state.user.name) && p.status==='approved');
    const trackingActivos = myApproved.filter(p=>(p.shipStatus||'pendiente')!=='entregado').length;
    const b1 = document.getElementById('badge-empresa-mis-cargas');
    const b2 = document.getElementById('badge-empresa-tracking');
    if(b1){
      const prev = Number(b1.textContent||'0');
      b1.style.display = myLoads? 'inline-block':'none';
      b1.textContent = myLoads;
      if(myLoads!==prev && myLoads>0){ b1.classList.remove('pulse-badge'); void b1.offsetWidth; b1.classList.add('pulse-badge'); }
    }
    if(b2){
      const prev = Number(b2.textContent||'0');
      b2.style.display = trackingActivos? 'inline-block':'none';
      b2.textContent = trackingActivos;
      if(trackingActivos!==prev && trackingActivos>0){ b2.classList.remove('pulse-badge'); void b2.offsetWidth; b2.classList.add('pulse-badge'); }
    }
  }
  if(state.user?.role==='transportista'){
    const approvedByLoad = new Set(state.proposals.filter(p=>p.status==='approved').map(p=>p.loadId));
    const ofertas = state.loads.filter(l=>l.owner!==state.user?.name && !approvedByLoad.has(l.id)).length;
    const misPost = state.proposals.filter(p=>p.carrier===state.user?.name).length;
    const misEnvios = state.proposals.filter(p=>p.carrier===state.user?.name && p.status==='approved').length;
    const trackingActivos = state.proposals.filter(p=>p.carrier===state.user?.name && p.status==='approved' && (p.shipStatus||'pendiente')!=='entregado').length;
    const setBadge = (id,val)=>{
      const el=document.getElementById(id); if(!el) return;
      const prev = Number(el.textContent||'0');
      el.style.display = val? 'inline-block':'none';
      el.textContent = val;
      if(val!==prev && val>0){ el.classList.remove('pulse-badge'); void el.offsetWidth; el.classList.add('pulse-badge'); }
    };
    setBadge('badge-transp-ofertas', ofertas);
    setBadge('badge-transp-mis-postulaciones', misPost);
    setBadge('badge-transp-mis-envios', misEnvios);
    setBadge('badge-transp-tracking', trackingActivos);
  }
  if(state.user?.role==='sendix'){
    const moderacion = state.proposals.filter(p=>p.status==='pending').length;
    const threads = state.proposals.filter(p=>p.status==='approved');
    const unread = threads.map(p=>computeUnread(threadIdFor(p))).reduce((a,b)=>a+b,0);
    const b1 = document.getElementById('badge-sendix-moderacion');
    const b2 = document.getElementById('badge-sendix-conversaciones');
    if(b1){ const prev=Number(b1.textContent||'0'); b1.style.display = moderacion? 'inline-block':'none'; b1.textContent = moderacion; if(moderacion!==prev && moderacion>0){ b1.classList.remove('pulse-badge'); void b1.offsetWidth; b1.classList.add('pulse-badge'); } }
    if(b2){ const prev=Number(b2.textContent||'0'); b2.style.display = unread? 'inline-block':'none'; b2.textContent = unread; if(unread!==prev && unread>0){ b2.classList.remove('pulse-badge'); void b2.offsetWidth; b2.classList.add('pulse-badge'); } }
  }
}

// Init
document.addEventListener('DOMContentLoaded', ()=>{
  initNav(); initLogin(); initPublishForm(); updateChrome();
  const start = state.user ? (location.hash.replace('#','')||'home') : 'login';
  navigate(start);
  // Shortcut: Ctrl/Cmd+K para buscar chats
  document.addEventListener('keydown', (e)=>{
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k'){
      const route = (location.hash.replace('#','')||'home');
      if(route==='conversaciones'){
        e.preventDefault();
        document.getElementById('chat-search')?.focus();
      }
    }
  });
  // Ajustar altura de barra inferior al cargar y al redimensionar
  updateBottomBarHeight();
  window.addEventListener('resize', ()=>updateBottomBarHeight());
});

// helpers chat
function escapeHtml(str){
  return (str||'')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;');
}
function linkify(text){
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.replace(urlRegex, (url)=>`<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
}
