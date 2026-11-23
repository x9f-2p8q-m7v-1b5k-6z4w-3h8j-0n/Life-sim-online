'use strict';
// net.js - PeerJS multiplayer
// ============================================================================
// PEERJS MULTIPLAYER — PEERJS ONLY (NO CUSTOM BACKEND)
// One shared public world. A well-known PeerJS ID identifies the current host.
// The host relays player state and car state. If it disappears, clients elect
// the longest-connected participant and attempt to claim the host ID in order.
// ============================================================================

const MULTIPLAYER_HOST_ID = 'lifesim-metropolis-global-v1';
const MULTIPLAYER_MAX_PLAYERS = 8;
const multiplayerStatus = document.getElementById('multiplayerStatus');
const multiplayerText = document.getElementById('multiplayerText');

let mpDisplayName = '';
let mpChatHistory = [];
let chatOpen = false;
let mpLocalNameplate = null;
let mpPeer = null;
let mpHostConnection = null;
let mpIsHost = false;
let mpConnected = false;
let mpStarted = false;
let mpJoinOrder = Number.MAX_SAFE_INTEGER;
let mpJoinSequence = 0;
let mpHostTerm = 0;
let mpLastSend = 0;
let mpLastHeartbeat = 0;
let mpElectionInProgress = false;
let mpReconnectTimer = null;
let mpLocalPeerId = null;
let mpHostPeerId = MULTIPLAYER_HOST_ID;
const mpConnections = new Map();
const mpPlayers = new Map();
const mpRemoteAvatars = new Map();
const mpCarOwners = new Map();
const mpCarTargets = new Map();
let mpLatestWorldSnapshot = null;
let mpTp = 0;                      // teleport token: bumped when the player legitimately teleports (R / respawn)
let mpHostHint = null;             // successor named by a leaving host
const mpMoveCheck = new Map();     // host-side speed check state per player
function mpNoteTeleport() { mpTp++; }

