// NOVA — the AI Architect, v2.
//
// Every think tick, for each runner she:
//   1. builds REACTION HYPOTHESES — keep running, dodge left, dodge right, stop, back off, jump — each a short
//      predicted path, weighted by what she has learned about this player (dodge side, stop/jump habits,
//      reaction time, running speed). Buddies get a bot-like profile.
//   2. generates GHOST TRAPS — every trap type on every nearby row/column, both "now" and "timed to arrive
//      exactly when you get there" — and scores each by EXPECTED HIT CHANCE across the hypotheses.
//   3. searches PAIRS of ghosts (with delays) for combos that cover each other's escapes, plus scripted funnels.
//   4. applies tactic learning: a per-player bandit over tactics (what has actually worked on YOU).
//   5. stays fair: a play is rejected if no reasonable reaction escapes it, energy is finite, threats per runner capped.
import { TRAPS } from './levels.js';
import { Wall, Spikes, Hammer, Cannon, Collapse } from './traps.js';
import { COLS, TILE, HALF, xOf, colOf, rowOf } from './track.js';
import { V3, clamp, rand } from './engine.js';

const MEM_KEY = 'ag.nova.mem';
const MEM0 = { dodge: 0, jump: .3, stop: .3, react: .4, speed: 4.4, lane: 0, n: 0, tac: {} };
export function loadMem() { try { const m = { ...MEM0, ...JSON.parse(localStorage.getItem(MEM_KEY) || '{}') }; m.tac ||= {}; return m; } catch { return { ...MEM0, tac: {} }; } }
export function saveMem(m) { try { localStorage.setItem(MEM_KEY, JSON.stringify(m)); } catch {} }
export const ema = (a, b, k) => a + (b - a) * k;

const DT = .1, HORIZON = 3.6, LIVE = { spikes: 1.2, hammer: 1.1, collapse: 4.5, wall: 7 };

// ---------- ghost traps: same geometry + danger timing as the real ones, no meshes ----------
export class Ghost {
  constructor(type, a) {
    this.type = type; this.a = a; this.tele = a.tele;
    if (type === 'spikes') this.zone = { x0: xOf(a.c0) - 1, x1: xOf(a.c1) + 1, z0: a.r0 * TILE, z1: (a.r1 + 1) * TILE };
    else if (type === 'wall') { const zc = a.row * TILE + 1; this.zone = { x0: xOf(a.c0) - 1, x1: xOf(a.c1) + 1, z0: zc - .45, z1: zc + .45 }; }
    else if (type === 'hammer') { const zc = a.row * TILE + 1; this.zone = { x0: -HALF, x1: HALF, z0: zc - .9, z1: zc + .9 }; }
    else if (type === 'cannon') { const zc = a.row * TILE + 1; this.zone = { x0: -HALF, x1: HALF, z0: zc - .7, z1: zc + .7 }; }
    else { const xs = a.tiles.map(t => xOf(t[1])), zs = a.tiles.map(t => t[0] * TILE);
      this.zone = { x0: Math.min(...xs) - 1, x1: Math.max(...xs) + 1, z0: Math.min(...zs), z1: Math.max(...zs) + TILE }; }
    this.jumpable = type === 'spikes' || type === 'cannon';
  }
  inZone(x, z) {
    if (this.type === 'collapse') { const r = Math.floor(z / TILE), c = Math.floor((x + HALF) / TILE); return this.a.tiles.some(t => t[0] === r && t[1] === c); }
    const q = this.zone; return x > q.x0 && x < q.x1 && z > q.z0 && z < q.z1;
  }
  window(x) {
    const t = this.tele;
    if (this.type === 'cannon') { const a = t + Math.abs(this.a.side * (HALF + .6) - x) / 10; return [a - .25, a + .25]; }
    if (this.type === 'hammer') return [t + .15, t + 1.0];
    return [t - .05, t + LIVE[this.type]];
  }
  delayed(d) { return new Ghost(this.type, { ...this.a, tele: this.a.tele + d }); }
  make(g) {
    const a = this.a;
    if (this.type === 'spikes') return new Spikes(g, a.c0, a.c1, a.r0, a.r1, a.tele);
    if (this.type === 'wall') return new Wall(g, a.c0, a.c1, a.row, a.tele);
    if (this.type === 'hammer') return new Hammer(g, a.row, a.tele, a.dir);
    if (this.type === 'cannon') return new Cannon(g, a.row, a.tele, a.side);
    return new Collapse(g, a.tiles, a.tele);
  }
  get cost() { return TRAPS[this.type].cost; }
}

