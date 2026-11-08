// NOVA — the AI Architect. Decision-making lives here; the simulation maths is in nova_brain.js.
import { TRAPS } from './levels.js';
import { COLS, TILE, HALF, xOf, colOf, rowOf } from './track.js';
import { Proc, V3, clamp, damp, rand } from './engine.js';
import { Ghost, hypotheses, evalGhosts, loadMem, saveMem, ema } from './nova_brain.js';

const pick = a => a[Math.floor(Math.random() * a.length)];
const LINES = {
  hit: ['Gotcha.', 'Predictable.', 'Ouch. For you.', 'Down you go.', 'Saw that coming.'],
  miss: ['Lucky.', 'Hm. Again.', 'Not bad.', 'Noted.', 'Adjusting.'],
  left: ['You always dodge left.', 'Left again? I know.'], right: ['You always dodge right.', 'Right again? I know.'],
  stop: ['You stop for everything.', 'Standing still is a choice.'], jump: ['Jumping again? I know.', 'Hop, hop. I counted.'],
  go: ['You never look up.', 'Eyes on the floor, little one.'], back: ['Backing off? Expected.'],
  combo: ['Dodge that, then this.', 'Two steps ahead.', 'Left or right? Both.'],
  funnel: ['Only one way through. Guess what is there.', 'Funnel.'],
  timed: ['I know exactly when you arrive.', 'Right on schedule.'],
  revive: ['Reviving? Bold.', 'Helping costs time.'], buddy: ['Your friends first, then.', 'Thinning the herd.'],
  wipe: ['All of you. Down.', 'Team wipe. Again?'], bonk: ['No Bonk left? Pity.', 'Out of Bonk.'],
  mercy: ['Fine. Breathe.', 'I will give you a second.'], final: ['Last stretch. No more games.'],
  camp: ['Camping? Cute.'], saved: ['How touching.', 'Teamwork. Disgusting.'],
  win: ['...Next time.', 'Enjoy it while it lasts.'],
  stunned: ['OW! You little—', 'My hand! MY HAND!', 'That tickles. Stop it.', 'Rude!'],
  dodge: ['Too slow.', 'Missed me.', 'Nice try.'],
  dead: ['Three strikes.', 'Knocked out. As planned.'],
};
const TAC_NAMES = { spikes: 'Spikes', hammer: 'Hammer', cannon: 'Cannon', collapse: 'Collapse', wall: 'Wall', funnel: 'Funnel', combo: 'Combos', timed: 'Timed traps' };

export class Nova {
  constructor(g, cfg) {
    this.g = g; this.cfg = cfg; this.energy = cfg.energyMax * .4; this.thinkT = cfg.grace; this.queue = [];
    this.mem = loadMem(); this.obs = []; this.pending = []; this.hand = new Hand(); this.cool = 0; this.sayT = 0;
    this.stats = { plays: 0, combos: 0, hits: 0 }; this.focus = null; this.final = false; this.campT = 0;
    this.rowCool = new Map();   // fairness: a row that was just trapped gets a guaranteed safe window
    this.stunT = 0;
    this.burst = 0; this.burstMax = 3 + (cfg.n - 1) / 19 * 6 + (cfg.nightmare ? 4 : 0);   // pacing: attack waves, then a breather
  }
  say(kind, force) {
    if (!force && this.sayT > 0) return; this.sayT = 2.4;
    this.g.say(LINES[kind] ? pick(LINES[kind]) : kind);
  }
  save() { saveMem(this.mem); }
  has(t) { return this.cfg.traps.includes(t); }
  rowOk(r) { const tr = this.g.track; return r >= 4 && r < tr.R - 4 && !tr.isChasm(r) && !tr.pad[r] && !(this.rowCool.get(r) > 0); }
  threatsNear(c) { return this.g.traps.filter(t => t.state !== 'done' && t.type !== 'wall' && Math.abs((t.zone.z0 + t.zone.z1) / 2 - c.pos.z) < 6).length; }
  overlaps(z) { return this.g.traps.some(t => t.state !== 'done' && t.zone.x0 < z.x1 && t.zone.x1 > z.x0 && t.zone.z0 < z.z1 + .5 && t.zone.z1 > z.z0 - .5); }
  // tactic bandit: what has actually worked on this player (optimistic prior)
  tacF(name) { const s = this.mem.tac[name]; const rate = s ? (s.h + 1) / (s.n + 3) : .33; return .7 + rate * 1.2; }
  bestTactic() { let b = null, br = -1; for (const [k, s] of Object.entries(this.mem.tac)) { if (s.n < 3) continue; const r = s.h / s.n; if (r > br) { br = r; b = k; } } return b ? `${TAC_NAMES[b] || b} (${Math.round(br * 100)}%)` : 'still learning'; }

