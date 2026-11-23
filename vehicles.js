'use strict';
// vehicles.js - Player character model, particles and the detailed car models
// ============================================================================
// ARTICULATED THIRD-PERSON & FIRST-PERSON CHARACTER MODEL
// ============================================================================
const player = new THREE.Group(); scene.add(player);
const playerModel = new THREE.Group(); player.add(playerModel);
const upperBodyPivot = new THREE.Group(); upperBodyPivot.name = 'crouchUpperBody'; upperBodyPivot.position.y = .88; playerModel.add(upperBodyPivot);
const skinMat = new THREE.MeshStandardMaterial({color:0xc58e70,roughness:.88});
const skinLightMat = new THREE.MeshStandardMaterial({color:0xd3a184,roughness:.9});
const jacketMat = new THREE.MeshStandardMaterial({color:0x263f59,roughness:.82});
const jacketDarkMat = new THREE.MeshStandardMaterial({color:0x192d43,roughness:.86});
const shirtMat = new THREE.MeshStandardMaterial({color:0xe0e3e2,roughness:.9});
const denimMat = new THREE.MeshStandardMaterial({color:0x273747,roughness:.94});
const denimLightMat = new THREE.MeshStandardMaterial({color:0x3b5063,roughness:.94});
const shoeMat = new THREE.MeshStandardMaterial({color:0x202326,roughness:.9});
const soleMat = new THREE.MeshStandardMaterial({color:0x777b7c,roughness:.95});
const hairMat = new THREE.MeshStandardMaterial({color:0x30251f,roughness:.95});
const eyeWhiteMat = new THREE.MeshStandardMaterial({color:0xf0eee7,roughness:.45});
const irisMat = new THREE.MeshStandardMaterial({color:0x587a83,roughness:.35});
const pupilMat = new THREE.MeshStandardMaterial({color:0x17191b,roughness:.25});
const detailDarkMat = new THREE.MeshStandardMaterial({color:0x202a31,roughness:.85});
const metalDetailMat = new THREE.MeshStandardMaterial({color:0x87939a,metalness:.65,roughness:.35});

