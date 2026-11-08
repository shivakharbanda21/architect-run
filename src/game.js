// Architect Run: you + 2 buddies vs NOVA, the AI Architect.
import * as THREE from 'three';
import { setup, SUN, V3, clamp, damp, rand, css, PLANS, genSpec, VP, Sfx, Creature, RIGS } from './engine.js';
import { Track, HALF, TILE, COLS, xOf, colOf, rowOf } from './track.js';
import { Nova } from './nova.js';
import { themeFor, makeSky, makeBelow, makeDeco } from './themes.js';
import { makeBrain, companionThink, chat } from './buddies.js';
import { Pickups, POWERS } from './pickups.js';
import { Shots, SHOTS } from './shots.js';
import { levelCfg, LEVEL_COUNT, TRAPS } from './levels.js';

const $ = id => document.getElementById(id);
const errBox = $('err');
addEventListener('error', e => { errBox.style.display = 'block'; errBox.textContent += (e.message || e) + '\n'; });
addEventListener('unhandledrejection', e => { errBox.style.display = 'block'; errBox.textContent += String(e.reason) + '\n'; });

// ---------- renderer / scene ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#cfe2f3');
scene.fog = new THREE.Fog('#cfe2f3', 28, 70);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
const hemi = new THREE.HemisphereLight('#ffffff', '#9fb4c8', 1.9); scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffffff', 2.0);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, far: 80 });
sun.shadow.bias = -0.0005; scene.add(sun, sun.target);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < .8 ? 68 : 55; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// ---------- game state ----------
const G = {
  scene, state: 'map', time: 0, runT: 0, track: null, nova: null, traps: [], runners: [], player: null,
  cfg: null, hits: 0, hitTimes: [], fx: (n, p, k) => Sfx.fx(n, p, k), shakeA: 0, parts: [],
  shake(a) { G.shakeA = Math.max(G.shakeA, a); },
  recentPlayerHits(s) { return G.hitTimes.filter(t => G.runT - t < s).length; },
  lives: 3, pow: {}, levelCoins: 0,
};
const MAX_LIVES = 3, CONTINUE_COST = 50;
let wallet = 0; try { wallet = +localStorage.getItem('ag.coins') || 0; } catch {}
const saveWallet = () => { try { localStorage.setItem('ag.coins', String(wallet)); } catch {} };
const world = {
  groundY: (x, z) => G.track ? G.track.groundY(x, z) : 0,
  clamp(p, c) {
    if (p.z < -5.6) { p.z = -5.6; c.vel.z = Math.max(0, c.vel.z); }
    for (const t of G.traps) {
      if (t.type !== 'wall' || !t.solid) continue;
      const pad = c.rad * .8, z = t.zone;
      if (p.x > z.x0 - pad && p.x < z.x1 + pad && p.z > z.z0 - pad && p.z < z.z1 + pad && p.y < t.h + 1.6) {
        if (c.bonking > 0) { t.smash(); popAt(c.head, 'BONK!', '#ffd27a'); G.shake(.25); continue; }
        const dx0 = p.x - (z.x0 - pad), dx1 = (z.x1 + pad) - p.x, dz0 = p.z - (z.z0 - pad), dz1 = (z.z1 + pad) - p.z, m = Math.min(dx0, dx1, dz0, dz1);
        if (m === dz0) { p.z = z.z0 - pad; c.vel.z = Math.min(0, c.vel.z); } else if (m === dz1) { p.z = z.z1 + pad; c.vel.z = Math.max(0, c.vel.z); }
        else if (m === dx0) { p.x = z.x0 - pad; c.vel.x = Math.min(0, c.vel.x); } else { p.x = z.x1 + pad; c.vel.x = Math.max(0, c.vel.x); }
      }
    }
  },
};
setup({ scene, camera, world });

// ---------- effects ----------
const debrisGeo = new THREE.BoxGeometry(.3, .3, .3), puffGeo = new THREE.SphereGeometry(.35, 10, 8);
G.debris = (pos, color, n) => { const mat = new THREE.MeshStandardMaterial({ color });
  for (let i = 0; i < n; i++) { const m = new THREE.Mesh(debrisGeo, mat); m.position.copy(pos).add(new V3(rand(-1, 1), rand(0, 1), rand(-.3, .3)));
    m.userData = { v: new V3(rand(-4, 4), rand(3, 8), rand(-3, 3)), life: 1.2, spin: new V3(rand(-9, 9), rand(-9, 9), 0) }; scene.add(m); G.parts.push(m); } };
G.puff = (pos, n) => { for (let i = 0; i < n; i++) { const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .8, depthWrite: false }));
  m.position.copy(pos); m.userData = { v: new V3(rand(-1.5, 1.5), rand(.5, 2), rand(-1.5, 1.5)), life: .7, puff: true }; scene.add(m); G.parts.push(m); } };
