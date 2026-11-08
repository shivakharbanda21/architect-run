import * as THREE from 'three';

// Shared creature engine: DNA, SDF renderer, procedural rigs, sound. Used by the Lab and the game.
let scene = null, camera = null;
// world hooks: ground height under a point (-Infinity = hole), and an optional position clamp
let world = { groundY: () => 0, clamp: () => {} };
export function setup(o) { scene = o.scene; camera = o.camera; if (o.world) world = o.world; }
export function setWorld(w) { world = w; }

// ---------- helpers ----------
const V3 = THREE.Vector3;
const MAXP = 64;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const rand = (a, b) => a + Math.random() * (b - a);
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
const dampAngle = (a, b, k, dt) => a + wrapA(b - a) * (1 - Math.exp(-k * dt));
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hsl(h, s, l) { h = ((h % 1) + 1) % 1; const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)]; }
const css = c => `rgb(${c.map(v => Math.round(clamp(v, 0, 1) * 255)).join(',')})`;
const nv = (...vs) => { const o = new V3(); for (let i = 0; i < vs.length; i += 2) o.addScaledVector(vs[i], vs[i + 1]); return o.normalize(); };

// ---------- creature DNA ----------
const SYL = ['bo','zi','pa','lu','mo','ki','fi','nu','ra','pe','do','gu','ty','be','xi','wo','sha','no','ble','ru','gra','sk','vo'];
const PLANS = ['biped', 'quad', 'bug', 'spider', 'worm', 'flyer'];
const PLAN_LABEL = { biped: 'Biped', quad: 'Quad', bug: 'Bug', spider: 'Spider', worm: 'Worm', flyer: 'Flyer' };
const PARTS = ['arms','horns','ears','tusks','trunk','tail','antennae','mandibles','wings','spikes','mouth','belly','stripes'];
const ODDS = {
  biped:  { arms: .9, horns: .3, ears: .35, tail: .35, antennae: .2, spikes: .2, mouth: .6, wings: .12, belly: .6, stripes: .15 },
  quad:   { tail: .85, ears: .6, horns: .35, tusks: .3, trunk: .3, spikes: .3, mouth: .4, wings: .08, belly: .6, stripes: .35 },
  bug:    { antennae: 1, mandibles: .6, wings: .45, spikes: .2, horns: .25, stripes: .6, tail: .2 },
  spider: { mandibles: .85, spikes: .3, horns: .15, stripes: .55, belly: .3 },
  worm:   { antennae: .6, horns: .25, mouth: .6, spikes: .35, stripes: .7 },
  flyer:  { wings: 1, tail: .6, ears: .4, horns: .25, mouth: .5, antennae: .25, belly: .6 },
};
function genSpec(seed, forcePlan) {
  seed = seed >>> 0;
  const r = mulberry(Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b));
  for (let i = 0; i < 6; i++) r(); // warm up: first outputs of nearby seeds are correlated
  const R = (a, b) => a + (b - a) * r(), pick = a => a[Math.floor(r() * a.length)];
  const name = (pick(SYL) + pick(SYL) + (r() < .35 ? pick(SYL) : '')).toUpperCase();
  let plan = pick(PLANS); if (forcePlan) plan = forcePlan;
  const s = { seed, name, plan, hue: r(), sat: R(.55, .85), light: R(.5, .6), accentShift: R(.06, .45),
    size: R(.9, 1.15), body: R(.85, 1.2), leg: R(.85, 1.25), eyeSize: R(.85, 1.25),
    eyes: plan === 'spider' ? pick([6, 8, 8]) : pick([1, 2, 2, 2, 2, 3, 3, 4, 5, 7]),
    tailStyle: pick(['tuft', 'club', 'plain']), segs: 5 + Math.floor(r() * 4), parts: [] };
  for (const p of PARTS) if (r() < (ODDS[plan][p] || 0)) s.parts.push(p);
  return s;
}
function colorsOf(s) {
  const body = hsl(s.hue, s.sat, s.light);
  const acc = hsl(s.hue + s.accentShift, Math.min(1, s.sat + .1), Math.min(.72, s.light + .1));
  return { body, acc, dark: body.map(v => v * .55), leg: body.map(v => v * .82), belly: body.map(v => v + (1 - v) * .45),
    wing: acc.map(v => v + (1 - v) * .45), ivory: [.97, .94, .84], mouth: [.32, .07, .12] };
}

export const SUN = new V3(-0.45, 0.85, -0.3).normalize();
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }

// ---------- SDF body renderer: every part is one equation (a tapered capsule), ray-marched in a bounding box ----------
const VP = new THREE.Matrix4();
const BOX = new THREE.BoxGeometry(1, 1, 1);
const VS = `varying vec3 vW;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FS = `#define MAXP ${MAXP}
uniform vec4 uA[MAXP]; uniform vec4 uB[MAXP]; uniform vec4 uC[MAXP];
uniform int uCount; uniform float uK; uniform vec3 uBoxC; uniform vec3 uBoxH; uniform mat4 uVP; uniform vec3 uSun; uniform float uFlash;
varying vec3 vW;
vec4 map(vec3 p){
  float d = 1e5; vec3 col = vec3(.5); float dh = 1e5; vec3 ch = vec3(0.); bool first = true;
  for (int i = 0; i < MAXP; i++) {
    if (i >= uCount) break;
    vec3 a = uA[i].xyz, ba = uB[i].xyz - a, pa = p - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0., 1.);
    float di = length(pa - ba * h) - mix(uA[i].w, uB[i].w, h);
    if (uC[i].w < .5) {
      if (first) { d = di; col = uC[i].rgb; first = false; }
      else { float m = clamp(.5 + .5 * (d - di) / uK, 0., 1.); d = mix(d, di, m) - uK * m * (1. - m); col = mix(col, uC[i].rgb, m); }
    } else if (di < dh) { dh = di; ch = uC[i].rgb; }
  }
  if (dh < d) { d = dh; col = ch; }
  return vec4(d, col);
}
float sdf(vec3 p){ return map(p).x; }
vec3 nrm(vec3 p){ vec2 e = vec2(1., -1.) * .002;
  return normalize(e.xyy*sdf(p+e.xyy) + e.yyx*sdf(p+e.yyx) + e.yxy*sdf(p+e.yxy) + e.xxx*sdf(p+e.xxx)); }