function addCharacterMesh(parent, geometry, material, position, scale=null) {
  const mesh=new THREE.Mesh(geometry,material);
  mesh.position.set(position[0],position[1],position[2]);
  if(scale) mesh.scale.set(scale[0],scale[1],scale[2]);
  mesh.castShadow=true; mesh.receiveShadow=true; parent.add(mesh); return mesh;
}
function addCharacterCapsule(parent, radius, length, material, position, scale=null) {
  return addCharacterMesh(parent,new THREE.CapsuleGeometry(radius,length,5,12),material,position,scale);
}
addCharacterMesh(upperBodyPivot,new THREE.SphereGeometry(1,20,16),denimMat,[0,.01,0],[.285,.22,.18]);
const torsoPoints=[
  new THREE.Vector2(.205,-.06),new THREE.Vector2(.255,.03),new THREE.Vector2(.265,.20),
  new THREE.Vector2(.315,.39),new THREE.Vector2(.375,.55),new THREE.Vector2(.35,.66),
  new THREE.Vector2(.245,.74),new THREE.Vector2(.16,.77)
];
addCharacterMesh(upperBodyPivot,new THREE.LatheGeometry(torsoPoints,24),jacketMat,[0,0,0]);
addCharacterMesh(upperBodyPivot,new THREE.CylinderGeometry(.115,.115,.12,16),skinMat,[0,.77,0]);
addCharacterMesh(upperBodyPivot,new THREE.BoxGeometry(.13,.15,.035),shirtMat,[0,.68,-.185]);
addCharacterMesh(upperBodyPivot,new THREE.BoxGeometry(.025,.56,.018),metalDetailMat,[0,.36,-.317]);
for(const side of [-1,1]) {
  addCharacterMesh(upperBodyPivot,new THREE.BoxGeometry(.12,.16,.025),jacketDarkMat,[side*.205,.37,-.31]);
  addCharacterMesh(upperBodyPivot,new THREE.BoxGeometry(.10,.035,.018),metalDetailMat,[side*.205,.43,-.328]);
  addCharacterMesh(upperBodyPivot,new THREE.BoxGeometry(.11,.045,.025),jacketDarkMat,[side*.205,.59,-.30]);
}
addCharacterMesh(upperBodyPivot,new THREE.BoxGeometry(.48,.065,.36),jacketDarkMat,[0,.03,0]);
addCharacterMesh(upperBodyPivot,new THREE.CylinderGeometry(.105,.12,.19,16),skinMat,[0,.81,0]);
addCharacterMesh(upperBodyPivot,new THREE.SphereGeometry(1,28,22),skinLightMat,[0,1.03,-.005],[.235,.285,.215]);
for(const side of [-1,1]) {
  addCharacterMesh(upperBodyPivot,new THREE.SphereGeometry(1,14,12),skinMat,[side*.231,1.03,-.005],[.055,.09,.045]);
  addCharacterMesh(upperBodyPivot,new THREE.SphereGeometry(1,14,12),eyeWhiteMat,[side*.086,1.075,-.190],[.046,.034,.022]);
  addCharacterMesh(upperBodyPivot,new THREE.SphereGeometry(1,12,10),irisMat,[side*.086,1.074,-.210],[.022,.025,.012]);
  addCharacterMesh(upperBodyPivot,new THREE.SphereGeometry(1,10,8),pupilMat,[side*.086,1.074,-.220],[.010,.016,.007]);
  addCharacterMesh(upperBodyPivot,new THREE.BoxGeometry(.095,.018,.025),hairMat,[side*.087,1.132,-.187]);
}
addCharacterMesh(upperBodyPivot,new THREE.SphereGeometry(1,12,10),skinMat,[0,1.005,-.221],[.035,.052,.045]);
addCharacterMesh(upperBodyPivot,new THREE.BoxGeometry(.065,.012,.012),detailDarkMat,[0,.905,-.211]);
addCharacterMesh(upperBodyPivot,new THREE.SphereGeometry(1,24,16),hairMat,[0,1.225,.025],[.245,.135,.225]);
for(let i=0;i<5;i++) {
  const x=(i-2)*.075;
  addCharacterMesh(upperBodyPivot,new THREE.SphereGeometry(1,12,10),hairMat,[x,1.165,-.155+Math.abs(i-2)*.006],[.065,.075,.09]);
}
const armPivots=[], forearmPivots=[];
for(const side of [-1,1]) {
  const arm=new THREE.Group(); arm.position.set(side*.385,.63,0); upperBodyPivot.add(arm); armPivots.push(arm); arm.name='armPivot'+(armPivots.length-1);
  addCharacterMesh(arm,new THREE.SphereGeometry(1,16,12),jacketMat,[0,-.035,0],[.145,.155,.145]);
  addCharacterCapsule(arm,.115,.31,jacketMat,[0,-.235,0]);
  addCharacterMesh(arm,new THREE.SphereGeometry(1,14,12),jacketDarkMat,[0,-.405,0],[.113,.105,.115]);
  const elbow=new THREE.Group(); elbow.position.set(0,-.43,0); arm.add(elbow); forearmPivots.push(elbow);
  addCharacterCapsule(elbow,.085,.285,jacketMat,[0,-.19,0]);
  addCharacterMesh(elbow,new THREE.CylinderGeometry(.087,.09,.075,12),jacketDarkMat,[0,-.355,0]);
  const hand=new THREE.Group(); hand.position.set(0,-.405,-.005); elbow.add(hand);
  addCharacterMesh(hand,new THREE.SphereGeometry(1,14,12),skinMat,[0,-.035,-.005],[.082,.105,.055]);
  for(let f=0;f<4;f++) {
    const fx=(f-1.5)*.033;
    addCharacterCapsule(hand,.014,.065,skinLightMat,[fx,-.115,-.025]);
  }
  addCharacterMesh(hand,new THREE.SphereGeometry(1,10,8),skinMat,[side*.085,-.055,-.005],[.035,.055,.035]);
}
const legPivots=[], kneePivots=[];
for(const side of [-1,1]) {
  const leg=new THREE.Group(); leg.name = `crouchLeg${legPivots.length}`; leg.position.set(side*.145,.88,0); playerModel.add(leg); legPivots.push(leg);
  addCharacterCapsule(leg,.132,.30,denimMat,[0,-.205,0]);
  addCharacterMesh(leg,new THREE.SphereGeometry(1,14,12),denimLightMat,[0,-.37,-.005],[.133,.12,.137]);
  const knee=new THREE.Group(); knee.name = `crouchKnee${kneePivots.length}`; knee.position.set(0,-.40,0); leg.add(knee); kneePivots.push(knee);
  addCharacterCapsule(knee,.105,.255,denimMat,[0,-.175,0]);
  addCharacterMesh(knee,new THREE.SphereGeometry(1,14,12),denimMat,[0,-.31,0],[.108,.11,.115]);
  addCharacterMesh(knee,new THREE.BoxGeometry(.07,.15,.012),denimLightMat,[side*.035,-.19,-.104]);
  addCharacterMesh(knee,new THREE.BoxGeometry(.235,.13,.37),shoeMat,[0,-.385,-.075]);
  addCharacterMesh(knee,new THREE.BoxGeometry(.24,.045,.38),soleMat,[0,-.448,-.075]);
  for(let lace=0;lace<3;lace++) addCharacterMesh(knee,new THREE.BoxGeometry(.105,.012,.014),metalDetailMat,[0,-.345,-.205+lace*.055]);
}
const characterRig={armPivots,forearmPivots,legPivots,kneePivots};