function updateParts(dt) {
  G.parts = G.parts.filter(m => { const u = m.userData; u.life -= dt; m.position.addScaledVector(u.v, dt);
    if (u.puff) { m.scale.multiplyScalar(1 + dt * 2.5); m.material.opacity = Math.max(0, u.life); u.v.multiplyScalar(Math.exp(-3 * dt)); }
    else { u.v.y -= 20 * dt; m.rotation.x += u.spin.x * dt; m.rotation.y += u.spin.y * dt; }
    if (u.life <= 0) { scene.remove(m); if (u.puff) m.material.dispose(); return false; } return true; });
}
const popsEl = $('pops');
function popAt(p, text, color = '#fff') { const v = p.clone().project(camera); if (v.z > 1) return;
  const d = document.createElement('div'); d.className = 'pop'; d.textContent = text; d.style.color = color;
  d.style.left = ((v.x + 1) / 2 * innerWidth) + 'px'; d.style.top = ((1 - v.y) / 2 * innerHeight) + 'px'; popsEl.appendChild(d); setTimeout(() => d.remove(), 1000); }
G.popAt = popAt;
let sayTimer = 0;
G.bubble = (c, text, urgent) => {
  let b = c.bubbleEl; if (!b) { b = c.bubbleEl = document.createElement('div'); b.className = 'bubble'; c.tag.appendChild(b); }
  b.textContent = text; b.classList.toggle('urgent', !!urgent); b.classList.add('on'); c.bubbleT = urgent ? 1.6 : 2.4;
};
G.say = text => { const s = $('say'); s.innerHTML = `<b>NOVA:</b> ${text}`; s.classList.add('on'); sayTimer = 2.6; };

// revive ring under a downed runner
const ringGeo = new THREE.RingGeometry(1.45, 1.65, 40); ringGeo.rotateX(-Math.PI / 2);
const discGeo = new THREE.CircleGeometry(1.45, 40); discGeo.rotateX(-Math.PI / 2);
function makeRing() { const g = new THREE.Group();
  const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#5fe0a6', transparent: true, opacity: .9, depthWrite: false }));
  const d = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: '#5fe0a6', transparent: true, opacity: .35, depthWrite: false }));
  g.add(r, d); g.userData.disc = d; g.visible = false; scene.add(g); return g; }

// ---------- runners ----------
function loadPlayerSpec() { try { const s = JSON.parse(localStorage.getItem('ag.creature')); if (s && s.plan) return s; } catch {} return genSpec(Math.floor(Math.random() * 2147483647), 'biped'); }
function makeRunner(spec, x, z, isPlayer, persona) {
  const c = new Creature(spec, x, z, isPlayer); c.yaw = 0;
  if (persona) { c.brain = makeBrain(persona); const r = document.createElement('span'); r.className = 'role'; r.textContent = c.brain.P.role; c.tag.appendChild(r); }
  Object.assign(c, { downT: 0, reviveP: 0, reviving: 0, invuln: 0, bonkCD: 0, bonking: 0, respawnT: 0, cp: -2, finished: false, ring: makeRing(), lead: 0, think: 0, goalX: x, maxZ: z });
  return c;
}
function speedOf(c) { const rig = RIGS[c.spec.plan]; const nat = Math.min(4 * rig.speed * (0.85 + .15 * c.spec.size), (c.legReach || 9) * 5.5); return clamp(nat * 1.1, 4.4, 5.6); }

G.hit = (c, dir, trap) => {
  if (c.down || c.invuln > 0 || c.respawnT > 0 || c.finished || G.state !== 'run') return;
  if (c.isPlayer && G.pow.shield > 0) {           // the shield eats the hit
    G.pow.shield = 0; c.invuln = 1.2; c.vel.x += dir.x * 4; c.vel.z += dir.z * 4; c.vel.y = 3; c.grounded = false;
    G.fx('shieldPop'); popAt(c.head, 'BLOCKED!', '#4fc3ff'); G.shake(.15); return;
  }
  c.flop(); c.downT = G.cfg.downT; c.reviveP = 0;
  c.vel.x += dir.x * 5; c.vel.z += dir.z * 5; c.vel.y = 4.5; c.grounded = false; c.dashT = 0;
  c.proc.mat.uniforms.uFlash.value = .9; G.fx('hit', c.pos.clone());
  popAt(c.head, c.isPlayer ? 'OUCH!' : 'HELP!', c.isPlayer ? '#ff8aa0' : '#ffd27a');
  if (c.isPlayer) { G.hits++; G.hitTimes.push(G.runT); G.shake(.35); flashRed(); loseLife(); }
  else chat(G, c, 'hit', true);
  G.nova.onHit(c, trap);
};
function getUp(c, revived) { if (!c.down) return; c.flop(); c.invuln = 1.6; c.reviveP = 0; c.downT = 0; c.ring.visible = false;
  if (revived) { G.fx('revive', c.pos.clone()); popAt(c.head, 'REVIVED!', '#5fe0a6'); G.nova.onRevive(c, revived);
    if (c.brain && revived === G.player) chat(G, c, 'thanks', true); } }
