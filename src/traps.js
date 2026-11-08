// NOVA's toolbox. Every trap telegraphs (red zone filling up) before it can hurt anyone.
import * as THREE from 'three';
import { COLS, TILE, HALF, xOf, rowOf } from './track.js';

const teleMat = () => new THREE.MeshBasicMaterial({ color: '#ff3b5c', transparent: true, opacity: .35, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const plane = new THREE.PlaneGeometry(1, 1); plane.rotateX(-Math.PI / 2);
const NOVA_COL = '#b9a4ff';

class Trap {
  constructor(g, type, zone, tele) {
    this.g = g; this.type = type; this.zone = zone; this.tele = tele; this.tele0 = tele; this.t = 0;
    this.state = 'tele'; this.group = new THREE.Group(); g.scene.add(this.group);
    this.h = g.track.rowH(Math.floor((zone.z0 + zone.z1) / 2 / TILE)); this.group.position.y = this.h;   // stairs: sit on the row's floor
    // telegraph: faint red zone + a brighter fill that sweeps across as time runs out
    const w = zone.x1 - zone.x0, d = zone.z1 - zone.z0, cx = (zone.x0 + zone.x1) / 2, cz = (zone.z0 + zone.z1) / 2;
    this.tz = new THREE.Mesh(plane, teleMat()); this.tz.scale.set(w, 1, d); this.tz.position.set(cx, .03, cz);
    this.tf = new THREE.Mesh(plane, teleMat()); this.tf.material.opacity = .6; this.tf.position.set(cx, .035, cz);
    this.tf.scale.set(w, 1, .001); this.group.add(this.tz, this.tf);
    this.line = false; this.jumpable = true; this.cost = 0;
  }
  get center() { return new THREE.Vector3((this.zone.x0 + this.zone.x1) / 2, 0, (this.zone.z0 + this.zone.z1) / 2); }
  inZone(p, pad = 0) { const z = this.zone; return p.x > z.x0 - pad && p.x < z.x1 + pad && p.z > z.z0 - pad && p.z < z.z1 + pad; }
  // for the AIs: seconds until this trap is dangerous / until it is safe again
  get tHit() { return Math.max(0, this.tele); }
  get tEnd() { return Math.max(0, this.tele) + this.live; }
  // when is the point (x, z) dangerous? [from, to] in seconds from now, or null. Shared by NOVA and the companions.
  danger(x, z) {
    if (this.state === 'done' || this.type === 'wall' || !this.inZone({ x, z })) return null;
    const t0 = Math.max(0, this.tele);
    if (this.type === 'hammer') return [t0 + .1, t0 + this.live];
    if (this.type === 'cannon') {
      if (this.state === 'tele') { const a = this.arrival(x); return [a - .28, a + .28]; }
      const ahead = (x - this.ball.position.x) * -this.side; if (ahead < -.7) return null; const e = ahead / this.speed; return [e - .28, e + .28];
    }
    return [t0 - .1, t0 + this.live];
  }
  blocks(x, z) { return this.type === 'wall' && this.state !== 'done' && this.inZone({ x, z }, .1) ? [Math.max(0, this.tele) - .1, Math.max(0, this.tele) + this.live] : null; }
  update(dt) {
    this.t += dt;
    if (this.state === 'tele') {
      this.tele -= dt;
      const k = 1 - Math.max(0, this.tele) / this.tele0, d = this.zone.z1 - this.zone.z0;
      this.tf.scale.z = Math.max(.001, d * k); this.tf.position.z = this.zone.z0 + d * k / 2;
      this.tz.material.opacity = .3 + .15 * Math.sin(this.t * (10 + 18 * k));
      if (this.tele <= 0) { this.state = 'live'; this.tz.visible = this.tf.visible = false; this.fire(); }
    }
  }
  remove() { if (this.state === 'done') return; this.state = 'done'; this.g.scene.remove(this.group); this.tz.material.dispose(); this.tf.material.dispose(); }
}

// ---------------- WALL: a block that rises out of the floor. Blocks, never hurts. Bonk breaks it. ----------------
const wallMat = new THREE.MeshStandardMaterial({ color: NOVA_COL, roughness: .35, transparent: true, opacity: .92 });
export class Wall extends Trap {
  constructor(g, c0, c1, row, tele) {
    const zc = row * TILE + TILE / 2;
    super(g, 'wall', { x0: xOf(c0) - TILE / 2, x1: xOf(c1) + TILE / 2, z0: zc - .45, z1: zc + .45 }, tele);
    this.live = 7; this.h = 0; this.jumpable = false; this.c0 = c0; this.c1 = c1; this.row = row;
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(this.zone.x1 - this.zone.x0 - .1, 1.7, .8), wallMat);
    this.mesh.castShadow = true; this.mesh.position.set((this.zone.x0 + this.zone.x1) / 2, -1, zc); this.mesh.visible = false;
    this.group.add(this.mesh);
  }
  fire() { this.mesh.visible = true; this.g.fx('slam', this.center, .8); this.g.shake(.15); }
  get solid() { return this.state === 'live' && this.h > .4; }
  update(dt) {
    super.update(dt);
    if (this.state !== 'live') return;
    this.live -= dt;
    this.h = this.live > .5 ? Math.min(1, this.h + dt * 7) : Math.max(0, this.live / .5);
    this.mesh.position.y = -0.85 + 1.7 * this.h;
    if (this.live <= 0) this.remove();
  }
  smash() { this.g.debris(this.mesh.position, NOVA_COL, 18); this.g.fx('bonk', this.center); this.g.fx('crumble', this.center); this.remove(); }
}

// ---------------- SPIKES: a patch of floor that stabs up for a moment ----------------
const spikeGeo = new THREE.ConeGeometry(.17, .75, 6); spikeGeo.translate(0, .375, 0);
const spikeMat = new THREE.MeshStandardMaterial({ color: '#e9edf6', metalness: .6, roughness: .25 });
export class Spikes extends Trap {
  constructor(g, c0, c1, r0, r1, tele) {
    super(g, 'spikes', { x0: xOf(c0) - TILE / 2, x1: xOf(c1) + TILE / 2, z0: r0 * TILE, z1: (r1 + 1) * TILE }, tele);
    this.live = 1.2;
    const nx = (c1 - c0 + 1) * 3, nz = (r1 - r0 + 1) * 3;
    this.spikes = new THREE.InstancedMesh(spikeGeo, spikeMat, nx * nz); this.spikes.castShadow = true;
    const m = new THREE.Matrix4(); let k = 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++)
      m.makeTranslation(this.zone.x0 + (i + .5) * TILE / 3, 0, this.zone.z0 + (j + .5) * TILE / 3), this.spikes.setMatrixAt(k++, m);
    this.spikes.position.y = -.8; this.group.add(this.spikes);
  }
  fire() { this.g.fx('spike', this.center); }
  update(dt) {
    super.update(dt);
    if (this.state === 'tele') { this.spikes.position.y = -.8 + .12 * Math.max(0, 1 - this.tele / .4); return; } // peek out just before
    if (this.state !== 'live') return;
    this.live -= dt;
    this.spikes.position.y = this.live > .25 ? Math.min(0, this.spikes.position.y + dt * 14) : -.8 + .8 * this.live / .25;
    if (this.live > .2) for (const c of this.g.runners)
      if (!c.down && c.pos.y - this.g.track.groundY(c.pos.x, c.pos.z) < .45 && this.inZone(c.pos, .15)) this.g.hit(c, new THREE.Vector3(0, 0, -1), this);
    if (this.live <= 0) this.remove();
  }
}

