/* =====================================================================
   VECTORAMA — a hyper-fast psychedelic vector arcade flight game
   Vanilla JS + Three.js (r128 UMD global `THREE`). No build step.
   Visual priority 10 / gameplay 6. Everything reacts to speed.
   ===================================================================== */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const rint = (a, b) => (a + Math.random() * (b - a + 1)) | 0;
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const chance = (p) => Math.random() < p;

  /* ------------------------------------------------------------------ *
   *  CONFIG — tune everything here                                     *
   * ------------------------------------------------------------------ */
  const CFG = {
    playerZ: -7,
    spawnZ: -480,          // where world objects appear (deeper = longer warp)
    recycleZ: 22,          // behind camera -> recycle
    moveX: 34,             // horizontal steering half-range
    moveUp: 15,
    moveDown: -19,
    fovBase: 82,
    fovMax: 134,
    worldSpeed: 150,       // world units / sec at speed factor 1
    speedStart: 1.5,
    speedMin: 0.9,
    speedMax: 9.5,
    speedDecay: 0.18,      // factor lost per second
    boostGate: 1.1,
    normalGate: 0.12,
    energy: 3,
    invuln: 1.15,
    collideR: 3.1,
    nearMissR: 7.6,
    fireRate: 0.07,
  };

  // colour zones (hex arrays). last of each acts as danger accent.
  const ZONES = [
    { name: 'VECTOR GRID',   cols: [0x00ffff, 0x0088ff, 0xffffff], danger: 0xff2255, fog: 0x00030a, env: ['grid', 'rings'] },
    { name: 'MAGENTA MACHINE',cols:[0xff00cc, 0xff2266, 0xaa00ff], danger: 0xffee00, fog: 0x0a0010, env: ['city', 'polys'] },
    { name: 'ACID WARNING',  cols: [0xffee00, 0xff7a00, 0xffffff], danger: 0xff0033, fog: 0x0a0700, env: ['grid', 'polys'] },
    { name: 'GREEN COMPUTER',cols: [0x00ff66, 0x00cc55, 0xd6ffe6], danger: 0xff0066, fog: 0x001005, env: ['grid', 'laser'] },
    { name: 'RGB ATTACK',    cols: [0xff1133, 0x11ff33, 0x1155ff], danger: 0xffffff, fog: 0x030308, env: ['polys', 'rings'] },
    { name: 'ULTRAVIOLET',   cols: [0x9b00ff, 0x00e5ff, 0xff2bb2], danger: 0xffe000, fog: 0x0a0016, env: ['city', 'rings'] },
    { name: 'WHITE VOID',    cols: [0xffffff, 0xbfefff, 0x00ffd0], danger: 0xff0033, fog: 0x000000, env: ['void', 'laser'] },
    { name: 'TOTAL CHROMA',  cols: [0xff0033, 0xffaa00, 0x00ff66, 0x00a2ff, 0xb400ff], danger: 0xffffff, fog: 0x050208, env: ['rings', 'laser', 'polys'] },
  ];

  // quality tiers (spawn caps). buffers allocated at MAX regardless.
  const QUAL = {
    HIGH: { dpr: 2.0, streaks: 1100, targets: 64, part: 1.0 },
    MED:  { dpr: 1.5, streaks: 620, targets: 46, part: 0.72 },
    LOW:  { dpr: 1.0, streaks: 300, targets: 30, part: 0.5 },
  };
  const MAX = { streak: 1100, part: 6000, proj: 80, target: 64, gate: 22, pow: 6 };

  /* ------------------------------------------------------------------ *
   *  DOM                                                               *
   * ------------------------------------------------------------------ */
  const D = {};
  ['scene','hud','score','speed','mult','energy','banner','zonetag',
   'start','boot','bootlog','over','over-stats','rotate','flash','mute','game'
  ].forEach(id => D[id] = document.getElementById(id) || document.querySelector('#' + id));
  D.game = document.getElementById('game');
  D.energyDots = D.energy.querySelectorAll('span');

  /* ------------------------------------------------------------------ *
   *  THREE core                                                        *
   * ------------------------------------------------------------------ */
  let renderer, scene, camera;
  const _v = new THREE.Vector3();
  const _c = new THREE.Color();
  const _c2 = new THREE.Color();
  const _q = new THREE.Object3D(); // matrix scratch

  const S = {
    mode: 'menu',            // menu | boot | play | dying | over
    q: QUAL.HIGH,
    tier: 'HIGH',
    speed: CFG.speedStart,
    speedN: 0,               // normalized 0..1
    score: 0, best: 0, mult: 1, combo: 0,
    energy: CFG.energy,
    invuln: 0,
    zone: 0, palette: null, danger: 0xff2255,
    beat: 0, beatClock: 0, phrase: 0,
    section: 'build',
    megaCool: 6, mega: null, voidT: 0,
    overdrive: 0,
    shake: 0, roll: 0,
    dieT: 0, freeze: 0,
    hueShift: 0,
    stats: { gates: 0, near: 0, maxSpeed: 1 },
    world: 0,                // world units advanced this frame
    t: 0,
    started: false,
  };

  function initThree() {
    renderer = new THREE.WebGLRenderer({ canvas: D.scene, antialias: false, alpha: false, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 1);
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000308, 0.0049);
    camera = new THREE.PerspectiveCamera(CFG.fovBase, innerWidth / innerHeight, 0.1, 800);
    camera.position.set(0, 1.6, 6);
    detectTier();
    applyDPR();
    resize();
    buildStarStreaks();
    buildGrids();
    buildParticles();
    buildProjectiles();
    buildTargets();
    buildGates();
    buildPowerups();
    buildShip();
  }

  function detectTier() {
    const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    setTier(mobile ? 'MED' : 'HIGH');
  }
  function setTier(t) { S.tier = t; S.q = QUAL[t]; applyDPR(); if (streaks) streaks.geometry.setDrawRange(0, S.q.streaks * 2); }
  function applyDPR() { if (renderer) renderer.setPixelRatio(Math.min(devicePixelRatio || 1, S.q.dpr)); }

  function resize() {
    const w = innerWidth, h = innerHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  addEventListener('resize', () => { if (renderer) resize(); });

  /* ------------------------------------------------------------------ *
   *  Materials helpers                                                 *
   * ------------------------------------------------------------------ */
  function neonMat(color, opacity) {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity == null ? 1 : opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  }
  function lineMat(color, opacity) {
    return new THREE.LineBasicMaterial({ color, transparent: true, opacity: opacity == null ? 1 : opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  }
  function wireMat(color, opacity) {
    return new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: opacity == null ? 1 : opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  }

  // merge indexed BufferGeometries (position + index only)
  function mergeGeos(list) {
    let vc = 0, ic = 0;
    list.forEach(g => { vc += g.attributes.position.count; ic += g.index ? g.index.count : 0; });
    const pos = new Float32Array(vc * 3); const idx = new Uint16Array(ic);
    let vo = 0, io = 0;
    list.forEach(g => {
      const p = g.attributes.position.array; pos.set(p, vo * 3);
      if (g.index) { const gi = g.index.array; for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo; io += gi.length; }
      vo += g.attributes.position.count;
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (ic) out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
  }

  // square neon frame geometry (4 thin bars)
  function frameGeo(size, thick) {
    const half = size / 2, t = thick / 2, bars = [];
    const mk = (w, h, x, y) => { const g = new THREE.BoxGeometry(w, h, thick); g.translate(x, y, 0); return g; };
    bars.push(mk(size, thick, 0, half), mk(size, thick, 0, -half), mk(thick, size, half, 0), mk(thick, size, -half, 0));
    const g = mergeGeos(bars); bars.forEach(b => b.dispose()); return g;
  }

  // n-point star outline as line segments geometry
  function starGeo(r, points, inner) {
    const pts = [];
    for (let i = 0; i < points * 2; i++) {
      const a = (i / (points * 2)) * TAU - Math.PI / 2;
      const rad = i % 2 ? r * inner : r;
      pts.push(new THREE.Vector3(Math.cos(a) * rad, Math.sin(a) * rad, 0));
    }
    const seg = [];
    for (let i = 0; i < pts.length; i++) { seg.push(pts[i], pts[(i + 1) % pts.length]); }
    const g = new THREE.BufferGeometry().setFromPoints(seg); return g;
  }

  /* shared geometries -------------------------------------------------*/
  const GEO = {};
  function shared() {
    GEO.ring = new THREE.TorusGeometry(1, 0.05, 8, 48);
    GEO.ringFat = new THREE.TorusGeometry(1, 0.12, 10, 64);
    GEO.box = new THREE.BoxGeometry(1, 1, 1);
    GEO.octa = new THREE.OctahedronGeometry(1);
    GEO.tetra = new THREE.TetrahedronGeometry(1);
    GEO.icosa = new THREE.IcosahedronGeometry(1, 1);
    GEO.cyl = new THREE.CylinderGeometry(1, 1, 1, 6);
    GEO.diamond = new THREE.OctahedronGeometry(1, 1);
    GEO.torusHi = new THREE.TorusGeometry(1, 0.05, 8, 48);
    for (const k in GEO) GEO[k]._keep = true; // never dispose shared geometry
  }

  /* ------------------------------------------------------------------ *
   *  STAR STREAKS  (hyperspace warp)                                   *
   * ------------------------------------------------------------------ */
  let streaks, streakData;
  function buildStarStreaks() {
    const N = MAX.streak;
    const pos = new Float32Array(N * 2 * 3);
    const col = new Float32Array(N * 2 * 3);
    streakData = new Float32Array(N * 4); // x,y,z,spd
    for (let i = 0; i < N; i++) resetStreak(i, true, pos);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setDrawRange(0, S.q.streaks * 2);
    const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1.0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
    streaks = new THREE.LineSegments(g, m); streaks.frustumCulled = false; scene.add(streaks);
  }
  function resetStreak(i, spread, pos) {
    const a = Math.random() * TAU, r = rand(5, 175);
    streakData[i * 4] = Math.cos(a) * r;
    streakData[i * 4 + 1] = Math.sin(a) * r * 0.7;
    streakData[i * 4 + 2] = spread ? rand(CFG.spawnZ, CFG.recycleZ) : CFG.spawnZ - rand(0, 180);
    streakData[i * 4 + 3] = rand(0.8, 1.35);
  }
  function updateStreaks(dt) {
    const p = streaks.geometry.attributes.position.array;
    const c = streaks.geometry.attributes.color.array;
    const len = 14 + S.speedN * 175 + S.overdrive * 95;
    const pal = S.palette;
    for (let i = 0; i < S.q.streaks; i++) {
      let z = streakData[i * 4 + 2] + S.world * streakData[i * 4 + 3] * (1.12 + S.speedN * 0.7);
      if (z > CFG.recycleZ) { resetStreak(i, false); z = streakData[i * 4 + 2]; }
      streakData[i * 4 + 2] = z;
      const x = streakData[i * 4], y = streakData[i * 4 + 1];
      const o = i * 6;
      p[o] = x; p[o + 1] = y; p[o + 2] = z;
      p[o + 3] = x; p[o + 4] = y; p[o + 5] = z - len;
      if (Math.random() < 0.10) { _c.setHex(0xffffff); } else { _c.setHex(pick(pal)); }
      const br = 0.74 + Math.random() * 0.26;
      c[o] = _c.r * br; c[o + 1] = _c.g * br; c[o + 2] = _c.b * br;
      c[o + 3] = _c.r * 0.04; c[o + 4] = _c.g * 0.04; c[o + 5] = _c.b * 0.04;
    }
    streaks.geometry.attributes.position.needsUpdate = true;
    streaks.geometry.attributes.color.needsUpdate = true;
  }

  /* ------------------------------------------------------------------ *
   *  GRID  (scrolling neon floor + ceiling)                            *
   * ------------------------------------------------------------------ */
  let gridFloor, gridCeil, gridCell = 16, gridVisible = true;
  function makeGrid(y, color) {
    const cells = 42, w = 360, lines = 22;
    const pts = [];
    for (let i = -lines; i <= lines; i++) { const x = i * (w / (lines * 2)); pts.push(new THREE.Vector3(x, y, -cells * gridCell + 20), new THREE.Vector3(x, y, 40)); }
    for (let j = 0; j <= cells; j++) { const z = 40 - j * gridCell; pts.push(new THREE.Vector3(-w / 2, y, z), new THREE.Vector3(w / 2, y, z)); }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = lineMat(color, 0.6);
    const ls = new THREE.LineSegments(g, m); ls.frustumCulled = false; return ls;
  }
  function buildGrids() {
    gridFloor = makeGrid(-15, 0x00ffff); gridCeil = makeGrid(20, 0x0066ff);
    scene.add(gridFloor); scene.add(gridCeil);
  }
  function updateGrid() {
    let z = (gridFloor.position.z + S.world) % gridCell;
    gridFloor.position.z = z; gridCeil.position.z = z;
    gridFloor.visible = gridCeil.visible = gridVisible;
    const puls = 0.42 + S.speedN * 0.42 + Math.abs(Math.sin(S.t * 3.2)) * 0.22;
    gridFloor.material.opacity = puls; gridCeil.material.opacity = puls * 0.85;
  }

  /* ------------------------------------------------------------------ *
   *  PARTICLES  (explosions / bursts / trail / sparks)                 *
   * ------------------------------------------------------------------ */
  let parts, pPos, pCol, pBase, pVel, pLife, pMax, pSize, pCur = 0;
  function buildParticles() {
    const N = MAX.part;
    pPos = new Float32Array(N * 3); pCol = new Float32Array(N * 3);
    pBase = new Float32Array(N * 3); pVel = new Float32Array(N * 3);
    pLife = new Float32Array(N); pMax = new Float32Array(N); pSize = new Float32Array(N);
    for (let i = 0; i < N; i++) pPos[i * 3 + 2] = 999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
    const m = new THREE.PointsMaterial({ size: 1.5, vertexColors: true, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: true });
    parts = new THREE.Points(g, m); parts.frustumCulled = false; scene.add(parts);
  }
  function spawnPart(x, y, z, vx, vy, vz, hex, life, size) {
    const i = pCur; pCur = (pCur + 1) % MAX.part;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
    _c.setHex(hex); pBase[i * 3] = _c.r; pBase[i * 3 + 1] = _c.g; pBase[i * 3 + 2] = _c.b;
    pLife[i] = life; pMax[i] = life; pSize[i] = size || 1.6;
  }
  function updateParts(dt) {
    const drift = S.world; let maxSize = 0;
    for (let i = 0; i < MAX.part; i++) {
      if (pLife[i] <= 0) { if (pCol[i * 3] !== 0) { pCol[i * 3] = pCol[i * 3 + 1] = pCol[i * 3 + 2] = 0; } continue; }
      pLife[i] -= dt;
      const f = clamp(pLife[i] / pMax[i], 0, 1);
      pPos[i * 3] += pVel[i * 3] * dt;
      pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
      pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt + drift;
      pVel[i * 3] *= 0.985; pVel[i * 3 + 1] *= 0.985;
      pCol[i * 3] = pBase[i * 3] * f; pCol[i * 3 + 1] = pBase[i * 3 + 1] * f; pCol[i * 3 + 2] = pBase[i * 3 + 2] * f;
      if (pSize[i] > maxSize) maxSize = pSize[i];
    }
    parts.geometry.attributes.position.needsUpdate = true;
    parts.geometry.attributes.color.needsUpdate = true;
    parts.material.size = 1.4 + S.speedN * 1.2;
  }
  function explode(x, y, z, hex, n, power) {
    n = Math.floor(n * S.q.part);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, b = rand(-1, 1), s = rand(0.3, 1) * power;
      const vx = Math.cos(a) * s * (1 - Math.abs(b)), vy = b * s, vz = Math.sin(a) * s * (1 - Math.abs(b)) - rand(0, power * 0.4);
      spawnPart(x, y, z, vx * 24, vy * 24, vz * 24, chance(0.32) ? 0xffffff : hex, rand(0.45, 1.0), rand(1.6, 3.6));
    }
  }

  /* ------------------------------------------------------------------ *
   *  PROJECTILES  (auto-fire dashes, instanced)                        *
   * ------------------------------------------------------------------ */
  let proj, projData; // x,y,z,alive
  function buildProjectiles() {
    const g = new THREE.BoxGeometry(0.22, 0.22, 4.2);
    proj = new THREE.InstancedMesh(g, neonMat(0xffffff, 0.95), MAX.proj);
    proj.frustumCulled = false; proj.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    projData = new Float32Array(MAX.proj * 4);
    for (let i = 0; i < MAX.proj; i++) { _q.position.set(0, 0, 999); _q.scale.setScalar(0.001); _q.updateMatrix(); proj.setMatrixAt(i, _q.matrix); }
    scene.add(proj);
  }
  let projCur = 0, fireT = 0;
  function fire() {
    for (let k = 0; k < (S.overdrive > 0 ? 2 : 1); k++) {
      const i = projCur; projCur = (projCur + 1) % MAX.proj;
      projData[i * 4] = ship.x + (k ? rand(-2, 2) : 0);
      projData[i * 4 + 1] = ship.y + 0.2;
      projData[i * 4 + 2] = CFG.playerZ - 2;
      projData[i * 4 + 3] = 1;
      proj.setColorAt(i, _c.setHex(pick(S.palette)));
    }
    proj.instanceColor.needsUpdate = true;
    Audio.fire();
  }
  function updateProjectiles(dt) {
    const spd = 240 + S.speedN * 120;
    for (let i = 0; i < MAX.proj; i++) {
      if (projData[i * 4 + 3] <= 0) continue;
      projData[i * 4 + 2] -= spd * dt;
      if (projData[i * 4 + 2] < CFG.spawnZ) { projData[i * 4 + 3] = 0; hideInst(proj, i); continue; }
      _q.position.set(projData[i * 4], projData[i * 4 + 1], projData[i * 4 + 2]);
      _q.rotation.set(0, 0, 0); _q.scale.set(1, 1, 1 + S.speedN * 2.4); _q.updateMatrix();
      proj.setMatrixAt(i, _q.matrix);
    }
    proj.instanceMatrix.needsUpdate = true;
  }
  function hideInst(mesh, i) { _q.position.set(0, 0, 999); _q.scale.setScalar(0.0001); _q.updateMatrix(); mesh.setMatrixAt(i, _q.matrix); }

  /* ------------------------------------------------------------------ *
   *  TARGETS  (shootable / dodgeable abstract shapes)                  *
   * ------------------------------------------------------------------ */
  const targets = [];
  function buildTargets() {
    const geos = [GEO.box, GEO.octa, GEO.tetra, GEO.diamond, GEO.icosa, GEO.torusHi];
    for (let i = 0; i < MAX.target; i++) {
      const g = pick(geos);
      const mesh = new THREE.Mesh(g, wireMat(0xffffff, 0.95));
      mesh.visible = false; scene.add(mesh);
      targets.push({ mesh, alive: false, r: 2, vx: 0, vy: 0, spin: 0, near: false, hazard: true });
    }
  }
  function spawnTarget(opts) {
    opts = opts || {};
    for (const t of targets) {
      if (t.alive) continue;
      const g = pick([GEO.box, GEO.octa, GEO.tetra, GEO.diamond, GEO.icosa, GEO.torusHi]);
      t.mesh.geometry = g;
      const s = opts.scale || (chance(0.14) ? rand(5.5, 9.5) : rand(1.8, 3.8));
      t.mesh.scale.setScalar(s); t.r = s * 1.05;
      t.mesh.position.set(opts.x != null ? opts.x : rand(-CFG.moveX, CFG.moveX),
        opts.y != null ? opts.y : rand(CFG.moveDown + 4, CFG.moveUp - 2), CFG.spawnZ + rand(-30, 0));
      t.mesh.material.color.setHex(opts.color || pick(S.palette));
      t.vx = opts.vx != null ? opts.vx : rand(-6, 6);
      t.vy = opts.vy || 0; t.spin = rand(2, 7) * (chance(0.5) ? 1 : -1);
      t.alive = true; t.near = false; t.mesh.visible = true;
      return t;
    }
    return null;
  }
  function updateTargets(dt) {
    for (const t of targets) {
      if (!t.alive) continue;
      const m = t.mesh;
      m.position.z += S.world; m.position.x += t.vx * dt; m.position.y += t.vy * dt;
      m.rotation.x += t.spin * dt; m.rotation.y += t.spin * 0.8 * dt;
      if (m.position.z > CFG.recycleZ) { t.alive = false; m.visible = false; continue; }
      // projectile hits
      if (m.position.z > CFG.spawnZ + 30 && m.position.z < 6) {
        for (let i = 0; i < MAX.proj; i++) {
          if (projData[i * 4 + 3] <= 0) continue;
          const dz = projData[i * 4 + 2] - m.position.z;
          if (dz > -6 && dz < 6) {
            const dx = projData[i * 4] - m.position.x, dy = projData[i * 4 + 1] - m.position.y;
            if (dx * dx + dy * dy < t.r * t.r * 1.4) { killTarget(t); projData[i * 4 + 3] = 0; hideInst(proj, i); break; }
          }
        }
      }
      if (!t.alive) continue;
      // collision / near-miss vs player
      if (m.position.z > CFG.playerZ - 3.5 && m.position.z < CFG.playerZ + 3.5) {
        const dx = m.position.x - ship.x, dy = m.position.y - ship.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < CFG.collideR * CFG.collideR && S.invuln <= 0 && S.overdrive <= 0) { damage(m.position.x, m.position.y); killTarget(t, true); }
        else if (!t.near && d2 < CFG.nearMissR * CFG.nearMissR) { t.near = true; nearMiss(); }
      }
    }
  }
  function killTarget(t, silent) {
    t.alive = false; t.mesh.visible = false;
    explode(t.mesh.position.x, t.mesh.position.y, t.mesh.position.z, t.mesh.material.color.getHex(), 24, 1.3);
    if (!silent) { addScore(120, true); Audio.hit(); bumpMult(0.04); }
  }

  /* ------------------------------------------------------------------ *
   *  GATES                                                             *
   * ------------------------------------------------------------------ */
  const gates = [];
  function buildGates() {
    for (let i = 0; i < MAX.gate; i++) {
      const grp = new THREE.Group();
      const ring = new THREE.Mesh(GEO.ringFat, neonMat(0x00ffff, 0.95));
      grp.add(ring); grp.visible = false; scene.add(grp);
      gates.push({ grp, ring, alive: false, boost: false, r: 12, passed: false, extra: [] });
    }
  }
  function spawnGate(boost) {
    for (const g of gates) {
      if (g.alive) continue;
      const r = boost ? rand(13, 17) : rand(9, 15);
      g.r = r; g.boost = boost; g.passed = false; g.alive = true; g.grp.visible = true;
      g.grp.position.set(rand(-18, 18), rand(-6, 8), CFG.spawnZ);
      g.ring.scale.setScalar(r);
      const col = boost ? pick(S.palette) : S.palette[0];
      g.ring.material.color.setHex(col);
      // clear extras
      g.extra.forEach(e => { g.grp.remove(e); if (e.material) e.material.dispose(); });
      g.extra.length = 0;
      if (boost) {
        for (let k = 1; k <= 5; k++) {
          const e = new THREE.Mesh(GEO.ring, neonMat(pick(S.palette), 0.85));
          e.scale.setScalar(r + k * 2.4); e.position.z = k * 3.2;
          g.grp.add(e); g.extra.push(e);
        }
        // chevrons
        for (let k = 0; k < 12; k++) {
          const bar = new THREE.Mesh(GEO.box, neonMat(pick(S.palette), 0.9));
          const a = (k / 12) * TAU; bar.position.set(Math.cos(a) * (r + 1), Math.sin(a) * (r + 1), 0);
          bar.scale.set(0.5, 3.4, 0.5); bar.rotation.z = a; g.grp.add(bar); g.extra.push(bar);
        }
      }
      return g;
    }
    return null;
  }
  function updateGates(dt) {
    for (const g of gates) {
      if (!g.alive) continue;
      g.grp.position.z += S.world;
      g.grp.rotation.z += (g.boost ? 1.4 : 0.5) * dt;
      const pulse = 1 + Math.sin(S.t * 8 + g.grp.position.z) * (g.boost ? 0.06 : 0.03);
      g.ring.scale.setScalar(g.r * pulse);
      if (!g.passed && g.grp.position.z > CFG.playerZ) {
        g.passed = true;
        const dx = ship.x - g.grp.position.x, dy = ship.y - g.grp.position.y;
        if (dx * dx + dy * dy < g.r * g.r) passGate(g);
      }
      if (g.grp.position.z > CFG.recycleZ) { g.alive = false; g.grp.visible = false; }
    }
  }
  function passGate(g) {
    S.stats.gates++;
    gateBurst(g.grp.position.x, g.grp.position.y, g.ring.material.color.getHex(), g.boost);
    if (g.boost) {
      S.speed = clamp(S.speed + CFG.boostGate, CFG.speedMin, CFG.speedMax);
      addScore(600, true); bumpMult(0.4); flash('#fff', 0.5); pulseFOV();
      setBanner('BOOST'); Audio.boost();
    } else {
      S.speed = clamp(S.speed + CFG.normalGate, CFG.speedMin, CFG.speedMax);
      addScore(200, true); bumpMult(0.12); Audio.gate();
    }
  }
  function gateBurst(x, y, hex, big) {
    const n = big ? 96 : 40;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, sp = big ? rand(18, 40) : rand(10, 22);
      spawnPart(x, y, CFG.playerZ, Math.cos(a) * sp, Math.sin(a) * sp, rand(-4, 8), chance(0.4) ? 0xffffff : hex, rand(0.4, 0.8), big ? 2.6 : 1.8);
    }
  }

  /* ------------------------------------------------------------------ *
   *  POWERUPS                                                          *
   * ------------------------------------------------------------------ */
  const POWTYPES = [
    { id: 'SHIELD', color: 0x00ffff }, { id: 'OVERDRIVE', color: 0xff00cc },
    { id: 'SLOW', color: 0x00ff66 }, { id: 'WIDE', color: 0xffee00 },
  ];
  const powerups = [];
  function buildPowerups() {
    for (let i = 0; i < MAX.pow; i++) {
      const grp = new THREE.Group();
      const core = new THREE.Mesh(GEO.icosa, wireMat(0xffffff, 1));
      const shell = new THREE.Mesh(GEO.icosa, neonMat(0xffffff, 0.25));
      shell.scale.setScalar(1.6); grp.add(core); grp.add(shell);
      grp.visible = false; scene.add(grp);
      powerups.push({ grp, core, shell, alive: false, type: null });
    }
  }
  function spawnPowerup() {
    for (const p of powerups) {
      if (p.alive) continue;
      const t = pick(POWTYPES); p.type = t; p.alive = true; p.grp.visible = true;
      p.grp.position.set(rand(-16, 16), rand(-4, 8), CFG.spawnZ);
      p.grp.scale.setScalar(2.6);
      p.core.material.color.setHex(t.color); p.shell.material.color.setHex(t.color);
      return p;
    }
  }
  function updatePowerups(dt) {
    for (const p of powerups) {
      if (!p.alive) continue;
      p.grp.position.z += S.world;
      p.grp.rotation.x += 2 * dt; p.grp.rotation.y += 2.6 * dt;
      p.shell.scale.setScalar(1.5 + Math.sin(S.t * 6) * 0.25);
      if (p.grp.position.z > CFG.playerZ - 3 && p.grp.position.z < CFG.playerZ + 3) {
        const dx = p.grp.position.x - ship.x, dy = p.grp.position.y - ship.y;
        if (dx * dx + dy * dy < 30) { collectPower(p); }
      }
      if (p.grp.position.z > CFG.recycleZ) { p.alive = false; p.grp.visible = false; }
    }
  }
  function collectPower(p) {
    p.alive = false; p.grp.visible = false;
    explode(p.grp.position.x, p.grp.position.y, CFG.playerZ, p.type.color, 70, 1.9);
    setBanner(p.type.id); flash('#fff', 0.6);
    if (p.type.id === 'OVERDRIVE') { S.overdrive = 8; S.speed = clamp(S.speed + 1.4, 0, CFG.speedMax); Audio.overdrive(); bumpMult(1.5); }
    else if (p.type.id === 'SHIELD') { S.invuln = Math.max(S.invuln, 6); Audio.powerup(); }
    else if (p.type.id === 'SLOW') { S.speed = clamp(S.speed - 1.0, CFG.speedMin, CFG.speedMax); S.invuln = Math.max(S.invuln, 2.5); Audio.powerup(); }
    else { bumpMult(0.5); Audio.powerup(); }
  }

  /* ------------------------------------------------------------------ *
   *  SHIP                                                              *
   * ------------------------------------------------------------------ */
  const ship = { x: 0, y: -2, tx: 0, ty: -2, px: 0, vx: 0 };
  let shipGrp, shipCore;
  function buildShip() {
    shipGrp = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.6, 3), neonMat(0x00ffff, 1));
    cone.rotation.x = -Math.PI / 2; shipGrp.add(cone); shipCore = cone;
    const shell = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3.4, 3), wireMat(0xffffff, 0.5));
    shell.rotation.x = -Math.PI / 2; shipGrp.add(shell);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.2, 12), neonMat(0xff00cc, 0.5));
    glow.position.z = 1.4; shipGrp.add(glow);
    shipGrp.position.set(0, -2, CFG.playerZ); scene.add(shipGrp);
  }
  function updateShip(dt) {
    ship.px = ship.x;
    const rate = 1 - Math.exp(-dt * 11);
    ship.x = lerp(ship.x, ship.tx, rate);
    ship.y = lerp(ship.y, ship.ty, rate);
    ship.vx = (ship.x - ship.px) / Math.max(dt, 0.001);
    shipGrp.position.set(ship.x, ship.y, CFG.playerZ);
    shipGrp.rotation.z = clamp(-ship.vx * 0.02, -0.8, 0.8);
    shipGrp.rotation.x = clamp(-(ship.ty - ship.y) * 0.03, -0.4, 0.4);
    const blink = S.invuln > 0 ? (Math.sin(S.t * 40) > 0 ? 0.2 : 1) : 1;
    shipCore.material.opacity = blink;
    shipCore.material.color.setHex(S.palette[0]);
    // engine trail
    if (S.mode === 'play') {
      for (let k = 0; k < 3; k++) spawnPart(ship.x + rand(-0.7, 0.7), ship.y + rand(-0.5, 0.5), CFG.playerZ + 1.6,
        rand(-2.5, 2.5), rand(-2.5, 2.5), rand(24, 48), chance(0.5) ? S.palette[0] : 0xffffff, rand(0.22, 0.5), rand(1.6, 2.8));
    }
  }

  /* ------------------------------------------------------------------ *
   *  MEGA EVENTS  (12 archetypes, procedurally varied)                 *
   * ------------------------------------------------------------------ */
  const MEGA = {};
  function pal() { return S.palette; }
  function evGroup() { const g = new THREE.Group(); g.position.z = CFG.spawnZ; scene.add(g); return g; }
  function disposeGroup(g) {
    g.traverse(o => { if (o.geometry && !o.geometry._keep) o.geometry.dispose(); if (o.material) { if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material.dispose(); } });
    scene.remove(g);
  }

  MEGA.RADIAL_BURST = () => {
    const g = evGroup(); const n = 300; const p = pal();
    const seg = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU, r = rand(50, 230); seg.push(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0)); }
    const ls = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), lineMat(pick(p), 0.8)); ls.frustumCulled = false; g.add(ls);
    return { g, dur: 4, spin: rand(-1, 1), update(dt) { g.rotation.z += this.spin * dt; ls.material.color.setHex(pick(p)); } };
  };
  MEGA.GIANT_STAR = () => {
    const g = evGroup(); const p = pal();
    const s = new THREE.LineSegments(starGeo(rand(70, 120), rint(5, 9), rand(0.4, 0.6)), lineMat(pick(p), 1)); s.frustumCulled = false; g.add(s);
    const s2 = new THREE.LineSegments(s.geometry, lineMat(pick(p), 0.6)); s2.scale.setScalar(0.6); s2.frustumCulled = false; g.add(s2);
    return { g, dur: 6, update(dt) { g.rotation.z += 0.5 * dt; s2.rotation.z -= 1.2 * dt; } };
  };
  MEGA.FRAME_TUNNEL = () => {
    const g = evGroup(); const p = pal(); const n = 78; const sq = frameGeo(1, 0.06);
    const m = new THREE.InstancedMesh(sq, neonMat(0xffffff, 0.9), n); m.frustumCulled = false; g.add(m);
    const twist = rand(-0.18, 0.18), rad = rand(30, 52);
    for (let i = 0; i < n; i++) {
      _q.position.set(Math.sin(i * 0.3) * 3, Math.cos(i * 0.3) * 3, -i * 9);
      _q.rotation.set(0, 0, i * twist); _q.scale.setScalar(rad + Math.sin(i * 0.4) * 6); _q.updateMatrix();
      m.setMatrixAt(i, _q.matrix); m.setColorAt(i, _c.setHex(pick(p)));
    }
    m.instanceColor.needsUpdate = true;
    return { g, dur: 7, update(dt) { g.rotation.z += 0.3 * dt; } };
  };
  MEGA.RAINBOW_RINGS = () => {
    const g = evGroup(); const n = 40;
    const m = new THREE.InstancedMesh(GEO.ringFat, neonMat(0xffffff, 0.95), n); m.frustumCulled = false; g.add(m);
    const rad = rand(18, 30);
    for (let i = 0; i < n; i++) {
      _q.position.set(0, 0, -i * 14); _q.rotation.set(0, 0, i * 0.2); _q.scale.setScalar(rad + Math.sin(i) * 4); _q.updateMatrix();
      m.setMatrixAt(i, _q.matrix); _c.setHSL((i / n + Math.random() * 0.02) % 1, 1, 0.55); m.setColorAt(i, _c);
    }
    m.instanceColor.needsUpdate = true;
    return { g, dur: 7, update(dt) { g.rotation.z += 0.4 * dt; } };
  };
  MEGA.POLYGON_EXPLODE = () => {
    const g = evGroup(); const p = pal();
    const core = new THREE.Mesh(GEO.icosa, wireMat(pick(p), 1)); core.scale.setScalar(32); g.add(core);
    return { g, dur: 5, blown: false, update(dt) { g.rotation.x += dt; g.rotation.y += 1.4 * dt; core.scale.multiplyScalar(1 + dt * 0.5);
      if (!this.blown && g.position.z > -120) { this.blown = true; core.visible = false; explode(g.position.x, g.position.y, g.position.z, pick(p), 160, 2.8); flash('#fff', 0.6); S.shake = Math.max(S.shake, 1); } } };
  };
  MEGA.CHECKER_WAVE = () => {
    const g = evGroup(); const p = pal();
    const geo = new THREE.PlaneGeometry(440, 440, 48, 48);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: checkerTex(pick(p), 0x000000), side: THREE.DoubleSide, transparent: true, opacity: 0.9, fog: true }));
    mesh.rotation.x = -Math.PI / 2.6; mesh.position.y = -16; g.add(mesh);
    const base = geo.attributes.position.array.slice();
    return { g, dur: 7, geo, base, update(dt) { const a = geo.attributes.position.array; for (let i = 0; i < a.length; i += 3) { a[i + 2] = Math.sin(this._t * 3.2 + base[i] * 0.05) * 26; } geo.attributes.position.needsUpdate = true; this._t = (this._t || 0) + dt; } };
  };
  MEGA.VECTOR_CITY = () => {
    const g = evGroup(); const p = pal(); const n = 68;
    const m = new THREE.InstancedMesh(GEO.box, wireMat(0xffffff, 0.9), n); m.frustumCulled = false; g.add(m);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1, h = rand(30, 130);
      _q.position.set(side * rand(26, 52), -15 + h / 2, -((i >> 1) * 20) - rand(0, 8));
      _q.rotation.set(0, 0, 0); _q.scale.set(rand(8, 18), h, rand(8, 18)); _q.updateMatrix();
      m.setMatrixAt(i, _q.matrix); m.setColorAt(i, _c.setHex(pick(p)));
    }
    m.instanceColor.needsUpdate = true;
    return { g, dur: 7, update() {} };
  };
  MEGA.KALEIDOSCOPE = () => {
    const g = evGroup(); const p = pal(); const arms = rint(8, 14);
    for (let k = 0; k < arms; k++) {
      const seg = []; for (let i = 0; i < 8; i++) { const r = 10 + i * 13; seg.push(new THREE.Vector3(r, 0, -i * 6), new THREE.Vector3(r + 9, 9, -i * 6)); }
      const ls = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), lineMat(pick(p), 0.9)); ls.rotation.z = (k / arms) * TAU; ls.frustumCulled = false; g.add(ls);
    }
    return { g, dur: 6, update(dt) { g.rotation.z += 0.9 * dt; g.children.forEach((c, i) => c.rotation.z += 0); } };
  };
  MEGA.LASER_FOREST = () => {
    const g = evGroup(); const p = pal(); const n = 80;
    const m = new THREE.InstancedMesh(GEO.box, neonMat(0xffffff, 0.85), n); m.frustumCulled = false; g.add(m);
    for (let i = 0; i < n; i++) {
      let x = rand(-80, 80); if (Math.abs(x) < 12) x += 24 * Math.sign(x || 1);
      _q.position.set(x, rand(-6, 6), -rand(0, 340)); _q.rotation.set(0, 0, 0); _q.scale.set(rand(0.4, 1.1), rand(50, 120), rand(0.4, 1.1)); _q.updateMatrix();
      m.setMatrixAt(i, _q.matrix); m.setColorAt(i, _c.setHex(pick(p)));
    }
    m.instanceColor.needsUpdate = true;
    return { g, dur: 6, update() {} };
  };
  MEGA.VOID_MONUMENT = () => {
    const g = evGroup(); const p = pal();
    const geo = new THREE.TorusKnotGeometry(28, 6, 120, 14, rint(2, 4), rint(3, 5));
    const knot = new THREE.Mesh(geo, wireMat(pick(p), 1)); g.add(knot);
    gridVisible = false;
    return { g, dur: 7, update(dt) { knot.rotation.x += 0.4 * dt; knot.rotation.y += 0.6 * dt; }, cleanup() { gridVisible = true; } };
  };
  MEGA.GEOMETRY_STORM = () => {
    const g = evGroup(); const p = pal(); const n = 80;
    const m = new THREE.InstancedMesh(GEO.octa, wireMat(0xffffff, 0.9), n); m.frustumCulled = false; g.add(m);
    const data = [];
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, r = rand(22, 62); data.push({ a, r, z: -rand(0, 340), s: rand(2.5, 8) }); m.setColorAt(i, _c.setHex(pick(p))); }
    m.instanceColor.needsUpdate = true;
    return { g, dur: 6, update(dt) { for (let i = 0; i < n; i++) { const d = data[i]; d.a += dt * 0.8; _q.position.set(Math.cos(d.a) * d.r, Math.sin(d.a) * d.r, d.z); _q.rotation.set(d.a, d.a, 0); _q.scale.setScalar(d.s); _q.updateMatrix(); m.setMatrixAt(i, _q.matrix); } m.instanceMatrix.needsUpdate = true; } };
  };
  MEGA.CHROMA_COLLAPSE = () => {
    const g = evGroup(); const p = pal(); const n = 220; const seg = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU, r = rand(70, 170); seg.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0), new THREE.Vector3(Math.cos(a) * (r + 12), Math.sin(a) * (r + 12), 0)); }
    const geo = new THREE.BufferGeometry().setFromPoints(seg); const base = geo.attributes.position.array.slice();
    const ls = new THREE.LineSegments(geo, lineMat(pick(p), 0.9)); ls.frustumCulled = false; g.add(ls);
    return { g, dur: 4.5, _t: 0, done2: false, update(dt) { this._t += dt; const k = this._t / 2.2; const a = geo.attributes.position.array;
      const f = k < 1 ? (1 - k) : ((k - 1) * 3); for (let i = 0; i < a.length; i++) a[i] = base[i] * clamp(f, 0.02, 3);
      geo.attributes.position.needsUpdate = true; ls.material.color.setHex(pick(p));
      if (!this.done2 && k > 1 && k < 1.05) { this.done2 = true; rotatePalette(); flash('#fff', 0.8); Audio.boost(); } } };
  };

  const MEGA_KEYS = Object.keys(MEGA);
  function startMega(name) {
    if (S.mega) endMega();
    name = name || pick(MEGA_KEYS);
    const ev = MEGA[name](); ev.name = name; ev.t = 0; S.mega = ev;
    setBanner('');
    flash('#fff', 0.55); rgbSplit(); S.shake = Math.max(S.shake, 0.9); S.roll = rand(-0.22, 0.22);
    Audio.zone();
  }
  function endMega() { if (!S.mega) return; if (S.mega.cleanup) S.mega.cleanup(); disposeGroup(S.mega.g); S.mega = null; }
  function updateMega(dt) {
    if (!S.mega) return;
    const ev = S.mega; ev.t += dt;
    ev.g.position.z += S.world * (0.9 + S.speedN * 0.4);
    ev.update(dt);
    if (ev.t > ev.dur && ev.g.position.z > 30) endMega();
    else if (ev.g.position.z > 60) endMega();
  }

  // small canvas checker texture (generated in code)
  function checkerTex(a, b) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    _c.setHex(a); _c2.setHex(b);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      x.fillStyle = (i + j) % 2 ? '#' + _c.getHexString() : '#000';
      x.fillRect(i * 8, j * 8, 8, 8);
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); return t;
  }

  /* ------------------------------------------------------------------ *
   *  ZONES / palette                                                   *
   * ------------------------------------------------------------------ */
  function applyZone(i) {
    S.zone = i % ZONES.length; const z = ZONES[S.zone];
    S.palette = z.cols.slice(); S.danger = z.danger;
    scene.fog.color.setHex(z.fog);
    renderer.setClearColor(z.fog, 1);
    gridFloor.material.color.setHex(z.cols[0]); gridCeil.material.color.setHex(z.cols[1] || z.cols[0]);
    document.documentElement.style.setProperty('--neon', '#' + _c.setHex(z.cols[0]).getHexString());
    document.documentElement.style.setProperty('--hot', '#' + _c.setHex(z.cols[1] || z.cols[0]).getHexString());
    setZoneTag('ZONE ' + String(S.zone + 1).padStart(2, '0') + '  ' + z.name);
    flash('#fff', 0.7); rgbSplit(); S.shake = Math.max(S.shake, 0.7); S.roll = rand(-0.16, 0.16);
  }
  function rotatePalette() { S.palette = S.palette.slice(); for (let i = 0; i < S.palette.length; i++) { _c.setHex(S.palette[i]); const hsl = {}; _c.getHSL(hsl); _c.setHSL((hsl.h + 0.33) % 1, 1, 0.55); S.palette[i] = _c.getHex(); } }

  /* ------------------------------------------------------------------ *
   *  DIRECTOR  (beat-driven spawns → hypnotic rhythm)                  *
   * ------------------------------------------------------------------ */
  function bpm() { return 118 * (0.9 + S.speedN * 0.55) * (S.overdrive > 0 ? 1.25 : 1); }
  function director(dt) {
    S.beatClock += dt;
    const beatDur = 60 / bpm();
    while (S.beatClock >= beatDur) {
      S.beatClock -= beatDur; S.beat++;
      const local = S.beat % 32;
      if (local === 0) { S.phrase++; if (S.phrase % 2 === 0) applyZone(S.zone + 1); }
      // section
      if (local < 16) S.section = 'build';
      else if (local < 24) S.section = 'peak';
      else if (local < 28) S.section = 'void';
      else S.section = 'recover';
      onBeat(local);
    }
    // mega scheduling
    S.megaCool -= dt;
    if (!S.mega && (S.section === 'void' || (S.section === 'peak' && chance(dt * 0.45))) && S.megaCool <= 0) { startMega(); S.megaCool = rand(6, 11) / (0.8 + S.speedN); }
    // overdrive powerup occasionally
    if (chance(dt * 0.03) && !powerups.some(p => p.alive)) spawnPowerup();
  }
  function onBeat(local) {
    if (S.mega && S.mega.t < S.mega.dur - 1) { if (local % 8 === 0) spawnGate(false); return; }
    if (S.section === 'void') return;
    // rings on the beat
    if (S.section === 'build') { if (local % 2 === 0) spawnGate(false); }
    else { spawnGate(false); }
    if (local % 8 === 0) spawnGate(true);
    // targets
    const dens = S.section === 'peak' ? 4 : 2;
    if (local % 2 === 1) for (let k = 0; k < dens; k++) spawnTarget();
    if (S.section === 'peak' && chance(0.45)) formation();
  }
  function formation() {
    const cx = rand(-14, 14), t = rint(0, 2);
    if (t === 0) for (let i = 0; i < 5; i++) spawnTarget({ x: cx, y: -12 + i * 6, scale: 2.2, color: pick(S.palette) });
    else if (t === 1) { const a0 = Math.random() * TAU; for (let i = 0; i < 6; i++) { const a = a0 + i / 6 * TAU; spawnTarget({ x: cx + Math.cos(a) * 8, y: 2 + Math.sin(a) * 8, scale: 2, color: pick(S.palette) }); } }
    else for (let i = 0; i < 6; i++) spawnTarget({ x: -18 + i * 7, y: rand(-8, 8), scale: 2, vx: 4 });
  }

  /* ------------------------------------------------------------------ *
   *  SCORE / MULT / DAMAGE / NEAR MISS                                 *
   * ------------------------------------------------------------------ */
  function addScore(n, event) { S.score += Math.floor(n * S.mult * (event ? 1 : 1)); }
  function bumpMult(n) { S.mult = clamp(S.mult + n, 1, 20); }
  function nearMiss() {
    S.stats.near++; addScore(150, true); bumpMult(0.08);
    S.speed = clamp(S.speed + 0.05, 0, CFG.speedMax);
    setBanner('NEAR MISS'); Audio.near();
  }
  function damage(x, y) {
    S.energy--; updateEnergy();
    S.speed = clamp(S.speed * 0.55, CFG.speedMin, CFG.speedMax);
    S.mult = Math.max(1, S.mult * 0.4); S.combo = 0; S.invuln = CFG.invuln;
    S.shake = 1; flash('#ff0033', 0.9); rgbSplit();
    explode(x, y, CFG.playerZ, S.danger, 46, 1.8); Audio.damage();
    if (S.energy <= 0) beginDeath();
  }

  /* ------------------------------------------------------------------ *
   *  UI helpers                                                        *
   * ------------------------------------------------------------------ */
  let bannerT = 0;
  function setBanner(txt) { if (!txt) { D.banner.classList.remove('show'); return; } D.banner.textContent = txt; D.banner.classList.remove('show'); void D.banner.offsetWidth; D.banner.classList.add('show'); }
  function setZoneTag(txt) { D.zonetag.textContent = txt; D.zonetag.classList.remove('show'); void D.zonetag.offsetWidth; D.zonetag.classList.add('show'); }
  function updateEnergy() { D.energyDots.forEach((d, i) => d.classList.toggle('dead', i >= S.energy)); }
  let flashT = 0;
  function flash(color, strength) { D.flash.style.background = color; D.flash.style.opacity = strength; flashT = 0.001; }
  function rgbSplit() { D.game.classList.remove('rgbsplit'); void D.game.offsetWidth; D.game.classList.add('rgbsplit'); setTimeout(() => D.game.classList.remove('rgbsplit'), 300); }
  function updateHUD() {
    D.score.textContent = 'SCORE ' + String(Math.floor(S.score)).padStart(8, '0');
    D.mult.textContent = 'X ' + S.mult.toFixed(1);
    D.speed.textContent = 'SPEED ' + S.speed.toFixed(1);
  }

  /* ------------------------------------------------------------------ *
   *  CAMERA / FEEDBACK                                                 *
   * ------------------------------------------------------------------ */
  let fovPulse = 0;
  function pulseFOV() { fovPulse = 1; }
  function updateCamera(dt) {
    S.speedN = clamp((S.speed - CFG.speedMin) / (CFG.speedMax - CFG.speedMin), 0, 1);
    const odN = S.overdrive > 0 ? 1 : 0;
    let fov = CFG.fovBase + S.speedN * (CFG.fovMax - CFG.fovBase) + fovPulse * 10 + odN * 12;
    fovPulse *= 0.9;
    camera.fov = lerp(camera.fov, fov, 1 - Math.exp(-dt * 6)); camera.updateProjectionMatrix();
    camera.position.x = lerp(camera.position.x, ship.x * 0.14, 1 - Math.exp(-dt * 5));
    camera.position.y = lerp(camera.position.y, 1.6 + ship.y * 0.1, 1 - Math.exp(-dt * 5));
    const shakeAmt = (S.shake * 0.7 + S.speedN * 0.16 + odN * 0.26);
    camera.position.x += (Math.random() - 0.5) * shakeAmt;
    camera.position.y += (Math.random() - 0.5) * shakeAmt;
    S.shake *= 0.86;
    camera.lookAt(ship.x * 0.3, ship.y * 0.2, -60);
    camera.rotation.z += -ship.vx * 0.004 + S.roll;
    S.roll *= 0.9;
  }

  /* ------------------------------------------------------------------ *
   *  AUDIO  (procedural Web Audio)                                     *
   * ------------------------------------------------------------------ */
  const Audio = (function () {
    let ctx, master, noiseBuf, muted = false, started = false;
    let schedT = 0, nextNote = 0, step = 0, timer = null;
    const scale = [0, 3, 5, 7, 10, 12, 15];
    function init() {
      if (started) return; started = true;
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ctx.destination);
        const len = ctx.sampleRate * 1; noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        nextNote = ctx.currentTime + 0.1;
        timer = setInterval(sched, 25);
      } catch (e) { started = false; }
    }
    function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
    function env(node, t, a, d, peak) { const g = ctx.createGain(); node.connect(g); g.connect(master); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); return g; }
    function tone(type, f, t, a, d, peak, sweep) { if (!ctx) return; const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (sweep) o.frequency.exponentialRampToValueAtTime(sweep, t + a + d); env(o, t, a, d, peak); o.start(t); o.stop(t + a + d + 0.02); }
    function noise(t, dur, peak, cut, sweepCut) { if (!ctx) return; const s = ctx.createBufferSource(); s.buffer = noiseBuf; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(cut, t); if (sweepCut) f.frequency.exponentialRampToValueAtTime(sweepCut, t + dur); s.connect(f); const g = ctx.createGain(); f.connect(g); g.connect(master); g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.start(t); s.stop(t + dur + 0.02); }
    function sched() {
      if (!ctx || S.mode !== 'play') return;
      const beatDur = 60 / bpm();
      while (nextNote < ctx.currentTime + 0.12) {
        const t = nextNote, i = S.speedN, od = S.overdrive > 0;
        // kick
        tone('sine', 130, t, 0.005, 0.12, 0.9, 42);
        // sub
        const root = 55 * Math.pow(2, (scale[step % scale.length]) / 12);
        tone('sawtooth', root, t, 0.01, beatDur * 0.7, 0.12 + i * 0.06);
        // hats
        if (i > 0.25 || od) { noise(t + beatDur / 2, 0.04, 0.12 + i * 0.1, 6000); }
        if ((i > 0.55 || od)) { noise(t + beatDur / 4, 0.03, 0.08, 8000); noise(t + beatDur * 0.75, 0.03, 0.08, 8000); }
        // arp
        const arpF = 220 * Math.pow(2, scale[(step * 2) % scale.length] / 12) * (od ? 2 : 1);
        tone(od ? 'square' : 'triangle', arpF, t, 0.005, 0.12, 0.05 + i * 0.08);
        if (i > 0.5) tone('square', arpF * 1.5, t + beatDur / 2, 0.005, 0.08, 0.04 + i * 0.05);
        step++; nextNote += beatDur;
      }
    }
    let lastFire = 0;
    return {
      init, resume,
      toggle() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.5; return muted; },
      fire() { if (!ctx || muted) return; const now = ctx.currentTime; if (now - lastFire < 0.05) return; lastFire = now; tone('square', 900 + Math.random() * 300, now, 0.004, 0.05, 0.05, 500); },
      hit() { if (!ctx) return; const t = ctx.currentTime; tone('square', 660, t, 0.004, 0.08, 0.12, 200); noise(t, 0.08, 0.1, 3000); },
      gate() { if (!ctx) return; const t = ctx.currentTime; tone('sine', 520, t, 0.004, 0.12, 0.12, 880); },
      boost() { if (!ctx) return; const t = ctx.currentTime; tone('sawtooth', 200, t, 0.02, 0.4, 0.18, 1400); noise(t, 0.4, 0.12, 400, 5000); },
      near() { if (!ctx) return; const t = ctx.currentTime; tone('sine', 1200, t, 0.003, 0.09, 0.1, 1900); },
      damage() { if (!ctx) return; const t = ctx.currentTime; tone('sawtooth', 160, t, 0.005, 0.35, 0.22, 40); noise(t, 0.3, 0.25, 1200, 200); },
      powerup() { if (!ctx) return; const t = ctx.currentTime; [0, 4, 7, 12].forEach((s, k) => tone('square', 440 * Math.pow(2, s / 12), t + k * 0.05, 0.004, 0.1, 0.12)); },
      overdrive() { if (!ctx) return; const t = ctx.currentTime; tone('sawtooth', 110, t, 0.03, 0.9, 0.25, 1760); noise(t, 0.9, 0.18, 300, 9000); },
      gameover() { if (!ctx) return; const t = ctx.currentTime; tone('sawtooth', 400, t, 0.02, 1.4, 0.25, 30); noise(t, 1.2, 0.15, 2000, 100); },
      zone() { if (!ctx) return; const t = ctx.currentTime; noise(t, 0.5, 0.14, 400, 6000); tone('sine', 300, t, 0.05, 0.5, 0.1, 1200); },
    };
  })();

  /* ------------------------------------------------------------------ *
   *  DEATH + GAME OVER                                                 *
   * ------------------------------------------------------------------ */
  function beginDeath() {
    S.mode = 'dying'; S.dieT = 0; S.freeze = 0.16;
    Audio.gameover();
    setTimeout(() => {
      explode(ship.x, ship.y, CFG.playerZ, S.palette[0], 200, 3.0);
      explode(ship.x, ship.y, CFG.playerZ, 0xffffff, 110, 2.1);
      shipGrp.visible = false; flash('#fff', 1); D.flash.classList.add('invert');
    }, 160);
  }
  function updateDeath(dt) {
    S.dieT += dt;
    if (S.dieT > 1.7) showGameOver();
  }
  function showGameOver() {
    S.mode = 'over';
    S.best = Math.max(S.best, Math.floor(S.score));
    try { localStorage.setItem('vectorama_best', S.best); } catch (e) {}
    D.flash.classList.remove('invert'); D.flash.style.opacity = 0;
    D.hud.classList.add('hidden');
    D['over-stats'].textContent =
      'SCORE  ' + String(Math.floor(S.score)).padStart(8, '0') + '\n' +
      'BEST   ' + String(S.best).padStart(8, '0') + '\n\n' +
      'MAX SPEED  ' + S.stats.maxSpeed.toFixed(1) + '\n' +
      'GATES      ' + S.stats.gates + '\n' +
      'NEAR MISS  ' + S.stats.near;
    D.over.classList.remove('hidden');
  }

  /* ------------------------------------------------------------------ *
   *  GAME START / RESET                                                *
   * ------------------------------------------------------------------ */
  function resetGame() {
    S.speed = CFG.speedStart; S.score = 0; S.mult = 1; S.combo = 0; S.energy = CFG.energy;
    S.invuln = 0; S.overdrive = 0; S.beat = 0; S.beatClock = 0; S.phrase = 0; S.section = 'build';
    S.megaCool = 3; S.shake = 0; S.roll = 0; S.dieT = 0; S.freeze = 0;
    S.stats = { gates: 0, near: 0, maxSpeed: 1 };
    ship.x = ship.tx = 0; ship.y = ship.ty = -2;
    shipGrp.visible = true; camera.fov = CFG.fovBase; camera.updateProjectionMatrix();
    targets.forEach(t => { t.alive = false; t.mesh.visible = false; });
    gates.forEach(g => { g.alive = false; g.grp.visible = false; });
    powerups.forEach(p => { p.alive = false; p.grp.visible = false; });
    for (let i = 0; i < MAX.proj; i++) { projData[i * 4 + 3] = 0; hideInst(proj, i); }
    proj.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < MAX.part; i++) { pLife[i] = 0; }
    endMega();
    applyZone(0);
    updateEnergy();
  }
  function startGame() {
    resetGame(); S.mode = 'play'; D.hud.classList.remove('hidden');
    Audio.resume();
  }

  function bootThenPlay() {
    D.start.classList.add('hidden');
    D.boot.classList.remove('hidden');
    const lines = ['BATIDA VECTOR SYSTEM', '', 'RAM CHECK ........ OK', 'CHROMA ENGINE .... OK', 'VELOCITY CORE .... OK', 'GEOMETRY BUS ..... OK', '', 'SIGNAL ACQUIRED'];
    D.bootlog.textContent = ''; let i = 0;
    const iv = setInterval(() => {
      D.bootlog.textContent += (i ? '\n' : '') + lines[i]; i++;
      if (i >= lines.length) { clearInterval(iv); setTimeout(() => { D.boot.classList.add('hidden'); startGame(); }, 350); }
    }, 170);
  }

  /* ------------------------------------------------------------------ *
   *  INPUT                                                             *
   * ------------------------------------------------------------------ */
  let pointerActive = false;
  function mapPointer(cx, cy) {
    const nx = (cx / innerWidth) * 2 - 1, ny = (cy / innerHeight) * 2 - 1;
    ship.tx = clamp(nx * CFG.moveX * 1.15, -CFG.moveX, CFG.moveX);
    ship.ty = clamp(-ny * (CFG.moveUp - CFG.moveDown) * 0.6, CFG.moveDown, CFG.moveUp);
  }
  function firstTap() {
    if (S.started) return; S.started = true;
    Audio.init(); requestFS();
  }
  function requestFS() {
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (fn) try { fn.call(el); } catch (e) {}
    if (screen.orientation && screen.orientation.lock) try { screen.orientation.lock('landscape'); } catch (e) {}
  }
  function onDown(x, y) {
    pointerActive = true; mapPointer(x, y);
    if (S.mode === 'menu') { firstTap(); bootThenPlay(); return; }
    if (S.mode === 'over') { D.over.classList.add('hidden'); startGame(); return; }
  }
  function onMove(x, y) { if (pointerActive && S.mode === 'play') mapPointer(x, y); }
  function onUp() { pointerActive = false; }

  addEventListener('touchstart', e => { e.preventDefault(); const t = e.changedTouches[0]; onDown(t.clientX, t.clientY); }, { passive: false });
  addEventListener('touchmove', e => { e.preventDefault(); const t = e.changedTouches[0]; onMove(t.clientX, t.clientY); }, { passive: false });
  addEventListener('touchend', e => { e.preventDefault(); onUp(); }, { passive: false });
  addEventListener('mousedown', e => onDown(e.clientX, e.clientY));
  addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
  addEventListener('mouseup', onUp);
  addEventListener('gesturestart', e => e.preventDefault());
  addEventListener('contextmenu', e => e.preventDefault());
  // keyboard (desktop)
  const keys = {};
  addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; if (S.mode === 'menu') { firstTap(); bootThenPlay(); } else if (S.mode === 'over') { D.over.classList.add('hidden'); startGame(); } });
  addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  function keyboardSteer(dt) {
    let dx = 0, dy = 0;
    if (keys['a'] || keys['arrowleft']) dx -= 1; if (keys['d'] || keys['arrowright']) dx += 1;
    if (keys['w'] || keys['arrowup']) dy += 1; if (keys['s'] || keys['arrowdown']) dy -= 1;
    if (dx || dy) { ship.tx = clamp(ship.tx + dx * 60 * dt, -CFG.moveX, CFG.moveX); ship.ty = clamp(ship.ty + dy * 44 * dt, CFG.moveDown, CFG.moveUp); }
    if (keys[' ']) S.speed = clamp(S.speed + dt * 1.5, 0, CFG.speedMax);
  }

  D.mute.addEventListener('click', e => { e.stopPropagation(); const m = Audio.toggle(); D.mute.classList.toggle('off', m); });
  D.mute.addEventListener('touchstart', e => { e.stopPropagation(); }, { passive: false });

  /* ------------------------------------------------------------------ *
   *  MAIN LOOP                                                         *
   * ------------------------------------------------------------------ */
  let last = 0, fpsAcc = 0, fpsCount = 0, fpsTimer = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    let dt = (now - last) / 1000; last = now;
    if (!(dt > 0)) dt = 0.016; dt = Math.min(dt, 0.05);
    S.t += dt;

    // adaptive quality
    fpsAcc += dt; fpsCount++; fpsTimer += dt;
    if (fpsTimer > 1.5) { const fps = fpsCount / fpsAcc; if (fps < 45 && S.tier === 'HIGH') setTier('MED'); else if (fps < 38 && S.tier === 'MED') setTier('LOW'); fpsAcc = 0; fpsCount = 0; fpsTimer = 0; }

    // flash decay
    if (flashT > 0) { flashT += dt; D.flash.style.opacity = Math.max(0, parseFloat(D.flash.style.opacity) - dt * 3); if (parseFloat(D.flash.style.opacity) <= 0) flashT = 0; }

    if (S.mode === 'play') {
      if (S.overdrive > 0) S.overdrive = Math.max(0, S.overdrive - dt);
      // speed decay + record
      S.speed = clamp(S.speed - CFG.speedDecay * dt, CFG.speedMin, CFG.speedMax);
      S.stats.maxSpeed = Math.max(S.stats.maxSpeed, S.speed);
      S.invuln = Math.max(0, S.invuln - dt);
      updateCamera(dt);
      S.world = CFG.worldSpeed * S.speed * dt;
      // score over time
      S.score += dt * S.speed * 60 * S.mult;
      S.mult = Math.max(1, S.mult - dt * 0.15); // slow decay -> chase it
      keyboardSteer(dt);
      // auto fire
      fireT += dt; const fr = CFG.fireRate / (S.overdrive > 0 ? 2 : 1);
      while (fireT >= fr) { fireT -= fr; fire(); }
      updateShip(dt);
      director(dt);
      updateGates(dt); updateTargets(dt); updatePowerups(dt); updateProjectiles(dt);
      updateMega(dt);
      updateStreaks(dt); updateGrid(); updateParts(dt);
      updateHUD();
    } else if (S.mode === 'dying') {
      if (S.freeze > 0) { S.freeze -= dt; S.world = 0; }
      else { S.speed = lerp(S.speed, 0.2, dt); S.world = CFG.worldSpeed * S.speed * dt; camera.position.z += dt * 4; }
      updateCamera(dt * 0.4);
      updateStreaks(dt); updateParts(dt); updateProjectiles(dt); updateTargets(dt); updateGates(dt);
      updateDeath(dt);
    } else {
      // menu / boot / over : gentle idle drift so background lives
      S.world = CFG.worldSpeed * 0.5 * dt; S.speedN = 0.15;
      if (!S.palette) applyZone(0);
      updateStreaks(dt); updateGrid();
      camera.rotation.z = Math.sin(S.t * 0.3) * 0.03;
      camera.fov = lerp(camera.fov, CFG.fovBase, 0.05); camera.updateProjectionMatrix();
      camera.lookAt(0, 0, -60);
    }

    renderer.render(scene, camera);
  }

  /* ------------------------------------------------------------------ *
   *  BOOTSTRAP                                                         *
   * ------------------------------------------------------------------ */
  function main() {
    try {
      shared();
      initThree();
      try { S.best = parseInt(localStorage.getItem('vectorama_best') || '0', 10) || 0; } catch (e) {}
      applyZone(0);
      // preview idle: menu background alive
      requestAnimationFrame(loop);
    } catch (err) {
      document.body.innerHTML = '<div style="color:#0ff;font-family:monospace;padding:20px">VECTORAMA could not start WebGL on this device.<br><br>' + (err && err.message ? err.message : err) + '</div>';
    }
  }
  main();
})();