function respawn(c) {
  const z = G.track.checkpointFor(c.maxZ) || -2, cols = G.track.openCols(rowOf(z));
  const col = cols.length ? cols.reduce((a, b) => Math.abs(xOf(b) - c.pos.x) < Math.abs(xOf(a) - c.pos.x) ? b : a) : 1;
  if (c.down) c.flop();
  c.pos.set(xOf(col), G.track.rowH(rowOf(z)) + 3, z); c.vel.set(0, 0, 0); c.invuln = 2; c.ring.visible = false; c.downT = 0;
  G.fx('checkpoint', null, .6); G.puff(c.pos.clone().setY(.3), 4);
  if (c.isPlayer && G.state === 'run') { G.hits++; G.hitTimes.push(G.runT); flashRed(); loseLife(); }
}
function loseLife() {
  G.lives--; heartsDirty = true;
  if (G.lives <= 0) { popAt(G.player.head, 'KNOCKED OUT!', '#ff4f7b'); endLevel(false, 'ko'); }
  else if (G.lives === 1) popAt(G.player.head, 'LAST LIFE!', '#ff4f7b');
}
let heartsDirty = true;
G.onCoin = pos => { const n = G.pow.double > 0 ? 2 : 1; G.levelCoins += n; G.fx('coin', null, .8); if (G.levelCoins % 10 === 0) popAt(pos, `🪙 ${G.levelCoins}`, '#ffd23d'); };
G.onPower = (k, pos) => {
  const P = POWERS[k]; G.fx('power');
  if (k === 'heart') { if (G.lives < MAX_LIVES) { G.lives++; heartsDirty = true; popAt(pos, '+1 LIFE', '#ff4f7b'); } else { G.levelCoins += 10; popAt(pos, '+10 🪙', '#ffd23d'); } return; }
  G.pow[k] = P.dur; popAt(pos, `${P.icon} ${P.label.toUpperCase()}`, P.col);
};
const shieldMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshStandardMaterial({ color: '#4fc3ff', emissive: '#4fc3ff', emissiveIntensity: .5, transparent: true, opacity: .22, depthWrite: false }));
shieldMesh.visible = false; scene.add(shieldMesh);
let redT = 0; function flashRed() { redT = .5; }

function doBonk(c, dir) {
  if (c.bonkCD > 0 || c.down || c.respawnT > 0) return;
  if (!dir || dir.lengthSq() < .04) dir = new V3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
  dir = dir.clone().setY(0).normalize();
  c.vel.x = dir.x * 13; c.vel.z = dir.z * 13; c.dashT = .2; c.bonking = .32; c.bonkCD = 3.5; c.syv += 6;
  G.fx('dash', c.pos.clone()); G.puff(c.pos.clone().setY(.3), 2);
}

// ---------- levels / progress ----------
let progress = { stars: {}, nm: {} };
try { progress = { stars: {}, nm: {}, ...JSON.parse(localStorage.getItem('ag.progress') || '{}') }; } catch {}
const saveProgress = () => { try { localStorage.setItem('ag.progress', JSON.stringify(progress)); } catch {} };
let nightmare = false;
const starsOf = n => (nightmare ? progress.nm : progress.stars)[n] || 0;
const unlocked = n => n === 1 || starsOf(n - 1) > 0;