// Spawn player cleanly on the central neighborhood sidewalk next to the starter sports coupe!
player.position.set(6.2, 0.16, 12.0);

// ============================================================================
// TIRE SMOKE & COLLISION SPARKS PARTICLE SYSTEM
// ============================================================================
const particleCount = 180;
const particleGeo = new THREE.BufferGeometry();
const particlePos = new Float32Array(particleCount * 3);
const particleVel = [];
const particleLife = new Float32Array(particleCount);
for(let i=0; i<particleCount; i++) {
  particlePos[i*3] = 0; particlePos[i*3+1] = -100; particlePos[i*3+2] = 0;
  particleVel.push(new THREE.Vector3());
  particleLife[i] = 0;
}
particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
particleGeo.setAttribute('life', new THREE.BufferAttribute(particleLife, 1));
const particleMat = new THREE.ShaderMaterial({transparent:true, depthWrite:false, uniforms:{tex:{value:null}, scale:{value:600}},
  vertexShader:'attribute float life; varying float vL; uniform float scale; void main(){ vL = life; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = clamp((0.5 + (1.0 - life) * 2.6) * scale / -mv.z, 1.0, 220.0); gl_Position = projectionMatrix * mv; }',
  fragmentShader:'uniform sampler2D tex; varying float vL; void main(){ vec4 c = texture2D(tex, gl_PointCoord); float a = c.a * vL * 0.5; if(a < 0.01) discard; gl_FragColor = vec4(0.82, 0.84, 0.86, a); }'});
const particleSystem = new THREE.Points(particleGeo, particleMat);
scene.add(particleSystem);
let particleIndex = 0;

function emitParticle(pos, vel, spread=1.4) {
  const positions = particleGeo.attributes.position.array;
  positions[particleIndex*3] = pos.x + (Math.random()-.5)*.45;
  positions[particleIndex*3+1] = pos.y + .22;
  positions[particleIndex*3+2] = pos.z + (Math.random()-.5)*.45;
  particleVel[particleIndex].set(
    vel.x * 0.15 + (Math.random()-.5)*spread,
    0.8 + Math.random()*1.4,
    vel.z * 0.15 + (Math.random()-.5)*spread
  );
  particleLife[particleIndex] = 1.0;
  particleIndex = (particleIndex + 1) % particleCount;
}

