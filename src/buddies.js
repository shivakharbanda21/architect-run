// Companion brains. Each buddy has a personality, its own goal, and plans through time around NOVA's traps.
//  Dasher   — races ahead (baits NOVA), bonks walls, takes tight timings, waits at the leash and yells at you.
//  Guardian — sticks close, scouts the next safe spot, calls out which way to dodge, always comes back to revive.
import { V3, clamp } from './engine.js';
import { TILE, HALF, COLS, xOf, colOf, rowOf, SHUTTLE } from './track.js';
import { plan, cellSafe } from './planner.js';

export const PERSONAS = {
  dash:  { role: 'Dasher',   lead: 9,   leash: 15, reviveRange: 8,  think: .15, timeW: .7,  margin: .05, bonk: true,  jumpCannon: true,  react: .12 },
  guard: { role: 'Guardian', lead: 2.2, leash: 5,  reviveRange: 20, think: .2,  timeW: .15, margin: .3,  bonk: false, jumpCannon: false, react: .2 },
  auto:  { role: 'Autopilot', lead: 0,  leash: 1e9, reviveRange: 6, think: .15, timeW: .45, margin: .15, bonk: true,  jumpCannon: true,  react: .15 },
};
const LINES = {
  dash: { start: ['Race you!', 'Last one out is NOVA food!'], wait: ['Come ON!', 'Hurry up!', 'Waiting…', 'Over here!'], bonk: ['BONK!', 'Out of my way!'],
    revive: ['Up you get!', 'Gotcha!'], hit: ['Ow!', 'Cheap shot!'], bounce: ['Wheee!'], thanks: ['Thanks!', 'Owe you one!'] },
  guard: { start: ["I've got your back.", 'Stay close.'], revive: ['I got you!', 'Hold on!'], hit: ['Ugh!', 'Help me up!'], thanks: ['My hero!', 'Thank you!'],
    clear: ['Clear ahead!', 'This way!'], bounce: ['Hold on!'] },
};
const pick = a => a[Math.floor(Math.random() * a.length)];

export function makeBrain(persona) { return { persona, P: PERSONAS[persona], plan: null, replan: 0, nT: -1, sayT: 2, laneX: 0, warned: new WeakSet(), waitT: 0, runup: false }; }
export function chat(G, c, key, force) {
  const b = c.brain; if (!b) return; const L = LINES[b.persona]?.[key]; if (!L) return;
  if (!force && b.sayT > 0) return; b.sayT = 3.5; G.bubble(c, pick(L));
}

// ---------- main think: returns a wish vector ----------
export function companionThink(G, c, dt, doBonk) {
  const tr = G.track, p = G.player, b = c.brain, P = b.P, wish = new V3();
  b.sayT -= dt; b.replan -= dt;
  if (c.down || c.finished) return wish;
  const finRow = rowOf(tr.finishZ) + 2;

  // 1) goal: revive someone, or keep our own pace relative to the player
  const downed = G.runners.filter(o => o !== c && o.down && o.pos.y > -1).sort((a, b2) => a.pos.distanceTo(c.pos) - b2.pos.distanceTo(c.pos))[0];
  let goalRow, goalCol, reviving = null;
  if (downed && downed.pos.distanceTo(c.pos) < P.reviveRange) {
    reviving = downed; goalRow = rowOf(downed.pos.z); goalCol = colOf(downed.pos.x);
    if (b.reviveFor !== downed) { b.reviveFor = downed; chat(G, c, 'revive', true); }
  } else {
    b.reviveFor = null;
    if (c === p || p.finished) goalRow = finRow;
    else {
      const want = p.pos.z + P.lead, cap = p.pos.z + P.leash;
      goalRow = rowOf(Math.min(Math.max(want, c.pos.z - 2), cap, tr.finishZ + 3));
      if (c.pos.z > cap - 1 && P.lead > 5) { b.waitT += dt; if (b.waitT > 2.5) { chat(G, c, 'wait'); if (Math.random() < .3) c.wave(); b.waitT = 0; } } else b.waitT = 0;
    }
  }
  // 2) moving platforms
  const sh = shuttle(G, c, goalRow); if (sh) return sh;

  // 3) plan through time
  if (b.replan <= 0 || G.traps.length !== b.nT) {
    b.replan = P.think; b.nT = G.traps.length;
    b.plan = plan(G, c, { goalRow, goalCol, prefX: b.laneX, timeW: P.timeW, margin: P.margin, bonk: P.bonk && c.bonkCD <= 0, jumpCannon: P.jumpCannon });
  }
  const path = b.plan?.path || [];
  let ax = xOf(clamp(colOf(c.pos.x), 0, COLS - 1)), az = rowOf(c.pos.z) * TILE + TILE / 2;
  if (path.length > 1) {
    const s0 = path[0], s1 = path.find(s => s[1] !== s0[1] || s[2] !== s0[2]);
    if (s1 && s1[0] - s0[0] <= 3) {                       // a move starts soon: go
      ax = xOf(s1[2]); az = s1[1] * TILE + TILE / 2;
      const i = path.indexOf(s1), s2 = path[i + 1];
      // keep running through only once lined up with the column (no corner cutting over holes)
      if (s2 && s2[2] === s1[2] && s2[1] > s1[1] && s2[0] - s1[0] <= 3 && Math.abs(c.pos.x - ax) < .35) az = s2[1] * TILE + TILE / 2;
      if (s1[2] !== s0[2] && Math.abs(c.pos.x - ax) > .35) az = Math.min(az, s0[1] * TILE + TILE * .8);   // finish the sidestep before going forward
    }
  }
  if (reviving && Math.hypot(reviving.pos.x - c.pos.x, reviving.pos.z - c.pos.z) < 1.4) { ax = c.pos.x; az = c.pos.z; }
  wish.set(clamp((ax - c.pos.x) * 1.6, -1, 1), 0, clamp((az - c.pos.z) * 1.1, -1, 1));
  if (wish.length() > 1) wish.normalize();
  if (tr.isSlick(c.pos.z) || tr.isSlick(c.pos.z + 2)) wish.multiplyScalar(.6);   // careful on ice

  reflexes(G, c, wish, doBonk);
  guardianCalls(G, c);
  return wish;
}

