// Four worlds, five levels each. Every world has its own palette, sky, "below", and scenery.
import * as THREE from 'three';
import { mulberry } from './engine.js';

export const THEMES = [
  { id: 'sky', name: 'Cloud Peaks', skyTop: '#4f9dff', skyBot: '#dff0ff', sunGlow: '#fff4d6', fog: '#d4e8ff', fogNear: 30, fogFar: 85,
    hemiSky: '#ffffff', hemiGround: '#a8c0de', hemiI: 1.8, sun: '#fff3e0', sunI: 2.3,
    tileA: '#f6fbff', tileB: '#d6e6f5', side: '#8fb2d9', trim: '#ffffff', slick: '#a9e4ff', pad: '#ff6fb5', plat: '#ffd27a',
    cp: ['#c4f5dc', '#a2eac6'], end: ['#ffe5ad', '#ffd27a'], line: 'rgba(110,140,175,.35)', below: 'clouds', belowCol: '#ffffff', deco: 'peaks', stars: 0 },
  { id: 'candy', name: 'Candy Canyon', skyTop: '#ff8fc8', skyBot: '#ffe9c7', sunGlow: '#fffbe0', fog: '#ffd6e4', fogNear: 30, fogFar: 85,
    hemiSky: '#fff3f8', hemiGround: '#e7a3c4', hemiI: 1.8, sun: '#fff0e6', sunI: 2.2,
    tileA: '#fff3f8', tileB: '#ffc8df', side: '#e45d9f', trim: '#7fe3c6', slick: '#ffb15c', pad: '#5fd6ff', plat: '#b78bff',
    cp: ['#c9f7e6', '#93ecd0'], end: ['#fff1a8', '#ffe066'], line: 'rgba(200,90,140,.3)', below: 'syrup', belowCol: '#ff8cc0', deco: 'candy', stars: 0 },
  { id: 'ember', name: 'Ember Forge', skyTop: '#1f0f33', skyBot: '#ff6a3d', sunGlow: '#ffb070', fog: '#6b2a45', fogNear: 24, fogFar: 70,
    hemiSky: '#ffd2b0', hemiGround: '#3a1d2e', hemiI: 1.25, sun: '#ffb27a', sunI: 2.4,
    tileA: '#6a6177', tileB: '#544c62', side: '#2a2232', trim: '#ff8a3d', slick: '#4fa3d9', pad: '#ffd23d', plat: '#ff8a3d',
    cp: ['#4d8c6c', '#3f7a5c'], end: ['#ffb84d', '#ff9a2e'], line: 'rgba(255,140,60,.35)', below: 'lava', belowCol: '#ff5a1f', deco: 'ember', stars: .3 },
  { id: 'neon', name: 'Neon Void', skyTop: '#03031a', skyBot: '#30186b', sunGlow: '#b18cff', fog: '#1c1245', fogNear: 26, fogFar: 80,
    hemiSky: '#b9c4ff', hemiGround: '#251a4a', hemiI: 1.35, sun: '#d8ccff', sunI: 2.0,
    tileA: '#2f3566', tileB: '#242951', side: '#111430', trim: '#3df5ff', slick: '#ff4fd8', pad: '#9dff5c', plat: '#3df5ff',
    cp: ['#1f6b62', '#195a53'], end: ['#7d4dff', '#6236e6'], line: 'rgba(61,245,255,.45)', below: 'grid', belowCol: '#3df5ff', deco: 'neon', stars: 1 },
];
export const themeFor = n => THEMES[Math.min(THEMES.length - 1, Math.floor((n - 1) / 5))];