let world3 = null;   // sky, below, deco for the current theme
function applyTheme(th, len) {
  if (world3) { for (const o of [world3.sky, world3.below.group, world3.deco.group]) { scene.remove(o); o.traverse(q => { q.geometry?.dispose(); }); } }
  world3 = { th, sky: makeSky(th), below: makeBelow(th, len), deco: makeDeco(th, len) };
  scene.add(world3.sky, world3.below.group, world3.deco.group);
  scene.background = new THREE.Color(th.skyBot); scene.fog.color.set(th.fog); scene.fog.near = th.fogNear; scene.fog.far = th.fogFar;
  hemi.color.set(th.hemiSky); hemi.groundColor.set(th.hemiGround); hemi.intensity = th.hemiI; sun.color.set(th.sun); sun.intensity = th.sunI;
  document.documentElement.style.setProperty('--theme', th.trim);
}
function clearLevel() {
  for (const t of G.traps) t.remove(); G.traps = [];
  for (const c of G.runners) { c.dispose(); scene.remove(c.ring); } G.runners = [];
  G.pickups?.dispose(); G.pickups = null; G.shots?.clear();
  G.nova?.dispose(); G.nova = null; G.track?.dispose(); G.track = null;
  G.parts.forEach(m => scene.remove(m)); G.parts = [];
}
function buildLevel(n) {
  clearLevel();
  const cfg = G.cfg = levelCfg(n, nightmare);
  const th = G.theme = themeFor(n);
  G.track = new Track(cfg, scene, th);
  applyTheme(th, G.track.R * TILE);
  const ps = loadPlayerSpec(), others = PLANS.filter(p => p !== ps.plan).sort(() => Math.random() - .5);
  G.player = makeRunner(ps, 0, -2.5, true, G.auto ? 'auto' : null);
  const b1 = makeRunner(genSpec(Math.floor(Math.random() * 1e9), others[0]), -2.6, -4, false, 'dash');
  const b2 = makeRunner(genSpec(Math.floor(Math.random() * 1e9), others[1]), 2.6, -4, false, 'guard');
  b1.brain.laneX = -2; b2.brain.laneX = 2;
  G.runners = [G.player, b1, b2];
  G.nova = new Nova(G, cfg); scene.add(G.nova.hand.p.mesh);
  G.hits = 0; G.hitTimes = []; G.runT = 0; G.traps = [];
  G.lives = MAX_LIVES; G.levelCoins = 0; G.pow = { magnet: 0, shield: 0, speed: 0, double: 0, rapid: 0 }; heartsDirty = true;
  G.pickups = new Pickups(G, cfg); G.shots ||= new Shots(G);
  for (const c of G.runners) { c.shotCD = 0; c.shotT = 3 + Math.random() * 4; }
  $('shotName').textContent = SHOTS[G.player.spec.plan].name.toUpperCase();
  // HUD: progress bar
  const pr = $('prog'), span = G.track.finishZ + 3, at = z => clamp((z + 3) / span, 0, 1) * 100 + '%';
  pr.innerHTML = G.track.cps.map(z => `<i class="cp" style="left:${at(z)}"></i>`).join('') + `<i class="fin"></i>` +
    G.runners.map((c, i) => `<i class="${i ? '' : 'me'}" id="pd${i}" style="background:${css(c.col.body)}"></i>`).join('');
  G.progAt = at;
  $('lvlName').textContent = `${nightmare ? '😈 ' : ''}${n}. ${cfg.name.toUpperCase()}`;
  $('lvlName').title = th.name;
}