// ---- unique names + presence helpers ----
const mpNameKey = n => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
function mpCleanName(n) { return String(n || '').replace(/[<>\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18); }
// Returns the id of whoever currently holds this name (case-insensitive), or null
function mpNameHolder(name, exceptId) {
  const k = mpNameKey(name); if(!k) return null;
  if(mpIsHost && exceptId !== mpLocalPeerId && mpNameKey(mpDisplayName) === k) return mpLocalPeerId;
  for(const [id, p] of mpPlayers) if(id !== exceptId && p.name && mpNameKey(p.name) === k) return id;
  return null;
}
function mpSuggestName(name) {
  const base = mpCleanName(name).slice(0, 15);
  for(let i = 2; i < 100; i++) { const c = `${base} ${i}`; if(!mpNameHolder(c, null)) return c; }
  return base + Math.floor(Math.random() * 999);
}
function mpTouch(id) { const p = mpPlayers.get(id); if(p) p.lastSeen = performance.now(); }
// Asks the player for a different name when the host says it is taken
function mpPromptNewName(taken, suggestion) {
  let box = document.getElementById('mpNameBox');
  if(!box) {
    box = document.createElement('div'); box.id = 'mpNameBox';
    box.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:#000a;font-family:Inter,Segoe UI,Arial,sans-serif';
    box.innerHTML = '<div style="width:min(92vw,380px);padding:22px;border:1px solid #ffffff30;border-radius:16px;background:#0a111bf2;color:#e6eef4;box-shadow:0 20px 60px #000a"><div style="font-weight:800;letter-spacing:.06em;margin-bottom:6px">NAME ALREADY IN USE</div><div id="mpNameMsg" style="font-size:13px;color:#a9bdcc;margin-bottom:12px"></div><input id="mpNameField" maxlength="18" style="width:100%;padding:12px;border:1px solid #ffffff35;border-radius:10px;background:#07121d;color:#fff;font:600 15px Inter,Arial,sans-serif;outline:none;margin-bottom:12px"><button id="mpNameOk" style="width:100%;padding:12px;border:0;border-radius:10px;background:#55df9a;color:#04210f;font:800 13px Inter,Arial,sans-serif;letter-spacing:.08em;cursor:pointer">USE THIS NAME</button></div>';
    document.body.appendChild(box);
    const submit = () => { const n = mpCleanName(document.getElementById('mpNameField').value); if(!n) return; mpDisplayName = n; try { localStorage.setItem('lifesimPlayerName', n); } catch(e) {} box.style.display = 'none'; if(mpHostConnection) mpSend(mpHostConnection, {type:'NAME_UPDATE', id:mpLocalPeerId, name:n}); };
    document.getElementById('mpNameOk').onclick = submit;
    document.getElementById('mpNameField').addEventListener('keydown', e => { e.stopPropagation(); if(e.key === 'Enter') submit(); });
  }
  document.getElementById('mpNameMsg').textContent = `Someone in the game is already called "${taken}". Pick a different name to be visible to other players.`;
  document.getElementById('mpNameField').value = suggestion || ''; box.style.display = 'flex'; setTimeout(() => document.getElementById('mpNameField').focus(), 50);
}

function mpStatus(message, state='') {
  multiplayerText.textContent = message;
  multiplayerStatus.classList.toggle('online', state === 'online');
  multiplayerStatus.classList.toggle('error', state === 'error');
}
function mpSend(conn, packet) {
  if(conn && conn.open) {
    try { conn.send(packet); } catch(err) { console.warn('LifeSim multiplayer send failed:', err); }
  }
}

const chatPanelEl = document.getElementById('chatPanel');
const chatHistoryEl = document.getElementById('chatHistory');
const chatInputEl = document.getElementById('chatInput');
const chatToggleEl = document.getElementById('chatToggle');
const chatPopupsEl = document.getElementById('chatPopups');

function mpShowChatPopup(item) {
  if(!chatPopupsEl || !item) return;
  const line = document.createElement('div');
  line.className = 'chatPopupLine';
  const name = document.createElement('span');
  name.className = 'chatPopupName';
  name.textContent = String(item.name || 'Player').slice(0,18);
  const colon = document.createElement('span');
  colon.className = 'chatPopupColon';
  colon.textContent = ': ';
  const message = document.createElement('span');
  message.className = 'chatPopupMessage';
  message.textContent = String(item.message || '').slice(0,256);
  line.append(name, colon, message);
  chatPopupsEl.appendChild(line);
  // Keep the HUD readable if several players chat at once.
  while(chatPopupsEl.children.length > 6) chatPopupsEl.firstElementChild.remove();
  setTimeout(() => line.remove(), 12000);
}

function mpRenderChatHistory() {
  chatHistoryEl.replaceChildren();
  for(const item of mpChatHistory.slice(-40)) {
    const line = document.createElement('div');
    line.className = 'chatLine';
    const name = document.createElement('span');
    name.className = 'chatName';
    name.textContent = String(item.name || 'Player').slice(0,18);
    const colon = document.createElement('span');
    colon.className = 'chatColon';
    colon.textContent = ': ';
    const message = document.createElement('span');
    message.className = 'chatMessage';
    message.textContent = String(item.message || '').slice(0,256);
    line.append(name, colon, message);
    chatHistoryEl.appendChild(line);
  }
  chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
}
function mpReceiveChatMessage(item, notify=true) {
  if(!item || typeof item.message !== 'string') return;
  const cleanMessage = item.message.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0,256);
  if(!cleanMessage) return;
  mpChatHistory.push({
    name:String(item.name || 'Player').replace(/[<>]/g, '').trim().slice(0,18) || 'Player',
    message:cleanMessage,
    at:Number(item.at) || Date.now()
  });
  if(mpChatHistory.length > 60) mpChatHistory.splice(0, mpChatHistory.length - 60);
  mpRenderChatHistory();
  if(notify) mpShowChatPopup(mpChatHistory[mpChatHistory.length - 1]);
}
function mpSendChatMessage(rawMessage) {
  const message = String(rawMessage || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0,256);
  if(!message) return;
  if(!mpStarted || (!mpIsHost && !mpConnected)) {
    toast('Chat is unavailable while multiplayer is disconnected');
    return;
  }
  if(mpIsHost) {
    const item = {name:mpDisplayName || 'Host', message, at:Date.now()};
    mpReceiveChatMessage(item);
    mpBroadcast({type:'CHAT_MESSAGE', item});
  } else {
    mpSend(mpHostConnection, {type:'CHAT_MESSAGE', message});
  }
}
function openChat() {
  if(!running) return;
  chatOpen = true;
  chatPanelEl.style.display = 'block';
  if(document.pointerLockElement) document.exitPointerLock();
  chatInputEl.focus();
  mpRenderChatHistory();
}
function closeChat() {
  chatOpen = false;
  chatPanelEl.style.display = 'none';
  chatInputEl.blur();
}
function toggleChat() {
  if(chatOpen) closeChat();
  else openChat();
}
chatToggleEl.addEventListener('click', toggleChat);
chatInputEl.addEventListener('keydown', e => {
  if(e.key === 'Enter') {
    e.preventDefault();
    mpSendChatMessage(chatInputEl.value);
    chatInputEl.value = '';
    closeChat();
  } else if(e.key === 'Escape') {
    e.preventDefault();
    closeChat();
  }
});
function mpBroadcast(packet, exceptId=null) {
  for(const [id, conn] of mpConnections) {
    if(id !== exceptId) mpSend(conn, packet);
  }
}
function mpPlayerCount() {
  return Math.min(MULTIPLAYER_MAX_PLAYERS, mpPlayers.size + 1);
}
function mpGetCarIndex() {
  return activeCar ? cars.indexOf(activeCar) : -1;
}
function mpCaptureLocalState(full) {
  const myIdx = mpGetCarIndex(); if(myIdx >= 0) mpRecentCar = {i:myIdx, t:performance.now()};
  const carStates = cars.map((car, index) => ({
    i:index,
    x:car.root.position.x, y:car.root.position.y, z:car.root.position.z,
    ry:car.root.rotation.y, vx:car.vx, vz:car.vz,
    av:car.angularVel, steer:car.steerAngle,
    p:car.paintIdx, d:+(car.dmg||0).toFixed(2), n:car.ind||0
  })).filter(cs => full || cs.i === myIdx || (mpRecentCar && cs.i === mpRecentCar.i && performance.now() - mpRecentCar.t < 1500) || (cars[cs.i].touchedT && performance.now() - cars[cs.i].touchedT < 2500));
  return {
    type:'PLAYER_STATE',
    id:mpLocalPeerId,
    name:mpDisplayName,
    joinOrder:mpJoinOrder,
    crouching:!inCar && !!keys.shift,
    x:player.position.x, y:player.position.y, z:player.position.z,
    ry:player.rotation.y, yaw, pitch,
    inCar, carIndex:mpGetCarIndex(),
    day:!!isDayMode, tod:timeOfDay, hostClock:!!mpIsHost,
    w:(typeof WANT !== 'undefined' && S.police) ? WANT.lvl : 0, hn:(typeof TRF !== 'undefined') ? TRF.honkSeq : 0, tp:mpTp,
    ap:(typeof avatarState === 'function') ? avatarState() : undefined, em:(typeof avatarEmoteState === 'function') ? avatarEmoteState() : 0,
    cars:carStates,
    owners:Array.from(mpCarOwners.entries()),
    term:mpHostTerm,
    sentAt:Date.now()
  };
}
function mpCreateNameplate(name, isLocal=false) {
  const el = document.createElement('div');
  el.className = 'mp-nameplate' + (isLocal ? ' local' : '');
  el.textContent = name || '';
  el.style.display = name ? 'block' : 'none';
  document.body.appendChild(el);
  return el;
}
// ---- Network smoothing: snapshot interpolation (renders remote entities ~110ms in the past between real samples) ----
const MPC = new Map(), SM = {}, MPKEYS = ['x','y','z','vx','vz','av','steer'], MP_DELAY = 110;
let mpRecentCar = null, mpLastHostState = 0, mpLastRecv = 0;
function mpOff(h, sentAt) { if(!Number.isFinite(sentAt)) return; const d = Date.now() - sentAt; h.off = h.off == null ? d : (d < h.off ? d : h.off + (d - h.off) * .04); }
function mpPushS(buf, s) { if(!Number.isFinite(s.t)) return; const l = buf[buf.length-1]; if(l && s.t <= l.t) return; buf.push(s); while(buf.length > 40) buf.shift(); }
function mpPushCar(cs, pkt) {
  let cb = MPC.get(cs.i); if(!cb) MPC.set(cs.i, cb = {buf:[], off:null, seen:0});
  cb.seen = performance.now(); mpOff(cb, pkt.sentAt);
  mpPushS(cb.buf, {t:pkt.sentAt, x:cs.x, y:cs.y, z:cs.z, ry:cs.ry || 0, vx:cs.vx || 0, vz:cs.vz || 0, av:cs.av || 0, steer:cs.steer || 0});
}
function mpSample(buf, h) {
  const n = buf.length; if(!n || h.off == null) return null;
  const rt = Date.now() - h.off - MP_DELAY; let a, b;
  if(rt <= buf[0].t) a = b = buf[0]; else if(rt >= buf[n-1].t) a = b = buf[n-1];
  else { let i = n - 1; while(i > 0 && buf[i-1].t > rt) i--; a = buf[i-1]; b = buf[i]; }
  const k = a === b ? 0 : (rt - a.t) / (b.t - a.t);
  for(const key of MPKEYS) SM[key] = (a[key] || 0) + ((b[key] || 0) - (a[key] || 0)) * k;
  SM.ry = a.ry + (THREE.MathUtils.euclideanModulo(b.ry - a.ry + Math.PI, Math.PI*2) - Math.PI) * k;
  if(a === b && n > 1 && rt > buf[n-1].t) { // brief dead-reckoning if packets are late (max 200ms)
    const p = buf[n-2], dtp = (b.t - p.t) / 1000, over = Math.min(rt - b.t, 200) / 1000;
    if(dtp > .005) { SM.x += (b.x - p.x) / dtp * over; SM.z += (b.z - p.z) / dtp * over; }
  }
  return SM;
}