void main(){
  vec3 ro = cameraPosition, rd = normalize(vW - ro);
  vec3 inv = 1. / rd, t0 = (uBoxC - uBoxH - ro) * inv, t1 = (uBoxC + uBoxH - ro) * inv;
  vec3 mn = min(t0, t1), mx = max(t0, t1);
  float tn = max(max(mn.x, mn.y), mn.z), tf = min(min(mx.x, mx.y), mx.z);
  if (tf < 0. || tn > tf) discard;
  float t = max(tn, 0.); bool hit = false;
  for (int i = 0; i < 90; i++) { float d = sdf(ro + rd * t); if (d < .0012 * (1. + t * .1)) { hit = true; break; } t += d * .9; if (t > tf) break; }
  if (!hit) discard;
  vec3 p = ro + rd * t, n = nrm(p), base = map(p).yzw;
  float ndl = dot(n, uSun), ndv = max(dot(n, -rd), 0.);
  vec3 amb = mix(vec3(.70, .75, .90), vec3(1.), n.y * .5 + .5);
  vec3 col = base * amb * (.62 + .38 * smoothstep(-.05, .2, ndl));
  vec3 hv = normalize(uSun - rd);
  col += smoothstep(.55, .65, pow(max(dot(n, hv), 0.), 48.)) * .35;
  col += pow(1. - ndv, 3.) * vec3(.75, .85, 1.) * .3;
  col *= clamp(.55 + .45 * sdf(p + n * .1) / .1, .45, 1.);
  col *= mix(.72, 1., smoothstep(.05, .3, ndv));
  col = mix(col, vec3(1.), uFlash);
  vec4 cp = uVP * vec4(p, 1.); gl_FragDepth = cp.z / cp.w * .5 + .5;
  gl_FragColor = vec4(col, 1.);
}`;
class Proc {
  constructor() {
    this.A = new Float32Array(MAXP * 4); this.B = new Float32Array(MAXP * 4); this.C = new Float32Array(MAXP * 4);
    this.n = 0; this.lo = new V3(); this.hi = new V3();
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, side: THREE.BackSide, uniforms: {
      uA: { value: this.A }, uB: { value: this.B }, uC: { value: this.C }, uCount: { value: 0 }, uK: { value: .12 },
      uBoxC: { value: new V3() }, uBoxH: { value: new V3(1, 1, 1) }, uVP: { value: VP }, uSun: { value: SUN }, uFlash: { value: 0 } } });
    this.mesh = new THREE.Mesh(BOX, this.mat); this.mesh.frustumCulled = false;
  }
  begin() { this.n = 0; this.lo.set(1e9, 1e9, 1e9); this.hi.set(-1e9, -1e9, -1e9); }
  push(a, ra, b, rb, c, g = 0) {
    if (this.n >= MAXP) return; const o = this.n++ * 4, A = this.A, B = this.B, C = this.C;
    A[o] = a.x; A[o + 1] = a.y; A[o + 2] = a.z; A[o + 3] = ra; B[o] = b.x; B[o + 1] = b.y; B[o + 2] = b.z; B[o + 3] = rb;
    C[o] = c[0]; C[o + 1] = c[1]; C[o + 2] = c[2]; C[o + 3] = g;
    this.lo.set(Math.min(this.lo.x, a.x - ra, b.x - rb), Math.min(this.lo.y, a.y - ra, b.y - rb), Math.min(this.lo.z, a.z - ra, b.z - rb));
    this.hi.set(Math.max(this.hi.x, a.x + ra, b.x + rb), Math.max(this.hi.y, a.y + ra, b.y + rb), Math.max(this.hi.z, a.z + ra, b.z + rb));
  }
  ball(p, r, c, g = 0) { this.push(p, r, p, r, c, g); }
  end(k) {
    const u = this.mat.uniforms; u.uCount.value = this.n; u.uK.value = k;
    const c = u.uBoxC.value.copy(this.lo).add(this.hi).multiplyScalar(.5);
    const h = u.uBoxH.value.copy(this.hi).sub(this.lo).multiplyScalar(.5).addScalar(k + .05);
    this.mesh.position.copy(c); this.mesh.scale.copy(h).multiplyScalar(2);
  }
}

// ---------- shared sprites ----------
const blobTex = canvasTex(64, 64, (g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  gr.addColorStop(0, 'rgba(30,45,70,.5)'); gr.addColorStop(.6, 'rgba(30,45,70,.22)'); gr.addColorStop(1, 'rgba(30,45,70,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
const starTex = canvasTex(64, 64, (g, w) => { g.translate(w / 2, w / 2); g.beginPath();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 12 : 28, a = i * Math.PI / 5 - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  g.closePath(); g.fillStyle = '#ffd23f'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#e0a400'; g.stroke(); });
const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

// ---------- sound: every effect is synthesized (oscillators + filtered noise), no audio files ----------
const Sfx = (() => {
  let ctx = null, master = null, noise = null;
  let muted = false; try { muted = localStorage.getItem('lab.muted') === '1'; } catch {}
  const VOL = .55;
  const now = () => ctx.currentTime;
  function unlock() { // browsers only allow audio after a click / key / tap
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ctx = new AC(); master = ctx.createGain(); master.gain.value = muted ? 0 : VOL;
      const comp = ctx.createDynamicsCompressor(); master.connect(comp); comp.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      wind();
    }
    if (ctx.state === 'suspended') ctx.resume();
  }
  const ok = () => ctx && ctx.state === 'running' && !muted;
  function bus(vol, pan) { const g = ctx.createGain(); g.gain.value = vol;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); p.connect(master); } else g.connect(master);
    return g; }
  function env(g, t, a, dur) { g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(1, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + dur); }
  function tone(o) {
    const t = now() + (o.at || 0), osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(o.f0, t); if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    env(g, t, o.a || .005, o.dur); let node = osc;
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); node = f; }
    node.connect(g); g.connect(bus(o.vol, o.pan || 0)); osc.start(t); osc.stop(t + o.dur + .05);
  }
  function hiss(o) {
    const t = now() + (o.at || 0), src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise; f.type = o.ft || 'bandpass'; f.frequency.setValueAtTime(o.f0, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur); f.Q.value = o.q || 1;
    env(g, t, o.a || .003, o.dur); src.connect(f); f.connect(g); g.connect(bus(o.vol, o.pan || 0));
    src.start(t, Math.random() * .5); src.stop(t + o.dur + .05);
  }
  function wind() { // looping noise through a slowly wobbling lowpass
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380; f.Q.value = .7;
    const lfo = ctx.createOscillator(); lfo.frequency.value = .08; const lg = ctx.createGain(); lg.gain.value = 160;
    lfo.connect(lg); lg.connect(f.frequency);
    const g = ctx.createGain(); g.gain.value = .05; src.connect(f); f.connect(g); g.connect(master); src.start(); lfo.start();
  }
  function where(c) { // quieter with distance, panned by screen position
    const d = camera.position.distanceTo(c.pos), p = c.pos.clone().project(camera);
    return { v: (c.isPlayer ? 1 : .6) * 1.6 / (1 + (d / 7) ** 2), pan: clamp(p.x, -1, 1) * .7 };
  }
  function gate(c, key, gap) { const t = now(); if ((c.sfxT[key] || -1) > t - gap) return false; c.sfxT[key] = t; return true; }
  const api = {
    unlock, count: 0,
    get muted() { return muted; },
    toggle() { muted = !muted; try { localStorage.setItem('lab.muted', muted ? '1' : '0'); } catch {}
      if (master) master.gain.setTargetAtTime(muted ? 0 : VOL, ctx.currentTime, .05); return muted; },
    step(c) { if (!ok() || !gate(c, 'step', .045)) return; const { v, pan } = where(c); if (v < .02) return; api.count++;
      const pl = c.spec.plan;
      if (pl === 'bug' || pl === 'spider') hiss({ f0: rand(2800, 4200), q: 5, dur: .03, vol: v * .12, pan });
      else if (pl === 'quad') { tone({ f0: 120 / c.spec.size, f1: 55, dur: .11, vol: v * .32, pan }); hiss({ ft: 'lowpass', f0: 500, dur: .05, vol: v * .1, pan }); }
      else { tone({ f0: c.voice * .4, f1: c.voice * .22, dur: .07, vol: v * .22, pan }); hiss({ ft: 'lowpass', f0: 900, dur: .035, vol: v * .08, pan }); } },
    jump(c) { if (!ok()) return; const { v, pan } = where(c); if (v < .02) return; api.count++;
      tone({ f0: c.voice, f1: c.voice * 2.3, dur: .2, vol: v * .28, pan });
      tone({ type: 'triangle', f0: c.voice * .5, f1: c.voice * 1.2, dur: .14, vol: v * .1, pan }); },
    land(c, impact) { if (!ok() || impact < 2) return; const { v, pan } = where(c); if (v < .02) return; api.count++;
      const k = clamp(impact / 8, .3, 1);
      tone({ f0: 140, f1: 45, dur: .14, vol: v * .4 * k, pan });
      tone({ type: 'triangle', f0: c.voice * .9, f1: c.voice * .35, dur: .1, vol: v * .14 * k, pan });
      hiss({ ft: 'lowpass', f0: 700, f1: 200, dur: .09, vol: v * .12 * k, pan }); },
    babble(c) { if (!ok()) return; const { v, pan } = where(c); if (v < .02) return; api.count++;
      const n = 3 + Math.floor(Math.random() * 3); let at = 0;
      for (let i = 0; i < n; i++) { const d = rand(.06, .11), f = c.voice * rand(.9, 1.6);
        tone({ type: 'square', lp: 1400, f0: f, f1: f * rand(.75, 1.3), dur: d, vol: v * .1, pan, at, a: .01 }); at += d + rand(.02, .05); } },
    flop(c) { if (!ok()) return; const { v, pan } = where(c); api.count++;
      tone({ type: 'sawtooth', lp: 900, f0: c.voice * 1.4, f1: c.voice * .4, dur: .5, vol: v * .14, pan, a: .02 });
      tone({ f0: 160, f1: 50, dur: .18, vol: v * .35, pan, at: .28 }); },
    getUp(c) { if (!ok()) return; const { v, pan } = where(c); api.count++;
      tone({ f0: c.voice * .8, f1: c.voice * 1.8, dur: .14, vol: v * .2, pan });
      tone({ f0: c.voice * 1.8, f1: c.voice * 2.4, dur: .1, vol: v * .12, pan, at: .1 }); },
    twinkle(c) { if (!ok()) return; const { v, pan } = where(c); if (v < .03) return; tone({ f0: rand(1800, 2600), dur: .18, vol: v * .06, pan }); },
    flap(c) { if (!ok() || !gate(c, 'flap', .08)) return; const { v, pan } = where(c); if (v < .03) return;
      hiss({ f0: 700, f1: 350, q: .8, dur: .12, vol: v * .12, pan, a: .03 }); },
    buzz(c) { if (!ok()) return; const { v, pan } = where(c); if (v < .03) return;
      tone({ type: 'sawtooth', lp: 700, f0: rand(170, 200), dur: .24, vol: v * .05, pan, a: .04 }); },
    slither(c) { if (!ok()) return; const { v, pan } = where(c); if (v < .03) return; hiss({ f0: 1800, f1: 900, q: 1.5, dur: .22, vol: v * .05, pan, a: .06 }); },
    bump(a, b) { if (!ok() || !gate(a, 'bump', .3)) return; const { v, pan } = where(a.isPlayer ? a : b); api.count++;
      tone({ type: 'triangle', f0: 520, f1: 260, dur: .09, vol: v * .2, pan }); },
    sparkle() { if (!ok()) return; api.count++; [523, 659, 784, 1047].forEach((f, i) => tone({ f0: f, dur: .22, vol: .1, at: i * .05 }));
      hiss({ ft: 'highpass', f0: 6000, dur: .3, vol: .05 }); },
    click() { if (!ok()) return; tone({ type: 'triangle', f0: 900, f1: 600, dur: .04, vol: .06 }); },
    // ---- game effects: p = a world position (V3) or null for UI sounds ----
    fx(name, p, k = 1) {
      if (!ok()) return; api.count++;
      let v = .9 * k, pan = 0;
      if (p) { const d = camera.position.distanceTo(p), q = p.clone().project(camera); v = k * 1.4 / (1 + (d / 12) ** 2); pan = clamp(q.x, -1, 1) * .7; }
      const S = {
        warn: () => { tone({ type: 'square', lp: 1800, f0: 880, dur: .08, vol: v * .07, pan }); tone({ type: 'square', lp: 1800, f0: 660, dur: .08, vol: v * .07, pan, at: .1 }); },
        slam: () => { tone({ f0: 110, f1: 38, dur: .3, vol: v * .6, pan }); hiss({ ft: 'lowpass', f0: 1200, f1: 150, dur: .25, vol: v * .3, pan }); },
        spike: () => { hiss({ ft: 'highpass', f0: 3000, dur: .12, vol: v * .2, pan }); tone({ type: 'sawtooth', lp: 2400, f0: 300, f1: 900, dur: .1, vol: v * .1, pan }); },
        swing: () => hiss({ f0: 400, f1: 1600, q: 1.2, dur: .35, vol: v * .25, pan, a: .1 }),
        boom: () => { tone({ f0: 90, f1: 30, dur: .45, vol: v * .7, pan }); hiss({ ft: 'lowpass', f0: 2000, f1: 100, dur: .5, vol: v * .45, pan }); },
        crumble: () => { for (let i = 0; i < 5; i++) hiss({ ft: 'lowpass', f0: rand(300, 900), dur: .12, vol: v * .18, pan, at: i * .06 }); },
        bonk: () => { tone({ type: 'triangle', f0: 260, f1: 90, dur: .16, vol: v * .5, pan }); hiss({ f0: 900, dur: .07, vol: v * .25, pan }); },
        dash: () => hiss({ f0: 600, f1: 2400, q: 1, dur: .22, vol: v * .25, pan, a: .02 }),
        hit: () => { tone({ type: 'square', lp: 1200, f0: 520, f1: 140, dur: .22, vol: v * .2, pan }); tone({ f0: 120, f1: 50, dur: .2, vol: v * .4, pan }); },
        revive: () => [392, 523, 659, 784].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: .16, vol: v * .14, at: i * .07, pan })),
        checkpoint: () => [659, 988].forEach((f, i) => tone({ f0: f, dur: .2, vol: v * .14, at: i * .09 })),
        win: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: .25, vol: .16, at: i * .11 })),
        lose: () => [392, 349, 311, 262].forEach((f, i) => tone({ type: 'sawtooth', lp: 900, f0: f, f1: f * .97, dur: .3, vol: .12, at: i * .2 })),
        star: () => { tone({ f0: 1047 * k, dur: .3, vol: .14 }); hiss({ ft: 'highpass', f0: 7000, dur: .2, vol: .05 }); },
        nova: () => { tone({ type: 'sawtooth', lp: 700, f0: 180, f1: 120, dur: .5, vol: v * .12, a: .05 }); tone({ type: 'sawtooth', lp: 700, f0: 270, f1: 180, dur: .5, vol: v * .08, a: .05 }); },
        tick: () => tone({ type: 'triangle', f0: 1200, dur: .03, vol: .05 }),
        shoot: () => { hiss({ f0: 900, f1: 2600, q: 2, dur: .14, vol: v * .25, pan, a: .01 }); tone({ type: 'triangle', f0: 520, f1: 260, dur: .1, vol: v * .12, pan }); },
        coin: () => { tone({ type: 'square', lp: 3000, f0: 1318, dur: .06, vol: .07 * k }); tone({ type: 'square', lp: 3000, f0: 1760, dur: .12, vol: .07 * k, at: .06 }); },
        power: () => [523, 784, 1047, 1568].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: .14, vol: .13, at: i * .05 })),
        shieldPop: () => { hiss({ ft: 'highpass', f0: 3000, dur: .3, vol: .2 }); tone({ f0: 900, f1: 300, dur: .25, vol: .15 }); },
        bounce: () => { tone({ f0: 180, f1: 720, dur: .28, vol: v * .35, pan }); tone({ type: 'triangle', f0: 360, f1: 1400, dur: .22, vol: v * .12, pan, at: .03 }); },
      };
      S[name]?.();
    },
  };
  return api;
})();
const VOICE = { biped: 330, quad: 190, bug: 520, spider: 460, worm: 260, flyer: 440 };

// ---------- rig math ----------
const UP = new V3(0, 1, 0);
function chain(nodes, anchor, wish, seg, k, dt) {
  let prev = anchor; const init = nodes.fresh;
  for (const n of nodes) {
    const want = prev.clone().addScaledVector(wish, seg);
    if (init) n.copy(want); else n.lerp(want, 1 - Math.exp(-k * dt));
    const d = n.clone().sub(prev); const l = d.length() || 1; n.copy(prev).addScaledVector(d, seg / l); prev = n;
  }
  nodes.fresh = false;
}
// two-bone inverse kinematics: given hip, foot and a pole direction, find the knee
function ik(h, ft, l1, l2, pole) {
  const d = ft.clone().sub(h); let dl = d.length(); const dir = d.divideScalar(dl || 1);
  dl = clamp(dl, Math.abs(l1 - l2) + 1e-3, (l1 + l2) * .999);
  const a = (l1 * l1 - l2 * l2 + dl * dl) / (2 * dl), hh = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  const p = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  return h.clone().addScaledVector(dir, a).addScaledVector(p, hh);
}

// Each body plan: dims() gives pivot height H (ground -> body centre) and resting height when flopped;
// build() emits body parts through L(x,y,z) (creature-local -> world) and declares legs, face, tail, wings, spikes.
const RIGS = {
  biped: {
    roll: 1.45, speed: 1,
    dims(s, U) { const Rb = U * .95 * s.body, Lb = U * .22 * (s.body + .2), reach = U * .75 * s.leg, hipY = -(Lb + Rb * .5);
      return { Rb, Lb, reach, hipY, H: reach * .82 - hipY, rest: Rb }; },
    build(x, d) {
      const { P, L, D, c, U, has, cr, amp, sx } = x, Rb = d.Rb * sx;
      P.push(L(0, -d.Lb, 0), Rb, L(0, d.Lb, 0), Rb * .96, c.body);
      if (has.belly) P.ball(L(0, -d.Lb * .4 - U * .1, Rb * .5), U * .55 * x.s.body, c.belly);
      if (has.stripes) for (const y of [.55, 0]) P.ball(L(0, d.Lb * .8 + y * Rb, -Rb * .45), Rb * .6, c.acc);
      if (has.arms) for (const sd of [-1, 1]) {
        const up = cr.waveT > 0 && sd > 0 ? 1 : 0, sw = Math.sin(cr.phase + (sd > 0 ? 0 : Math.PI)) * .3 * amp;
        const sh = L(sd * Rb * .88, d.Lb * .15, 0);
        const el = sh.clone().addScaledVector(D(sd * .45, -.8 + up * 1.7, sw), U * .32);
        const hd = el.clone().addScaledVector(D(sd * .15, -.9 + up * 1.9, sw * 1.3 + up * Math.sin(x.t * 16) * .4), U * .28);
        P.push(sh, .14 * U, el, .11 * U, c.body); P.push(el, .11 * U, hd, .14 * U, c.body);
      }
      for (const sd of [-1, 1]) x.leg({ hip: L(sd * Rb * .42, d.hipY, 0), side: sd, pair: 0, lat: .05 * U, fwd: 0,
        l1: d.reach * .5, l2: d.reach * .5, r1: .17 * U, r2: .14 * U, pad: .19 * U, pole: 'fwd' });
      x.face = { c: L(0, d.Lb * .8 + U * .15, 0), r: Rb, spread: 1, F: D(0, 0, 1) };
      x.tail = L(0, -d.Lb * .5, -Rb * .85);
      x.wings = { root: s => L(s * Rb * .4, d.Lb * .5, -Rb * .75), span: U * 1.1, w: U * .22, back: .3, freq: 7, amp: .6 };
      x.spikes = [[0, d.Lb * .7, -Rb * .88], [0, 0, -Rb * .97], [0, -d.Lb * .7, -Rb * .9]].map(p => L(...p));
    }
  },
  quad: {
    roll: 2.8, speed: 1.25,
    dims(s, U) { const Rb = U * .62 * s.body, Lt = U * .72 * s.body, reach = U * 1.0 * s.leg, hipY = -Rb * .45;
      return { Rb, Lt, reach, hipY, H: reach * .8 - hipY, rest: Rb }; },
    build(x, d) {
      const { P, L, D, c, U, has, cr, amp, sx } = x, Rb = d.Rb * sx, Lt = d.Lt;
      P.push(L(0, 0, -Lt), Rb * .95, L(0, .06 * U, Lt), Rb, c.body);
      if (has.belly) P.ball(L(0, -Rb * .35, 0), Rb * .78, c.belly);
      if (has.stripes) for (const z of [.6, 0, -.6]) P.ball(L(0, Rb * .55, Lt * z), Rb * .5, c.acc);
      for (const [pi, z] of [[0, Lt * .8], [1, -Lt * .8]]) for (const sd of [-1, 1])
        x.leg({ hip: L(sd * Rb * .55, d.hipY, z), side: sd, pair: pi, lat: .08 * U, fwd: 0, l1: d.reach * .5, l2: d.reach * .5,
          r1: .22 * U * x.s.body, r2: .16 * U * x.s.body, pad: .19 * U * x.s.body, pole: pi === 0 ? 'fwd' : 'back' });
      const bob = Math.sin(cr.phase * 2) * .05 * U * amp;
      const nb = L(0, Rb * .35, Lt * .85), nt = L(0, Rb * .35 + U * .55 + bob, Lt + U * .3);
      P.push(nb, Rb * .55, nt, U * .3, c.body);
      const hr = U * .52, Hc = nt.clone().addScaledVector(D(0, .1, 1), U * .15);
      P.ball(Hc, hr, c.body);
      const tip = Hc.clone().addScaledVector(D(0, -.3, 1), hr * .95);
      P.push(Hc, hr * .62, tip, hr * .46, c.body); P.ball(tip, hr * .42, c.belly);
      x.face = { c: Hc, r: hr, spread: 1.3, F: D(0, 0, 1), mouth: tip.clone().addScaledVector(D(0, -1, .3), hr * .38), snout: tip, floppy: true };
      x.tail = L(0, Rb * .2, -Lt - Rb * .75);
      x.wings = { root: s => L(s * Rb * .5, Rb * .7, Lt * .25), span: U * 1.3, w: U * .26, back: .3, freq: 6, amp: .6 };
      x.spikes = [.5, 0, -.5, -1].map(z => L(0, Rb * .92, Lt * z));
    }
  },
  bug: {
    roll: 2.9, speed: 1.15,
    dims(s, U) { const reach = U * 1.0 * s.leg; return { reach, H: reach * .42, rest: U * .45 }; },
    build(x, d) {
      const { P, L, D, c, U, has, sx } = x, B = x.s.body;
      P.ball(L(0, 0, 0), U * .3 * sx, c.body);
      const a0 = L(0, .05 * U, -U * .3), a1 = L(0, .18 * U, -U * 1.05 * B);
      P.push(a0, U * .32 * sx, a1, U * .46 * B * sx, c.body);
      if (has.stripes) for (const k of [.35, .75]) P.ball(a0.clone().lerp(a1, k), U * (.34 + .12 * k) * B * 1.04, c.acc);
      const Hc = L(0, .08 * U, U * .48), hr = U * .27;
      P.ball(Hc, hr, c.body);
      const zs = [.16, 0, -.16], fan = [.38, .05, -.34];
      for (let i = 0; i < 3; i++) for (const sd of [-1, 1])
        x.leg({ hip: L(sd * .22 * U, -.05 * U, zs[i] * U), side: sd, pair: i, lat: d.reach * .55, fwd: fan[i] * d.reach,
          l1: d.reach * .45, l2: d.reach * .62, r1: .075 * U, r2: .05 * U, pad: 0, pole: 'up' });
      x.face = { c: Hc, r: hr, spread: 1.35, F: D(0, 0, 1) };
      x.tail = has.tail ? a1.clone().addScaledVector(D(0, 0, -1), U * .4 * B) : null;
      x.wings = { root: s => L(s * .12 * U, .22 * U, -.05 * U), span: U * 1.15, w: U * .2, back: 1.1, freq: 26, amp: .35 };
      x.spikes = [.3, .6, .9].map(k => a0.clone().lerp(a1, k).addScaledVector(D(0, 1, 0), U * .4 * B));
    }
  },
  spider: {
    roll: 2.9, speed: 1.2,
    dims(s, U) { const reach = U * 1.15 * s.leg; return { reach, H: reach * .38, rest: U * .5 }; },
    build(x, d) {
      const { P, L, D, c, U, has, sx } = x, B = x.s.body;
      P.ball(L(0, 0, .1 * U), U * .36 * sx, c.body);
      const ab = L(0, .24 * U, -U * .72 * B);
      P.ball(ab, U * .58 * B * sx, c.body);
      if (has.stripes) for (const sd of [-1, 1]) P.ball(ab.clone().addScaledVector(D(sd * .35, 1, -.1), U * .5 * B), U * .17, c.acc);
      if (has.belly) P.ball(ab.clone().addScaledVector(D(0, .6, .5), U * .4 * B), U * .2, c.acc);
      const Hc = L(0, .1 * U, .38 * U), hr = U * .28;
      P.ball(Hc, hr, c.body);
      const zs = [.25, .1, -.05, -.2], fan = [.45, .15, -.15, -.42];
      for (let i = 0; i < 4; i++) for (const sd of [-1, 1])
        x.leg({ hip: L(sd * .25 * U, 0, zs[i] * U), side: sd, pair: i, lat: d.reach * .58, fwd: fan[i] * d.reach,
          l1: d.reach * .5, l2: d.reach * .62, r1: .065 * U, r2: .045 * U, pad: 0, pole: 'up' });
      x.face = { c: Hc, r: hr, spread: .95, F: D(0, 0, 1) };
      x.spikes = [-.3, 0, .3].map(k => ab.clone().addScaledVector(D(k, 1, 0), U * .56 * B));
    }
  },
  worm: {
    roll: 0, speed: .75,
    dims(s, U) { const r0 = U * .45 * s.body; return { r0, H: r0, rest: r0 }; },
    build(x, d) {
      const { P, L, c, U, has, cr, amp, f, r0: side0 } = x, n = x.s.segs, r0 = d.r0;
      if (!cr.wseg || cr.wseg.length !== n) cr.wseg = Array.from({ length: n }, (_, i) => L(0, 0, 0).addScaledVector(f, -i * r0 * 1.2));
      const S = cr.wseg; S[0].copy(L(0, 0, 0));
      const rad = i => r0 * (1 - .45 * i / n);
      for (let i = 1; i < n; i++) {
        const v = S[i].clone().sub(S[i - 1]); v.y = 0; const l = v.length() || 1;
        S[i].copy(S[i - 1]).addScaledVector(v, (rad(i - 1) + rad(i)) * .62 / l);
        S[i].y = cr.pos.y + rad(i) + Math.max(0, Math.sin(cr.phase * 1.5 - i * .9)) * .12 * U * amp;
      }
      const E = S.map((p, i) => { const v = (i ? S[i - 1] : S[0].clone().addScaledVector(f, 1)).clone().sub(i ? p : S[0]); v.y = 0; v.normalize();
        const sd = new V3(v.z, 0, -v.x); return { p: p.clone().addScaledVector(sd, Math.sin(cr.phase - i * .9) * .1 * U * amp), fw: v, sd }; });
      E.forEach((e, i) => P.ball(e.p, rad(i), has.stripes && i % 2 ? c.acc : c.body));
      let pair = 0;
      for (let i = 1; i < Math.min(n, 6); i++) for (const sd of [-1, 1]) {
        const e = E[i], ri = rad(i);
        const hip = e.p.clone().addScaledVector(e.sd, sd * ri * .6).addScaledVector(UP, -ri * .45);
        const rest = hip.clone().addScaledVector(e.sd, sd * ri * .5); rest.y = .05 * U;
        x.leg({ hip, rest, side: sd, pair: i, l1: ri * 1.1, l2: 0, r1: .08 * U, r2: .06 * U, pad: 0, stub: true });
        pair++;
      }
      x.face = { c: E[0].p, r: rad(0) * 1.05, spread: 1, F: E[0].fw.clone() };
      x.tail = has.tail ? E[n - 1].p : null;
      x.spikes = E.slice(1, 5).map((e, i) => e.p.clone().addScaledVector(UP, rad(i + 1) * .9));
    }
  },
  flyer: {
    roll: 2.8, speed: 1.2, flies: true,
    dims(s, U) { const reach = U * .55 * s.leg, Rb = U * .62 * s.body; return { reach, Rb, H: 1.25 + reach + Rb, rest: Rb }; },
    build(x, d) {
      const { P, L, D, c, U, has, sx } = x, Rb = d.Rb * sx;
      P.ball(L(0, 0, 0), Rb, c.body);
      if (has.belly) P.ball(L(0, -Rb * .3, Rb * .45), Rb * .62, c.belly);
      for (const sd of [-1, 1]) x.leg({ hip: L(sd * Rb * .4, -Rb * .75, 0), side: sd, pair: 0, lat: .1 * U, fwd: 0,
        l1: d.reach * .5, l2: d.reach * .5, r1: .1 * U, r2: .08 * U, pad: .11 * U, pole: 'fwd' });
      x.face = { c: L(0, Rb * .1, 0), r: Rb, spread: 1, F: D(0, 0, 1) };
      x.tail = L(0, -Rb * .2, -Rb * .85);
      x.wings = { root: s => L(s * Rb * .55, Rb * .35, -Rb * .3), span: U * 1.7, w: U * .34, back: .25, freq: 9, amp: .9 };
      x.spikes = [[0, Rb * .97, 0], [0, Rb * .8, -Rb * .55]].map(p => L(...p));
    }
  },
};

// ---------- creature ----------
const tagsEl = document.getElementById('tags');
class Creature {
  constructor(spec, x, z, isPlayer = false) {
    this.proc = new Proc(); scene.add(this.proc.mesh);
    this.pos = new V3(x, 0, z); this.vel = new V3(); this.yaw = rand(0, 6.28); this.phase = 0; this.move = 0;
    this.sy = 1; this.syv = 0; this.roll = 0; this.down = false; this.grounded = true; this.jumpReq = false;
    this.blinkT = rand(1, 4); this.blink = 0; this.waveT = 0; this.lookCam = 0; this.isPlayer = isPlayer;
    this.rad = .6; this.head = new V3(); this.mid = .8;
    this.sfxT = {}; this.dizzyT = 0; this.buzzT = 0; this.lastFlap = 0;
    this.shadow = new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
    scene.add(this.shadow);
    this.stars = [0, 1, 2].map(() => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, depthWrite: false }));
      s.scale.set(.28, .28, .28); s.visible = false; scene.add(s); return s; });
    this.tag = document.createElement('div'); this.tag.className = 'tag pill' + (isPlayer ? ' me' : ''); tagsEl.appendChild(this.tag);
    this.ai = { home: new V3(x, 0, z), target: new V3(x, 0, z), wait: rand(0, 2) };
    this.setSpec(spec);
  }
  setSpec(s) {
    this.spec = s; this.col = colorsOf(s); this.feet = []; this.chains = {}; this.wseg = null;
    // each creature's own voice: body plan sets the range, bigger = lower, seed colour nudges it
    this.voice = VOICE[s.plan] * Math.pow(2, (1 - s.size) * 1.5) * (.85 + .3 * ((s.hue * 7.31) % 1));
    this.tag.innerHTML = `<span class="dot" style="background:${css(this.col.body)}"></span>${s.name} <small>${PLAN_LABEL[s.plan]}</small>`;
  }
  chainOf(key, n) { let c = this.chains[key]; if (!c || c.length !== n) { c = this.chains[key] = Array.from({ length: n }, () => new V3()); c.fresh = true; } return c; }
  wave() { if (!this.down) { this.waveT = 1.4; Sfx.babble(this); if (this.grounded) { this.vel.y = 5; this.grounded = false; } } }
  flop() { this.down = !this.down; if (this.down) { this.syv -= 4; Sfx.flop(this); } else Sfx.getUp(this); }

  update(dt, wish, t) {
    const rig = RIGS[this.spec.plan];
    // legs set the top speed: a creature can't run faster than its feet can step
    const maxS = this.maxSpeed ?? Math.min(4 * rig.speed * (0.85 + .15 * this.spec.size), (this.legReach || 9) * 5.5);
    if (this.down || this.frozen) wish.set(0, 0, 0);
    const acc = this.grounded ? (this.slip ? 1.5 : 12) : 4;
    if (this.dashT > 0) this.dashT -= dt; // dashing: keep the burst velocity
    else { this.vel.x = damp(this.vel.x, wish.x * maxS, acc, dt); this.vel.z = damp(this.vel.z, wish.z * maxS, acc, dt); }
    if (this.jumpReq && this.grounded && !this.down && !this.frozen) { this.vel.y = 7.2; this.grounded = false; this.syv += 5; Sfx.jump(this); }
    this.jumpReq = false;
    this.vel.y -= 20 * dt; this.pos.addScaledVector(this.vel, dt);
    const ground = world.groundY(this.pos.x, this.pos.z);
    if (this.pos.y <= ground && this.pos.y > ground - .6) {
      if (!this.grounded) { this.syv -= Math.min(7, -this.vel.y * .7); Sfx.land(this, -this.vel.y); }
      this.pos.y = ground; this.vel.y = 0; this.grounded = true;
    } else if (this.pos.y > ground + .02 || this.pos.y < ground - .6) this.grounded = false;
    world.clamp(this.pos, this);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.speed = sp; this.move = clamp(sp / maxS, 0, 1);
    const turnK = this.spec.plan === 'worm' ? 5 : 10, yaw0 = this.yaw;
    if (sp > .4 && !this.down) this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), turnK, dt);
    if (this.waveT > 0) { this.waveT -= dt; if (this.waveT > .6) this.yaw += dt * 7; }
    this.turnRate = Math.abs(wrapA(this.yaw - yaw0)) / Math.max(dt, 1e-4);
    if (this.grounded) this.phase += dt * (2 + sp * 3.4);
    const tgt = 1 + (this.grounded ? .05 * Math.sin(this.phase * 2) * this.move : clamp(this.vel.y * .025, -.12, .18));
    this.syv += (tgt - this.sy) * 170 * dt; this.syv *= Math.exp(-11 * dt); this.sy = clamp(this.sy + this.syv * dt, .65, 1.4);
    this.roll = damp(this.roll, this.down ? rig.roll : 0, 6, dt);
    this.blinkT -= dt; if (this.blinkT < 0) { this.blink = .14; this.blinkT = rand(2, 5); } this.blink = Math.max(0, this.blink - dt);
    this.lookCam = damp(this.lookCam, this.move < .15 && !this.down ? 1 : 0, 4, dt);
    // looping ambience per creature: dizzy twinkles, bug buzz, worm slither
    if (this.down && this.roll > .8 && (this.dizzyT -= dt) < 0) { Sfx.twinkle(this); this.dizzyT = rand(.35, .6); }
    if (this.move > .2 && (this.buzzT -= dt) < 0) {
      const pl = this.spec.plan;
      if (pl === 'bug' && this.spec.parts.includes('wings')) { Sfx.buzz(this); this.buzzT = .22; }
      else if (pl === 'worm') { Sfx.slither(this); this.buzzT = .32; }
    }
    this.build(dt, t);
  }

  build(dt, t) {
    const s = this.spec, c = this.col, P = this.proc, U = .5 * s.size, rig = RIGS[s.plan], has = Object.fromEntries(s.parts.map(p => [p, 1]));
    P.begin();
    const f = new V3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), r0 = new V3(f.z, 0, -f.x);
    const cq = Math.cos(this.roll), sq = Math.sin(this.roll);
    const u = UP.clone().multiplyScalar(cq).addScaledVector(r0, -sq), rt = r0.clone().multiplyScalar(cq).addScaledVector(UP, sq);
    const w = rig.roll > 0 ? clamp(this.roll / rig.roll, 0, 1) : 0;
    const sy = this.sy, sx = 1 / Math.sqrt(sy);
    const d = rig.dims(s, U);
    const hover = rig.flies && !this.down ? Math.sin(t * 3) * .12 : 0;
    const O = this.pos.clone(); O.y += (d.H + hover) * (1 - w) + d.rest * w + (sy - 1) * d.rest * .6;
    // creature-local -> world (with jelly squash: y stretches, x/z shrink)
    const L = (x, y, z) => O.clone().addScaledVector(rt, x * sx).addScaledVector(u, y * sy).addScaledVector(f, z * sx);
    const D = (x, y, z) => new V3().addScaledVector(rt, x).addScaledVector(u, y).addScaledVector(f, z).normalize();
    const amp = this.move * (this.grounded ? 1 : .3);
    const legs = [];
    const x = { P, L, D, c, U, s, has, cr: this, amp, sx, t, f, r0, leg: l => legs.push(l), face: null, tail: null, wings: null, spikes: [] };
    rig.build(x, d);

    // ----- legs: planted feet + stepping + IK -----
    const air = !this.grounded || rig.flies;
    const velH = new V3(this.vel.x, 0, this.vel.z);
    const idx = new Map(legs.map((l, i) => [l.pair + ':' + l.side, i]));
    const walkers = legs.filter(l => !l.stub && !rig.flies);
    this.legReach = walkers.length ? Math.min(...walkers.map(l => l.l1 + l.l2)) : 0;
    const stepping = (pair, side) => { const j = idx.get(pair + ':' + side); return j !== undefined && this.feet[j]?.step; };
    legs.forEach((lg, i) => {
      const ft = this.feet[i] ||= { p: new V3(), from: new V3(), to: new V3(), t: 0, step: false, fresh: true };
      const reach = lg.l1 + lg.l2, gy = lg.pad || lg.r2 * .85;
      const rest = lg.rest ? lg.rest.clone() : new V3(lg.hip.x, 0, lg.hip.z).addScaledVector(r0, lg.side * lg.lat).addScaledVector(f, lg.fwd);
      rest.y = gy;
      if (ft.fresh) { ft.p.copy(rest); ft.fresh = false; }
      if (air) {
        const hang = lg.hip.clone().addScaledVector(UP, -reach * .78).addScaledVector(r0, lg.side * Math.min(lg.lat || 0, reach * .3))
          .addScaledVector(f, -reach * .12 + Math.sin(t * 4 + i) * reach * .06);
        ft.p.lerp(hang, 1 - Math.exp(-12 * dt));
        const lag = ft.p.clone().sub(hang); if (lag.length() > reach * .2) ft.p.copy(hang).addScaledVector(lag.normalize(), reach * .2);
        ft.step = false;
      } else if (lg.stub) { // caterpillar legs: a ripple runs down the body instead of discrete steps
        const ph = this.phase * 1.5 - lg.pair * .9;
        ft.p.copy(rest).addScaledVector(f, Math.sin(ph) * reach * .35 * this.move); ft.p.y = gy + Math.max(0, Math.cos(ph)) * reach * .3 * this.move;
      } else {
        const dist = Math.hypot(ft.p.x - rest.x, ft.p.z - rest.z), thr = reach * .3;
        const idle = this.move < .05 && dist > reach * .1;
        const free = !stepping(lg.pair, -lg.side) && !stepping(lg.pair - 1, lg.side) && !stepping(lg.pair + 1, lg.side);
        const strained = ft.p.distanceTo(lg.hip) > reach * .97;
        if (!ft.step && (((dist > thr || idle) && free) || dist > thr * 1.6 || strained)) {
          // quicker steps at speed; land a little ahead of the hip so the foot stays planted while the body passes over it
          ft.dur = clamp(reach * .45 / Math.max(this.speed + this.turnRate * reach, .1), .09, .22);
          ft.step = true; ft.t = 0; ft.from.copy(ft.p);
        }
        if (ft.step) { // re-aim every frame so a turning body doesn't leave the foot landing in a stale spot
          const ahead = velH.clone().multiplyScalar(ft.dur); if (ahead.length() > reach * .32) ahead.setLength(reach * .32);
          ft.to.copy(rest).add(ahead); ft.to.y = gy;
          ft.t += dt / ft.dur; const k = Math.min(1, ft.t), e = k * k * (3 - 2 * k);
          ft.p.lerpVectors(ft.from, ft.to, e); ft.p.y = gy + Math.sin(Math.PI * k) * reach * .22;
          if (ft.t >= 1) { ft.step = false; ft.p.copy(ft.to); Sfx.step(this); } }
        else ft.p.y = damp(ft.p.y, gy, 20, dt);
      }
      let foot = ft.p;
      if (w > 0) { const flail = lg.hip.clone().addScaledVector(u, -reach * .7).addScaledVector(rt, lg.side * reach * .25)
          .addScaledVector(f, Math.sin(t * 14 + i * 1.7) * reach * .2); foot = ft.p.clone().lerp(flail, w); }
      this.stretch = Math.max(this.stretch || 0, foot.distanceTo(lg.hip) / (reach || 1));
      const col = s.plan === 'bug' || s.plan === 'spider' ? c.dark : c.leg;
      if (lg.stub) { P.push(lg.hip, lg.r1, foot, lg.r2, col); return; }
      const pole = lg.pole === 'fwd' ? nv(f, 1, u, .2) : lg.pole === 'back' ? nv(f, -1, u, .2) : nv(u, 1, rt, lg.side * .7);
      const knee = ik(lg.hip, foot, lg.l1, lg.l2, pole);
      P.push(lg.hip, lg.r1, knee, lg.r2 * 1.05, col); P.push(knee, lg.r2, foot, lg.r2 * .85, col);
      if (lg.pad) P.push(foot, lg.pad, foot.clone().addScaledVector(f, lg.pad * .9), lg.pad * .9, c.dark);
    });
    // ----- face -----
    const F = x.face, fc = F.c, fr = F.r, Fd = F.F, Uf = u, Rf = rt;
    const n = s.eyes;
    const lay = n === 1 ? [[0, .2]] : n === 2 ? [[-.36, .2], [.36, .2]] : n === 3 ? [[-.42, .1], [.42, .1], [0, .52]]
      : Array.from({ length: n }, (_, i) => { const a = i * 2.39996, rr = .62 * Math.sqrt((i + .5) / n); return [Math.cos(a) * rr, Math.sin(a) * rr * .8 + .2]; });
    const eR = fr * s.eyeSize * (n === 1 ? .27 : n === 2 ? .2 : n === 3 ? .17 : .27 / Math.sqrt(n / 2.2));
    const toCam = camera.position.clone().sub(fc).normalize();
    for (const [lx, ly] of lay) {
      const dir = nv(Fd, 1, Rf, lx * F.spread, Uf, ly);
      const ec = fc.clone().addScaledVector(dir, fr * .88);
      if (this.blink > 0) { P.ball(ec, eR * .55, c.body, 1); continue; }
      P.ball(ec, eR, [.98, .98, 1], 1);
      const look = dir.clone();
      if (this.down) look.addScaledVector(Rf, Math.cos(t * 8) * .45).addScaledVector(Uf, Math.sin(t * 8) * .45);
      else look.lerp(toCam, .45 * this.lookCam);
      look.normalize(); if (look.dot(dir) < .55) look.lerp(dir, .5).normalize();
      const pc = ec.clone().addScaledVector(look, eR * .62);
      P.ball(pc, eR * .55, [.06, .06, .09], 1);
      if (n <= 3) P.ball(pc.clone().addScaledVector(look, eR * .42).addScaledVector(Uf, eR * .25).addScaledVector(Rf, eR * .18), eR * .15, [1, 1, 1], 1);
    }
    if (has.mouth) {
      const m = F.mouth || fc.clone().addScaledVector(nv(Fd, 1, Uf, -.4), fr * .96), open = this.down ? .5 : 0;
      P.push(m.clone().addScaledVector(Rf, -fr * .26).addScaledVector(Uf, fr * (.07 - open * .1)), fr * .05, m, fr * .065, c.mouth, 1);
      P.push(m, fr * .065, m.clone().addScaledVector(Rf, fr * .26).addScaledVector(Uf, fr * (.07 - open * .1)), fr * .05, c.mouth, 1);
    }
    if (has.horns) for (const sd of [-1, 1]) {
      const root = fc.clone().addScaledVector(nv(Uf, .85, Rf, sd * .45, Fd, .1), fr * .85);
      const mid = root.clone().addScaledVector(nv(Uf, 1, Rf, sd * .6), fr * .38);
      const tip = mid.clone().addScaledVector(nv(Uf, .8, Fd, .45, Rf, sd * .2), fr * .36);
      P.push(root, fr * .16, mid, fr * .1, c.acc, 1); P.push(mid, fr * .1, tip, fr * .025, c.acc, 1);
    }
    if (has.ears) for (const sd of [-1, 1]) {
      if (F.floppy) { const root = fc.clone().addScaledVector(Rf, sd * fr * .8).addScaledVector(Uf, fr * .2);
        const tip = root.clone().addScaledVector(nv(Rf, sd * .9, Uf, -.5, Fd, -.25), fr * .75 * (1 + .06 * Math.sin(t * 3 + sd)));
        P.push(root, fr * .33, tip, fr * .42, c.acc); }
      else { const e = fc.clone().addScaledVector(nv(Uf, .75, Rf, sd * .65), fr * .85);
        P.push(e, fr * .22, e.clone().addScaledVector(nv(Uf, .6, Rf, sd * .5), fr * .2), fr * .16, c.acc); }
    }
    if (has.antennae) for (const sd of [-1, 1]) {
      const root = fc.clone().addScaledVector(nv(Uf, 1, Fd, .35, Rf, sd * .35), fr * .9);
      const nodes = this.chainOf('ant' + sd, 2);
      chain(nodes, root, nv(Uf, 1, Fd, .5, Rf, sd * .45), fr * .55, 9, dt);
      P.push(root, fr * .06, nodes[0], fr * .05, c.dark, 1); P.push(nodes[0], fr * .05, nodes[1], fr * .045, c.dark, 1);
      P.ball(nodes[1], fr * .14, c.acc, 1);
    }
    if (has.mandibles) for (const sd of [-1, 1]) {
      const root = fc.clone().addScaledVector(nv(Fd, 1, Uf, -.35, Rf, sd * .35), fr * .85), open = .2 + .15 * Math.sin(t * 7);
      const mid = root.clone().addScaledVector(nv(Fd, 1, Rf, sd * .25), fr * .35);
      const tip = mid.clone().addScaledVector(nv(Fd, 1, Rf, -sd * (.6 + open)), fr * .32);
      P.push(root, fr * .1, mid, fr * .08, c.dark, 1); P.push(mid, fr * .08, tip, fr * .02, c.dark, 1);
    }
    if (has.tusks) for (const sd of [-1, 1]) {
      const base = (F.mouth || fc.clone().addScaledVector(Fd, fr * .7)).clone().addScaledVector(Rf, sd * fr * .32);
      const mid = base.clone().addScaledVector(nv(Fd, 1, Uf, -.4, Rf, sd * .25), fr * .5);
      const tip = mid.clone().addScaledVector(nv(Fd, .4, Uf, 1), fr * .35);
      P.push(base, fr * .1, mid, fr * .075, c.ivory, 1); P.push(mid, fr * .075, tip, fr * .02, c.ivory, 1);
    }
    if (has.trunk) {
      const root = F.snout || fc.clone().addScaledVector(nv(Fd, 1, Uf, -.2), fr * .9);
      const nodes = this.chainOf('trunk', 4);
      chain(nodes, root, nv(Fd, .35, Uf, -1, Rf, Math.sin(t * 2.2) * .35), fr * .3, 6, dt);
      let prev = root, pr = fr * .36;
      nodes.forEach((p, i) => { const r = fr * (.32 - i * .05) + (i === 3 ? fr * .04 : 0); P.push(prev, pr, p, r, c.body); prev = p; pr = r; });
    }
    // ----- tail -----
    if (has.tail && x.tail) {
      const nodes = this.chainOf('tail', 4);
      chain(nodes, x.tail, nv(Fd, -1, Uf, .4, Rf, Math.sin(t * 6) * .35 * (1 - this.move * .5)), U * .28, 8, dt);
      let prev = x.tail, pr = U * .2;
      nodes.forEach((p, i) => { const r = U * (.17 - i * .03); P.push(prev, pr, p, r, c.body); prev = p; pr = r; });
      if (s.tailStyle === 'club') P.ball(prev, U * .22, c.acc); else if (s.tailStyle === 'tuft') P.ball(prev, U * .15, c.acc);
    }
    // ----- wings -----
    if (has.wings && x.wings && rig.flies && !this.down) { const sg = Math.sin(t * x.wings.freq); if (this.lastFlap > 0 && sg <= 0) Sfx.flap(this); this.lastFlap = sg; }
    if (has.wings && x.wings) for (const sd of [-1, 1]) {
      const W = x.wings, root = W.root(sd), a = .35 + W.amp * Math.sin(t * W.freq);
      const out = nv(Rf, sd * Math.cos(a), Uf, Math.sin(a), Fd, -W.back);
      if (s.plan === 'bug') { // insect: one translucent-looking leaf
        const mid = root.clone().addScaledVector(out, W.span * .5).addScaledVector(Fd, -W.span * .08);
        const tip = root.clone().addScaledVector(out, W.span).addScaledVector(Fd, -W.span * .25);
        P.push(root, W.w * .25, mid, W.w, c.wing, 1); P.push(mid, W.w, tip, W.w * .15, c.wing, 1);
      } else { // feathered: arm bone + three feathers fanning back, outer ones lag the flap
        const wrist = root.clone().addScaledVector(out, W.span * .42);
        P.push(root, W.w * .38, wrist, W.w * .3, c.body, 0);
        for (let k = 0; k < 3; k++) {
          const lag = W.amp * Math.sin(t * W.freq - .5 - k * .35) * .35;
          const fd = nv(out, 1, Fd, -(.15 + k * .55), Uf, lag);
          const tip = wrist.clone().addScaledVector(fd, W.span * (.68 - k * .13));
          P.push(wrist, W.w * .55, tip, W.w * .22, k === 1 ? c.wing : c.acc, 1);
        }
      }
    }
    // ----- back spikes -----
    if (has.spikes) for (const p of x.spikes.slice(0, 4)) P.push(p, U * .1, p.clone().addScaledVector(Uf, U * .32).addScaledVector(Fd, -U * .14), U * .02, c.acc, 1);

    const blend = (s.plan === 'bug' || s.plan === 'spider') ? U * .1 : U * .22;
    P.end(blend);

    // shadow, stars, tag anchors
    const ex = P.hi.x - P.lo.x, ez = P.hi.z - P.lo.z;
    this.rad = clamp(Math.max(ex, ez) * .32, .4, 1.6);
    const sh = Math.max(ex, ez) * 1.05 / (1 + Math.max(0, P.lo.y) * .5);
    this.shadow.scale.set(sh, 1, sh); { const sx = (P.lo.x + P.hi.x) / 2, sz = (P.lo.z + P.hi.z) / 2, gy = world.groundY(sx, sz); this.shadow.visible = gy > -50; this.shadow.position.set(sx, (gy > -50 ? gy : 0) + .012, sz); }
    this.shadow.material.opacity = 1 / (1 + Math.max(0, P.lo.y) * .8);
    this.stars.forEach((st, i) => { st.visible = this.down && this.roll > .8;
      const a = t * 3 + i * 2.094; st.position.set(fc.x + Math.cos(a) * .55, P.hi.y + .2, fc.z + Math.sin(a) * .55); });
    this.head.set((P.lo.x + P.hi.x) / 2, P.hi.y + .3, (P.lo.z + P.hi.z) / 2);
    this.mid = (P.lo.y + P.hi.y) / 2;
  }
  dispose() { scene.remove(this.proc.mesh, this.shadow, ...this.stars); this.proc.mat.dispose(); this.shadow.material.dispose(); this.tag.remove(); }
}


export { V3, MAXP, clamp, damp, rand, wrapA, dampAngle, mulberry, hsl, css, nv, SYL, PLANS, PLAN_LABEL, PARTS, ODDS,
  genSpec, colorsOf, canvasTex, VP, Proc, blobTex, starTex, blobGeo, Sfx, VOICE, UP, chain, ik, RIGS, Creature };
