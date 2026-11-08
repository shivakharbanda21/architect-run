// Coins and power-ups laid along the track.
import * as THREE from 'three';
import { mulberry, canvasTex, V3 } from './engine.js';
import { COLS, TILE, xOf, colOf, rowOf, GAP, BOUNCE } from './track.js';

export const POWERS = {
  magnet: { icon: '🧲', label: 'Magnet', dur: 9, col: '#ff5f6d', w: .26 },
  shield: { icon: '🛡️', label: 'Shield', dur: 14, col: '#4fc3ff', w: .24 },
  speed:  { icon: '⚡', label: 'Speed', dur: 6, col: '#ffd23d', w: .18 },
  double: { icon: '💰', label: '2x Coins', dur: 12, col: '#ffb13d', w: .14 },
  rapid:  { icon: '🔥', label: 'Rapid Fire', dur: 7, col: '#ff7a2e', w: .1 },
  heart:  { icon: '❤️', label: '+1 Life', dur: 0, col: '#ff4f7b', w: .08 },
};
const iconTex = {};
function texFor(k) { return iconTex[k] ||= canvasTex(128, 128, (g, w) => { g.font = '92px system-ui, Apple Color Emoji'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(POWERS[k].icon, w / 2, w / 2 + 6); }); }

export class Pickups {
  constructor(G, cfg) {
    this.G = G; const tr = G.track, rnd = mulberry(cfg.seed + 99), coins = [];
    const add = (x, y, z) => coins.push({ x, y, z, y0: y, got: false, fly: false });
    // coin trails: a lane of coins over a few rows, arcs over gaps and chasms
    for (let r = 3; r < tr.R - 4; r++) {
      const kd = tr.kind[r + 1];
      if (kd === GAP) { const c = tr.openCols(r)[Math.floor(rnd() * tr.openCols(r).length)] ?? 1;
        for (let i = 0; i <= 6; i++) { const t = i / 6; add(xOf(c), tr.rowH(r) + .7 + Math.sin(t * Math.PI) * 1.2, r * TILE + 1.4 + t * 3.4); } r += 2; continue; }
      if (tr.pad[r] && kd === BOUNCE) { for (let i = 0; i <= 8; i++) { const t = i / 8; add(xOf(1 + (r & 1)), .8 + Math.sin(t * Math.PI) * 3, r * TILE + 1 + t * 8); } r += 4; continue; }
      if (rnd() < .38) {
        const open = tr.openCols(r); if (!open.length) continue;
        let c = open[Math.floor(rnd() * open.length)]; const len = 3 + Math.floor(rnd() * 3);
        for (let i = 0; i < len && tr.solid(r + i, c); i++) for (const dz of [.5, 1.5]) add(xOf(c), tr.rowH(r + i) + .7, (r + i) * TILE + dz);
        r += len;
      }
    }
    this.coins = coins;
    const geo = new THREE.CylinderGeometry(.28, .28, .07, 20); geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: '#ffd23d', metalness: .6, roughness: .25, emissive: '#b8860b', emissiveIntensity: .35 });
    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, coins.length)); this.mesh.castShadow = true; G.scene.add(this.mesh);
    // power-up boxes every ~22 units on an open column
    this.powers = [];
    const keys = Object.keys(POWERS);
    for (let z = 18; z < tr.finishZ - 8; z += 16 + rnd() * 14) {
      const r = rowOf(z), open = tr.openCols(r); if (!open.length || tr.kind[r] || tr.pad[r]) continue;
      let u = rnd(), k = keys[0]; for (const kk of keys) { if ((u -= POWERS[kk].w) <= 0) { k = kk; break; } }
      const g = new THREE.Group(), c = open[Math.floor(rnd() * open.length)];
      const box = new THREE.Mesh(new THREE.BoxGeometry(.75, .75, .75), new THREE.MeshStandardMaterial({ color: POWERS[k].col, emissive: POWERS[k].col, emissiveIntensity: .45, transparent: true, opacity: .8, roughness: .2 }));
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texFor(k), depthTest: false })); sp.scale.set(.7, .7, .7); sp.renderOrder = 5;
      g.add(box, sp); g.position.set(xOf(c), tr.rowH(r) + 1, r * TILE + 1); G.scene.add(g);
      this.powers.push({ k, g, box, got: false, y0: g.position.y });
    }
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.s = new V3(1, 1, 1);
  }
  update(dt, t) {
    const G = this.G, p = G.player, pw = G.pow, m = this.m, mid = new V3(p.pos.x, p.pos.y + p.mid * .6, p.pos.z);
    const mag = pw.magnet > 0 ? 5.5 : 0;
    this.coins.forEach((c, i) => {
      if (c.got) { m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, m); return; }
      const dx = mid.x - c.x, dy = mid.y - c.y, dz = mid.z - c.z, d = Math.hypot(dx, dy, dz);
      if (!p.down && (c.fly || d < mag)) { c.fly = true; const k = Math.min(1, dt * 14 / Math.max(d, .3)); c.x += dx * k * 1.2; c.y += dy * k * 1.2; c.z += dz * k * 1.2; }
      if (!p.down && d < .85) { c.got = true; G.onCoin(new V3(c.x, c.y, c.z)); }
      this.e.set(0, t * 3 + i * .3, 0); this.q.setFromEuler(this.e);
      m.compose(new V3(c.x, c.y + (c.fly ? 0 : Math.sin(t * 3 + i) * .08), c.z), this.q, this.s); this.mesh.setMatrixAt(i, m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const pu of this.powers) {
      if (pu.got) continue;
      pu.box.rotation.set(t * 1.1, t * 1.6, 0); pu.g.position.y = pu.y0 + Math.sin(t * 2.5) * .15;
      if (!p.down && Math.hypot(pu.g.position.x - p.pos.x, pu.g.position.z - p.pos.z) < 1 && Math.abs(pu.g.position.y - p.pos.y - .8) < 1.4) {
        pu.got = true; G.scene.remove(pu.g); G.onPower(pu.k, pu.g.position.clone());
      }
    }
  }
  dispose() { this.G.scene.remove(this.mesh); this.mesh.geometry.dispose(); for (const pu of this.powers) this.G.scene.remove(pu.g); }
}