  // ---------- candidate generation ----------
  singles(c, hyps) {
    const tr = this.g.track, cfg = this.cfg, out = [], r0 = rowOf(c.pos.z), vz = Math.max(.1, c.vel.z);
    const teles = r => { const eta = (r * TILE + 1 - c.pos.z) / vz, list = [cfg.tele];
      if (eta > cfg.tele + .25 && eta < cfg.tele + 2.2) list.push(eta - .1); return list; };  // "timed": goes off right as they arrive
    for (let r = r0; r <= r0 + 7; r++) {
      if (!this.rowOk(r)) continue;
      const open = tr.openCols(r); if (!open.length) continue;
      for (const tele of teles(r)) {
        const timed = tele !== cfg.tele;
        if (this.has('spikes')) {
          const spans = open.map(k => [k, k]);
          if (cfg.n >= 10) for (const k of open) if (open.includes(k + 1)) spans.push([k, k + 1]);
          if (open.length <= 2) spans.push([Math.min(...open), Math.max(...open)]);
          for (const [a, b] of spans) out.push(new Ghost('spikes', { c0: a, c1: b, r0: r, r1: r, tele, timed }));
        }
        if (this.has('hammer') && r > r0) out.push(new Ghost('hammer', { row: r, tele, dir: c.pos.x > 0 ? -1 : 1, timed }));
        if (this.has('cannon') && r > r0) for (const side of [1, -1]) out.push(new Ghost('cannon', { row: r, tele, side, timed }));
        if (this.has('collapse') && r <= r0 + 3) for (const k of open) {
          out.push(new Ghost('collapse', { tiles: [[r, k]], tele, timed }));
          if (cfg.skill > .6 && open.includes(k + 1)) out.push(new Ghost('collapse', { tiles: [[r, k], [r, k + 1]], tele, timed }));
        }
      }
    }
    return out.filter(g => !this.overlaps(g.zone));
  }
  // walls don't hurt: they cost you time. Value = chance your path runs into it.
  walls(c, hyps) {
    const tr = this.g.track, cfg = this.cfg, out = [], r0 = rowOf(c.pos.z);
    if (!this.has('wall')) return out;
    for (let r = r0 + 1; r <= r0 + 4; r++) {
      const open = tr.openCols(r); if (!this.rowOk(r) || open.length < 2) continue;
      for (let a = 0; a < open.length; a++) for (let b = a; b < open.length - (a === 0 ? 1 : 0); b++) {
        const span = open.slice(a, b + 1); if (span.some((k, i) => i && k !== span[i - 1] + 1)) continue;
        const gh = new Ghost('wall', { c0: span[0], c1: span.at(-1), row: r, tele: cfg.tele * .8 });
        if (this.overlaps(gh.zone)) continue;
        let blocked = 0; for (const h of hyps) if (h.pts.some(p => p.t > gh.tele && p.x > gh.zone.x0 && p.x < gh.zone.x1 && p.z > gh.zone.z0 - .4 && p.z < gh.zone.z1)) blocked += h.p;
        if (blocked > .2) out.push({ gh, E: blocked * (c.bonkCD > 1 ? .7 : .4) });
      }
    }
    return out;
  }
  funnels(c, hyps) {
    const tr = this.g.track, cfg = this.cfg, out = [], r0 = rowOf(c.pos.z);
    if (!this.has('wall') || !this.has('spikes') || c.vel.z < 1.5) return out;
    for (let rw = r0 + 2; rw <= r0 + 4; rw++) {
      const open = tr.openCols(rw); if (!this.rowOk(rw) || !this.rowOk(rw + 1) || open.length < 2) continue;
      for (const gap of open) {
        const rest = open.filter(k => k !== gap), L = rest.filter(k => k < gap), R = rest.filter(k => k > gap), walls = [];
        if (L.length) walls.push(new Ghost('wall', { c0: Math.min(...L), c1: Math.max(...L), row: rw, tele: cfg.tele * .7 }));
        if (R.length) walls.push(new Ghost('wall', { c0: Math.min(...R), c1: Math.max(...R), row: rw, tele: cfg.tele * .7 }));
        const sp = new Ghost('spikes', { c0: gap, c1: gap, r0: rw, r1: rw + 1, tele: cfg.tele + .35 });
        if ([...walls, sp].some(g => this.overlaps(g.zone))) continue;
        // runners heading forward get squeezed into the gap column
        const gx = xOf(gap), wz = rw * TILE - 1;
        const squeezed = hyps.map(h => ({ ...h, pts: h.pts.map(p => p.z > wz ? { ...p, x: gx } : p) }));
        out.push({ ghosts: [...walls, sp], squeezed });
      }
    }
    return out;
  }

