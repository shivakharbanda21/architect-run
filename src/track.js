// The run: a strip of 2x2 tiles, 4 columns wide, running along +z.
// Features: gaps, chasms (bounce pad / moving platform), narrow sections, pits, stairs + plateaus, ice.
import * as THREE from 'three';
import { mulberry, canvasTex } from './engine.js';

export const COLS = 4, TILE = 2, HALF = COLS * TILE / 2;
export const xOf = c => -HALF + TILE / 2 + c * TILE;
export const colOf = x => Math.floor((x + HALF) / TILE);
export const rowOf = z => Math.floor(z / TILE);
const FULL = (1 << COLS) - 1;
export const GAP = 1, BOUNCE = 2, SHUTTLE = 3;   // kind[] of empty rows

export class Track {
  constructor(cfg, scene, theme) {
    this.scene = scene; this.theme = theme; this.group = new THREE.Group(); scene.add(this.group);
    const R = cfg.rows, rnd = mulberry(cfg.seed);
    const mask = new Array(R).fill(FULL), H = new Float32Array(R), slick = new Uint8Array(R), pad = new Uint8Array(R), kind = new Uint8Array(R);
    const cps = [], plats = [];
    let r = 5, lastCp = 0;
    const room = n => r + n < R - 6;
    const narrowMask = (prev) => { const s = Math.floor(rnd() * 3), m = cfg.n >= 14 && rnd() < .4 ? 1 << (1 + Math.floor(rnd() * 2)) : 3 << s; return prev && !(m & prev) ? prev : m; };
    while (r < R - 6) {
      if (r - lastCp >= 14) { cps.push(r); lastCp = r; r += 2; continue; }
      const opts = [['flat', 1.1], ['gap', cfg.gapRate * 10], ['narrow', cfg.narrowRate * 10], ['pit', cfg.pitRate * 10], ['stairs', cfg.stairRate * 10],
        ['ice', cfg.iceRate * 10], ['bounce', cfg.bounceRate * 10], ['shuttle', cfg.shuttleRate * 10]];
      let u = rnd() * opts.reduce((a, o) => a + o[1], 0), pick = 'flat';
      for (const [k, w] of opts) { if ((u -= w) <= 0) { pick = k; break; } }
      if (pick === 'flat') r += 1 + Math.floor(rnd() * 2);
      else if (pick === 'gap') { mask[r] = 0; kind[r] = GAP; r += 3; }
      else if (pick === 'narrow') { const len = 3 + Math.floor(rnd() * 4); let prev = 0;
        for (let i = 0; i < len && room(i + 1); i++) { mask[r + i] = prev = narrowMask(prev); } r += len + 2; }
      else if (pick === 'pit') { const hole = 1 << Math.floor(rnd() * COLS); mask[r] = FULL & ~hole; r += 2; }
      else if (pick === 'stairs' && room(14)) {
        const plateau = 3 + Math.floor(rnd() * 3), st = .45;
        for (let i = 0; i < 3; i++) H[r + i] = st * (i + 1);
        for (let i = 0; i < plateau; i++) { H[r + 3 + i] = st * 3; if (cfg.n >= 8 && i > 0 && i < plateau - 1 && rnd() < .35) mask[r + 3 + i] = narrowMask(mask[r + 2 + i] === FULL ? 0 : mask[r + 2 + i]); }
        for (let i = 0; i < 3; i++) H[r + 3 + plateau + i] = st * (2 - i);
        r += 6 + plateau + 1;
      }
      else if (pick === 'ice') { const len = 3 + Math.floor(rnd() * 3), nar = cfg.n >= 12 && rnd() < .5; let prev = 0;
        for (let i = 0; i < len && room(i + 1); i++) { slick[r + i] = 1; if (nar) mask[r + i] = prev = narrowMask(prev); } r += len + 1; }
      else if (pick === 'bounce' && room(7)) { pad[r] = 1; for (let i = 1; i <= 3; i++) { mask[r + i] = 0; kind[r + i] = BOUNCE; } r += 6; }
      else if (pick === 'shuttle' && room(8)) {
        for (let i = 0; i < 4; i++) { mask[r + i] = 0; kind[r + i] = SHUTTLE; }
        const s = Math.floor(rnd() * 3);
        plats.push({ c0: s, c1: s + 1, zA: r * TILE - .05, zB: (r + 4) * TILE - TILE + .05, z: r * TILE - .05, dir: 1, wait: 1.2, dz: 0, r0: r, r1: r + 3, y: 0 });
        r += 6;
      }
      else r++;
    }
    for (const p of plats) p.z += TILE / 2, p.zA += TILE / 2, p.zB += TILE / 2;   // centre of the platform
    Object.assign(this, { R, mask, H, slick, pad, kind, plats, cps: cps.map(r => r * TILE + 1) });
    this.finishZ = (R - 3) * TILE; this.startZ = -3;
    this.drop = new Float32Array(R * COLS); this.dvel = new Float32Array(R * COLS);
    this.warn = new Float32Array(R * COLS); this.back = new Float32Array(R * COLS);
    this.build();
  }
  solid(r, c) {
    if (c < 0 || c >= COLS) return false;
    if (r < 0) return r >= -3;
    if (r >= this.R) return r < this.R + 3;
    return !!(this.mask[r] & (1 << c)) && this.drop[r * COLS + c] > -.25;
  }
  rowH(r) { return r >= 0 && r < this.R ? this.H[r] : 0; }
  platAt(x, z) { const c = colOf(x); for (const p of this.plats) if (c >= p.c0 && c <= p.c1 && Math.abs(z - p.z) < TILE / 2 + .05) return p; return null; }
  groundY(x, z) {
    const c = colOf(x), r = rowOf(z);
    if (this.solid(r, c)) return r >= 0 && r < this.R ? this.H[r] + this.drop[r * COLS + c] : 0;
    if (this.plats.length && this.platAt(x, z)) return 0;
    return -1e9;
  }
  isSlick(z) { const r = rowOf(z); return r >= 0 && r < this.R && !!this.slick[r]; }
  isPad(x, z) { const r = rowOf(z); return r >= 0 && r < this.R && !!this.pad[r] && this.solid(r, colOf(x)); }
  openCols(r) { const o = []; for (let c = 0; c < COLS; c++) if (this.solid(r, c)) o.push(c); return o; }
  isGap(r) { return r >= 0 && r < this.R && this.kind[r] === GAP; }
  isChasm(r) { return r >= 0 && r < this.R && this.mask[r] === 0; }
  narrow(r) { return r >= 0 && r < this.R && this.mask[r] !== FULL; }
  checkpointFor(z) { let best = 0; for (const c of this.cps) if (z >= c) best = c; return best; }