// ---------- sky dome: vertical gradient + sun glow + optional stars ----------
export function makeSky(th) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(th.skyTop) }, bot: { value: new THREE.Color(th.skyBot) }, glow: { value: new THREE.Color(th.sunGlow) },
      sunDir: { value: new THREE.Vector3(-.3, .25, 1).normalize() }, stars: { value: th.stars } },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `uniform vec3 top, bot, glow, sunDir; uniform float stars; varying vec3 vD;
      float h(vec3 p){ p = fract(p*443.897); p += dot(p, p.yzx+19.19); return fract((p.x+p.y)*p.z); }
      void main(){ float y = clamp(vD.y*1.4+.25, 0., 1.); vec3 c = mix(bot, top, pow(y, .8));
        float s = max(0., dot(normalize(vD), sunDir)); c += glow * (pow(s, 24.)*.8 + pow(s, 4.)*.18);
        if (stars > 0.) { vec3 q = floor(vD*180.); float st = step(.996, h(q)) * smoothstep(.0, .4, vD.y+.1); c += vec3(st) * stars; }
        gl_FragColor = vec4(c, 1.); }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), mat); m.renderOrder = -10; m.frustumCulled = false; return m;
}

// ---------- the world below the track ----------
export function makeBelow(th, len) {
  const g = new THREE.Group(), rnd = mulberry(77);
  if (th.below === 'clouds') {
    const cloud = new THREE.MeshStandardMaterial({ color: th.belowCol, roughness: 1 }), sph = new THREE.SphereGeometry(1, 16, 12);
    for (let z = -30; z < len + 40; z += 3.5) for (let k = 0; k < 3; k++) {
      const m = new THREE.Mesh(sph, cloud), s = 2 + rnd() * 3.5;
      m.position.set((rnd() - .5) * 46, -9 - rnd() * 4, z + rnd() * 3); m.scale.set(s * 1.4, s * .6, s); g.add(m);
    }
    return { group: g, update() {} };
  }
  // animated liquid / grid plane
  const kind = th.below === 'lava' ? 0 : th.below === 'syrup' ? 1 : 2;
  const mat = new THREE.ShaderMaterial({
    fog: true, transparent: kind === 2,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { t: { value: 0 }, col: { value: new THREE.Color(th.belowCol) }, kind: { value: kind } }]),
    vertexShader: `#include <fog_pars_vertex>
      varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz;
      vec4 mvPosition = viewMatrix*w; gl_Position = projectionMatrix*mvPosition; #include <fog_vertex> }`,
    fragmentShader: `#include <fog_pars_fragment>
      uniform float t; uniform vec3 col; uniform int kind; varying vec2 vUv; varying vec3 vW;
      float n(vec2 p){ return sin(p.x)*sin(p.y); }
      void main(){ vec2 p = vW.xz*.18; vec3 c; float a = 1.;
        if (kind == 0) { float f = n(p*1.3 + vec2(t*.3, t*.2)) + .5*n(p*2.7 - vec2(t*.4, -t*.1)) + .25*n(p*5.1 + t*.6);
          float k = smoothstep(-.4, 1.2, f); c = mix(vec3(.35,.04,.02), col, k) + vec3(1.,.8,.3)*pow(k, 6.)*1.5; }
        else if (kind == 1) { float f = n(p*1.1 + vec2(t*.2, 0.)) + .5*n(p*2.3 + vec2(0., t*.3));
          c = mix(col*.75, col*1.15 + .1, smoothstep(-.6, 1., f)); c += vec3(1.)*pow(max(0., f), 8.)*.5; }
        else { vec2 g = abs(fract(vW.xz*.25 + vec2(0., t*.15)) - .5); float l = 1. - smoothstep(.0, .04, min(g.x, g.y));
          c = col * l * 1.4 + vec3(.05,.02,.12); a = .25 + l*.75; }
        gl_FragColor = vec4(c, a);
        #include <fog_fragment>
      }`,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(220, len + 160, 1, 1), mat);
  plane.rotation.x = -Math.PI / 2; plane.position.set(0, kind === 2 ? -10 : -8, len / 2); g.add(plane);
  // embers / sparkles rising
  let pts = null;
  if (kind !== 1) {
    const N = 400, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (rnd() - .5) * 60; pos[i * 3 + 1] = -8 + rnd() * 16; pos[i * 3 + 2] = -20 + rnd() * (len + 60); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: kind === 0 ? '#ffb04d' : '#9ff8ff', size: kind === 0 ? .22 : .16, transparent: true, opacity: .85, depthWrite: false }));
    g.add(pts);
  }
  return { group: g, update(dt, time) { mat.uniforms.t.value = time;
    if (pts) { const a = pts.geometry.attributes.position.array; for (let i = 1; i < a.length; i += 3) { a[i] += dt * (kind === 0 ? 1.6 : .7); if (a[i] > 9) a[i] = -8; } pts.geometry.attributes.position.needsUpdate = true; } } };
}