// ---------------- HAMMER: a pendulum that swings across the whole track ----------------
const hamMat = new THREE.MeshStandardMaterial({ color: '#ff6f91', roughness: .4 }), frameMat = new THREE.MeshStandardMaterial({ color: '#6f7aa0' });
export class Hammer extends Trap {
  constructor(g, row, tele, dir = 1) {
    const zc = row * TILE + TILE / 2;
    super(g, 'hammer', { x0: -HALF, x1: HALF, z0: zc - .9, z1: zc + .9 }, tele);
    this.live = 1.1; this.line = true; this.jumpable = false; this.dir = dir; this.zc = zc; this.L = 6.2; this.piv = 7;
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(.14, .14, this.piv + .2), frameMat); p.position.set(s * (HALF + 1.6), this.piv / 2, zc); this.group.add(p); }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, HALF * 2 + 3.2), frameMat); bar.rotation.z = Math.PI / 2; bar.position.set(0, this.piv, zc); this.group.add(bar);
    this.arm = new THREE.Group(); this.arm.position.set(0, this.piv, zc); this.group.add(this.arm);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, this.L), frameMat); rod.position.y = -this.L / 2; this.arm.add(rod);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(.6, .6, 1.5, 18), hamMat); head.rotation.x = Math.PI / 2; head.position.y = -this.L; head.castShadow = true; this.arm.add(head);
    this.theta = -1.3 * dir; this.arm.rotation.z = this.theta; this.swung = false;
  }
  fire() { this.g.fx('swing', this.center); }
  headPos() { return new THREE.Vector3(Math.sin(this.theta) * this.L, this.h + this.piv - Math.cos(this.theta) * this.L, this.zc); }
  update(dt) {
    super.update(dt);
    if (this.state === 'tele') { this.theta = this.dir * (-1.3 - .25 * (1 - this.tele / this.tele0)); this.arm.rotation.z = this.theta; return; }
    if (this.state !== 'live') return;
    this.live -= dt;
    const k = 1 - Math.max(0, this.live - .25) / .85;   // 0..1 over the swing
    this.theta = this.dir * (-1.55 + 3.1 * (k * k * (3 - 2 * k))); this.arm.rotation.z = this.theta;
    const h = this.headPos();
    for (const c of this.g.runners) {
      if (c.down) continue;
      const cy = c.pos.y + c.mid * .6;
      if (Math.abs(c.pos.z - this.zc) < .75 + c.rad * .5 && Math.hypot(c.pos.x - h.x, cy - h.y) < .7 + c.rad * .6)
        this.g.hit(c, new THREE.Vector3(this.dir * 1.4, 0, -.4).normalize(), this);
    }
    if (this.live <= 0) this.remove();
  }
}