function updateParticles(dt) {
  const positions = particleGeo.attributes.position.array;
  for(let i=0; i<particleCount; i++) {
    if(particleLife[i] > 0) {
      particleLife[i] -= dt * 0.9;
      positions[i*3] += particleVel[i].x * dt;
      positions[i*3+1] += particleVel[i].y * dt;
      positions[i*3+2] += particleVel[i].z * dt;
      if(particleLife[i] <= 0) positions[i*3+1] = -100;
    }
  }
  particleGeo.attributes.position.needsUpdate = true;
  particleGeo.attributes.life.needsUpdate = true;
}

// ============================================================================
// DETAILED CAR MODELS (lathe-free: beveled extruded bodywork, merged detail meshes, real wheels)
// ============================================================================
const CARS = {
  SEDAN:{acc:1,top:42,grip:1,L:4.42,W:2.14,mass:1520,low:[[-2.21,.4],[-2.21,.8],[-2.1,.98],[-1.6,1.02],[1,1.02],[1.6,.98],[2.18,.84],[2.21,.55],[2.15,.4]],gh:[[-1.45,1],[-.95,1.52],[.45,1.52],[1.1,1]],roof:[-.95,.45,1.52],belt:1.04,hy:.76,ty:.86,mz:.75,doors:[-.55,.5],seats:[-.1,-.95],dash:.7},
  SPORT:{acc:1.15,top:52,grip:1.18,L:4.32,W:2.18,mass:1380,low:[[-2.16,.38],[-2.16,.75],[-2,.95],[-1.2,1],[.9,1],[1.6,.8],[2.16,.58],[2.12,.38]],gh:[[-1.2,.98],[-.7,1.38],[.2,1.38],[.95,.98]],roof:[-.7,.2,1.38],belt:1,hy:.68,ty:.84,mz:.7,doors:[-.45,.4],seats:[-.15],dash:.55,wing:true},
  SUV:{acc:.88,top:38,grip:.92,L:4.55,W:2.26,mass:1850,low:[[-2.27,.5],[-2.27,1.05],[-2.2,1.2],[1.2,1.2],[1.7,1.1],[2.27,.95],[2.27,.52]],gh:[[-2.15,1.2],[-2.1,1.95],[.6,1.95],[1.25,1.2]],roof:[-2.1,.6,1.95],belt:1.22,hy:.95,ty:1.05,mz:1.05,doors:[-.7,.4],seats:[.0,-1.0],dash:.75,rails:true},
  TAXI:{acc:1,top:42,grip:1,L:4.42,W:2.14,mass:1560,low:[[-2.21,.4],[-2.21,.8],[-2.1,.98],[-1.6,1.02],[1,1.02],[1.6,.98],[2.18,.84],[2.21,.55],[2.15,.4]],gh:[[-1.45,1],[-.95,1.52],[.45,1.52],[1.1,1]],roof:[-.95,.45,1.52],belt:1.04,hy:.76,ty:.86,mz:.75,doors:[-.55,.5],seats:[-.1,-.95],dash:.7,taxi:true},
  POLICE:{acc:1.12,top:50,grip:1.08,L:4.55,W:2.18,mass:1700,low:[[-2.27,.4],[-2.27,.82],[-2.15,1],[-1.6,1.04],[1,1.04],[1.6,1],[2.22,.86],[2.27,.55],[2.2,.4]],gh:[[-1.45,1.02],[-.95,1.52],[.45,1.52],[1.1,1.02]],roof:[-.95,.45,1.52],belt:1.06,hy:.78,ty:.88,mz:.76,doors:[-.55,.5],seats:[-.1,-.95],dash:.7,police:true},
  BUS:{acc:.42,top:24,grip:.78,L:10.8,W:2.6,mass:11000,low:[[-5.4,.55],[-5.4,3.05],[5.1,3.05],[5.4,2.85],[5.4,.6]],gh:[[-5.2,2.9],[-5.2,3.0],[5.1,3.0],[5.1,2.9]],roof:null,belt:1.55,hy:.9,ty:1.1,mz:1.7,doors:[3.6,-.4],seats:[4.0],dash:4.5,sideGlass:[1.65,2.85,-5,4.8],steerMax:.5,agility:.8,wb:6.4,rollMax:.05,wheelR:.5},
  TRUCK:{acc:.6,top:30,grip:.82,L:7.2,W:2.4,mass:5200,low:[[-3.6,.55],[-3.6,3.1],[.7,3.1],[.7,1.5],[2.6,1.4],[3.5,1.05],[3.6,.6]],gh:[[.85,1.5],[1,2.2],[2.3,2.2],[2.85,1.45]],roof:[.9,2.3,2.2],belt:1.5,hy:.85,ty:.95,mz:1.6,doors:[1.3,2.1],seats:[1.5],dash:2.4,steerMax:.5,agility:.9,wb:4.4,rollMax:.06},
  VAN:{acc:.7,top:32,grip:.82,L:4.75,W:2.28,mass:2100,low:[[-2.37,.5],[-2.37,2.2],[.9,2.2],[1.3,1.5],[1.9,1.2],[2.37,.95],[2.37,.52]],gh:[[.95,1.6],[1.2,2],[1.5,2],[1.8,1.5]],roof:null,belt:1.5,hy:.95,ty:1.1,mz:1.3,doors:[1.0,1.5],seats:[1.2],dash:1.75}
};
const CM = {
  trim:new THREE.MeshStandardMaterial({color:0x15191d,roughness:.6,metalness:.3}),
  chrome:new THREE.MeshStandardMaterial({color:0xdfe6ea,roughness:.12,metalness:1}),
  alloy:new THREE.MeshStandardMaterial({color:0xaab3ba,roughness:.25,metalness:.9}),
  tire:new THREE.MeshStandardMaterial({color:0x0e1013,roughness:.85}),
  light:new THREE.MeshBasicMaterial({color:0xfff5d6}),
  plate:new THREE.MeshStandardMaterial({color:0xf2f2ee,roughness:.5}),
  caliper:new THREE.MeshStandardMaterial({color:0xe63946,roughness:.4,metalness:.4})
};
function carExtr(pts, w, bs=.06, bt=.08) {
  const s = new THREE.Shape(); pts.forEach(([z,y],i) => i ? s.lineTo(z,y) : s.moveTo(z,y));
  const g = new THREE.ExtrudeGeometry(s, {depth:w-2*bt, bevelEnabled:true, bevelThickness:bt, bevelSize:bs, bevelSegments:3, curveSegments:2});
  g.translate(0,0,-(w-2*bt)/2); g.rotateY(-Math.PI/2); return g;
}
function carMerge(gs) {
  gs = gs.map(g => g.index ? g.toNonIndexed() : g); let n = 0; gs.forEach(g => n += g.attributes.position.count);
  const P = new Float32Array(n*3), N = new Float32Array(n*3), U = new Float32Array(n*2); let o = 0;
  for(const g of gs) { P.set(g.attributes.position.array,o*3); N.set(g.attributes.normal.array,o*3); if(g.attributes.uv) U.set(g.attributes.uv.array,o*2); o += g.attributes.position.count; g.dispose(); }
  const r = new THREE.BufferGeometry(); r.setAttribute('position',new THREE.BufferAttribute(P,3)); r.setAttribute('normal',new THREE.BufferAttribute(N,3)); r.setAttribute('uv',new THREE.BufferAttribute(U,2)); return r;
}
const cT = (g,x,y,z,rx=0,ry=0,rz=0) => { g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x,y,z); return g; };
const cB = (w,h,d,x,y,z,rx=0,ry=0,rz=0) => cT(new THREE.BoxGeometry(w,h,d),x,y,z,rx,ry,rz);
function makeCar(x, z, headingY=0, color=0x287fbd, archetype='SPORT') {
  const root = new THREE.Group(); scene.add(root); root.position.set(x, 0, z); root.rotation.y = headingY;
  const visual = new THREE.Group(); visual.rotation.y = Math.PI; root.add(visual);
  const chassis = new THREE.Group(); visual.add(chassis);
  const D = CARS[archetype] || CARS.SPORT, W = D.W, L = D.L, hz = L/2 + .07, sk = [-1, 1];
  const paint = new THREE.MeshStandardMaterial({color, roughness:.16, metalness:.62});
  const P = [carExtr(D.low, W)], TR = [], CH = [], LT = [];
  if(D.roof) { const [a,b,y] = D.roof; P.push(cB(W*.78,.07,b-a,0,y+.03,(a+b)/2)); }
  for(const s of sk) P.push(cB(.22,.13,.26,s*(W/2+.1),D.belt+.24,D.mz,0,s*.3));
  // trim: bumpers, grille, skirts, wheel-arch shadows, door seams, interior, wing/rails
  TR.push(cB(W*.9,.17,.2,0,.46,hz), cB(W*.9,.17,.2,0,.46,-hz), cB(W*.42,.2,.05,0,D.hy-.02,hz+.02));
  for(let i=0;i<3;i++) TR.push(cB(W*.4,.012,.06,0,D.hy-.08+i*.06,hz+.04));
  for(const s of sk) {
    TR.push(cB(.07,.12,L*.52,s*(W/2),.42,0));
    for(const z0 of D.doors) TR.push(cB(.014,.62,.02,s*(W/2+.008),D.belt-.3,z0));
    for(const wz of [-1,1]) TR.push(cT(new THREE.CylinderGeometry(.5,.5,.02,20),s*(W/2+.012),.43,wz*L*.32,0,0,Math.PI/2));
    for(const sz of D.seats) { TR.push(cB(.5,.14,.5,s*.42,D.belt-.05,sz), cB(.5,.5,.12,s*.42,D.belt+.22,sz-.28)); }
    CH.push(cB(.02,.14,.03,s*(W/2+.02),D.belt-.04,D.doors[0]+.3), cT(new THREE.CylinderGeometry(.065,.065,.22,10),s*.62,.38,-hz-.04,Math.PI/2));
    LT.push(cB(.5,.13,.08,s*.7,D.hy,hz+.02), cB(.3,.03,.06,s*.7,D.hy-.1,hz+.04));
  }
  TR.push(cB(W*.8,.22,.35,0,D.belt+.02,D.dash));
  if(D.roof) CH.push(cB(.02,.03,D.roof[1]-D.roof[0]+1,-(W/2+.03),D.belt+.01,(D.roof[0]+D.roof[1])/2), cB(.02,.03,D.roof[1]-D.roof[0]+1,(W/2+.03),D.belt+.01,(D.roof[0]+D.roof[1])/2));
  if(D.wing) { TR.push(cB(2.04,.07,.34,0,1.4,-hz+.1)); for(const s of sk) TR.push(cB(.06,.3,.2,s*.68,1.24,-hz+.1)); }
  if(D.rails) for(const s of sk) CH.push(cB(.07,.07,2.5,s*.82,D.roof[2]+.1,-.75));
  TR.push(cB(.5,.12,.02,0,.62,-hz-.04)); CH.push(cB(.5,.12,.02,0,.62,hz+.04)); // plates live in chrome/trim (cheap)
  if(D.sideGlass) { const [y0, y1, z0, z1] = D.sideGlass; for(const sx of sk) CH.push(cB(.04, y1 - y0, z1 - z0, sx*(W/2 + .01), (y0 + y1)/2, (z0 + z1)/2)); }
  const body = new THREE.Mesh(carMerge(P), paint); body.castShadow = true; body.receiveShadow = true; chassis.add(body);
  const glass = new THREE.Mesh(carExtr(D.gh, W*.86, .03, .04), sharedMat.glassDay); glass.castShadow = true; chassis.add(glass);
  chassis.add(new THREE.Mesh(carMerge(TR), CM.trim), new THREE.Mesh(carMerge(CH), CM.chrome), new THREE.Mesh(carMerge(LT), CM.light));
  const brakeLights = [];
  for(const sx of [-0.72, 0.72]) { const tl = new THREE.Mesh(new THREE.BoxGeometry(.5,.13,.06), new THREE.MeshBasicMaterial({color:0x991610})); tl.position.set(sx, D.ty, -hz-.01); chassis.add(tl); brakeLights.push(tl); }
  // wheels: tire + alloy (rim, 5 spokes, brake disc) + caliper; group spins on X
  const wheelMeshes = [], steerPivots = [], wX = W/2 - .04, wZ = D.wb ? D.wb/2 : L*.32, wsc = D.wheelR ? D.wheelR/.43 : 1;
  [[-1,1],[1,1],[-1,-1],[1,-1]].forEach(([sx,sz], i) => {
    const pivot = new THREE.Group(); pivot.position.set(sx*wX, .43*wsc, sz*wZ); pivot.scale.setScalar(wsc); visual.add(pivot); if(i < 2) steerPivots.push(pivot);
    const wh = new THREE.Group(); pivot.add(wh);
    wh.add(new THREE.Mesh(cT(new THREE.CylinderGeometry(.43,.43,.28,28),0,0,0,0,0,Math.PI/2), CM.tire));
    const A = [cT(new THREE.CylinderGeometry(.31,.31,.06,20),sx*.12,0,0,0,0,Math.PI/2), cT(new THREE.CylinderGeometry(.27,.27,.03,20),-sx*.02,0,0,0,0,Math.PI/2)];
    for(let k=0;k<5;k++) A.push(cB(.04,.56,.07,sx*.15,0,0,k*Math.PI/5));
    wh.add(new THREE.Mesh(carMerge(A), CM.alloy), new THREE.Mesh(cB(.05,.14,.2,-sx*.04,.17,0), CM.caliper));
    wheelMeshes.push(wh);
  });
  const siren = [];
  if(D.police) {
    for(const s of sk) { const m = new THREE.Mesh(new THREE.BoxGeometry(.5, .13, .22), new THREE.MeshBasicMaterial({color:s < 0 ? 0xff2020 : 0x2050ff})); m.position.set(s*.32, D.roof[2] + .12, (D.roof[0] + D.roof[1])/2); chassis.add(m); siren.push(m); }
    const bar = new THREE.Mesh(carMerge([cB(1.3, .06, .3, 0, D.roof[2] + .05, (D.roof[0] + D.roof[1])/2), ...sk.map(s => cB(.04, .6, L*.44, s*(W/2 + .03), .78, 0))]), CM.trim); chassis.add(bar);
    const white = new THREE.Mesh(carMerge(sk.map(s => cB(.03, .5, 1.9, s*(W/2 + .015), D.belt - .35, D.doors[0] + .2))), new THREE.MeshStandardMaterial({color:0x101418, roughness:.5})); chassis.add(white);
  }
  if(D.taxi) { const sg = new THREE.Mesh(new THREE.BoxGeometry(.7, .2, .28), new THREE.MeshBasicMaterial({map:makeSignTexture('TAXI', '#f4c400', '#101010')})); sg.position.set(0, D.roof[2] + .17, (D.roof[0] + D.roof[1])/2); chassis.add(sg); }
  const swTilt = new THREE.Group(); swTilt.position.set(-.42, D.belt + .2, D.dash - .28); swTilt.rotation.x = .5; chassis.add(swTilt);
  const sw = new THREE.Mesh(carMerge([new THREE.TorusGeometry(.17,.019,8,20), cB(.34,.025,.025,0,0,0), cB(.025,.17,.025,0,-.085,0)]), CM.trim); swTilt.add(sw);
  return {root, chassis, wheelMeshes, steerPivots, siren, halfW:W*.52, halfL:L*.51, spin:0, type:archetype, mass:D.mass, vx:0, vz:0, angularVel:0, steerAngle:0, roll:0, pitch:0, headlights:[], brakeLights, paint, sw, D, acc:D.acc, top:D.top, grip:D.grip};
}