  collapse(r, c, tele) {
    if (r < 3 || r >= this.R - 3 || !(this.mask[r] & (1 << c)) || this.pad[r]) return false;
    const i = r * COLS + c; if (this.warn[i] > 0 || this.drop[i] < -.01) return false;
    this.warn[i] = tele; return true;
  }
  build() {
    const th = this.theme;
    const top = canvasTex(64, 64, (g, w) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, w);
      g.strokeStyle = th.line; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, w - 3);
      g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(4, 4, w - 8, 3); });
    const geo = new THREE.BoxGeometry(TILE * .98, 3, TILE * .98); geo.translate(0, -1.5, 0);
    const mat = new THREE.MeshStandardMaterial({ map: top, roughness: .7 });
    const list = [];
    for (let r = -3; r < this.R + 3; r++) for (let c = 0; c < COLS; c++)
      if (r < 0 || r >= this.R || this.mask[r] & (1 << c)) list.push([r, c]);
    this.tiles = new THREE.InstancedMesh(geo, mat, list.length); this.tiles.receiveShadow = true; this.tiles.castShadow = true;
    this.index = new Int32Array((this.R + 6) * COLS).fill(-1);
    const m = new THREE.Matrix4(), col = new THREE.Color(), cpRows = new Set(this.cps.map(z => rowOf(z)));
    list.forEach(([r, c], k) => {
      if (r >= 0 && r < this.R) this.index[r * COLS + c] = k;
      m.makeTranslation(xOf(c), this.rowH(r), r * TILE + TILE / 2); this.tiles.setMatrixAt(k, m);
      const odd = (r + c) & 1, inR = r >= 0 && r < this.R;
      if (cpRows.has(r)) col.set(th.cp[odd]);
      else if (!inR || r >= this.R - 3) col.set(th.end[odd]);
      else if (this.pad[r]) col.set(th.pad);
      else if (this.slick[r]) col.set(th.slick).offsetHSL(0, 0, odd ? .06 : 0);
      else col.set(odd ? th.tileA : th.tileB);
      this.tiles.setColorAt(k, col);
    });
    this.baseCol = this.tiles.instanceColor.array.slice();
    this.group.add(this.tiles);
    // slick rows get a glossy overlay, pads a bouncy ring
    const gloss = new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: .22, roughness: .05, metalness: .3, depthWrite: false });
    const padRing = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: th.pad, emissiveIntensity: .8 });
    const ringG = new THREE.TorusGeometry(.6, .12, 8, 24); ringG.rotateX(Math.PI / 2);
    const chev = new THREE.ConeGeometry(.35, .5, 3); chev.rotateX(Math.PI / 2);
    this.padMeshes = [];
    for (let r = 0; r < this.R; r++) for (let c = 0; c < COLS; c++) {
      if (!(this.mask[r] & (1 << c))) continue;
      if (this.slick[r]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(TILE * .96, TILE * .96), gloss); p.rotation.x = -Math.PI / 2; p.position.set(xOf(c), this.H[r] + .015, r * TILE + 1); this.group.add(p); }
      if (this.pad[r]) { const g = new THREE.Group(); g.position.set(xOf(c), this.H[r] + .06, r * TILE + 1);
        g.add(new THREE.Mesh(ringG, padRing)); const a = new THREE.Mesh(chev, padRing); a.position.set(0, .05, .1); g.add(a); this.group.add(g); this.padMeshes.push(g); }
    }
    // glowing trim along both edges (only where there is floor)
    const trimMat = new THREE.MeshStandardMaterial({ color: th.trim, emissive: th.trim, emissiveIntensity: th.id === 'neon' || th.id === 'ember' ? 1.4 : .25 });
    const trimGeo = new THREE.BoxGeometry(.12, .12, TILE);
    for (let r = -3; r < this.R + 3; r++) {
      const inR = r >= 0 && r < this.R, msk = inR ? this.mask[r] : FULL;
      if (msk & 1) { const t = new THREE.Mesh(trimGeo, trimMat); t.position.set(-HALF - .02, this.rowH(r) + .02, r * TILE + 1); this.group.add(t); }
      if (msk & (1 << (COLS - 1))) { const t = new THREE.Mesh(trimGeo, trimMat); t.position.set(HALF + .02, this.rowH(r) + .02, r * TILE + 1); this.group.add(t); }
    }
    // moving platforms
    const platMat = new THREE.MeshStandardMaterial({ color: th.plat, roughness: .45 });
    for (const p of this.plats) {
      const w = (p.c1 - p.c0 + 1) * TILE - .1, mesh = new THREE.Mesh(new THREE.BoxGeometry(w, .5, TILE - .1), platMat);
      mesh.castShadow = mesh.receiveShadow = true; mesh.position.set((xOf(p.c0) + xOf(p.c1)) / 2, -.25, p.z);
      const e = new THREE.Mesh(new THREE.BoxGeometry(w + .05, .1, TILE - .05), trimMat); e.position.y = .2; mesh.add(e);
      p.mesh = mesh; this.group.add(mesh);
    }
    // finish arch + checkpoint flags
    const archMat = new THREE.MeshStandardMaterial({ color: th.end[1], roughness: .35, emissive: th.end[1], emissiveIntensity: .25 });
    const arch = new THREE.Mesh(new THREE.TorusGeometry(HALF + .4, .35, 12, 40, Math.PI), archMat);
    arch.position.set(0, 0, this.finishZ); arch.castShadow = true; this.group.add(arch);
    const ban = new THREE.Mesh(new THREE.BoxGeometry(5, .9, .2), new THREE.MeshStandardMaterial({ color: '#fff', map: canvasTex(256, 48, (g) => {
      g.fillStyle = '#2a2f45'; g.fillRect(0, 0, 256, 48); g.fillStyle = '#ffd27a'; g.font = '900 30px system-ui'; g.textAlign = 'center'; g.fillText('EXIT', 128, 35); }) }));
    ban.position.set(0, HALF + .2, this.finishZ); ban.rotation.y = Math.PI; this.group.add(ban);
    const poleMat = new THREE.MeshStandardMaterial({ color: '#7d8bb0' }), flagMat = new THREE.MeshStandardMaterial({ color: th.cp[1], emissive: th.cp[1], emissiveIntensity: .3, side: THREE.DoubleSide });
    for (const z of this.cps) for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, 2.6), poleMat); p.position.set(s * (HALF + .3), 1.3, z); this.group.add(p);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(.9, .55), flagMat); f.position.set(s * (HALF + .3) - s * .45, 2.3, z); this.group.add(f);
    }
  }
  update(dt, onFall) {
    // platforms shuttle back and forth with a pause at each end
    for (const p of this.plats) {
      const z0 = p.z;
      if (p.wait > 0) p.wait -= dt;
      else { const tgt = p.dir > 0 ? p.zB : p.zA; p.z += Math.sign(tgt - p.z) * Math.min(Math.abs(tgt - p.z), 3.2 * dt); if (Math.abs(tgt - p.z) < 1e-3) { p.dir *= -1; p.wait = 1.3; } }
      p.dz = p.z - z0; p.mesh.position.z = p.z;
    }
    for (const g of this.padMeshes) g.children[0].scale.setScalar(1 + .08 * Math.sin(performance.now() * .008));
    const m = new THREE.Matrix4(), ic = this.tiles.instanceColor.array, base = this.baseCol;
    let dirtyM = false, dirtyC = false;
    for (let r = 0; r < this.R; r++) for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c, k = this.index[i]; if (k < 0) continue;
      let jitter = 0;
      if (this.warn[i] > 0) {
        this.warn[i] -= dt; jitter = (Math.random() - .5) * .12; dirtyC = true;
        const f = .5 + .5 * Math.sin(performance.now() * .03);
        ic[k * 3] = 1; ic[k * 3 + 1] = base[k * 3 + 1] * (.35 + .3 * f); ic[k * 3 + 2] = base[k * 3 + 2] * (.35 + .3 * f);
        if (this.warn[i] <= 0) { this.dvel[i] = -2; this.drop[i] = -.3; this.back[i] = 4.5; onFall?.(r, c); }
      } else if (this.drop[i] < 0) {
        if (this.back[i] > 0) { this.back[i] -= dt; this.dvel[i] -= 25 * dt; this.drop[i] = Math.max(-30, this.drop[i] + this.dvel[i] * dt); }
        else { this.drop[i] = Math.min(0, this.drop[i] + 18 * dt); if (this.drop[i] > -.02) this.drop[i] = 0; }
        ic[k * 3] = base[k * 3]; ic[k * 3 + 1] = base[k * 3 + 1]; ic[k * 3 + 2] = base[k * 3 + 2]; dirtyC = true;
      } else if (!jitter) continue;
      m.makeTranslation(xOf(c) + jitter, this.H[r] + this.drop[i], r * TILE + TILE / 2); this.tiles.setMatrixAt(k, m); dirtyM = true;
    }
    if (dirtyM) this.tiles.instanceMatrix.needsUpdate = true;
    if (dirtyC) this.tiles.instanceColor.needsUpdate = true;
  }
  dispose() { this.scene.remove(this.group); this.group.traverse(o => { o.geometry?.dispose(); }); }
}