function mpMakeRemoteAvatar(id) {
  if(mpRemoteAvatars.has(id)) return mpRemoteAvatars.get(id);
  const group = new THREE.Group();
  const model = playerModel.clone(true);
  group.add(model);
  group.visible = false;       // stays hidden until a real position has arrived (no ghost avatar at the world origin)
  scene.add(group);
  const record = {
    id, group, model, buf:[], off:null, target:null, lastSeen:performance.now(), inCar:false, apKey:'', hasPos:false,
    nameplate:mpCreateNameplate('')
  };
  mpRemoteAvatars.set(id, record);
  return record;
}
function mpRemovePlayer(id) {
  const avatar = mpRemoteAvatars.get(id);
  if(avatar) {
    scene.remove(avatar.group);
    if(avatar.nameplate) avatar.nameplate.remove();   // the bug: name tags of people who left stayed on screen forever
    if(typeof avatarDispose === 'function') avatarDispose(avatar);
    mpRemoteAvatars.delete(id);
  }
  mpPlayers.delete(id);
  const conn = mpConnections.get(id); mpConnections.delete(id);
  if(conn && conn.open) { try { conn.close(); } catch(e) {} }
  mpMoveCheck.delete(id);
  for(const [carIndex, owner] of mpCarOwners) {
    if(owner === id) mpCarOwners.delete(carIndex);
  }
  mpUpdateStatus();
}
// Two live players can never share a name, so any other entry with this name is a stale ghost of the same person
function mpDedupeName(id, name) {
  const k = mpNameKey(name); if(!k) return;
  for(const [oid, p] of Array.from(mpPlayers)) if(oid !== id && p.name && mpNameKey(p.name) === k) {
    const oc = mpConnections.get(oid); if(mpIsHost && oc && oc.open && performance.now() - (p.lastSeen || 0) < 8000) continue;
    mpRemovePlayer(oid);
  }
  for(const [oid, av] of Array.from(mpRemoteAvatars)) if(oid !== id && av.nameplate && mpNameKey(av.nameplate.textContent) === k && !mpPlayers.has(oid)) mpRemovePlayer(oid);
}
function mpApplyPlayerState(state, fromSnap) {
  if(!state || !state.id || state.id === mpLocalPeerId) return;
  if(state.hostClock && Number.isFinite(state.tod) && fxMode === 0) timeOfDay = state.tod;
  const existing = mpPlayers.get(state.id) || {};
  const cleanName = typeof state.name === 'string' ? mpCleanName(state.name) : '';
  mpPlayers.set(state.id, {...existing, ...state, name:cleanName || existing.name || '', lastSeen:performance.now()});
  if(cleanName) mpDedupeName(state.id, cleanName);
  const hasPos = Number.isFinite(state.x) && Number.isFinite(state.z);
  // roster/name-only updates carry no position: remember the player but do not spawn an avatar until we know where they are
  if(!hasPos && !mpRemoteAvatars.has(state.id)) return;
  const avatar = mpMakeRemoteAvatar(state.id);
  if(typeof state.name === 'string' && cleanName) { avatar.nameplate.textContent = cleanName; }
  else if(existing.name) avatar.nameplate.textContent = existing.name;
  if(!hasPos) return;
  if(fromSnap && avatar.target && performance.now() - avatar.lastSeen < 1500) return; // stale 1Hz snapshot must not overwrite live data
  avatar.target = state; avatar.hasPos = true;
  mpOff(avatar, state.sentAt); mpPushS(avatar.buf, {t:state.sentAt, x:state.x || 0, y:state.y || 0, z:state.z || 0, ry:state.ry || 0});
  avatar.lastSeen = performance.now();
  avatar.inCar = !!state.inCar;
  avatar.group.visible = !state.inCar;
  if(typeof avatarApplyRemote === 'function') avatarApplyRemote(avatar, state);
  if(Array.isArray(state.cars)) {
    for(const carState of state.cars) {
      if(!carState || !Number.isInteger(carState.i) || !cars[carState.i]) continue;
      if(carState.i === mpGetCarIndex()) continue;
      mpCarTargets.set(carState.i, carState); cars[carState.i].netT = performance.now();
      if(state.inCar && state.carIndex === carState.i) mpPushCar(carState, state);
    }
  }
  if(Array.isArray(state.owners) && (state.hostClock || fromSnap)) {
    mpCarOwners.clear();
    for(const entry of state.owners) {
      if(Array.isArray(entry) && Number.isInteger(entry[0])) mpCarOwners.set(entry[0], entry[1]);
    }
  }
}
function mpApplyWorldSnapshot(snapshot) {
  if(!snapshot || !Array.isArray(snapshot.players)) return;
  mpLatestWorldSnapshot = snapshot;
  if(Number.isFinite(snapshot.term)) mpHostTerm = Math.max(mpHostTerm, snapshot.term);
  if(Number.isFinite(snapshot.sequence)) mpJoinSequence = Math.max(mpJoinSequence, snapshot.sequence);
  if(Array.isArray(snapshot.cars)) {
    for(const carState of snapshot.cars) {
      if(!carState || !cars[carState.i]) continue;
      if(carState.i === mpGetCarIndex() || MPC.has(carState.i) || mpCarOwners.has(carState.i)) continue;
      const c = cars[carState.i];
      c.root.position.set(carState.x, carState.y, carState.z);
      c.root.rotation.y = carState.ry;
      c.vx = carState.vx || 0; c.vz = carState.vz || 0;
      c.angularVel = carState.av || 0; c.steerAngle = carState.steer || 0;
    }
  }
  if(Array.isArray(snapshot.owners)) {
    mpCarOwners.clear();
    for(const entry of snapshot.owners) if(Array.isArray(entry)) mpCarOwners.set(entry[0], entry[1]);
  }
  for(const state of snapshot.players) mpApplyPlayerState(state, true);
  // the host's snapshot is the full list of who is really here: drop everyone else (people who left, stale ghosts)
  const present = new Set(snapshot.players.map(p => p.id));
  for(const id of Array.from(mpPlayers.keys())) if(!present.has(id)) mpRemovePlayer(id);
  for(const id of Array.from(mpRemoteAvatars.keys())) if(!present.has(id)) mpRemovePlayer(id);
}
function mpBuildSnapshot() {
  const local = mpCaptureLocalState(true);
  const players = [local];
  for(const state of mpPlayers.values()) players.push(state);
  return {
    type:'WORLD_SNAPSHOT',
    term:mpHostTerm,
    sequence:mpJoinSequence,
    players,
    cars:local.cars,
    owners:Array.from(mpCarOwners.entries()),
    day:!!isDayMode,
    at:Date.now()
  };
}
function mpUpdateStatus() {
  if(!mpStarted) return;
  const count = mpIsHost ? mpPlayerCount() : Math.min(MULTIPLAYER_MAX_PLAYERS, mpPlayers.size + (mpConnected ? 1 : 0));
  const role = mpIsHost ? 'HOST' : (mpConnected ? 'CONNECTED' : 'RECONNECTING');
  mpStatus(`MULTIPLAYER: ${role} · ${count}/${MULTIPLAYER_MAX_PLAYERS} PLAYERS`, mpConnected || mpIsHost ? 'online' : '');
}
function mpSetCarOwner(index, ownerId) {
  if(index < 0) return;
  if(ownerId) mpCarOwners.set(index, ownerId);
  else mpCarOwners.delete(index);
  const packet = {type:'CAR_OWNERS', owners:Array.from(mpCarOwners.entries()), term:mpHostTerm};
  if(mpIsHost) mpBroadcast(packet);
  else mpSend(mpHostConnection, packet);
}
function mpHandlePacket(packet, fromId) {
  if(!packet || typeof packet !== 'object') return;
  mpLastRecv = performance.now();
  if(fromId) mpTouch(fromId);
  if(packet.type === 'CHAT_MESSAGE') {
    if(mpIsHost) {
      if(fromId === mpLocalPeerId) return;
      const roster = mpPlayers.get(fromId);
      if(!roster || !mpConnections.has(fromId)) return;
      const message = String(packet.message || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0,256);
      if(!message) return;
      const item = {name:String(roster.name || 'Player').slice(0,18), message, at:Date.now()};
      mpReceiveChatMessage(item);
      mpBroadcast({type:'CHAT_MESSAGE', item});
    } else if(fromId === mpHostPeerId && packet.item) {
      mpReceiveChatMessage(packet.item);
    }
    return;
  }
  if(packet.type === 'CHAT_HISTORY') {
    if(!mpIsHost && Array.isArray(packet.items)) {
      mpChatHistory = [];
      for(const item of packet.items.slice(-40)) mpReceiveChatMessage(item, false);
      mpRenderChatHistory();
    }
    return;
  }
  if(packet.type === 'HELLO' || packet.type === 'NAME_UPDATE') {
    if(mpIsHost) {
      if(packet.id !== fromId) return;
      const safeName = mpCleanName(packet.name);
      if(!safeName) return;
      const prior = mpPlayers.get(fromId) || {id:fromId, joinOrder:++mpJoinSequence};
      // unique names: if someone else holds it, ask for another (unless that holder is a dead ghost of the same person)
      const holder = mpNameHolder(safeName, fromId);
      if(holder) {
        const hp = mpPlayers.get(holder), hc = mpConnections.get(holder), alive = holder === mpLocalPeerId || (hc && hc.open && performance.now() - ((hp && hp.lastSeen) || 0) < 8000);
        if(alive) {
          mpPlayers.set(fromId, {...prior, id:fromId, name:'', lastSeen:performance.now()});
          mpSend(mpConnections.get(fromId), {type:'NAME_TAKEN', name:safeName, suggestion:mpSuggestName(safeName)});
          return;
        }
        mpRemovePlayer(holder);
      }
      const namedState = {...prior, id:fromId, name:safeName, joinOrder:prior.joinOrder, lastSeen:performance.now()};
      mpPlayers.set(fromId, namedState);
      mpSend(mpConnections.get(fromId), {type:'NAME_OK', name:safeName});
      mpBroadcast({type:'NAME_UPDATE', id:fromId, name:safeName, joinOrder:namedState.joinOrder}, fromId);
      // Send the newcomer the current named roster, including their own name.
      const conn = mpConnections.get(fromId);
      mpSend(conn, {type:'ROSTER', players:[mpCaptureLocalState(), ...Array.from(mpPlayers.values())]});
      mpSend(conn, {type:'CHAT_HISTORY', items:mpChatHistory.slice(-40)});
      mpUpdateStatus();
    } else if(packet.id && packet.id !== mpLocalPeerId && typeof packet.name === 'string') {
      mpApplyPlayerState({id:packet.id, name:packet.name, joinOrder:packet.joinOrder});
    }
    return;
  }
  if(packet.type === 'NAME_TAKEN') { if(!mpIsHost) { toast('That name is already taken'); mpPromptNewName(packet.name, packet.suggestion); } return; }
  if(packet.type === 'NAME_OK') { if(!mpIsHost && packet.name) mpDisplayName = packet.name; return; }
  if(packet.type === 'BYE') { if(mpIsHost && packet.id === fromId) { mpRemovePlayer(fromId); mpBroadcast({type:'ROSTER', players:[mpCaptureLocalState(), ...Array.from(mpPlayers.values())]}); } return; }
  if(packet.type === 'HOST_BYE') {
    if(!mpIsHost && fromId === mpHostPeerId) { mpHostHint = packet.successor || null; mpConnected = false; mpHostConnection = null; mpRemovePlayer(MULTIPLAYER_HOST_ID); mpUpdateStatus(); toast('Host left · moving the game to another player'); mpBeginElection(); }
    return;
  }
  if(packet.type === 'TRAFFIC') { if(!mpIsHost && fromId === mpHostPeerId && typeof trafficApply === 'function') trafficApply(packet); return; }
  if(packet.type === 'TR_HIT') { if(mpIsHost && Array.isArray(packet.hits) && mpPlayers.get(fromId) && mpPlayers.get(fromId).name) for(const h of packet.hits.slice(0, 12)) trafficHitIn(h); return; }
  if(packet.type === 'CORRECT') {
    if(!mpIsHost && Number.isFinite(packet.x) && Number.isFinite(packet.z)) {
      if(inCar && activeCar && packet.car) { activeCar.root.position.set(packet.x, 0, packet.z); activeCar.vx = activeCar.vz = 0; } else if(!inCar) { player.position.x = packet.x; player.position.z = packet.z; }
      toast('Position corrected');
    }
    return;
  }
  if(packet.type === 'WELCOME') {
    mpConnected = true;
    mpHostPeerId = fromId;
    mpJoinOrder = Number.isFinite(packet.joinOrder) ? packet.joinOrder : mpJoinOrder;
    mpHostTerm = Math.max(mpHostTerm, packet.term || 0);
    mpJoinSequence = Math.max(mpJoinSequence, packet.sequence || 0);
    if(packet.snapshot) mpApplyWorldSnapshot(packet.snapshot);
    if(Array.isArray(packet.chatHistory)) {
      mpChatHistory = [];
      for(const item of packet.chatHistory.slice(-40)) mpReceiveChatMessage(item);
      mpRenderChatHistory();
    }
    mpSend(mpHostConnection, {type:'JOIN_ACK', id:mpLocalPeerId});
    mpSend(mpHostConnection, {type:'NAME_UPDATE', id:mpLocalPeerId, name:mpDisplayName});
    mpSend(mpHostConnection, mpCaptureLocalState());
    mpUpdateStatus();
    return;
  }
  if(packet.type === 'ROSTER') {
    if(Array.isArray(packet.players)) {
      const present = new Set(packet.players.map(p => p.id));
      for(const p of packet.players) if(p.id !== mpLocalPeerId) mpApplyPlayerState(p);
      for(const id of mpPlayers.keys()) if(!present.has(id)) mpRemovePlayer(id);
    }
    mpUpdateStatus();
    return;
  }
  if(packet.type === 'PLAYER_STATE') {
    if(mpIsHost) {
      if(packet.id !== fromId) return;
      const roster0 = mpPlayers.get(fromId);
      if(!roster0 || !roster0.name) return;      // nobody is visible until the host has accepted a unique name
      packet.name = roster0.name;                // the validated name is the only one that counts
      // speed check: reject impossible movement (teleporting) and snap the player back
      {
        const nowT = performance.now(), mc = mpMoveCheck.get(fromId); let px = packet.x, pz = packet.z, maxV = 11;
        if(packet.inCar && Array.isArray(packet.cars)) { const cs = packet.cars.find(c => c && c.i === packet.carIndex); if(cs) { px = cs.x; pz = cs.z; maxV = 95; } }
        if(!Number.isFinite(px) || !Number.isFinite(pz)) return;
        if(mc && nowT - mc.t < 10000 && mc.inCar === !!packet.inCar) {
          const tpOk = packet.tp !== mc.tp && nowT - mc.tpAt > 4000, dist = Math.hypot(px - mc.x, pz - mc.z), dts = Math.max(.05, (nowT - mc.t) / 1000);
          if(!tpOk && dist > maxV * dts + 9) { mc.bad = (mc.bad || 0) + 1; if(mc.bad > 1) { mpSend(mpConnections.get(fromId), {type:'CORRECT', x:mc.x, z:mc.z, car:!!packet.inCar}); mc.t = nowT; } return; }
          if(tpOk) mc.tpAt = nowT;
        }
        const prev = mc || {tpAt:0}; mpMoveCheck.set(fromId, {x:px, z:pz, t:nowT, tp:packet.tp, inCar:!!packet.inCar, tpAt:(packet.tp !== prev.tp && prev.tp !== undefined) ? nowT : prev.tpAt, bad:0});
      }
      const activeIndex = packet.inCar ? packet.carIndex : -1;
      const previouslyOwned = [];
      for(const [idx, owner] of mpCarOwners) if(owner === fromId) previouslyOwned.push(idx);
      if(activeIndex >= 0) {
        const owner = mpCarOwners.get(activeIndex);
        if(owner && owner !== fromId) {
          mpSend(mpConnections.get(fromId), {type:'CAR_DENIED', carIndex:activeIndex});
          return;
        }
        mpCarOwners.set(activeIndex, fromId);
      }
      // The host is authoritative for parked cars. While a player drives, that
      // player's updates are applied to the host; on exit, the final car state
      // is applied before its ownership is released, so it remains where parked.
      const acceptedCarIndexes = new Set(previouslyOwned);
      if(activeIndex >= 0) acceptedCarIndexes.add(activeIndex);
      // cars this player is shoving around (parked cars they rammed): accept if unowned and close to the sender
      if(Array.isArray(packet.cars)) for(const cs of packet.cars) { if(!cs || !cars[cs.i] || mpCarOwners.has(cs.i) || Math.hypot(cs.x - packet.x, cs.z - packet.z) > 40 && !packet.inCar) continue; if(packet.inCar && Math.hypot(cs.x - cars[activeIndex]?.root.position.x, cs.z - cars[activeIndex]?.root.position.z) > 45) continue; acceptedCarIndexes.add(cs.i); }
      if(Array.isArray(packet.cars)) {
        for(const carState of packet.cars) {
          if(!carState || !acceptedCarIndexes.has(carState.i) || !cars[carState.i]) continue;
          mpPushCar(carState, packet);
        }
      }
      if(activeIndex < 0) {
        for(const idx of previouslyOwned) mpCarOwners.delete(idx);
      }
      mpApplyPlayerState(packet);
      const rosterEntry = mpPlayers.get(fromId) || {};
      mpPlayers.set(fromId, {...rosterEntry, ...packet, id:fromId, name:String(packet.name || rosterEntry.name || '').trim()});
      mpBroadcast(packet, fromId);
      mpLatestWorldSnapshot = mpBuildSnapshot();
    } else {
      mpApplyPlayerState(packet);
    }
    return;
  }
  if(packet.type === 'WORLD_SNAPSHOT') {
    if(!mpIsHost && (!Number.isFinite(packet.term) || packet.term >= mpHostTerm)) {
      mpApplyWorldSnapshot(packet);
    }
    return;
  }
  if(packet.type === 'CAR_OWNERS') {
    if(mpIsHost) {
      // The host is the authority for vehicle ownership. Client claims are
      // confirmed by the next PLAYER_STATE packet, preventing two drivers
      // from simultaneously taking the same vehicle.
      mpSend(mpConnections.get(fromId), {type:'CAR_OWNERS', owners:Array.from(mpCarOwners.entries())});
    } else if(Array.isArray(packet.owners)) {
      mpCarOwners.clear();
      for(const entry of packet.owners) if(Array.isArray(entry)) mpCarOwners.set(entry[0], entry[1]);
    }
    return;
  }
  if(packet.type === 'CAR_DENIED') {
    if(activeCar && cars.indexOf(activeCar) === packet.carIndex) {
      activeCar = null; inCar = false; player.visible = true;
      toast('That vehicle is already being driven by another player');
    }
    return;
  }
  if(packet.type === 'PING') {
    mpSend(mpConnections.get(fromId) || mpHostConnection, {type:'PONG', at:packet.at});
    return;
  }
  if(packet.type === 'PONG') return;
}
function mpRegisterHostConnection(conn) {
  conn.on('open', () => {
    if(mpConnections.size >= MULTIPLAYER_MAX_PLAYERS - 1) {
      mpSend(conn, {type:'FULL'});
      conn.close();
      return;
    }
    const id = conn.peer;
    mpJoinSequence++;
    const joinOrder = mpJoinSequence;
    mpConnections.set(id, conn);
    mpPlayers.set(id, {id, joinOrder, lastSeen:performance.now()});
    mpSend(conn, {
      type:'WELCOME', joinOrder, term:mpHostTerm,
      sequence:mpJoinSequence,
      snapshot:mpBuildSnapshot(),
      chatHistory:mpChatHistory.slice(-40)
    });
    mpBroadcast({type:'ROSTER', players:[mpCaptureLocalState(), ...Array.from(mpPlayers.values())]}, id);
    mpUpdateStatus();
  });
  conn.on('data', packet => mpHandlePacket(packet, conn.peer));
  conn.on('close', () => {
    mpRemovePlayer(conn.peer);
    if(mpIsHost) mpBroadcast({type:'ROSTER', players:[mpCaptureLocalState(), ...Array.from(mpPlayers.values())]});
  });
  conn.on('error', err => console.warn('LifeSim peer connection error:', err));
}
function mpConnectToHost() {
  if(!mpPeer || mpPeer.destroyed || mpPeer.disconnected) return;
  mpStatus('MULTIPLAYER: FINDING HOST…');
  const conn = mpPeer.connect(MULTIPLAYER_HOST_ID, {reliable:true, serialization:'json'});
  mpHostConnection = conn;
  conn.on('open', () => {
    mpConnected = true;
    mpHostPeerId = MULTIPLAYER_HOST_ID;
    mpSend(conn, {type:'HELLO', id:mpLocalPeerId, name:mpDisplayName});
    mpSend(conn, {type:'NAME_UPDATE', id:mpLocalPeerId, name:mpDisplayName});
    mpUpdateStatus();
  });
  conn.on('data', packet => mpHandlePacket(packet, MULTIPLAYER_HOST_ID));
  conn.on('close', () => {
    mpConnected = false;
    mpHostConnection = null;
    mpRemovePlayer(MULTIPLAYER_HOST_ID);
    mpUpdateStatus();
    if(mpStarted && !mpIsHost) mpBeginElection();
  });
  conn.on('error', err => {
    console.warn('LifeSim host connection error:', err);
    mpConnected = false;
    mpRemovePlayer(MULTIPLAYER_HOST_ID);
    mpUpdateStatus();
    if(mpStarted && !mpIsHost) mpBeginElection();
  });
}
function mpBecomeHost(peerInstance, migrated=false) {
  mpPeer = peerInstance;
  mpLocalPeerId = MULTIPLAYER_HOST_ID;
  mpIsHost = true;
  mpConnected = true;
  mpHostPeerId = MULTIPLAYER_HOST_ID;
  mpHostTerm++;
  mpElectionInProgress = false;
  if(!Number.isFinite(mpJoinOrder) || mpJoinOrder === Number.MAX_SAFE_INTEGER) mpJoinOrder = 0;
  mpPeer.on('connection', conn => mpRegisterHostConnection(conn));
  mpPeer.on('disconnected', () => {
    mpIsHost = false; mpConnected = false;
    mpBeginElection();
  });
  mpPeer.on('error', err => {
    console.warn('LifeSim host peer error:', err);
    if(err && err.type === 'unavailable-id') {
      mpIsHost = false;
      mpConnectToHost();
    }
  });
  mpLatestWorldSnapshot = mpBuildSnapshot();
  mpStatus(`MULTIPLAYER: HOST · 1/${MULTIPLAYER_MAX_PLAYERS} PLAYERS`, 'online');
  if(migrated) toast('Host migrated · world session restored');
  mpUpdateStatus();
}
function mpTryClaimHost(delay) {
  setTimeout(() => {
    if(!mpStarted || mpIsHost || mpElectionInProgress) return;
    mpElectionInProgress = true;
    mpStatus('MULTIPLAYER: HOST MIGRATION…');
    let candidate;
    try { candidate = new Peer(MULTIPLAYER_HOST_ID); }
    catch(err) {
      mpElectionInProgress = false;
      setTimeout(mpBeginElection, 1800);
      return;
    }
    let settled = false;
    candidate.on('open', () => {
      if(settled) return;
      settled = true;
      if(mpPeer && mpPeer !== candidate) {
        try { mpPeer.destroy(); } catch(e) {}
      }
      mpBecomeHost(candidate, true);
    });
    candidate.on('error', err => {
      if(settled) return;
      if(err && err.type === 'unavailable-id') {
        settled = true;
        mpElectionInProgress = false;
        if(mpPeer && !mpPeer.destroyed) mpConnectToHost();
        else mpCreateClientPeer();
      } else {
        console.warn('LifeSim host election error:', err);
        settled = true;
        mpElectionInProgress = false;
        setTimeout(mpBeginElection, 2200);
      }
    });
    setTimeout(() => {
      if(!settled) {
        settled = true;
        try { candidate.destroy(); } catch(e) {}
        mpElectionInProgress = false;
        setTimeout(mpBeginElection, 1800);
      }
    }, 9000);
  }, delay);
}
function mpBeginElection() {
  if(!mpStarted || mpIsHost || mpElectionInProgress) return;
  if(mpReconnectTimer) clearTimeout(mpReconnectTimer);
  const candidates = [{id:mpLocalPeerId, joinOrder:mpJoinOrder}];
  for(const p of mpPlayers.values()) {
    if(p.id && Number.isFinite(p.joinOrder)) candidates.push({id:p.id, joinOrder:p.joinOrder});
  }
  candidates.sort((a,b) => a.joinOrder - b.joinOrder);
  const bestOrder = candidates.length ? candidates[0].joinOrder : mpJoinOrder;
  const tied = candidates.filter(c => c.joinOrder === bestOrder);
  let chosen = tied.length ? tied[Math.floor(Math.random()*tied.length)] : {id:mpLocalPeerId};
  const hinted = mpHostHint && candidates.find(c => c.id === mpHostHint); mpHostHint = null; if(hinted) chosen = hinted;
  const rank = chosen.id === mpLocalPeerId ? 0 : 1;
  // If local player is not the preferred candidate, keep reconnecting to the
  // fixed host ID. A later election retry handles a failed preferred candidate.
  if(chosen.id !== mpLocalPeerId) {
    mpReconnectTimer = setTimeout(() => {
      if(mpPeer && !mpPeer.destroyed) mpConnectToHost();
      else mpCreateClientPeer();
      mpElectionInProgress = false;
    }, 1600);
    return;
  }
  mpTryClaimHost(rank * 1200 + Math.random()*350);
}
function mpCreateClientPeer() {
  if(!mpStarted) return;
  try {
    const p = new Peer();
    mpPeer = p;
    p.on('open', id => {
      mpLocalPeerId = id;
      mpConnectToHost();
    });
    p.on('error', err => {
      console.warn('LifeSim PeerJS client error:', err);
      mpStatus('MULTIPLAYER: CONNECTION RETRYING…', 'error');
      setTimeout(() => {
        if(mpStarted && !mpIsHost) mpCreateClientPeer();
      }, 2500);
    });
    p.on('disconnected', () => {
      if(mpStarted && !mpIsHost) {
        try { p.reconnect(); } catch(e) {}
      }
    });
  } catch(err) {
    console.error(err);
    mpStatus('MULTIPLAYER: PEERJS UNAVAILABLE', 'error');
  }
}
function startMultiplayer() {
  if(mpStarted) return;
  mpStarted = true;
  mpStatus('MULTIPLAYER: CONNECTING TO PEERJS…');
  let hostCandidate;
  try { hostCandidate = new Peer(MULTIPLAYER_HOST_ID); }
  catch(err) {
    console.warn(err);
    mpCreateClientPeer();
    return;
  }
  let opened = false;
  hostCandidate.on('open', () => {
    opened = true;
    mpLocalPeerId = MULTIPLAYER_HOST_ID;
    mpJoinOrder = 0;
    mpBecomeHost(hostCandidate, false);
  });
  hostCandidate.on('error', err => {
    console.warn('LifeSim initial host claim:', err);
    if(err && err.type === 'unavailable-id') {
      if(!opened) {
        mpIsHost = false;
        mpCreateClientPeer();
      }
    } else {
      mpStatus('MULTIPLAYER: PEERJS CONNECTION ISSUE', 'error');
      setTimeout(() => { if(mpStarted && !mpIsHost) mpCreateClientPeer(); }, 2500);
    }
  });
}
function mpTick(dt) {
  if(!mpStarted) return;
  const now = performance.now();
  if(!mpIsHost && mpConnected && mpLastRecv && now - mpLastRecv > 6000) { mpLastRecv = 0; try { mpHostConnection && mpHostConnection.close(); } catch(e) {} } // silent stall -> force reconnect
  if(mpIsHost) {
    if(now - mpLastHostState > 33) { mpLastHostState = now; mpBroadcast(mpCaptureLocalState()); }
    if(now - mpLastHeartbeat > 1000) {
      mpLastHeartbeat = now;
      const snapshot = mpBuildSnapshot();
      mpLatestWorldSnapshot = snapshot;
      mpBroadcast(snapshot);
    }
  } else if(mpConnected && mpHostConnection && now - mpLastSend > 33) {
    mpLastSend = now;
    mpSend(mpHostConnection, mpCaptureLocalState());
  }
  for(const [id, avatar] of mpRemoteAvatars) {
    if(avatar.target) {
      const s = avatar.target;
      const alpha = 1 - Math.exp(-dt * 14);
      const sm = mpSample(avatar.buf, avatar);
      if(sm) { avatar.group.position.set(sm.x, sm.y, sm.z); avatar.group.rotation.y = sm.ry; }
      else {
      avatar.group.position.x = THREE.MathUtils.lerp(avatar.group.position.x, s.x || 0, alpha);
      avatar.group.position.y = THREE.MathUtils.lerp(avatar.group.position.y, s.y || 0, alpha);
      avatar.group.position.z = THREE.MathUtils.lerp(avatar.group.position.z, s.z || 0, alpha);
      avatar.group.rotation.y = THREE.MathUtils.lerp(avatar.group.rotation.y, s.ry || 0, alpha);
      }
      avatar.model.scale.y = 1;
      if(typeof avatarRemoteUpdate === 'function') avatarRemoteUpdate(avatar, s, dt);
      const remoteUpper = avatar.model.getObjectByName('crouchUpperBody');
      if(remoteUpper) {
        remoteUpper.position.y = THREE.MathUtils.damp(remoteUpper.position.y, s.crouching ? .68 : .88, 15, dt);
        remoteUpper.rotation.x = THREE.MathUtils.damp(remoteUpper.rotation.x, s.crouching ? -.22 : 0, 15, dt);
      }
      for(let i=0;i<2;i++) {
        const leg = avatar.model.getObjectByName(`crouchLeg${i}`);
        const knee = avatar.model.getObjectByName(`crouchKnee${i}`);
        if(leg) leg.rotation.x = THREE.MathUtils.damp(leg.rotation.x, s.crouching ? -.48 : 0, 15, dt);
        if(knee) knee.rotation.x = THREE.MathUtils.damp(knee.rotation.x, s.crouching ? 1.18 : 0, 15, dt);
      }
      // Anchor the label just above the hair; the crouched pose lowers the head naturally.
      let anchor = avatar.group.position;
      let height = s.crouching ? 2.03 : 2.25;
      if(s.inCar && Number.isInteger(s.carIndex) && cars[s.carIndex]) {
        anchor = cars[s.carIndex].root.position;
        height = 2.25;
      }
      const projected = new THREE.Vector3(anchor.x, anchor.y + height, anchor.z).project(camera);
      const visible = projected.z > -1 && projected.z < 1 &&
        projected.x >= -1.15 && projected.x <= 1.15 &&
        projected.y >= -1.15 && projected.y <= 1.15;
      avatar.nameplate.style.display = (visible && avatar.hasPos && avatar.nameplate.textContent) ? 'block' : 'none';
      if(visible) {
        avatar.nameplate.style.left = `${(projected.x * 0.5 + 0.5) * innerWidth}px`;
        avatar.nameplate.style.top = `${(-projected.y * 0.5 + 0.5) * innerHeight}px`;
      }
    }
  }

  if(mpDisplayName) {
    if(!mpLocalNameplate) mpLocalNameplate = mpCreateNameplate(mpDisplayName, true);
    mpLocalNameplate.textContent = mpDisplayName;
    let localAnchor = player.position;
    let localHeight = keys.shift ? 2.03 : 2.25;
    if(inCar && activeCar) {
      localAnchor = activeCar.root.position;
      localHeight = 2.25;
    }
    const projected = new THREE.Vector3(localAnchor.x, localAnchor.y + localHeight, localAnchor.z).project(camera);
    const visible = projected.z > -1 && projected.z < 1 &&
      projected.x >= -1.15 && projected.x <= 1.15 &&
      projected.y >= -1.15 && projected.y <= 1.15;
    mpLocalNameplate.style.display = visible ? 'block' : 'none';
    if(visible) {
      mpLocalNameplate.style.left = `${(projected.x * 0.5 + 0.5) * innerWidth}px`;
      mpLocalNameplate.style.top = `${(-projected.y * 0.5 + 0.5) * innerHeight}px`;
    }
  }
  for(const [index, cb] of MPC) {
    const c = cars[index];
    if(!c || index === mpGetCarIndex() || now - cb.seen > 1500) { MPC.delete(index); continue; }
    const sm = mpSample(cb.buf, cb); if(!sm) continue;
    c.root.position.set(sm.x, sm.y, sm.z); c.root.rotation.y = sm.ry;
    c.vx = sm.vx; c.vz = sm.vz; c.angularVel = sm.av; c.steerAngle = sm.steer;
  }
  for(const [index, target] of mpCarTargets) {
    const c = cars[index];
    if(!c || index === mpGetCarIndex() || MPC.has(index)) continue;
    const alpha = 1 - Math.exp(-dt * 18);
    c.root.position.x = THREE.MathUtils.lerp(c.root.position.x, target.x, alpha);
    c.root.position.y = THREE.MathUtils.lerp(c.root.position.y, target.y, alpha);
    c.root.position.z = THREE.MathUtils.lerp(c.root.position.z, target.z, alpha);
    c.root.rotation.y += THREE.MathUtils.euclideanModulo(target.ry - c.root.rotation.y + Math.PI, Math.PI*2) * alpha - Math.PI * alpha;
    c.vx = target.vx || 0; c.vz = target.vz || 0;
    c.angularVel = target.av || 0; c.steerAngle = target.steer || 0;
  }
  if(mpIsHost) {
    for(const [id, conn] of Array.from(mpConnections)) {
      if(!conn.open) mpRemovePlayer(id);
    }
    // presence: nobody has been heard from for 15 s -> they left (tab killed, network dropped)
    if(now - (mpTick.lastPresence || 0) > 1000) {
      mpTick.lastPresence = now; let changed = false;
      for(const [id, conn] of Array.from(mpConnections)) { const p = mpPlayers.get(id); if(!p || now - (p.lastSeen || 0) > 15000) { mpRemovePlayer(id); changed = true; } }
      if(changed) mpBroadcast({type:'ROSTER', players:[mpCaptureLocalState(), ...Array.from(mpPlayers.values())]});
    }
  } else if(mpConnected && mpHostConnection) {
    if(now - (mpTick.lastHit || 0) > 100 && typeof TRF !== 'undefined' && TRF.hitOut.length) { mpTick.lastHit = now; mpSend(mpHostConnection, {type:'TR_HIT', hits:TRF.hitOut.splice(0, 12)}); }
    if(now - (mpTick.lastPrune || 0) > 2000) { mpTick.lastPrune = now; for(const [id, av] of Array.from(mpRemoteAvatars)) if(now - av.lastSeen > 12000) mpRemovePlayer(id); }
  }
}


// ---- graceful leave: tell everyone immediately instead of making them wait for a timeout ----
function mpSayGoodbye() {
  if(!mpStarted) return;
  try {
    if(mpIsHost) {
      let succ = null, best = Infinity;
      for(const [id, p] of mpPlayers) if(p.name && mpConnections.has(id) && Number.isFinite(p.joinOrder) && p.joinOrder < best) { best = p.joinOrder; succ = id; }
      mpBroadcast({type:'HOST_BYE', successor:succ});
    } else if(mpHostConnection && mpHostConnection.open) mpSend(mpHostConnection, {type:'BYE', id:mpLocalPeerId});
    if(mpPeer && !mpPeer.destroyed) mpPeer.destroy();   // releases the peer id straight away so a successor can claim it
  } catch(e) {}
}
addEventListener('pagehide', mpSayGoodbye);
addEventListener('beforeunload', mpSayGoodbye);