CARS.BIKE = {acc:1.35, top:48, grip:.85, L:2.2, W:.8, mass:240, belt:.95, seats:[-.1], roof:null, dash:.55, steerMax:.7, agility:1.8, wb:1.4, rollMax:.5, rollGain:.9, wheelR:.34, doors:[0]};
function makeBike(x, z, headingY=0, color=0xd62828) {
  const root = new THREE.Group(); scene.add(root); root.position.set(x, 0, z); root.rotation.y = headingY;
  const visual = new THREE.Group(); visual.rotation.y = Math.PI; root.add(visual);
  const chassis = new THREE.Group(); visual.add(chassis);
  const paint = new THREE.MeshStandardMaterial({color, roughness:.25, metalness:.6}), D = CARS.BIKE;
  const frame = new THREE.Mesh(carMerge([cB(.22, .34, 1.1, 0, .72, -.05), cB(.3, .22, .6, 0, 1.0, .15), cB(.2, .12, .8, 0, .85, -.75, .15)]), paint); frame.castShadow = true; chassis.add(frame);
  chassis.add(new THREE.Mesh(carMerge([cB(.3, .1, .75, 0, .95, -.5), cB(.14, .06, .3, 0, .5, -1.0), cT(new THREE.CylinderGeometry(.06, .06, .5, 8), 0, .35, -.1, 0, 0, Math.PI/2)]), CM.trim));
  const headlight = new THREE.Mesh(new THREE.SphereGeometry(.12, 10, 8), CM.light); headlight.position.set(0, .98, .72); chassis.add(headlight);
  const forkPivot = new THREE.Group(); forkPivot.position.set(0, .45, .75); visual.add(forkPivot);
  forkPivot.add(new THREE.Mesh(carMerge([cB(.07, .9, .08, .12, .35, 0, .25), cB(.07, .9, .08, -.12, .35, 0, .25), cB(.7, .05, .05, 0, .82, -.1)]), CM.chrome));
  const wheelMeshes = [], mk = (parent, py, pz) => { const piv = new THREE.Group(); piv.position.set(0, py, pz); parent.add(piv); const wh = new THREE.Group(); piv.add(wh);
    wh.add(new THREE.Mesh(cT(new THREE.CylinderGeometry(.34, .34, .16, 20), 0, 0, 0, 0, 0, Math.PI/2), CM.tire)); wh.add(new THREE.Mesh(cT(new THREE.CylinderGeometry(.2, .2, .18, 14), 0, 0, 0, 0, 0, Math.PI/2), CM.alloy)); wheelMeshes.push(wh); };
  mk(forkPivot, -.11, .0); mk(visual, .34, -.78);
  const tl = new THREE.Mesh(new THREE.BoxGeometry(.22, .08, .05), new THREE.MeshBasicMaterial({color:0x991610})); tl.position.set(0, .95, -1.08); chassis.add(tl);
  return {root, chassis, wheelMeshes, steerPivots:[forkPivot], siren:[], halfW:.52, halfL:1.12, spin:0, type:'BIKE', mass:D.mass, vx:0, vz:0, angularVel:0, steerAngle:0, roll:0, pitch:0, headlights:[], brakeLights:[tl], paint, D, acc:D.acc, top:D.top, grip:D.grip};
}

const cars = [
  // Parallel-parked at the curb (right-hand side of each road, aligned with traffic), never in a lane
  makeCar( 3.3,  14.0, 0,           0x287fbd, 'SPORT'),
  makeCar(-3.3, -18.0, Math.PI,     0xd2a343, 'SEDAN'),
  makeCar( 24.0,  3.3, -Math.PI/2,  0x4c9a68, 'SUV'),
  makeCar(-28.0, -3.3, Math.PI/2,   0xc84b31, 'SPORT'),
  makeCar( 66.7, 22.0, 0,           0xe2e8f0, 'VAN'),
  makeCar( -3.3, 44.0, Math.PI,     0x7c3aed, 'SPORT'),
  makeCar( 22.0, 66.7, -Math.PI/2,  0x0ea5e9, 'SEDAN'),
  makeCar(-50.0, -3.3, Math.PI/2,   0xf59e0b, 'SUV')
];
let activeCar = null;