  // ---------- think ----------
  stun(t, by) {
    const fresh = !(this.stunT > 0);
    this.stunT = Math.max(this.stunT, t); this.energy = Math.max(0, this.energy - 1.5); this.hand.p.mat.uniforms.uFlash.value = 1;
    this.queue = [];                                   // knocked out of her combo
    this.g.fx('bonk', this.hand.pos.clone(), 1.2); this.g.popAt(this.hand.pos, 'STUNNED!', '#ffd23d');
    if (fresh) this.say('stunned', true);
  }
  think() {
    const g = this.g, cfg = this.cfg, P = g.player;
    if (this.cool > 0 || this.stunT > 0) return;
    if (cfg.mercy && g.recentPlayerHits(10) >= 2) { this.cool = 2.5; this.say('mercy', true); return; }
    let best = null;
    const consider = (o) => { if (!best || o.u > best.u) best = o; };
    for (const c of g.runners) {
      if (c.finished || c.pos.y < -1) continue;
      if (c.down && !(cfg.hunt && c !== P)) continue;
      if (this.threatsNear(c) >= cfg.maxThreats) continue;
      if (c.pos.z < 6 || c.pos.z > g.track.finishZ - 3) continue;
      const isP = c === P;
      let w = isP ? 1 : (P.down ? 1.3 : .5);
      if (cfg.hunt && c.reviving > .2) w += .5;                          // punish the reviver
      const hyps = hypotheses(g, c, this.mem, isP, cfg.skill);
      const noise = () => (Math.random() - .5) * (1 - cfg.skill) * .5;
      const singles = this.singles(c, hyps).map(gh => {
        const ev = evalGhosts(hyps, [gh]);
        const tac = gh.a.timed ? 'timed' : gh.type;
        const v = ev.E * w * (isP ? this.tacF(tac) : 1) * (.6 + .4 * cfg.skill);
        return { ghosts: [gh], ev, v, cost: gh.cost, tac, c };
      }).filter(s => s.ev.E > .05);
      for (const s of singles) if (s.ev.escapes > 0 || cfg.nightmare) consider({ ...s, u: s.v / Math.pow(s.cost, .6) + noise() });
      // combos: pairs of the strongest singles, second one delayed, together they cover the escapes
      if (cfg.combos) {
        const top = singles.sort((a, b) => b.v - a.v).slice(0, 7);
        for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
          const A = top[i].ghosts[0];
          for (const d of [0, .35, .7]) {
            const B = top[j].ghosts[0].delayed(d), z1 = A.zone, z2 = B.zone;
            if (z1.x0 < z2.x1 && z1.x1 > z2.x0 && z1.z0 < z2.z1 && z1.z1 > z2.z0) continue;
            const ev = evalGhosts(hyps, [A, B]); if (!ev.escapes && !cfg.nightmare) continue;
            const cost = A.cost + B.cost, v = ev.E * w * (isP ? this.tacF('combo') : 1) * 1.05;
            if (ev.E > top[i].ev.E + .12) consider({ ghosts: [A, B], ev, v, cost, tac: 'combo', c, u: v / Math.pow(cost, .6) + noise() });
          }
        }
        for (const f of this.funnels(c, hyps)) {
          const ev = evalGhosts(f.squeezed, [f.ghosts.at(-1)]); if (!ev.escapes && !cfg.nightmare) continue;
          const cost = f.ghosts.reduce((a, q) => a + q.cost, 0), v = ev.E * w * (isP ? this.tacF('funnel') : 1);
          consider({ ghosts: f.ghosts, ev, v, cost, tac: 'funnel', c, u: v / Math.pow(cost, .6) + noise() + .05 });
        }
      }
      for (const wl of this.walls(c, hyps)) { const v = wl.E * w * (isP ? this.tacF('wall') : 1); consider({ ghosts: [wl.gh], ev: { E: wl.E, top: null, escapes: 1 }, v, cost: 1, tac: 'wall', c, u: v + noise() }); }
      // Bonk on cooldown: a wall right in their face costs them time (par pressure)
      if (isP && cfg.hunt && this.has('wall') && c.bonkCD > 1.5) {
        const rw = rowOf(c.pos.z + Math.max(2, c.vel.z * cfg.tele)) + 1, open = g.track.openCols(rw);
        if (this.rowOk(rw) && open.length >= 2) { const keep = open[c.pos.x > 0 ? 0 : open.length - 1], rest = open.filter(k => k !== keep);
          const gh = new Ghost('wall', { c0: Math.min(...rest), c1: Math.max(...rest), row: rw, tele: cfg.tele * .7 });
          if (rest.length && rest.every((k, i) => !i || k === rest[i - 1] + 1) && !this.overlaps(gh.zone)) consider({ ghosts: [gh], ev: { E: 0, top: null }, v: .3, cost: 1, tac: 'wall', c, u: .3, line: 'bonk' }); }
      }
    }
    if (!best || best.u < .12) return;
    // save up if we can't afford it yet but it's worth it
    if (best.cost > this.energy) return;
    this.execute(best);
  }

  execute(play) {
    const g = this.g, P = g.player, isP = play.c === P;
    this.energy -= play.cost; this.stats.plays++;
    this.burst += play.cost;
    if (this.burst >= this.burstMax) { this.burst = 0; this.cool = 2.4 - (this.cfg.n - 1) / 19 * .9 - (this.cfg.nightmare ? .6 : 0); }
    if (play.ghosts.length > 1) this.stats.combos++;
    const traps = [];
    play.ghosts.forEach((gh, i) => {
      const go = () => { const t = gh.make(g); if (this.place(t)) traps.push(t); };
      if (gh.type === 'spikes' && play.tac === 'funnel' && i === play.ghosts.length - 1) this.later(.35, go); else go();
    });
    if (isP) this.pending.push({ tac: play.tac, traps, t: Math.max(...play.ghosts.map(q => q.a.tele)) + 1.6, hit: false });
    // talk about it: name the habit we're exploiting
    const top = play.ev.top, m = this.mem, conf = clamp(m.n / 6, 0, 1);
    if (play.line) this.say(play.line);
    else if (!isP && play.c.reviving > .2) this.say('revive', true);
    else if (!isP && P.down) this.say('buddy');
    else if (isP && play.tac === 'funnel') this.say('funnel');
    else if (isP && top && conf > .5 && Math.random() < .5 && ((top === 'left' && m.dodge > .4) || (top === 'right' && m.dodge < -.4) || (top === 'stop' && m.stop > .55) || (top === 'jump' && m.jump > .5) || top === 'go')) this.say(top, true);
    else if (isP && play.tac === 'combo') this.say('combo');
    else if (isP && play.tac === 'timed' && Math.random() < .4) this.say('timed');
  }
  later(dt, fn) { this.queue.push({ t: dt, fn }); }
  place(trap) {
    if (trap.type === 'collapse' && !trap.ok) { trap.remove(); return false; }
    // fairness: one trap may never catch the whole standing team at once (except in nightmare)
    const up = this.g.runners.filter(c => !c.down && !c.finished);
    if (!this.cfg.nightmare && up.length >= 2 && trap.type !== 'wall' && up.every(c => trap.inZone(c.pos, .6))) { trap.remove(); this.energy += TRAPS[trap.type].cost * .8; return false; }
    this.g.traps.push(trap); this.focus = trap.center; this.hand.press(trap.tele0);
    if (trap.type !== 'wall') for (let r = Math.floor(trap.zone.z0 / TILE); r <= Math.floor((trap.zone.z1 - .01) / TILE); r++)
      this.rowCool.set(r, Math.max(this.rowCool.get(r) || 0, trap.tEnd + (this.cfg.nightmare ? .9 : 1.8)));
    this.g.fx('warn', trap.center, .9);
    const p = this.g.player;
    if (!p.down && trap.type !== 'wall' && Math.abs(trap.center.z - p.pos.z) < 7)
      this.obs.push({ trap, x0: p.pos.x, v0: p.vel.clone(), jumped: false, vz: 0, n: 0, age: 0, react: null, t: trap.tele0 + .15 });
    return true;
  }

  update(dt) {
    const g = this.g, cfg = this.cfg, p = g.player;
    if (this.stunT > 0) this.stunT = Math.max(0, this.stunT - dt);
    const fl = this.hand.p.mat.uniforms.uFlash; fl.value = Math.max(this.stunT > 0 ? .25 + .25 * Math.sin(g.time * 20) : 0, fl.value - dt * 3);
    for (const [r, t] of this.rowCool) { if (t - dt <= 0) this.rowCool.delete(r); else this.rowCool.set(r, t - dt); }
    this.sayT -= dt; this.cool -= dt; this.burst = Math.max(0, this.burst - dt * .35);
    if (!this.final && p.pos.z > g.track.finishZ * .72 && g.state === 'run') { this.final = true; this.say('final', true); }
    this.energy = Math.min(cfg.energyMax, this.energy + cfg.regen * (this.final ? 1.35 : 1) * dt);
    for (const q of this.queue) q.t -= dt;
    const due = this.queue.filter(q => q.t <= 0); this.queue = this.queue.filter(q => q.t > 0); due.forEach(q => q.fn());
    if (g.state === 'run') {
      this.thinkT -= dt; if (this.thinkT <= 0) { this.thinkT = cfg.think * rand(.8, 1.2); this.think(); }
      // camping detector
      if (!p.down && Math.hypot(p.vel.x, p.vel.z) < .5 && p.pos.z > 6) { this.campT += dt; if (this.campT > 3) { this.campT = -4; this.say('camp'); } } else if (this.campT > 0) this.campT = 0;
      if (p.grounded && p.vel.z > 1.5) this.mem.speed = ema(this.mem.speed, p.vel.z, dt * .3);
    }
    // learning from traps aimed near the player
    const m = this.mem;
    for (const o of this.obs) {
      o.t -= dt; o.age += dt; if (p.vel.y > 3) o.jumped = true; o.vz += Math.max(0, p.vel.z); o.n++;
      if (o.react === null && p.vel.clone().sub(o.v0).length() > 1.8) o.react = o.age;
      if (o.t <= 0) {
        const dx = p.pos.x - o.x0, k = .22;
        if (Math.abs(dx) > .7) m.dodge = ema(m.dodge, Math.sign(dx), k);
        m.jump = ema(m.jump, o.jumped ? 1 : 0, k); m.stop = ema(m.stop, o.vz / Math.max(1, o.n) < 1.3 ? 1 : 0, k);
        if (o.react !== null) m.react = ema(m.react, o.react, .2);
        m.lane = ema(m.lane, p.pos.x, .1); m.n++;
        if (!o.hit && Math.random() < .2) this.say('miss');
      }
    }
    this.obs = this.obs.filter(o => o.t > 0);
    for (const q of this.pending) { q.t -= dt; if (q.t <= 0) { const s = m.tac[q.tac] ||= { n: 0, h: 0 }; s.n++; if (q.hit) s.h++; } }
    this.pending = this.pending.filter(q => q.t > 0);
    // the hand hovers ahead of the player, swoops over each new trap
    const idle = new V3(p.pos.x * .3, 7.5, p.pos.z + 13);
    let tgt = this.focus && this.hand.busy > 0 ? new V3(this.focus.x * .8, 4.6 + (this.focus.y || 0), Math.max(this.focus.z + 3.2, p.pos.z + 6)) : idle;
    if (this.stunT > 0) tgt = idle.clone().add(new V3(Math.sin(g.time * 9) * 1.5, 1 + Math.sin(g.time * 13) * .6, 0));   // reeling
    this.hand.update(dt, tgt, g.time);
  }
  onHit(c, trap) {
    for (const o of this.obs) if (o.trap === trap) o.hit = true;
    if (c === this.g.player) { this.stats.hits++; for (const q of this.pending) if (q.traps.includes(trap)) q.hit = true; this.say('hit'); }
  }
  onRevive(c, by) { if (c === this.g.player && by && Math.random() < .5) this.say('saved'); }
  dispose() { this.hand.dispose(); }
}