// ---------------- CANNON: fires a ball that rolls low across the track. Jump it. ----------------
const ballMat = new THREE.MeshStandardMaterial({ color: '#3a3f58', roughness: .3, metalness: .4 });
export class Cannon extends Trap {
  constructor(g, row, tele, side = 1) {
    const zc = row * TILE + TILE / 2;
    super(g, 'cannon', { x0: -HALF, x1: HALF, z0: zc - .7, z1: zc + .7 }, tele);
    this.line = true; this.side = side; this.zc = zc; this.speed = 10; this.live = (HALF * 2 + 2) / this.speed;
    this.barrel = new THREE.Mesh(new THREE.CylinderGeometry(.45, .55, 1.6, 16), ballMat); this.barrel.rotation.z = Math.PI / 2;
    this.barrel.position.set(side * (HALF + 1.4), .5, zc); this.group.add(this.barrel);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(.5, 18, 12), ballMat); this.ball.castShadow = true; this.ball.visible = false;
    this.ball.position.set(side * (HALF + .6), .5, zc); this.group.add(this.ball);
  }
  // when will the ball reach x? (for the AIs)
  arrival(x) { return this.tele + Math.abs(this.side * (HALF + .6) - x) / this.speed; }
  fire() { this.ball.visible = true; this.g.fx('boom', this.barrel.position.clone()); this.g.shake(.2); this.g.puff(this.barrel.position, 6); }
  update(dt) {
    super.update(dt);
    if (this.state === 'tele') { this.barrel.position.x = this.side * (HALF + 1.4 + .15 * Math.sin(this.t * 40) * (1 - this.tele / this.tele0)); return; }
    if (this.state !== 'live') return;
    this.live -= dt; this.ball.position.x -= this.side * this.speed * dt; this.ball.rotation.z += this.side * this.speed * dt / .5;
    const b = this.ball.position;
    for (const c of this.g.runners) {
      if (c.down) continue;
      const feet = c.pos.y - this.h;
      if (feet < .6 && Math.abs(c.pos.z - b.z) < .5 + c.rad * .6 && Math.abs(c.pos.x - b.x) < .5 + c.rad * .6)
        this.g.hit(c, new THREE.Vector3(-this.side, 0, 0), this);
    }
    if (this.live <= 0) this.remove();
  }
}

// ---------------- COLLAPSE: the floor tiles shake red, then drop away for a few seconds ----------------
export class Collapse extends Trap {
  constructor(g, tiles, tele) {
    const xs = tiles.map(t => xOf(t[1])), zs = tiles.map(t => t[0] * TILE);
    super(g, 'collapse', { x0: Math.min(...xs) - TILE / 2, x1: Math.max(...xs) + TILE / 2, z0: Math.min(...zs), z1: Math.max(...zs) + TILE }, tele);
    this.tz.visible = this.tf.visible = false;     // the tiles themselves glow red and shake
    this.tiles = tiles.filter(([r, c]) => g.track.collapse(r, c, tele)); this.live = 4.5; this.ok = this.tiles.length > 0;
  }
  inZone(p, pad = 0) { const r = Math.floor(p.z / TILE), c = Math.floor((p.x + HALF) / TILE); return this.tiles.some(t => t[0] === r && t[1] === c); }
  fire() { this.g.fx('crumble', this.center); }
  update(dt) { super.update(dt); if (this.state === 'live') { this.live -= dt; if (this.live <= 0) this.remove(); } }
}

export const TRAP_CLASSES = { wall: Wall, spikes: Spikes, hammer: Hammer, cannon: Cannon, collapse: Collapse };
export { COLS };