// ---------- screens ----------
const body = document.body;
function show(id) { for (const s of ['map', 'intro', 'result', 'pause']) $(s).classList.toggle('on', s === id); }
function openMap() {
  G.state = 'map'; body.classList.remove('playing'); show('map'); renderMap(); $('wallet').textContent = `🪙 ${wallet}`;
}
function renderMap() {
  const path = $('path'), W = Math.min(420, innerWidth), stepY = 96, H = LEVEL_COUNT * stepY + 60;
  path.style.height = H + 'px';
  const pos = i => ({ x: W / 2 + Math.sin(i * .9) * (W * .3), y: H - 50 - i * stepY });
  let d = ''; for (let i = 0; i < LEVEL_COUNT; i++) { const p = pos(i); d += (i ? ' L' : 'M') + p.x + ' ' + p.y; }
  let html = `<svg viewBox="0 0 ${W} ${H}"><path d="${d}" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="10" stroke-linecap="round" stroke-dasharray="2 18"/></svg>`;
  let next = 1; while (next < LEVEL_COUNT && starsOf(next) > 0) next++;
  for (let i = 0; i < LEVEL_COUNT; i++) {
    const n = i + 1, p = pos(i), st = starsOf(n), lock = !unlocked(n);
    const cls = ['node', lock ? 'lock' : st ? 'done' : '', n === next && !lock ? 'next' : '', n % 5 === 0 ? 'boss' : ''].join(' ');
    const stars = lock ? '' : `<div class="st">${[1, 2, 3].map(k => k <= st ? '★' : '<span class="off">★</span>').join('')}</div>`;
    html += `<div class="${cls}" data-n="${n}" style="left:${p.x}px;top:${p.y}px">${lock ? '🔒' : n}${stars}</div>`;
  }
  path.innerHTML = html;
  const nx = path.querySelector('.node.next') || path.querySelector('.node');
  requestAnimationFrame(() => nx?.scrollIntoView({ block: 'center' }));
  $('nmBtn').classList.toggle('on', nightmare);
}
$('path').addEventListener('click', e => { const el = e.target.closest('.node'); if (!el || el.classList.contains('lock')) return; Sfx.click(); openIntro(+el.dataset.n); });
$('nmBtn').onclick = () => { nightmare = !nightmare; Sfx.click(); renderMap(); };
let curLevel = 1;
function openIntro(n) {
  curLevel = n; buildLevel(n); G.state = 'intro'; body.classList.remove('playing'); show('intro');
  const cfg = G.cfg;
  $('iNum').textContent = `${G.theme.name.toUpperCase()} · LEVEL ${n}${nightmare ? ' · NIGHTMARE' : ''}`; $('iName').textContent = cfg.name;
  $('iBadges').innerHTML = (cfg.newTrap ? `<span class="badge">NEW TRAP: ${TRAPS[cfg.newTrap].icon} ${TRAPS[cfg.newTrap].label}</span>` : '') +
    (n === 6 ? '<span class="badge">NOVA COMBOS</span>' : '') + (n === 12 ? '<span class="badge">NOVA HUNTS REVIVERS</span>' : '');
  $('iQuote').innerHTML = `<b>NOVA:</b> ${cfg.intro || ['Again? Fine.', 'I have been practising.', 'This one is personal.', 'Run, little thing.'][n % 4]}`;
  $('iGoals').innerHTML = `<li>Reach the exit</li><li>Finish under ${cfg.par}s</li><li>Get hit 1 time or less</li>`;
  camSnap = true;
}
$('iBack').onclick = () => { Sfx.click(); openMap(); };
$('iPlay').onclick = () => { Sfx.unlock(); Sfx.click(); startCountdown(); };
let helpT = 0;
function startCountdown() {
  show(null); body.classList.add('playing'); G.state = 'count'; let k = 3;
  const cEl = $('count'), tick = () => {
    if (G.state !== 'count') return;
    if (k > 0) { cEl.innerHTML = `<span>${k}</span>`; G.fx('tick'); k--; setTimeout(tick, 700); }
    else { cEl.innerHTML = '<span>GO!</span>'; G.fx('checkpoint'); G.state = 'run';
      $('help').classList.remove('gone'); clearTimeout(helpT); helpT = setTimeout(() => $('help').classList.add('gone'), curLevel <= 2 ? 12000 : 5000); setTimeout(() => cEl.innerHTML = '', 700);
      G.say(G.cfg.intro || 'Run.'); G.fx('nova', null, .8);
      setTimeout(() => G.runners.forEach((c, i) => c.brain && c !== G.player && setTimeout(() => chat(G, c, 'start', true), i * 900)), 2600); }
  };
  tick();
}
let endReason = '';
function endLevel(won, reason = 'wipe') {
  if (G.state !== 'run') return;
  G.state = 'end'; G.nova.save(); endReason = won ? '' : reason;
  if (won) { wallet += G.levelCoins; saveWallet(); }
  const cfg = G.cfg, t = G.runT;
  const stars = won ? 1 + (t <= cfg.par) + (G.hits <= 1) : 0;
  if (won) { G.fx('win'); G.nova.say('win', true); G.runners.forEach(c => !c.down && c.wave()); }
  else { G.fx('lose'); G.nova.say(reason === 'ko' ? 'dead' : 'wipe', true); }
  if (won) { const tbl = nightmare ? progress.nm : progress.stars; tbl[curLevel] = Math.max(tbl[curLevel] || 0, stars); saveProgress(); }
  setTimeout(() => {
    if (G.state !== 'end') return;
    show('result'); body.classList.remove('playing');
    $('rNum').textContent = `LEVEL ${curLevel}${nightmare ? ' · NIGHTMARE' : ''}`;
    $('rTitle').textContent = won ? ['ESCAPED!', 'ESCAPED!', 'GREAT RUN!', 'FLAWLESS!'][stars] : endReason === 'ko' ? 'KNOCKED OUT' : 'TEAM WIPED';
    $('rCoins').innerHTML = won ? `+${G.levelCoins} 🪙 <small>· total ${wallet}</small>` : `${G.levelCoins} 🪙 lost <small>· wallet ${wallet}</small>`;
    const cont = $('rContinue'); cont.style.display = !won && endReason === 'ko' ? '' : 'none';
    cont.disabled = wallet < CONTINUE_COST; cont.textContent = `CONTINUE · ${CONTINUE_COST} 🪙`;
    const sp = [...$('rStars').children]; sp.forEach(s => s.classList.remove('on'));
    sp.forEach((s, i) => { if (i < stars) setTimeout(() => { s.classList.add('on'); Sfx.fx('star', null, 1 + i * .25); }, 350 + i * 380); });
    $('rQuote').innerHTML = `<b>NOVA:</b> ${won ? (stars === 3 ? 'Impossible. Do it again.' : stars === 2 ? 'Not bad. I am learning, though.' : 'Slow. Sloppy. Survived.') : endReason === 'ko' ? 'Three hits. That is all it takes.' : 'Too easy. Try reviving faster.'}`;
    const m = G.nova.mem, dodge = m.n > 3 && Math.abs(m.dodge) > .3 ? (m.dodge > 0 ? 'left' : 'right') : 'unreadable';
    $('rFacts').innerHTML = `<div>Time <b>${t.toFixed(1)}s</b></div><div>Par <b>${cfg.par}s</b></div><div>Hits <b>${G.hits}</b></div>` +
      `<div>NOVA traps <b>${G.nova.stats.plays}</b></div><div>Combos <b>${G.nova.stats.combos}</b></div><div>She thinks you dodge <b>${dodge}</b></div>` +
      `<div>Your reaction <b>${m.n > 2 ? Math.round(m.react * 1000) + 'ms' : '?'}</b></div><div style="grid-column:1/3">Her best tactic vs you <b>${G.nova.bestTactic()}</b></div>`;
    $('rNext').style.display = won && curLevel < LEVEL_COUNT ? '' : 'none';
  }, won ? 1800 : 1500);
}
$('rMap').onclick = () => { Sfx.click(); openMap(); };
$('rContinue').onclick = () => {           // spend coins: back in at the last checkpoint with one life
  if (wallet < CONTINUE_COST || endReason !== 'ko') return;
  wallet -= CONTINUE_COST; saveWallet(); Sfx.fx('power');
  G.lives = 1; heartsDirty = true; const p = G.player; if (p.down) p.flop(); respawn(p); G.state = 'run'; p.invuln = 3;
  show(null); body.classList.add('playing'); G.say('Paying your way out? Fine.');
};
$('rRetry').onclick = () => { Sfx.click(); openIntro(curLevel); startCountdown(); };
$('rNext').onclick = () => { Sfx.click(); openIntro(curLevel + 1); };
let pausedFrom = null;
function pause() { if (G.state !== 'run' && G.state !== 'count') return; pausedFrom = G.state; G.state = 'pause'; show('pause'); }
function resume() { show(null); G.state = pausedFrom === 'count' ? 'run' : pausedFrom; $('count').innerHTML = ''; }
$('pauseBtn').onclick = pause; $('pResume').onclick = resume;
$('pRetry').onclick = () => { openIntro(curLevel); startCountdown(); };
$('pMap').onclick = openMap;