// ---------- the giant hand (same SDF renderer as the creatures) ----------
const LIL = [.74, .64, 1], LIL2 = [.62, .52, .95], NAIL = [1, .86, .97];
class Hand {
  constructor() {
    this.p = new Proc(); this.g = this.p.mesh; this.pos = new V3(0, 7, 10); this.vel = new V3();
    this.busy = 0; this.curl = .3; this.dip = 0;   // the game adds this.p.mesh to the scene
  }
  press(tele) { this.busy = Math.min(.9, tele); this.dipT = this.busy * .8; }   // swoop in, drop it, get out of the way
  update(dt, tgt, t) {
    this.busy -= dt;
    // springy follow
    const k = 9; this.vel.addScaledVector(tgt.clone().sub(this.pos), k * k * dt).multiplyScalar(Math.exp(-2 * k * dt));
    this.pos.addScaledVector(this.vel, dt);
    const pressing = this.busy > 0;
    this.curl = damp(this.curl, pressing ? 1.1 : .35 + .1 * Math.sin(t * 2), 6, dt);
    if (this.dipT !== undefined) { this.dipT -= dt; if (this.dipT < 0 && this.dipT > -.25) this.dip = 1.6; }
    this.dip = damp(this.dip, 0, 5, dt);
    const P = this.p, s = 1.1, base = this.pos.clone().add(new V3(0, Math.sin(t * 1.7) * .15 - this.dip, 0));
    const tilt = this.curl * .5;
    // hand frame: fingers point toward -z (toward the runners) and down as it curls
    const F = new V3(0, -Math.sin(tilt), -Math.cos(tilt)), U = new V3(0, Math.cos(tilt), -Math.sin(tilt)), R = new V3(1, 0, 0);
    const at = (f, u, r) => base.clone().addScaledVector(F, f * s).addScaledVector(U, u * s).addScaledVector(R, r * s);
    P.begin();
    P.push(at(.9, .05, 0), .42 * s, at(.15, .1, 0), .5 * s, LIL);          // palm
    P.push(at(-.2, .1, 0), .34 * s, at(-.8, .2, 0), .3 * s, LIL2);          // wrist / cuff
    for (let i = 0; i < 4; i++) {
      const r = (-.45 + i * .3), len = [.55, .65, .62, .48][i], k = 1.2 + i * .07;
      const k1 = at(1.15, .05, r * 1.05), dir1 = F.clone().multiplyScalar(Math.cos(this.curl)).addScaledVector(U, -Math.sin(this.curl));
      const k2 = k1.clone().addScaledVector(dir1, len * s);
      const c2 = this.curl * 1.5, dir2 = F.clone().multiplyScalar(Math.cos(c2)).addScaledVector(U, -Math.sin(c2));
      const tip = k2.clone().addScaledVector(dir2, len * .8 * s);
      P.push(k1, .17 * s, k2, .15 * s, LIL); P.push(k2, .15 * s, tip, .13 * s, LIL);
      P.ball(tip.clone().addScaledVector(U, .06 * s), .07 * s, NAIL, 1);
    }
    const th0 = at(.45, -.1, .5), th1 = th0.clone().addScaledVector(R, .35 * s).addScaledVector(F, .35 * s).addScaledVector(U, -.25 * s * this.curl);
    P.push(th0, .19 * s, th1, .15 * s, LIL);
    P.end(.16);
  }
  dispose() { this.p.mesh.parent?.remove(this.p.mesh); this.p.mat.dispose(); }
}