// ---------- reaction hypotheses ----------
// returns [{ name, p, pts: [{x, z, air}] }] sampled every DT for HORIZON seconds
export function hypotheses(G, c, mem, isPlayer, skill) {
  const tr = G.track, out = [];
  const react = isPlayer ? clamp(mem.react, .15, .9) : .22;
  const vz0 = c.down ? 0 : c.vel.z, vx0 = c.down ? 0 : c.vel.x;
  const cruise = isPlayer ? clamp(mem.speed, 2.5, 6) : 4.3;
  const conf = clamp(mem.n / 6, 0, 1);
  const bias = isPlayer ? mem.dodge * conf : 0;             // +1 = always dodges toward +x
  const pStop = isPlayer ? .08 + .45 * mem.stop : .35, pJump = isPlayer ? .04 + .3 * mem.jump : .05;
  const pGo = c.down ? 0 : .12 + (isPlayer ? 0 : .05), pBack = .06;
  const pDodge = Math.max(.1, 1 - pStop - pJump - pGo - pBack);
  const mk = (name, p, fn) => { if (p <= 0) return; const pts = []; let x = c.pos.x, z = c.pos.z, vx = vx0, vz = vz0;
    for (let t = 0; t <= HORIZON; t += DT) { const s = fn(t, vx, vz, x, z); vx = s[0]; vz = s[1]; x = clamp(x + vx * DT, -HALF + .3, HALF - .3); z += vz * DT;
      pts.push({ x, z, air: s[2] || false, t }); }
    out.push({ name, p, pts }); };
  const lat = s => { const tc = colOf(c.pos.x) + s; return tc >= 0 && tc < COLS && tr.solid(rowOf(c.pos.z + 1), tc); };
  if (c.down) { mk('down', 1, () => [0, 0]); return out; }
  const run = (t, vx, vz) => [vx * .8, vz + (Math.max(vz, cruise * .9) - vz) * .2];
  mk('go', pGo, run);
  mk('stop', pStop, (t, vx, vz) => t < react ? run(t, vx, vz) : [vx * .6, vz * .55]);
  mk('back', pBack, (t, vx, vz) => t < react ? run(t, vx, vz) : t < react + .6 ? [0, -2.5] : [0, 0]);
  mk('jump', pJump, (t, vx, vz) => [...run(t, vx, vz), t > react && t < react + .72]);
  for (const s of [1, -1]) {
    const ok = lat(s), w = pDodge * (.5 + .5 * s * bias);
    if (ok) mk(s > 0 ? 'left' : 'right', w, (t, vx, vz) => t < react ? run(t, vx, vz) : t < react + .5 ? [s * 4.2, vz * .85] : [0, Math.max(vz, cruise * .7)]);
    else out.find(h => h.name === 'stop').p += w;           // can't dodge that way: they'll stop instead
  }
  const sum = out.reduce((a, h) => a + h.p, 0); out.forEach(h => h.p /= sum);
  return out;
}

// does a hypothesis get hit by any of the ghosts? (optional path transform for funnels)
export function hits(hyp, ghosts) {
  for (const pt of hyp.pts) for (const g of ghosts) {
    if (g.type === 'wall' || !g.inZone(pt.x, pt.z)) continue;
    const w = g.window(pt.x); if (pt.t < w[0] || pt.t > w[1]) continue;
    if (pt.air && g.jumpable) continue;
    return true;
  }
  return false;
}
export function evalGhosts(hyps, ghosts) {
  let E = 0, escapes = 0, top = null, topP = 0;
  for (const h of hyps) { if (hits(h, ghosts)) { E += h.p; if (h.p > topP) { topP = h.p; top = h.name; } } else if (h.name !== 'go') escapes++; }
  return { E, escapes, top };
}
