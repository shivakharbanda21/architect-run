// Every body plan shoots something different. Hit NOVA's hand to stun her, smash walls, disarm cannons.
import * as THREE from 'three';
import { V3, rand } from './engine.js';

export const SHOTS = {
  biped:  { name: 'Snowball', col: '#ffffff', r: .24, speed: 19, cd: 1.1, stun: 2.2, glow: 0 },
  quad:   { name: 'Fireball', col: '#ff7a2e', r: .28, speed: 16, cd: 1.5, stun: 2.8, glow: 1.6 },
  bug:    { name: 'Stinger',  col: '#ffd23d', r: .15, speed: 27, cd: .8,  stun: 1.6, glow: 1.2 },
  spider: { name: 'Web',      col: '#f4f0ff', r: .32, speed: 14, cd: 1.6, stun: 3.4, glow: .3 },
  worm:   { name: 'Goo',      col: '#7dff6a', r: .26, speed: 15, cd: 1.2, stun: 2.4, glow: 1 },
  flyer:  { name: 'Feather',  col: '#ff8ad8', r: .17, speed: 23, cd: 1.0, stun: 1.8, glow: 1 },
};
const geo = new THREE.SphereGeometry(1, 14, 10);
const mats = {};
const matFor = k => mats[k] ||= new THREE.MeshStandardMaterial({ color: SHOTS[k].col, emissive: SHOTS[k].col, emissiveIntensity: SHOTS[k].glow, roughness: .4 });

export class Shots {
  constructor(G) { this.G = G; this.list = []; }
  fire(c) {
    const G = this.G, S = SHOTS[c.spec.plan];
    if (c.shotCD > 0 || c.down || G.state !== 'run') return false;
    c.shotCD = S.cd * (c === G.player && G.pow.rapid > 0 ? .3 : 1);
    const from = new V3(c.pos.x, c.pos.y + c.mid * .9 + .3, c.pos.z + .4);
    const hand = G.nova.hand.pos, toHand = hand.clone().sub(from);
    let dir;
    if (toHand.z > 2 && toHand.z < 30) dir = toHand.add(G.nova.hand.vel.clone().multiplyScalar(toHand.length() / S.speed)).normalize();  // lead the target
    else dir = new V3(Math.sin(c.yaw) * .3, .25, 1).normalize();
    const m = new THREE.Mesh(geo, matFor(c.spec.plan)); m.scale.setScalar(S.r); m.position.copy(from); G.scene.add(m);
    this.list.push({ m, vel: dir.multiplyScalar(S.speed), S, owner: c, life: 2.4, dodged: false });
    G.fx('shoot', from, c === G.player ? 1 : .5); c.syv += 3;
    return true;
  }
  update(dt) {
    const G = this.G, nova = G.nova, hand = nova.hand;
    for (const s of this.list) {
      s.life -= dt;
      const toH = hand.pos.clone().sub(s.m.position), d = toH.length();
      if (d < 8 && !nova.stunT && !s.swatted) s.vel.addScaledVector(toH.normalize(), dt * 14).setLength(s.S.speed);   // gentle homing
      s.vel.y -= 4 * dt; s.m.position.addScaledVector(s.vel, dt);
      // NOVA reads the shot and swats it away sometimes (she gets better at it)
      if (!s.dodged && d < 5 && !(nova.stunT > 0)) { s.dodged = true; if (Math.random() < G.cfg.skill * .4) { s.swatted = true; hand.vel.x += (Math.random() < .5 ? -1 : 1) * 16; hand.vel.y += 6; nova.say('dodge'); } }
      if (d < (s.swatted ? 1.0 : 1.5)) { nova.stun(s.S.stun, s.owner); G.puff(s.m.position.clone(), 5); s.life = 0; continue; }
      for (const t of G.traps) {
        if (t.state === 'done') continue;
        if (t.type === 'wall' && t.state === 'live' && t.inZone(s.m.position, .2) && s.m.position.y < t.h + 1.8) { t.smash(); G.popAt(s.m.position, 'SMASH!', '#ffd27a'); s.life = 0; break; }
        if (t.type === 'cannon' && t.state === 'tele') { const b = t.barrel.position.clone(); b.y += t.h;
          if (b.distanceTo(s.m.position) < 1.2) { G.popAt(b, 'DISARMED!', '#5fe0a6'); G.puff(b, 6); G.fx('bonk', b); t.remove(); s.life = 0; break; } }
      }
      if (s.m.position.y < -10) s.life = 0;
    }
    this.list = this.list.filter(s => { if (s.life > 0) return true; this.G.scene.remove(s.m); return false; });
  }
  clear() { for (const s of this.list) this.G.scene.remove(s.m); this.list = []; }
}
