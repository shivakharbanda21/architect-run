// Time-aware path planner over the tile grid, shared by the companions (to move) and NOVA (to predict).
// Searches (row, col, time) states in 0.25s steps: wait, step left/right/forward/back, jump a gap, ride a bounce pad.
// A cell is usable at time t only if it is floor and no trap is dangerous there during the stay.
import { COLS, TILE, xOf, colOf, rowOf, GAP, BOUNCE } from './track.js';

export const Q = .25;

// is (r, c) safe for the whole interval [ta, tb] (seconds from now)?
export function cellSafe(G, r, c, ta, tb, o = {}) {
  const tr = G.track;
  if (!tr.solid(r, c)) return false;
  const x = xOf(c), z = r * TILE + TILE / 2, m = o.margin ?? .15;
  for (const t of G.traps) {
    if (t.state === 'done') continue;
    if (t.type === 'wall') { if (!o.bonk) { const w = t.blocks(x, z); if (w && w[1] > ta && w[0] < tb) return false; } continue; }
    if (o.ignore === t) continue;
    const d = t.danger(x, z); if (!d) continue;
    if (t.type === 'cannon' && o.jumpCannon) continue;     // will hop the ball on reflex
    if (d[1] + m > ta && d[0] - m < tb) return false;
  }
  return true;
}

// plan from runner c. o: { goalRow, goalCol?, prefX, timeW, margin, bonk, jumpCannon, horizon }
export function plan(G, c, o = {}) {
  const tr = G.track, speed = c.maxSpeed || 4.6;
  const mv = Math.max(1, Math.round(TILE / speed / Q)), K = o.horizon ?? 18;
  const r0 = rowOf(c.pos.z), c0 = Math.max(0, Math.min(COLS - 1, colOf(c.pos.x)));
  const RL = r0 - 2, RN = 14, idx = (k, r, cc) => (k * RN + (r - RL)) * COLS + cc;
  const seen = new Int32Array((K + 6) * RN * COLS).fill(-2);
  const goalRow = o.goalRow ?? r0 + 6, goalCol = o.goalCol, prefX = o.prefX ?? c.pos.x, timeW = o.timeW ?? .25;
  const inWin = r => r >= RL && r < RL + RN;
  seen[idx(0, r0, c0)] = -1;
  const layers = [[[r0, c0]]];
  for (let k = 0; k < K; k++) {
    const L = layers[k] || []; if (!L.length) continue;
    for (const [r, cc] of L) {
      const from = idx(k, r, cc), ta = k * Q;
      const push = (nr, nc, dk, check = true) => {
        const nk = k + dk; if (nk > K || !inWin(nr) || nc < 0 || nc >= COLS) return;
        const id = idx(nk, nr, nc); if (seen[id] !== -2) return;
        if (check && !cellSafe(G, nr, nc, ta + dk * Q * .4, nk * Q + Q * .5, o)) return;
        seen[id] = from; (layers[nk] ||= []).push([nr, nc]);
      };
      push(r, cc, 1);                                       // wait
      push(r, cc - 1, mv); push(r, cc + 1, mv);              // sidestep
      push(r - 1, cc, mv);                                  // back off
      const kf = tr.kind[r + 1];
      if (tr.solid(r + 1, cc)) push(r + 1, cc, mv);         // forward
      else if (kf === GAP && tr.solid(r + 2, cc)) push(r + 2, cc, 3);                 // jump a 1-row gap
      if (tr.pad[r] && tr.kind[r + 1] === BOUNCE) { for (const d of [4, 5]) if (tr.solid(r + d, cc)) { push(r + d, cc, 5); break; } } // launched
    }
  }
  // pick the best reachable state: progress toward the goal, quick, and somewhere we can stay safe afterwards
  let best = null, bs = -1e9;
  for (let k = 0; k <= K; k++) for (const [r, cc] of layers[k] || []) {
    const dist = goalCol === undefined ? Math.max(0, goalRow - r) + Math.max(0, r - goalRow) * .4 : Math.abs(goalRow - r) + Math.abs(goalCol - cc) * .8;
    let s = -dist * 2 - k * Q * timeW - Math.abs(xOf(cc) - prefX) * .08;
    if (!cellSafe(G, r, cc, k * Q, K * Q + .6, o)) s -= 6;
    if (s > bs) { bs = s; best = [k, r, cc]; }
  }
  // walk back to the first move
  const path = []; let cur = best;
  while (cur) { path.unshift(cur); const p = seen[idx(cur[0], cur[1], cur[2])]; if (p < 0) break;
    const cc = p % COLS, rest = (p - cc) / COLS, r = rest % RN + RL, k = (rest - (rest % RN)) / RN; cur = [k, r, cc]; }
  return { path, score: bs, safeNow: cellSafe(G, r0, c0, 0, Q * 2, o), r0, c0 };
}