// ---------- input ----------
const keys = new Set();
addEventListener('keydown', e => {
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  keys.add(e.code);
  if (G.state === 'run') {
    if (e.code === 'Space' && !e.repeat) G.player.jumpReq = true;
    if ((e.code === 'KeyF' || e.code === 'ShiftLeft' || e.code === 'KeyJ') && !e.repeat) doBonk(G.player, playerWish());
    if ((e.code === 'KeyE' || e.code === 'KeyK') && !e.repeat) G.shots.fire(G.player);
  }
  if (e.code === 'Escape' || e.code === 'KeyP') { if (G.state === 'pause') resume(); else pause(); }
  if (e.code === 'KeyM' && !e.repeat) setMute(Sfx.toggle());
  if (e.code === 'Enter' && G.state === 'intro') $('iPlay').click();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); if (G.state === 'run') pause(); });
addEventListener('pointerdown', Sfx.unlock, true); addEventListener('keydown', Sfx.unlock, true);
const muteBtn = $('muteBtn'); function setMute(m) { muteBtn.textContent = m ? '🔇' : '🔊'; } setMute(Sfx.muted);
muteBtn.onclick = () => { Sfx.unlock(); setMute(Sfx.toggle()); };
if (matchMedia('(pointer: coarse)').matches) body.classList.add('coarse');
const joy = $('joy'), knob = $('knob'), stick = { x: 0, y: 0, id: null };
joy.addEventListener('pointerdown', e => { stick.id = e.pointerId; joy.setPointerCapture(e.pointerId); moveStick(e); });
joy.addEventListener('pointermove', e => { if (e.pointerId === stick.id) moveStick(e); });
const endStick = () => { stick.id = null; stick.x = stick.y = 0; knob.style.transform = ''; };
joy.addEventListener('pointerup', endStick); joy.addEventListener('pointercancel', endStick);
function moveStick(e) { const b = joy.getBoundingClientRect(); let dx = e.clientX - (b.left + b.width / 2), dy = e.clientY - (b.top + b.height / 2);
  const m = Math.hypot(dx, dy), max = b.width / 2 - 10; if (m > max) { dx *= max / m; dy *= max / m; }
  stick.x = dx / max; stick.y = dy / max; knob.style.transform = `translate(${dx}px,${dy}px)`; }
$('tJump').addEventListener('pointerdown', e => { e.preventDefault(); if (G.state === 'run') G.player.jumpReq = true; });
$('tBonk').addEventListener('pointerdown', e => { e.preventDefault(); if (G.state === 'run') doBonk(G.player, playerWish()); });
$('tShoot').addEventListener('pointerdown', e => { e.preventDefault(); if (G.state === 'run') G.shots.fire(G.player); });
// camera looks down +z, so screen-right is -x
function playerWish() {
  const ix = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + stick.x;
  const iz = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - stick.y;
  const w = new V3(-ix, 0, iz); if (w.length() > 1) w.normalize(); return w;
}

