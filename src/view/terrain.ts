import * as THREE from 'three';
import { LAYER_KEYS, LAYER_LOADS, ORGANIC_LOADS_PER_TILE } from '../data/balance';
import { fbm, hash2 } from '../sim/rng';
import type { GameState } from '../sim/state';

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const WATER_Y = -0.05;
const LAND = 1.0, BED = -0.32;
// How far each layer drops the ground when fully dug, and the colour of what it exposes (linear rgb).
const DEPTH = [0.38, 0.45, 0.8, 1.1, 0.45];
const STOPS: [number, number, number, number][] = [
  [0, 0.33, 0.20, 0.10],        // fresh dirt
  [0.38, 0.16, 0.09, 0.045],    // dark topsoil
  [0.83, 0.34, 0.15, 0.06],     // the brown layer
  [1.63, 0.12, 0.20, 0.33],     // blue clay
  [2.73, 0.30, 0.30, 0.33],     // bedrock
  [3.18, 0.20, 0.20, 0.23],
];
function dirtColour(d: number): [number, number, number] {
  let i = 0; while (i < STOPS.length - 2 && d > STOPS[i + 1][0]) i++;
  const a = STOPS[i], b = STOPS[i + 1], t = Math.min(1, Math.max(0, (d - a[0]) / (b[0] - a[0])));
  return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

/**
 * The ground: one mesh with a vertex at every tile corner, edge midpoint and
 * center, so each tile can sink into a pit as it is dug and neighbouring pits
 * join up. A border of hills and forest surrounds the playable map.
 */
export class Terrain {
  readonly M = 12;             // border tiles beyond the playable map
  readonly n: number;
  readonly E: number;          // tiles per side including border
  readonly G: number;          // vertices per side
  group = new THREE.Group();
  mesh: THREE.Mesh;
  water: THREE.Mesh;
  private wflag: Uint8Array;
  private dist: Float32Array;
  private base: Float32Array;  // static height per vertex
  private wAvg: Float32Array;
  private grass: Float32Array; // static grass colour per vertex
  private pos: THREE.BufferAttribute;
  private col: THREE.BufferAttribute;
  private nor: THREE.BufferAttribute;
  private dirty = false; private lo = Infinity; private hi = -1;
  waterUniforms = { uTime: { value: 0 }, uNight: { value: 0 }, uSun: { value: new THREE.Color(1, 1, 1) } };

  constructor(private s: GameState) {
    const n = this.n = s.size, M = this.M, E = this.E = n + 2 * M, G = this.G = E * 2 + 1;
    // Water flags on the extended grid: the creek carries on straight past the map edge.
    this.wflag = new Uint8Array(E * E);
    for (let ey = 0; ey < E; ey++) for (let ex = 0; ex < E; ex++) {
      const tx = ex - M, ty = Math.min(n - 1, Math.max(0, ey - M));
      if (tx >= 0 && tx < n && s.tiles[ty * n + tx].water) this.wflag[ey * E + ex] = 1;
    }
    // Distance to water, so hills only rise away from the creek.
    const dist = this.dist = new Float32Array(E * E).fill(99); const q: number[] = [];
    for (let i = 0; i < E * E; i++) if (this.wflag[i]) { dist[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % E, y = (i / E) | 0, d = dist[i] + 1;
      if (d > 14) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= E || ny >= E) continue; const j = ny * E + nx; if (dist[j] > d) { dist[j] = d; q.push(j); } }
    }
    this.base = new Float32Array(G * G); this.wAvg = new Float32Array(G * G); this.grass = new Float32Array(G * G * 3);
    const positions = new Float32Array(G * G * 3), colors = new Float32Array(G * G * 3), uvs = new Float32Array(G * G * 2);
    const c = new THREE.Color(), c2 = new THREE.Color();
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const v = j * G + i, x = i / 2 - M, z = j / 2 - M;
      let w = 0, d = 0, k = 0;
      this.adjacent(i, j, (ex, ey) => { if (ex < 0 || ey < 0 || ex >= E || ey >= E) return; w += this.wflag[ey * E + ex]; d += this.dist[ey * E + ex]; k++; });
      w /= k; d /= k;
      const out = Math.max(0, -x, x - n, -z, z - n), rim = smooth(0, M, out);
      const hs = smooth(1, 7, d);
      const hill = Math.pow(fbm(s.seed + 11, x * 0.07, z * 0.07, 3), 1.6) * 2.2 * hs;
      const mountain = Math.pow(rim, 1.3) * (4.5 + 3 * fbm(s.seed + 13, x * 0.2, z * 0.2, 3)) * smooth(0.5, 5, d);
      const land = LAND + hill + mountain;
      this.base[v] = land * (1 - w) + BED * w; this.wAvg[v] = w;
      // grass colour
      const lush = fbm(s.seed + 300, x * 0.13, z * 0.13, 2), dry = fbm(s.seed + 400, x * 0.07, z * 0.07, 2);
      c.setHex(0x4f8f38).lerp(c2.setHex(0x86bb4a), lush);
      if (dry > 0.58) c.lerp(c2.setHex(0xb9b25a), Math.min(1, (dry - 0.58) * 4));
      if (d < 2.5) c.lerp(c2.setHex(0x3f9a4a), 0.45);
      c.lerp(c2.setHex(0x2f5f33), rim * 0.55);                               // darker forest floor outside
      if (mountain > 2.2) c.lerp(c2.setHex(0x8b8f96), smooth(2.2, 4.5, mountain)); // bare rock up high
      if (w > 0.02) c.lerp(c2.setHex(0xcdb98a), smooth(0.02, 0.5, w));           // sandy bank
      if (w > 0.6) c.lerp(c2.setHex(0x6f6a55), smooth(0.6, 1, w));               // creek bed
      c.multiplyScalar(0.94 + 0.12 * hash2(s.seed, i, j));
      this.grass.set([c.r, c.g, c.b], v * 3);
      positions.set([x, this.base[v], z], v * 3); colors.set([c.r, c.g, c.b], v * 3); uvs.set([x, z], v * 2);
    }
    const idx = new Uint32Array((G - 1) * (G - 1) * 6); let o = 0;
    for (let j = 0; j < G - 1; j++) for (let i = 0; i < G - 1; i++) {
      const a = j * G + i, b = a + 1, d = a + G, e = d + 1;
      if ((i + j) % 2 === 0) { idx.set([a, d, e, a, e, b], o); } else { idx.set([a, d, b, b, d, e], o); }
      o += 6;
    }
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(positions, 3); this.col = new THREE.BufferAttribute(colors, 3);
    geo.setAttribute('position', this.pos); geo.setAttribute('color', this.col); geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: detailTexture(), roughness: 0.95, metalness: 0 }));
    this.mesh.receiveShadow = true;
    this.nor = new THREE.BufferAttribute(new Float32Array(G * G * 3), 3); geo.setAttribute('normal', this.nor);
    for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) if (s.tiles[ty * n + tx].organicLeft < ORGANIC_LOADS_PER_TILE && !s.tiles[ty * n + tx].water) this.updateTile(tx, ty, true);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) this.normalAt(i, j);
    this.dirty = false; this.lo = Infinity; this.hi = -1;
    geo.computeBoundingSphere(); geo.boundingSphere!.radius += 6;

    // Water is laid only over creek tiles, so deep pits elsewhere stay dry.
    const wp: number[] = [];
    for (let ey = 0; ey < E; ey++) for (let ex = 0; ex < E; ex++) {
      if (!this.wflag[ey * E + ex]) continue;
      const x = ex - M, z = ey - M;
      wp.push(x, 0, z, x, 0, z + 1, x + 1, 0, z + 1, x, 0, z, x + 1, 0, z + 1, x + 1, 0, z);
    }
    const wgeo = new THREE.BufferGeometry(); wgeo.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    this.water = new THREE.Mesh(wgeo, new THREE.ShaderMaterial({
      uniforms: this.waterUniforms, transparent: true, depthWrite: false,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `varying vec3 vW; uniform float uTime; uniform float uNight; uniform vec3 uSun;
        float wave(vec2 p, float t){ return sin(p.x*2.3+t*1.1)*sin(p.y*2.9-t*0.9) + 0.5*sin((p.x+p.y)*4.7+t*1.9) + 0.25*sin((p.x-p.y)*9.1-t*2.6); }
        void main(){
          float n = wave(vW.xz, uTime);
          vec3 deep = mix(vec3(0.05,0.30,0.52), vec3(0.03,0.10,0.30), uNight);
          vec3 shallow = mix(vec3(0.20,0.62,0.80), vec3(0.14,0.30,0.62), uNight);
          vec3 col = mix(deep, shallow, 0.5 + 0.28*n);
          float glint = pow(max(0.0, sin(vW.x*7.0+uTime*1.7+n)*sin(vW.z*6.0-uTime*1.3+n)), 14.0);
          float foam = smoothstep(0.86, 1.0, sin(vW.x*3.1+vW.z*2.3+uTime*0.8+n*1.5)*0.5+0.5) * 0.18;
          col += uSun * (glint*0.9 + foam);
          gl_FragColor = vec4(col, 0.82);
        }`,
    }));
    this.water.position.y = WATER_Y; this.water.frustumCulled = false;
    this.group.add(this.mesh, this.water);
  }

  /** Tiles (extended coords) that touch vertex (i, j) of the half-tile grid. */
  private adjacent(i: number, j: number, fn: (ex: number, ey: number) => void) {
    const x0 = Math.floor((i - 1) / 2), x1 = Math.floor(i / 2), y0 = Math.floor((j - 1) / 2), y1 = Math.floor(j / 2);
    fn(x0, y0); if (x1 !== x0) fn(x1, y0);
    if (y1 !== y0) { fn(x0, y1); if (x1 !== x0) fn(x1, y1); }
  }
  /** How far a tile has really been dug down, in world units. */
  private target(i: number): number {
    const t = this.s.tiles[i];
    if (t.water || t.organicLeft >= ORGANIC_LOADS_PER_TILE) return 0;
    let d = 0.08 * (t.organicLeft / ORGANIC_LOADS_PER_TILE);
    for (let k = 0; k < 5; k++) d += DEPTH[k] * (1 - t[LAYER_KEYS[k]] / LAYER_LOADS[k]);
    return d;
  }
  // The depth drawn on screen trails the real one, so ground sinks as it is dug instead of snapping.
  private shown: Float32Array | null = null;
  private sinking = new Set<number>();
  private dug(ex: number, ey: number): number {
    const tx = ex - this.M, ty = ey - this.M, n = this.n;
    if (tx < 0 || ty < 0 || tx >= n || ty >= n) return 0;
    return this.shown ? this.shown[ty * n + tx] : 0;
  }
  /** A tile changed: sink it to its new depth over the next moments, or at once when loading. */
  updateTile(tx: number, ty: number, snap = false) {
    const n = this.n, i = ty * n + tx;
    if (!this.shown) this.shown = new Float32Array(n * n);
    if (snap) { this.shown[i] = this.target(i); this.sinking.delete(i); this.reshape(tx, ty); } else this.sinking.add(i);
  }
  /** Ease every sinking tile toward its real depth. Call once a frame. */
  animate(dt: number) {
    if (!this.sinking.size || !this.shown) return;
    const n = this.n, k = Math.min(1, dt * 2.2);
    for (const i of this.sinking) {
      const want = this.target(i), d = want - this.shown[i];
      if (Math.abs(d) < 0.004) { this.shown[i] = want; this.sinking.delete(i); } else this.shown[i] += d * k;
      this.reshape(i % n, (i / n) | 0);
    }
  }
  isWater(tx: number, ty: number) { const ex = tx + this.M, ey = ty + this.M; return ex >= 0 && ey >= 0 && ex < this.E && ey < this.E && this.wflag[ey * this.E + ex] === 1; }
  waterDist(tx: number, ty: number) { const ex = tx + this.M, ey = ty + this.M; return ex >= 0 && ey >= 0 && ex < this.E && ey < this.E ? this.dist[ey * this.E + ex] : 0; }

  private normalAt(i: number, j: number) {
    const G = this.G, p = this.pos, c = (v: number) => Math.min(G - 1, Math.max(0, v));
    const nx = p.getY(j * G + c(i - 1)) - p.getY(j * G + c(i + 1)), nz = p.getY(c(j - 1) * G + i) - p.getY(c(j + 1) * G + i), l = Math.hypot(nx, 1, nz);
    this.nor.setXYZ(j * G + i, nx / l, 1 / l, nz / l);
  }

  /** Re-shape and re-colour the nine vertices of a tile after digging. */
  private reshape(tx: number, ty: number, normals = true) {
    const G = this.G, i0 = (tx + this.M) * 2, j0 = (ty + this.M) * 2;
    for (let j = j0; j <= j0 + 2; j++) for (let i = i0; i <= i0 + 2; i++) {
      const v = j * G + i;
      let lo = 99, hi = 0;
      this.adjacent(i, j, (ex, ey) => { const d = this.dug(ex, ey); lo = Math.min(lo, d); hi = Math.max(hi, d); });
      this.pos.setY(v, this.base[v] - lo * (1 - this.wAvg[v]));
      let r = this.grass[v * 3], g = this.grass[v * 3 + 1], b = this.grass[v * 3 + 2];
      if (hi > 0) {
        const k = lo > 0 ? 1 : 0.6;      // the rim keeps some grass, the floor is bare
        const [dr, dg, db] = dirtColour(lo);
        r += (dr - r) * k; g += (dg - g) * k; b += (db - b) * k;
      }
      this.col.setXYZ(v, r, g, b);
    }
    if (normals) for (let j = j0 - 1; j <= j0 + 3; j++) for (let i = i0 - 1; i <= i0 + 3; i++) if (i >= 0 && j >= 0 && i < G && j < G) this.normalAt(i, j);
    this.lo = Math.min(this.lo, Math.max(0, (j0 - 1) * G)); this.hi = Math.max(this.hi, Math.min(G * G - 1, (j0 + 4) * G));
    this.dirty = true;
  }
  /** Send only the rows that changed to the graphics card. */
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    for (const a of [this.pos, this.col, this.nor]) { a.clearUpdateRanges(); a.addUpdateRange(this.lo * 3, (this.hi - this.lo + 1) * 3); a.needsUpdate = true; }
    this.lo = Infinity; this.hi = -1;
  }

  /** Where a ray from the camera meets the ground. Marches the height field, so it is cheap on any map size. */
  raycast(o: THREE.Vector3, d: THREE.Vector3): THREE.Vector3 | null {
    if (d.y >= -0.001) return null;
    let t = Math.max(0, (o.y - 14) / -d.y), prev = t;
    const p = new THREE.Vector3();
    for (let k = 0; k < 900; k++) {
      p.copy(o).addScaledVector(d, t);
      if (p.y < this.heightAt(p.x, p.z)) {
        let a = prev, b = t;
        for (let m = 0; m < 8; m++) { const mid = (a + b) / 2; p.copy(o).addScaledVector(d, mid); if (p.y < this.heightAt(p.x, p.z)) b = mid; else a = mid; }
        return p.copy(o).addScaledVector(d, b);
      }
      if (p.y < -6) return null;
      prev = t; t += 0.2;
    }
    return null;
  }

  heightAt(x: number, z: number): number {
    const G = this.G, fi = Math.min(G - 1.001, Math.max(0, (x + this.M) * 2)), fj = Math.min(G - 1.001, Math.max(0, (z + this.M) * 2));
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, w = fj - j, p = this.pos;
    const a = p.getY(j * G + i), b = p.getY(j * G + i + 1), c = p.getY((j + 1) * G + i), d = p.getY((j + 1) * G + i + 1);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  }

  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.water.geometry.dispose(); (this.water.material as THREE.Material).dispose(); }
}

function detailTexture(): THREE.Texture {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#f4f4f4'; c.fillRect(0, 0, S, S);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    c.fillStyle = rnd() > 0.5 ? `rgba(0,0,0,${0.03 + rnd() * 0.07})` : `rgba(255,255,255,${0.05 + rnd() * 0.1})`;
    const x = rnd() * S, y = rnd() * S; c.fillRect(x, y, 1 + rnd() * 2.5, 2 + rnd() * 6);
  }
  // faint tile grid so the squares still read
  const g = c.createLinearGradient(0, 0, 10, 0); g.addColorStop(0, 'rgba(0,0,0,0.16)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(0, 0, 10, S);
  const g2 = c.createLinearGradient(0, 0, 0, 10); g2.addColorStop(0, 'rgba(0,0,0,0.16)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g2; c.fillRect(0, 0, S, 10);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