// ---------- scenery along both sides of the track ----------
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .6, ...extra });
const glow = color => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: .4 });
export function makeDeco(th, len) {
  const g = new THREE.Group(), rnd = mulberry(1234 + th.id.length), spin = [];
  const side = () => (rnd() < .5 ? -1 : 1), place = (m, z, minX = 8, maxX = 26, y0 = -3, y1 = 4) => {
    m.position.set(side() * (minX + rnd() * (maxX - minX)), y0 + rnd() * (y1 - y0), z); m.rotation.y = rnd() * 6.28; g.add(m); return m; };
  if (th.deco === 'peaks') {
    const rock = std('#b8c8dc'), grass = std('#9fe0b0'), snow = std('#ffffff'), pine = std('#5fbf8f'), crystal = std('#9fdcff', { metalness: .2, roughness: .15, transparent: true, opacity: .85 });
    const cone = new THREE.ConeGeometry(1, 1, 7), cyl = new THREE.CylinderGeometry(1, 1, 1, 9), oct = new THREE.OctahedronGeometry(1, 0);
    for (let z = -20; z < len + 40; z += 7 + rnd() * 6) {
      const isl = new THREE.Group(), r = 2 + rnd() * 3;
      const under = new THREE.Mesh(cone, rock); under.scale.set(r, r * 1.8, r); under.rotation.x = Math.PI; under.position.y = -r * .9; isl.add(under);
      const top = new THREE.Mesh(cyl, rnd() < .5 ? grass : snow); top.scale.set(r, .4, r); isl.add(top);
      for (let k = 0; k < 1 + rnd() * 3; k++) { const t = new THREE.Mesh(cone, pine), h = 1 + rnd() * 1.6; t.scale.set(h * .45, h, h * .45);
        t.position.set((rnd() - .5) * r, .2 + h / 2, (rnd() - .5) * r); isl.add(t); }
      place(isl, z, 9, 30, -4, 5); spin.push({ m: isl, bob: rnd() * 6, y: isl.position.y });
      if (rnd() < .5) { const c = new THREE.Mesh(oct, crystal); c.scale.set(.6, 1.4, .6); place(c, z + 3, 6.5, 9, -1, 2.5); spin.push({ m: c, r: .6 }); }
    }
  } else if (th.deco === 'candy') {
    const stick = std('#ffffff'), cols = ['#ff5fa2', '#5fd6ff', '#ffd23d', '#9dff8a', '#b78bff'].map(c => std(c, { roughness: .3 }));
    const cyl = new THREE.CylinderGeometry(.12, .12, 1, 8), disc = new THREE.CylinderGeometry(1, 1, .3, 24), torus = new THREE.TorusGeometry(1, .18, 8, 24), drop = new THREE.SphereGeometry(1, 16, 10, 0, 6.28, 0, Math.PI / 2);
    for (let z = -20; z < len + 40; z += 4 + rnd() * 5) {
      const k = rnd();
      if (k < .45) { const l = new THREE.Group(), h = 2 + rnd() * 4, s = .8 + rnd() * 1.2;
        const st = new THREE.Mesh(cyl, stick); st.scale.y = h; st.position.y = h / 2; l.add(st);
        const d = new THREE.Mesh(disc, cols[Math.floor(rnd() * 5)]); d.scale.set(s, 1, s); d.rotation.x = Math.PI / 2; d.position.y = h + s; l.add(d);
        const ring = new THREE.Mesh(torus, stick); ring.scale.setScalar(s * .6); ring.position.y = h + s; ring.position.z = .17; l.add(ring);
        place(l, z, 6.5, 22, -6, -1); spin.push({ m: l, r: .3 });
      } else if (k < .8) { const d = new THREE.Mesh(drop, cols[Math.floor(rnd() * 5)]), s = 1 + rnd() * 2.5; d.scale.set(s, s * 1.2, s); place(d, z, 7, 24, -6, -2); }
      else { const c = new THREE.Mesh(torus, cols[Math.floor(rnd() * 5)]); c.scale.setScalar(1.5 + rnd() * 2); c.rotation.x = rnd() * 3; place(c, z, 10, 26, -1, 6); spin.push({ m: c, r: .5 }); }
    }
  } else if (th.deco === 'ember') {
    const bas = std('#3a3040', { roughness: .9 }), hot = glow('#ff6a1f'), hex = new THREE.CylinderGeometry(1, 1.1, 1, 6), rockG = new THREE.DodecahedronGeometry(1, 0);
    for (let z = -20; z < len + 40; z += 3.5 + rnd() * 4) {
      if (rnd() < .65) { const p = new THREE.Group(), h = 4 + rnd() * 10, r = .7 + rnd() * 1.4;
        const m = new THREE.Mesh(hex, bas); m.scale.set(r, h, r); m.position.y = -h / 2 + 1; p.add(m);
        const cap = new THREE.Mesh(hex, hot); cap.scale.set(r * .8, .12, r * .8); cap.position.y = 1.02; p.add(cap);
        place(p, z, 6.5, 24, -6, 1);
      } else { const r = new THREE.Mesh(rockG, rnd() < .3 ? hot : bas); r.scale.setScalar(.6 + rnd() * 1.4); place(r, z, 7, 26, 1, 8); spin.push({ m: r, r: .4, bob: rnd() * 6, y: r.position.y }); }
    }
  } else {
    const cols = ['#3df5ff', '#ff4fd8', '#9dff5c', '#7d4dff'].map(glow), dark = std('#151838', { roughness: .3, metalness: .5 });
    const torus = new THREE.TorusGeometry(1, .07, 6, 40), pyr = new THREE.ConeGeometry(1, 1.4, 4), box = new THREE.BoxGeometry(1, 1, 1);
    for (let z = -20; z < len + 40; z += 4 + rnd() * 5) {
      const k = rnd();
      if (k < .4) { const r = new THREE.Mesh(torus, cols[Math.floor(rnd() * 4)]); r.scale.setScalar(2 + rnd() * 3); place(r, z, 9, 28, -2, 8); spin.push({ m: r, r: .25 + rnd() * .4 }); }
      else if (k < .75) { const p = new THREE.Mesh(pyr, dark), s = 1 + rnd() * 2.5; p.scale.setScalar(s); place(p, z, 7, 26, -4, 6);
        const e = new THREE.Mesh(new THREE.EdgesGeometry(pyr), new THREE.LineBasicMaterial({ color: ['#3df5ff', '#ff4fd8'][Math.floor(rnd() * 2)] })); p.add(e); spin.push({ m: p, r: .3, bob: rnd() * 6, y: p.position.y }); }
      else { const h = 6 + rnd() * 14, m = new THREE.Mesh(box, cols[Math.floor(rnd() * 4)]); m.scale.set(.12, h, .12); place(m, z, 7, 20, -8 + h / 2, -8 + h / 2); }
    }
  }
  return { group: g, update(dt, time) { for (const s of spin) { if (s.r) s.m.rotation.y += s.r * dt; if (s.bob !== undefined) s.m.position.y = s.y + Math.sin(time * .8 + s.bob) * .4; } } };
}