// ---------- main loop ----------
const clock = new THREE.Clock();
const cam = { target: new V3(0, 1, 0), pos: new V3(0, 6, -10) };
let camSnap = true;
function separate(list) {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j], dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz), m = a.rad + b.rad;
    if (d > 0 && d < m && Math.abs(a.pos.y - b.pos.y) < 1) { const push = (m - d) / 2 / d;
      a.pos.x -= dx * push; a.pos.z -= dz * push; b.pos.x += dx * push; b.pos.z += dz * push; }
  }
}
function step(dt) {
  const running = G.state === 'run', live = running || G.state === 'end';
  if (running) G.runT += dt;
  const tr = G.track;
  tr.update(dt);
  for (const t of G.traps) t.update(dt);
  G.traps = G.traps.filter(t => t.state !== 'done');
  if (running || G.state === 'end') G.nova.update(dt);
  else G.nova.hand.update(dt, new V3(G.player.pos.x * .4, 6.5, G.player.pos.z + 9), G.time);

  for (const c of G.runners) {
    c.maxSpeed = speedOf(c) * (c.isPlayer && G.pow.speed > 0 ? 1.35 : 1);
    c.shotCD = Math.max(0, (c.shotCD || 0) - dt);
    if (running && c.brain && c !== G.player && !c.down && (c.shotT -= dt) <= 0) { c.shotT = 4 + Math.random() * 5; if (G.nova.hand.pos.z - c.pos.z > 3) G.shots.fire(c); }
    let wish = new V3();
    if (live && !c.finished) wish = c.isPlayer && !G.auto ? (running ? playerWish() : new V3()) : (running && c.brain ? companionThink(G, c, dt, doBonk) : new V3());
    // floor effects: moving platforms carry you, ice is slippery, pads launch you
    if (c.grounded) { const pl = tr.platAt(c.pos.x, c.pos.z); if (pl && Math.abs(c.pos.y) < .15 && !tr.solid(rowOf(c.pos.z), colOf(c.pos.x))) c.pos.z += pl.dz; }
    c.slip = c.grounded && tr.isSlick(c.pos.z);
    if (c.grounded && !c.down && tr.isPad(c.pos.x, c.pos.z) && c.vel.y <= 0) {
      c.vel.y = 10.5; c.vel.z = Math.max(c.vel.z, 8.6); c.vel.x *= .3; c.dashT = 1.05; c.grounded = false; c.syv += 8;
      G.fx('bounce', c.pos.clone()); if (c.brain && c !== G.player) chat(G, c, 'bounce');
    }
    if (c.bubbleT > 0 && (c.bubbleT -= dt) <= 0) c.bubbleEl?.classList.remove('on');
    if (c.finished) wish.set(0, 0, c.pos.z < tr.finishZ + 3 ? .6 : 0);
    c.bonkCD = Math.max(0, c.bonkCD - dt); c.bonking -= dt; c.invuln -= dt;
    c.update(dt, wish, G.time);
    c.maxZ = Math.max(c.maxZ, c.pos.z);
    const fl = c.proc.mat.uniforms.uFlash; fl.value = Math.max(0, fl.value - dt * 2.5);
    if (c.invuln > 0 && !c.down) fl.value = Math.max(fl.value, (Math.sin(G.time * 30) > 0) * .35);
    if (c.pos.y < -7) respawn(c);
    if (!c.finished && c.pos.z > tr.finishZ && running) { c.finished = true; if (c.isPlayer) endLevel(true); else G.fx('checkpoint', c.pos.clone(), .5); }
    // checkpoints
    const cpz = tr.checkpointFor(c.maxZ); if (c.isPlayer && cpz > c.cp && cpz) { c.cp = cpz; popAt(c.head, 'CHECKPOINT', '#5fe0a6'); G.fx('checkpoint'); }
    c.tag.classList.toggle('help', c.down);
  }
  // knockdowns: revive by standing next to the fallen runner, or get up alone after a while
  for (const c of G.runners) {
    let helper = null;
    if (c.down && c.pos.y > -1) {
      for (const o of G.runners) if (o !== c && !o.down && o.respawnT <= 0 && Math.hypot(o.pos.x - c.pos.x, o.pos.z - c.pos.z) < 1.9) { helper = o; break; }
      if (helper) c.reviveP += dt / 1.1; else c.reviveP = Math.max(0, c.reviveP - dt * .5);
      c.downT -= dt;
      if (c.reviveP >= 1) getUp(c, helper); else if (c.downT <= 0) getUp(c, null);
      c.ring.visible = c.down; c.ring.position.set(c.pos.x, Math.max(0, tr.groundY(c.pos.x, c.pos.z)) + .04, c.pos.z);
      c.ring.userData.disc.scale.setScalar(Math.max(.01, c.reviveP));
    } else c.ring.visible = false;
    for (const o of G.runners) if (o !== c) o._helping = o._helping || helper === o;
  }
  for (const o of G.runners) { o.reviving = o._helping ? o.reviving + dt : 0; o._helping = false; }
  if (running && G.runners.every(c => c.down)) endLevel(false);
  separate(G.runners);
  updateParts(dt);
  if (running) { for (const k in G.pow) if (G.pow[k] > 0) G.pow[k] = Math.max(0, G.pow[k] - dt); }
  G.pickups?.update(dt, G.time); G.shots?.update(dt);
  const pl = G.player; shieldMesh.visible = G.pow.shield > 0 && !pl.down;
  if (shieldMesh.visible) { shieldMesh.position.set(pl.pos.x, pl.pos.y + pl.mid * .6, pl.pos.z); shieldMesh.scale.setScalar(pl.rad + .55 + Math.sin(G.time * 6) * .04); }
}
function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  G.time += dt;
  if (G.track && G.state !== 'pause') step(dt);
  if (world3) { world3.below.update(dt, G.time); world3.deco.update(dt, G.time); world3.sky.position.copy(camera.position); }
  // camera: behind and above the player, looking down the track
  if (G.player) {
    const p = G.player.pos, tgt = new V3(p.x * .55, Math.max(0, p.y) * .5 + .8, p.z + 3.2);
    const narrowScreen = camera.aspect < .8, want = tgt.clone().add(new V3(0, narrowScreen ? 8.5 : 6.6, narrowScreen ? -10.5 : -8.8));
    if (G.state === 'map' || G.state === 'intro') { want.add(new V3(Math.sin(G.time * .3) * 4, 1.5, -2)); }
    if (camSnap) { cam.target.copy(tgt); cam.pos.copy(want); camSnap = false; }
    cam.target.lerp(tgt, 1 - Math.exp(-6 * dt)); cam.pos.lerp(want, 1 - Math.exp(-4 * dt));
    camera.position.copy(cam.pos);
    if (G.shakeA > 0) { camera.position.add(new V3(rand(-1, 1), rand(-1, 1), 0).multiplyScalar(G.shakeA)); G.shakeA = Math.max(0, G.shakeA - dt * 1.5); }
    camera.lookAt(cam.target);
    sun.position.copy(cam.target).addScaledVector(SUN, 30); sun.target.position.copy(cam.target);
  }
  camera.updateMatrixWorld();
  VP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  renderer.render(scene, camera);
  if (G.track) hud(dt);
  requestAnimationFrame(frame);
}
function hud(dt) {
  for (const c of G.runners) {
    const p = c.head.clone(); p.y += .25; p.project(camera);
    const vis = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1 && body.classList.contains('playing');
    c.tag.style.display = vis ? '' : 'none';
    if (vis) { c.tag.style.left = ((p.x + 1) / 2 * innerWidth) + 'px'; c.tag.style.top = ((1 - p.y) / 2 * innerHeight) + 'px'; }
  }
  if (!body.classList.contains('playing')) return;
  const t = $('timer'); t.textContent = G.runT.toFixed(1) + 's'; t.classList.toggle('over', G.runT > G.cfg.par);
  if (heartsDirty) { heartsDirty = false; $('hits').innerHTML = [0, 1, 2].map(i => `<span class="${i < G.lives ? 'h' : 'h off'}">❤</span>`).join(''); }
  $('coins').textContent = `🪙 ${G.levelCoins}`;
  $('powers').innerHTML = Object.entries(G.pow).filter(([, v]) => v > 0).map(([k, v]) => `<div class="pw" style="--c:${POWERS[k].col}">${POWERS[k].icon}<i style="width:${Math.min(1, v / POWERS[k].dur) * 100}%"></i></div>`).join('');
  $('tShootCd').style.transform = `scaleY(${G.player.shotCD / (SHOTS[G.player.spec.plan].cd)})`;
  $('energyFill').style.width = (G.nova.energy / G.cfg.energyMax * 100) + '%';
  G.runners.forEach((c, i) => { const el = $('pd' + i); if (el) { el.style.left = G.progAt(c.pos.z); el.style.opacity = c.down ? .4 : 1; } });
  sayTimer -= dt; if (sayTimer <= 0) $('say').classList.remove('on');
  redT -= dt; $('vignette').style.boxShadow = `inset 0 0 140px rgba(255,40,80,${Math.max(0, redT) * 1.2})`;
  $('tBonkCd').style.transform = `scaleY(${G.player.bonkCD / 3.5})`;
}

// boot: show the map with level 1's track behind it
buildLevel(1); openMap();
requestAnimationFrame(frame);
window.game = G;
// test hooks: simulate a whole level headless (G.auto lets the buddy AI drive the player)
G.step = step; G.buildLevel = buildLevel; G.endLevel = endLevel;
G.sim = (n, nm = false, maxT = 120) => {
  nightmare = nm; curLevel = n; G.auto = true; buildLevel(n); G.state = 'run';
  const dt = 1 / 60; let t = 0; while ((G.state === 'run') && t < maxT) { step(dt); t += dt; }
  const r = { n, nm, state: G.state, won: G.player.finished, time: +G.runT.toFixed(1), par: G.cfg.par, hits: G.hits, plays: G.nova.stats.plays, combos: G.nova.stats.combos, mem: { ...G.nova.mem } };
  G.auto = false; G.state = 'map'; return r;
};