// cannonball hops, gap jumps with a run-up, edge safety, bonking walls in our way
function reflexes(G, c, wish, doBonk) {
  const tr = G.track, P = c.brain.P;
  for (const t of G.traps) if (t.type === 'cannon' && t.state !== 'done' && t.t > P.react) {
    const d = t.danger(c.pos.x, c.pos.z); if (d && d[0] > -.05 && d[0] < .1 && c.grounded) c.jumpReq = true;
  }
  const gy = (x, z) => tr.groundY(x, z) > -50;
  if (c.grounded) {
    const sx = Math.sign(wish.x); if (sx && !gy(c.pos.x + sx * .7, c.pos.z) && !gy(c.pos.x + sx * .7, c.pos.z + .6)) wish.x = 0;
    const vz = c.vel.z;
    let edge = Infinity; for (let d = .2; d <= 3; d += .2) if (!gy(c.pos.x, c.pos.z + d)) { edge = d; break; }
    let back = Infinity; for (let d = .2; d <= 1; d += .2) if (!gy(c.pos.x, c.pos.z - d)) { back = d; break; }
    const stopD = .35 + Math.max(0, vz) ** 2 / (c.slip ? 3 : 20);
    if (edge < 3) {
      const gapRow = tr.isGap(rowOf(c.pos.z + edge + .05));
      if (gapRow && wish.z > .3) {
        const b = c.brain;
        if (b.runup) { wish.z = -1; if (edge > 1.6) b.runup = false; }
        else if (edge < .5) { if (vz > 3.2 && Math.abs(c.vel.x) < 1.5) c.jumpReq = true; else b.runup = true; }
        else if (edge < stopD && vz < 3) b.runup = true;
        if (!b.runup) wish.x *= .3;
      } else if (!gapRow && edge < stopD) wish.z = Math.min(wish.z, 0);
    } else c.brain.runup = false;
    if (back < 1 && wish.z < 0 && !c.brain.runup) wish.z = 0;
    if (back < .5) c.brain.runup = false;
  }
  if (P.bonk && c.bonkCD <= 0) for (const t of G.traps) if (t.type === 'wall' && t.solid && t.inZone({ x: c.pos.x, z: c.pos.z + 1.3 }) && wish.z > .3) { doBonk(c, new V3(0, 0, 1)); chat(G, c, 'bonk', true); break; }
}

// ride the shuttle platforms: wait at the edge, hop on when it docks, hop off at the far side
function shuttle(G, c, goalRow) {
  const tr = G.track; if (!tr.plats.length) return null;
  const r = rowOf(c.pos.z);
  const p = tr.plats.find(q => r >= q.r0 - 2 && r <= q.r1 && goalRow > q.r1); if (!p) return null;
  const cx = (xOf(p.c0) + xOf(p.c1)) / 2, w = new V3(), on = tr.platAt(c.pos.x, c.pos.z) === p && r >= p.r0;
  const docked = (z) => Math.abs(p.z - z) < .05 && p.wait > .25;
  const aim = (x, z, k = 1) => { w.set(clamp((x - c.pos.x) * 1.6, -1, 1), 0, clamp((z - c.pos.z) * 1.2, -1, 1) * k); if (w.length() > 1) w.normalize(); return w; };
  if (on) return docked(p.zB) ? aim(cx, p.zB + 3) : aim(cx, p.z, .8);
  if (r < p.r0) return docked(p.zA) ? aim(cx, p.zA) : aim(cx, p.r0 * TILE - 1.1);
  return null;
}

// the Guardian reads the player's situation and shouts the escape
function guardianCalls(G, c) {
  const b = c.brain; if (b.persona !== 'guard') return;
  const p = G.player; if (p.down || p.finished || Math.abs(p.pos.z - c.pos.z) > 14) return;
  for (const t of G.traps) {
    if (t.state !== 'tele' || t.t < .15 || b.warned.has(t) || t.type === 'wall') continue;
    const d = t.danger(p.pos.x, p.pos.z) || t.danger(p.pos.x, p.pos.z + Math.max(0, p.vel.z) * .6);
    if (!d || d[0] > 1.4) continue;
    b.warned.add(t);
    if (t.type === 'cannon') { G.bubble(c, 'JUMP the ball!'); return; }
    const pl = plan(G, p, { goalRow: rowOf(p.pos.z) + 2, prefX: p.pos.x, timeW: .2, margin: .2, horizon: 12 });
    const s0 = pl.path[0], s1 = pl.path.find(s => s[1] !== s0[1] || s[2] !== s0[2]);
    let msg = 'Wait!';
    if (s1 && s1[0] <= 3) { if (s1[2] > s0[2]) msg = 'Go LEFT!'; else if (s1[2] < s0[2]) msg = 'Go RIGHT!'; else if (s1[1] > s0[1]) msg = 'Keep going!'; else msg = 'Back up!'; }
    G.bubble(c, msg, true); b.sayT = 2; return;
  }
}
