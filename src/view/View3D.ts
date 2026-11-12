import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BANDS, CLAIM_SIZE, HOPPER, ORGANIC_LOADS_PER_TILE, PUMP, TANKS, TICKS_PER_DAY, bandOf } from '../data/balance';
import { organicGrade } from '../sim/mapgen';
import { fbm, hash2 } from '../sim/rng';
import { Item, Unit, isContainer, isDigger, isFixture, isProcessor, isTank, isVehicle, isWash, itemById, needsWater, onGround, tileAt, unitById } from '../sim/state';
import { step } from '../sim/step';
import { canClaim, nextClaimCost } from '../sim/systems/economy';
import { nearWater, wet } from '../sim/systems/machines';
import { ITEM_NAME, decide } from './actions';
import { BAND_COLORS, BAND_CSS } from './bands';
import { MinerParts, broadleafGeometry, flowerGeometry, grassGeometry, makeFlag, makeItem, makeMiner, pineGeometry, renderIcons, rockGeometry, setContents } from './models';
import type { Session } from './session';
import { Terrain, WATER_Y } from './terrain';

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const DAY_SHARE = 0.72; // part of each day the sun is up
export const DAWN_OFFSET = 0.06;

interface UnitView { m: MinerParts; ring: THREE.Mesh; glow: THREE.Sprite; px: number; py: number; yaw: number; label: HTMLDivElement }
interface Float { el: HTMLDivElement; p: THREE.Vector3; born: number }

export class View3D {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
  world = new THREE.Group();
  terrain!: Terrain;
  sun = new THREE.DirectionalLight(0xffffff, 2.6);
  hemi = new THREE.HemisphereLight(0xcfe6ff, 0x8a7a55, 1.1);
  lantern = new THREE.PointLight(0xffc070, 0, 9, 1.4);
  uTime = { value: 0 };
  // camera rig
  target = new THREE.Vector3(); yaw = Math.PI / 4; yawGoal = Math.PI / 4; dist = 24; pitch = 0.85;
  // entities
  units = new Map<number, UnitView>();
  items = new Map<number, THREE.Group>();
  itemGlows = new Map<number, THREE.Sprite>();
  notes = new Map<number, HTMLDivElement>();
  hoses = new THREE.Group(); hoseKey = '';
  lastDay = -1; wasPaused = true;
  flags = new Map<number, { g: THREE.Group; band: number }>();
  deco = new Map<number, [THREE.InstancedMesh, number][]>();
  fence = new THREE.Group();
  tileSig!: Int32Array;
  hover!: THREE.Mesh; claimPreview!: THREE.Mesh; itemRing!: THREE.Mesh; jobRings: THREE.Mesh[] = [];
  ghost: THREE.Group | null = null; ghostKind = '';
  pings: { m: THREE.Mesh; born: number }[] = [];
  fireflies!: THREE.Points;
  particles!: { pts: THREE.Points; pos: Float32Array; col: Float32Array; vel: Float32Array; life: Float32Array; next: number };
  floats: Float[] = [];
  glowTex = glowTexture();
  // input
  mouse = { x: 0, y: 0, inside: false };
  hit = { tx: -1, ty: -1, fx: 0, fy: 0, ok: false };
  drag: { x: number; y: number } | null = null;
  panning = false;
  keys = new Set<string>();
  acc = 0; lastNow = 0; dayF = 0;
  labels = document.getElementById('labels')!;
  hintEl = document.getElementById('hint')!;
  boxEl = document.getElementById('boxsel')!;
  ray = new THREE.Raycaster();

  constructor(public ses: Session, container: HTMLElement) {
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    container.appendChild(r.domElement);
    ses.icons = renderIcons();

    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.7, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.scene.fog = new THREE.FogExp2(0x9ed2f2, 0.011);
    this.scene.background = new THREE.Color(0x9ed2f2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 140;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.lantern, this.world);

    this.build();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput(r.domElement);
    ses.onRestart = () => this.build();
    const loop = () => { this.frame(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h); this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ world
  build() {
    const s = this.ses.state, n = s.size;
    // clear the old world
    this.world.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    this.world.clear(); this.terrain?.dispose();
    for (const v of this.units.values()) v.label.remove();
    for (const el of this.notes.values()) el.remove();
    this.notes.clear(); this.hoseKey = ''; this.lastDay = -1;
    this.units.clear(); this.items.clear(); this.itemGlows.clear(); this.flags.clear(); this.deco.clear(); this.pings = []; this.jobRings = [];
    this.floats.forEach(f => f.el.remove()); this.floats = []; this.ghost = null; this.ghostKind = ''; this.acc = 0;
    this.tileSig = new Int32Array(n * n).fill(-1);

    this.terrain = new Terrain(s);
    this.world.add(this.terrain.group);
    this.fence = new THREE.Group(); this.world.add(this.fence);
    this.hoses = new THREE.Group(); this.world.add(this.hoses);
    this.scatter();

    const flat = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false });
    this.hover = new THREE.Mesh(drapeGeometry(1), flat(0xffffff, 0.3)); this.hover.visible = false;
    this.claimPreview = new THREE.Mesh(drapeGeometry(CLAIM_SIZE), flat(0x7dff8a, 0.3)); this.claimPreview.visible = false;
    this.itemRing = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.44, 28).rotateX(-Math.PI / 2), flat(0xf2c14e, 0.95)); this.itemRing.visible = false;
    this.world.add(this.hover, this.claimPreview, this.itemRing);

    // sparks, dust
    const N = 700, pos = new Float32Array(N * 3).fill(-999), col = new Float32Array(N * 3), g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.22, map: this.glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    pts.frustumCulled = false; this.world.add(pts);
    this.particles = { pts, pos, col, vel: new Float32Array(N * 3), life: new Float32Array(N), next: 0 };
    // fireflies drift around the camera at night
    const F = 140, fp = new Float32Array(F * 3), fg = new THREE.BufferGeometry();
    for (let i = 0; i < F; i++) fp.set([(Math.random() - 0.5) * 34, 0.5 + Math.random() * 1.4, (Math.random() - 0.5) * 34], i * 3);
    fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    this.fireflies = new THREE.Points(fg, new THREE.PointsMaterial({ size: 0.16, map: this.glowTex, color: 0xd8ff7a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.fireflies.frustumCulled = false; this.world.add(this.fireflies);

    this.scanTiles(); this.drawClaims();
    this.target.set(s.spawn.x + 0.5, 0, s.spawn.y + 0.5); this.yaw = this.yawGoal = Math.PI / 4; this.dist = 21;
    this.ses.selUnits.add(this.ses.boss.id);
  }

  /** Trees, rocks, grass and flowers, all instanced. */
  scatter() {
    const s = this.ses.state, n = s.size, T = this.terrain, M = T.M;
    const sway = (m: THREE.MeshStandardMaterial, amount: number) => {
      m.onBeforeCompile = sh => {
        sh.uniforms.uTime = this.uTime;
        sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float ph = instanceMatrix[3][0] * 1.3 + instanceMatrix[3][2] * 1.7;
          #else
            float ph = 0.0;
          #endif
          float sw = sin(uTime * 1.5 + ph) * ${amount.toFixed(3)} * max(0.0, position.y) * max(0.0, position.y);
          transformed.x += sw; transformed.z += sw * 0.6;`);
      };
      return m;
    };
    const foliage = sway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), 0.022);
    const blades = sway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }), 1.2);
    const stone = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    const kinds = {
      pine0: { geo: pineGeometry(0), mat: foliage, shadow: true }, pine1: { geo: pineGeometry(1), mat: foliage, shadow: true },
      aspen: { geo: broadleafGeometry(true), mat: foliage, shadow: true }, oak: { geo: broadleafGeometry(false), mat: foliage, shadow: true },
      rock: { geo: rockGeometry(), mat: stone, shadow: true },
      // the wooded rim is scenery: it casts no shadows, which saves a whole extra pass over it
      pine0_far: { geo: pineGeometry(0), mat: foliage, shadow: false }, pine1_far: { geo: pineGeometry(1), mat: foliage, shadow: false }, rock_far: { geo: rockGeometry(), mat: stone, shadow: false },
      grass: { geo: grassGeometry(), mat: blades, shadow: false }, flower: { geo: flowerGeometry(), mat: blades, shadow: false },
    };
    const lists: Record<string, { m: THREE.Matrix4; tile: number; c?: THREE.Color }[]> = {};
    Object.keys(kinds).forEach(k => lists[k] = []);
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const put = (kind: string, x: number, z: number, scale: number, tile: number, rot: number, c?: THREE.Color) => {
      p.set(x, T.heightAt(x, z) - 0.02, z); q.setFromAxisAngle(up, rot); sc.setScalar(scale);
      lists[kind].push({ m: new THREE.Matrix4().compose(p, q, sc), tile, c });
    };
    const petals = [0xffffff, 0xffe27a, 0xff9ecb, 0xb9a6ff].map(h => new THREE.Color(h));
    const thin = Math.min(1, (96 / n) ** 2);   // fewer grass tufts per tile on bigger maps keeps the frame rate up
    for (let ty = -M; ty < n + M; ty++) for (let tx = -M; tx < n + M; tx++) {
      if (T.isWater(tx, ty)) continue;
      const inside = tx >= 0 && ty >= 0 && tx < n && ty < n, tile = inside ? ty * n + tx : -1;
      const h = hash2(s.seed + 77, tx, ty), h2 = hash2(s.seed + 78, tx, ty), h3 = hash2(s.seed + 79, tx, ty);
      const x = tx + 0.2 + h2 * 0.6, z = ty + 0.2 + h3 * 0.6, wd = T.waterDist(tx, ty);
      const forest = fbm(s.seed + 500, tx * 0.09, ty * 0.09, 2);
      if (!inside) { // the wooded hills around the map
        if (T.heightAt(x, z) < 4.6 && h < 0.34 + forest * 0.3 && wd > 1) put(h2 > 0.5 ? 'pine0_far' : 'pine1_far', x, z, 1.1 + h3 * 0.9, -1, h * 9);
        else if (h > 0.93) put('rock_far', x, z, 1.5 + h2 * 2.5, -1, h * 9);
        continue;
      }
      if (Math.hypot(tx - s.spawn.x, ty - s.spawn.y) <= 3) { if (h > 0.5) put('grass', x, z, 0.8 + h2 * 0.5, tile, h * 9); continue; }
      if (h < 0.03 + Math.max(0, forest - 0.5) * 0.5 && wd > 0) put(h < 0.012 ? 'aspen' : h < 0.02 ? 'oak' : h2 > 0.5 ? 'pine0' : 'pine1', x, z, 0.85 + h3 * 0.5, tile, h * 90);
      else if (h > 0.285 && h < 0.3) put('rock', x, z, 0.7 + h2 * 0.9, tile, h * 90);
      else {
        const blades = wd <= 1 ? 3 : 2;
        for (let k = 0; k < blades; k++) { const a = hash2(s.seed + 90 + k, tx, ty), b = hash2(s.seed + 95 + k, tx, ty); if (a > 1 - 0.65 * thin) put('grass', tx + 0.1 + a * 0.8, ty + 0.1 + b * 0.8, 0.7 + b * 0.8, tile, a * 9); }
        if (h > 1 - 0.1 * thin) put('flower', x, z, 0.9 + h2 * 0.6, tile, 0, petals[Math.floor(h3 * 4)]);
      }
    }
    for (const [k, list] of Object.entries(lists)) {
      const def = kinds[k as keyof typeof kinds];
      const im = new THREE.InstancedMesh(def.geo, def.mat, list.length);
      list.forEach((e, i) => {
        im.setMatrixAt(i, e.m); if (e.c) im.setColorAt(i, e.c);
        if (e.tile >= 0) { if (!this.deco.has(e.tile)) this.deco.set(e.tile, []); this.deco.get(e.tile)!.push([im, i]); }
      });
      im.castShadow = def.shadow; im.receiveShadow = true; im.frustumCulled = false;
      this.world.add(im);
    }
  }

  scanTiles() {
    const s = this.ses.state, n = s.size, zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < n * n; i++) {
      const t = s.tiles[i];
      if (t.water) continue;
      const sig = ((((t.organicLeft * 17 + t.topsoilLeft) * 37 + t.brownLeft) * 61 + t.blueLeft) * 13 + t.bedrockLeft) * 64 + (t.sample + 1) * 8 + (t.known ? 4 : 0) + (t.ripped ? 2 : 0) + (t.drilled ? 1 : 0);
      if (sig === this.tileSig[i]) continue;
      const first = this.tileSig[i] === -1; this.tileSig[i] = sig;
      const tx = i % n, ty = (i / n) | 0;
      if (t.organicLeft < ORGANIC_LOADS_PER_TILE) {
        this.terrain.updateTile(tx, ty);
        const d = this.deco.get(i);
        if (d) { for (const [im, k] of d) { im.setMatrixAt(k, zero); im.instanceMatrix.needsUpdate = true; } this.deco.delete(i); }
      }
      const band = t.known || t.drilled ? bandOf(organicGrade(t)) : t.sample, f = this.flags.get(i);
      if (band >= 0 && t.organicLeft > 0) {
        if (!f || f.band !== band) {
          if (f) this.world.remove(f.g);
          const g = makeFlag(BAND_COLORS[band]); g.rotation.y = this.yaw - 0.6; g.userData.born = first ? 0 : performance.now();
          this.world.add(g); this.flags.set(i, { g, band });
        }
      } else if (f) { this.world.remove(f.g); this.flags.delete(i); }
    }
    this.terrain.flush();
    for (const [i, f] of this.flags) { const tx = i % n, ty = (i / n) | 0; f.g.position.set(tx + 0.78, this.terrain.heightAt(tx + 0.78, ty + 0.22), ty + 0.22); }
  }

  /** A staked rope fence around everything the player owns. */
  drawClaims() {
    const s = this.ses.state, n = s.size, me = this.ses.me, T = this.terrain;
    this.fence.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    this.fence.clear();
    const mine = (x: number, y: number) => tileAt(s, x, y)?.owner === me;
    const edges: [number, number, number, number][] = [], posts = new Set<string>();
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!mine(x, y)) continue;
      if (!mine(x, y - 1)) edges.push([x, y, x + 1, y]); if (!mine(x, y + 1)) edges.push([x, y + 1, x + 1, y + 1]);
      if (!mine(x - 1, y)) edges.push([x, y, x, y + 1]); if (!mine(x + 1, y)) edges.push([x + 1, y, x + 1, y + 1]);
    }
    if (!edges.length) return;
    const rope = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.014, 0.014, 1, 5).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf2c14e, emissive: 0xf2c14e, emissiveIntensity: 0.55, roughness: 0.7 }), edges.length);
    const m = new THREE.Matrix4(), a = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), mid = new THREE.Vector3(), zAxis = new THREE.Vector3(0, 0, 1);
    edges.forEach(([x1, z1, x2, z2], i) => {
      a.set(x1, T.heightAt(x1, z1) + 0.3, z1); b.set(x2, T.heightAt(x2, z2) + 0.3, z2);
      mid.addVectors(a, b).multiplyScalar(0.5); b.sub(a); sc.set(1, 1, b.length()); q.setFromUnitVectors(zAxis, b.normalize());
      rope.setMatrixAt(i, m.compose(mid, q, sc)); posts.add(x1 + ',' + z1); posts.add(x2 + ',' + z2);
    });
    const list = [...posts].map(k => k.split(',').map(Number));
    const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.04, 0.42, 6).translate(0, 0.19, 0), new THREE.MeshStandardMaterial({ color: 0xe9d9a8, roughness: 0.9 }), list.length);
    const cap = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.034, 0.034, 0.08, 6).translate(0, 0.38, 0), new THREE.MeshStandardMaterial({ color: 0xd0342c, roughness: 0.7 }), list.length);
    list.forEach(([x, z], i) => { m.makeTranslation(x, T.heightAt(x, z), z); post.setMatrixAt(i, m); cap.setMatrixAt(i, m); });
    post.castShadow = cap.castShadow = true; rope.frustumCulled = post.frustumCulled = cap.frustumCulled = false;
    this.fence.add(rope, post, cap);
  }

  // ------------------------------------------------------------------ helpers
  /** Ground height for people and machines: they wade in the creek but drive down into pits. */
  ground(x: number, z: number) { const h = this.terrain.heightAt(x, z); return h < -0.28 && this.terrain.isWater(Math.floor(x), Math.floor(z)) ? -0.28 : h; }
  /** Gear set down in the creek sits in the shallows instead of sinking. */
  itemGround(x: number, z: number) { const h = this.terrain.heightAt(x, z); return h < WATER_Y - 0.03 && this.terrain.isWater(Math.floor(x), Math.floor(z)) ? WATER_Y - 0.03 : h; }
  screenOf(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, behind: v.z > 1 };
  }
  tileScreen(tx: number, ty: number) { return this.screenOf(tx + 0.5, this.ground(tx + 0.5, ty + 0.5), ty + 0.5); }
  pxPerUnit(p: THREE.Vector3) { const a = this.screenOf(p.x, p.y, p.z), b = this.screenOf(p.x, p.y + 1, p.z); return Math.hypot(a.x - b.x, a.y - b.y); }

  burst(x: number, y: number, z: number, n: number, color: number, spread = 1.4, up = 2.2) {
    const P = this.particles, c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = P.next = (P.next + 1) % P.life.length, a = Math.random() * Math.PI * 2, r = Math.random() * spread;
      P.pos.set([x, y, z], i * 3); P.vel.set([Math.cos(a) * r, up * (0.4 + Math.random() * 0.8), Math.sin(a) * r], i * 3);
      P.col.set([c.r, c.g, c.b], i * 3); P.life[i] = 0.6 + Math.random() * 0.7;
    }
  }
  floatText(x: number, y: number, z: number, text: string, color: string, size = 18) {
    const el = document.createElement('div'); el.className = 'float'; el.textContent = text; el.style.color = color; el.style.fontSize = size + 'px';
    this.labels.appendChild(el); this.floats.push({ el, p: new THREE.Vector3(x, y, z), born: performance.now() });
  }
  ping(x: number, z: number, color: number) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    m.position.set(x, this.ground(x, z) + 0.05, z); this.world.add(m); this.pings.push({ m, born: performance.now() });
  }

  // ------------------------------------------------------------------ input
  pick() {
    const ses = this.ses, s = ses.state, mx = this.mouse.x, my = this.mouse.y;
    let unit: Unit | undefined, item: Item | undefined, best = Infinity;
    const v = new THREE.Vector3();
    for (const u of s.units) {
      const uv = this.units.get(u.id); if (!uv || u.owner !== ses.me) continue;
      v.copy(uv.m.group.position); v.y += 0.45;
      const p = this.screenOf(v.x, v.y, v.z), r = this.pxPerUnit(v) * (u.vehicle >= 0 ? 0.9 : 0.42), d = Math.hypot((mx - p.x) * 1.5, my - p.y);
      if (d < r && d < best) { unit = u; best = d; }
    }
    best = Infinity;
    for (const it of s.items) {
      const g = this.items.get(it.id); if (!g || !onGround(it) || it.driver >= 0) continue;
      v.copy(g.position); v.y += isFixture(it.kind) ? 0.3 : 0.12;
      const p = this.screenOf(v.x, v.y, v.z), r = this.pxPerUnit(v) * (isFixture(it.kind) ? 0.5 : 0.3), d = Math.hypot(mx - p.x, my - p.y);
      if (d < r && d < best) { item = it; best = d; }
    }
    return { unit, item, tx: this.hit.tx, ty: this.hit.ty, fx: this.hit.fx, fy: this.hit.fy, ok: this.hit.ok };
  }
  castGround() {
    const ndc = new THREE.Vector2(this.mouse.x / window.innerWidth * 2 - 1, -(this.mouse.y / window.innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const pt = this.terrain.raycast(this.ray.ray.origin, this.ray.ray.direction);
    if (pt) this.hit = { fx: pt.x, fy: pt.z, tx: Math.floor(pt.x), ty: Math.floor(pt.z), ok: !!tileAt(this.ses.state, Math.floor(pt.x), Math.floor(pt.z)) };
    else this.hit.ok = false;
  }
  claimOrigin() { const n = this.ses.state.size, c = (v: number) => Math.min(n - CLAIM_SIZE, Math.max(0, v - CLAIM_SIZE / 2)); return { x0: c(this.hit.tx), y0: c(this.hit.ty) }; }

  bindInput(el: HTMLCanvasElement) {
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointermove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true; if (this.panning) this.panBy(-e.movementX, -e.movementY); });
    el.addEventListener('pointerleave', () => { this.mouse.inside = false; });
    el.tabIndex = 0; el.style.outline = 'none';   // focusable, so keys work when the game sits in a frame on another page
    el.addEventListener('pointerdown', e => { window.focus(); el.focus({ preventScroll: true }); this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.castGround(); el.setPointerCapture(e.pointerId); this.onDown(e); });
    el.addEventListener('pointerup', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.castGround(); this.onUp(e); });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      if (e.ctrlKey || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY))) this.dist = THREE.MathUtils.clamp(this.dist * (e.deltaY > 0 ? 1.12 : 0.89), 8, 90);
      else this.panBy(e.deltaX, e.deltaY);
    }, { passive: false });
    window.addEventListener('keydown', e => { if ((e.target as HTMLElement)?.tagName !== 'INPUT') { this.keys.add(e.key.toLowerCase()); this.onKey(e); } });
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }
  panBy(dx: number, dy: number) {
    const k = this.dist * 0.0016, s = Math.sin(this.yaw), c = Math.cos(this.yaw), n = this.ses.state.size;
    this.target.x += (c * dx + s * dy * 1.5) * k; this.target.z += (-s * dx + c * dy * 1.5) * k;
    this.target.x = THREE.MathUtils.clamp(this.target.x, -2, n + 2); this.target.z = THREE.MathUtils.clamp(this.target.z, -2, n + 2);
  }
  setMode(m: Session['mode'], pending: string | number | null = null) { this.ses.mode = m; this.ses.pending = pending; }

  onKey(e: KeyboardEvent) {
    const ses = this.ses, k = e.key.toLowerCase();
    if (!ses.started) return;
    if (k === 't') this.setMode(ses.mode === 'testpan' ? '' : 'testpan');
    else if (k === 'c') this.setMode(ses.mode === 'claim' ? '' : 'claim');
    else if (k === 'r') { if (ses.player.drill) this.setMode(ses.mode === 'drill' ? '' : 'drill'); else ses.onToast('Buy a drill rig from the store first'); }
    else if (k === 'm') { if (itemById(ses.state, ses.selItem)) this.setMode('move', ses.selItem); else ses.onToast('Left-click a bucket, sieve, pan or sluice first, then press M'); }
    else if (k === 'escape') {
      const modalOpen = !document.getElementById('modal')!.classList.contains('hidden');
      if (modalOpen) document.dispatchEvent(new CustomEvent('hud-close'));
      else if (ses.mode) this.setMode('');
      else { ses.selUnits.clear(); ses.selItem = -1; }
    }
    else if (k === 'g') ses.selUnits.forEach(id => ses.send({ c: 'drop', p: ses.me, unit: id }));
    else if (k === 'b') document.dispatchEvent(new CustomEvent('hud-store'));
    else if (k === 'h') document.dispatchEvent(new CustomEvent('hud-help'));
    else if (k === ' ') { ses.paused = !ses.paused; e.preventDefault(); }
    else if (k === '1') { ses.speed = 1; ses.paused = false; } else if (k === '2') { ses.speed = 2; ses.paused = false; } else if (k === '3') { ses.speed = 4; ses.paused = false; }
    else if (k === '=' || k === '+') this.dist = Math.max(8, this.dist * 0.87); else if (k === '-') this.dist = Math.min(90, this.dist * 1.15);
    else if (k === 'q') this.yawGoal += Math.PI / 2; else if (k === 'e') this.yawGoal -= Math.PI / 2;
    else if (k === 'f') { const b = ses.boss; this.target.set(b.x, 0, b.y); ses.selUnits.clear(); ses.selUnits.add(b.id); }
  }

  onDown(e: PointerEvent) {
    const ses = this.ses;
    if (!ses.started || ses.state.over) return;
    if (e.button === 1) { this.panning = true; return; }
    if (e.button === 0) { this.drag = { x: e.clientX, y: e.clientY }; return; }
    if (e.button === 2) {
      if (ses.mode) { this.setMode(''); return; }
      const hit = this.pick(); if (!hit.ok && !hit.item) return;
      let strong = false, any = false;
      const ids = [...ses.selUnits];
      ids.forEach((id, i) => {
        const u = ses.state.units.find(x => x.id === id); if (!u) return;
        const a = decide(ses, u, hit.tx, hit.ty, hit.fx, hit.fy, hit.item, e.shiftKey);
        if (a.cmd.c === 'move' && ids.length > 1) { if (i === 0) ses.send({ ...a.cmd, units: ids }); }
        else ses.send(a.cmd);
        strong = strong || a.strong; any = true;
      });
      if (any) this.ping(hit.fx, hit.fy, strong ? 0xf2c14e : 0x9be37a);
      else ses.onToast('Select your miner first (left-click, or press F)');
    }
  }

  onUp(e: PointerEvent) {
    const ses = this.ses, s = ses.state;
    if (e.button === 1) { this.panning = false; return; }
    if (e.button !== 0 || !this.drag) return;
    const d = this.drag; this.drag = null; this.boxEl.style.display = 'none';
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 && !ses.mode) {
      const x0 = Math.min(d.x, e.clientX), x1 = Math.max(d.x, e.clientX), y0 = Math.min(d.y, e.clientY), y1 = Math.max(d.y, e.clientY);
      if (!e.shiftKey) ses.selUnits.clear();
      ses.selItem = -1;
      for (const [id, v] of this.units) { const p = this.screenOf(v.m.group.position.x, v.m.group.position.y + 0.4, v.m.group.position.z); if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) ses.selUnits.add(id); }
      return;
    }
    const hit = this.pick();
    if (ses.mode === 'claim') {
      if (!hit.ok) return;
      const { x0, y0 } = this.claimOrigin();
      if (canClaim(s, x0, y0)) { ses.send({ c: 'buyClaim', p: ses.me, x0, y0 }); this.setMode(''); } else ses.onToast('Claims cannot overlap');
      return;
    }
    if (ses.mode === 'testpan' || ses.mode === 'drill') {
      const t = tileAt(s, hit.tx, hit.ty);
      if (!hit.ok || !t || t.water) { ses.onToast('Pick dry ground to sample'); return; }
      const onFoot = s.units.find(x => ses.selUnits.has(x.id) && x.vehicle < 0) ?? ses.boss;
      ses.send({ c: 'testpan', p: ses.me, unit: onFoot.id, tx: hit.tx, ty: hit.ty, deep: ses.mode === 'drill' });
      this.ping(hit.fx, hit.fy, 0x8fd3ff);
      return;
    }
    if (ses.mode === 'place') {
      if (!hit.ok) return;
      ses.send({ c: 'buy', p: ses.me, what: String(ses.pending), x: hit.tx, y: hit.ty });
      if (!e.shiftKey) this.setMode('');
      return;
    }
    if (ses.mode === 'move') {
      if (!hit.ok) return;
      const u = s.units.find(x => ses.selUnits.has(x.id) && x.boss) ?? s.units.find(x => ses.selUnits.has(x.id)) ?? ses.boss;
      ses.send({ c: 'relocate', p: ses.me, unit: u.id, item: Number(ses.pending), x: hit.tx, y: hit.ty });
      this.ping(hit.fx, hit.fy, 0xf2c14e); this.setMode('');
      return;
    }
    if (hit.unit) { if (!e.shiftKey) ses.selUnits.clear(); ses.selUnits.add(hit.unit.id); ses.selItem = -1; }
    else if (hit.item) ses.selItem = hit.item.id;
    else ses.selItem = -1;
  }

  updateHover() {
    const ses = this.ses, s = ses.state, T = this.terrain;
    this.hover.visible = this.claimPreview.visible = false;
    let hint = '';
    if (this.ghost) this.ghost.visible = false;
    if (!ses.started || s.over || !this.mouse.inside) { this.hintEl.style.display = 'none'; return; }
    this.castGround();
    const hit = this.pick(), t = hit.ok ? tileAt(s, hit.tx, hit.ty) : undefined;
    ses.selTile = t ? { x: hit.tx, y: hit.ty } : null;
    if (ses.mode === 'claim' && hit.ok) {
      const { x0, y0 } = this.claimOrigin(), cost = nextClaimCost(s, ses.me), free = canClaim(s, x0, y0), ok = free && ses.player.cash >= cost;
      drape(this.claimPreview, T, x0, y0, CLAIM_SIZE); this.claimPreview.visible = true;
      (this.claimPreview.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0x7dff8a : 0xff6b5a);
      hint = !free ? 'Overlaps a claim you already hold' : `Click to stake these ${CLAIM_SIZE} x ${CLAIM_SIZE} tiles: ${cost ? '$' + cost.toLocaleString() : 'FREE'}`;
    } else if (t) {
      drape(this.hover, T, hit.tx, hit.ty, 1); this.hover.visible = true;
      (this.hover.material as THREE.MeshBasicMaterial).color.setHex(ses.mode === 'testpan' || ses.mode === 'drill' ? 0x8fd3ff : ses.mode === 'place' || ses.mode === 'move' ? 0xf2c14e : 0xffffff);
      if (ses.mode === 'testpan') hint = !t.water ? 'Click to test pan here' : '';
      else if (ses.mode === 'drill') hint = t.water ? '' : t.drilled ? 'Already core-sampled' : 'Click to core-drill here: $100 for the grade of all five layers';
      else if (ses.mode === 'place' || ses.mode === 'move') {
        const kind = ses.mode === 'place' ? String(ses.pending) : itemById(s, Number(ses.pending))?.kind ?? '';
        if (kind && this.ghostKind !== kind) { if (this.ghost) this.world.remove(this.ghost); this.ghost = makeItem(kind); this.ghostKind = kind; this.ghost.traverse(o => { const m = o as THREE.Mesh; if (m.material) { m.material = (m.material as THREE.Material).clone(); (m.material as THREE.Material).transparent = true; (m.material as THREE.Material).opacity = 0.55; m.castShadow = false; } }); this.world.add(this.ghost); }
        if (this.ghost) { this.ghost.visible = true; this.ghost.position.set(hit.tx + 0.5, this.itemGround(hit.tx + 0.5, hit.ty + 0.5), hit.ty + 0.5); }
        const dry = (kind === 'pan' || kind === 'sluice' || kind === 'washplant') && !wet(s, hit.tx, hit.ty, ses.me);
        const pumpDry = kind === 'pump' && !nearWater(s, hit.tx, hit.ty);
        hint = (ses.mode === 'place' ? `Click to have the ${ITEM_NAME[kind]} delivered here` : `Click to move the ${ITEM_NAME[kind]} here`) + (dry ? ' (it only works beside the creek or near a pump)' : pumpDry ? ' (a pump has to sit beside the creek)' : '');
      }
      else if (hit.unit) hint = hit.unit.boss ? 'You (left-click to select)' : `${hit.unit.name}: ${hit.unit.status}`;
      else if (ses.selUnits.size) {
        const u = s.units.find(x => ses.selUnits.has(x.id));
        if (u) { const a = decide(ses, u, hit.tx, hit.ty, hit.fx, hit.fy, hit.item, this.keys.has('shift')); if (a.strong || hit.item || a.label.length > 12) hint = 'Right-click: ' + a.label; }
      } else if (hit.item) hint = 'Left-click to select, then M to move it';
    }
    const el = this.hintEl;
    if (hint && !this.drag) { el.textContent = hint; el.style.display = 'block'; el.style.left = this.mouse.x + 18 + 'px'; el.style.top = this.mouse.y + 18 + 'px'; } else el.style.display = 'none';
    if (this.drag && !ses.mode && Math.hypot(this.mouse.x - this.drag.x, this.mouse.y - this.drag.y) > 8) {
      const b = this.boxEl.style; b.display = 'block';
      b.left = Math.min(this.drag.x, this.mouse.x) + 'px'; b.top = Math.min(this.drag.y, this.mouse.y) + 'px';
      b.width = Math.abs(this.mouse.x - this.drag.x) + 'px'; b.height = Math.abs(this.mouse.y - this.drag.y) + 'px';
    }
  }

  // ------------------------------------------------------------------ sim events
  afterStep() {
    const ses = this.ses, s = ses.state;
    for (const e of s.events) {
      if (e.owner !== undefined && e.owner !== ses.me) continue;
      if (e.type === 'toast' || e.type === 'buy' || e.type === 'hire') ses.onToast(e.text!);
      const x = (e.x ?? 0) + 0.5, z = (e.y ?? 0) + 0.5, y = this.ground(x, z);
      // quieter the further it is from what the camera is looking at
      const near = e.x === undefined ? 1 : 1 - smooth(this.dist * 0.35, this.dist * 1.1 + 6, Math.hypot(x - this.target.x, z - this.target.z));
      const snd = e.type === 'rip' ? 'scoop' : e.type === 'drill' ? 'sample' : e.type;
      if (e.type !== 'toast' && e.type !== 'dug') ses.sfx.play(snd, e.type === 'claim' || e.type === 'buy' || e.type === 'hire' ? 1 : near, e.amount ?? 0);
      if (e.type === 'scoop') this.burst(x, y + 0.3, z, 10, 0x9c7a4e, 1.2, 1.6);
      if (e.type === 'dump') this.burst(x, y + 0.9, z, 8, 0x9c7a4e, 0.8, 0.8);
      if (e.type === 'gold') {
        const amt = e.amount!;
        this.floatText(x, y + 0.9, z, '+$' + (amt >= 10 ? Math.round(amt) : amt.toFixed(1)), amt >= 60 ? '#ffe27a' : amt >= 25 ? '#f2c14e' : '#d9c79a', amt >= 60 ? 26 : 19);
        this.burst(x, y + 0.4, z, Math.min(40, 5 + Math.floor(amt / 4)), 0xffd24a);
        document.dispatchEvent(new CustomEvent('hud-cash'));
      } else if (e.type === 'rip') { this.burst(x, y + 0.3, z, 12, 0xa8703f, 1.4, 1.2);
      } else if (e.type === 'sample' || e.type === 'drill') {
        const b = e.amount!;
        this.floatText(x, y + 0.9, z, BANDS[b].name, BAND_CSS[b], 16 + b * 2);
        this.burst(x, y + 0.2, z, 4 + b * 6, BAND_COLORS[b], 1, 1.8);
      } else if (e.type === 'claim') {
        this.drawClaims();
        this.floatText(e.x!, this.ground(e.x!, e.y!) + 1.2, e.y!, 'Claim staked!', '#f2c14e', 26); this.burst(e.x!, this.ground(e.x!, e.y!) + 0.5, e.y!, 50, 0xf2c14e, 4, 3);
      } else if (e.type === 'dug') this.burst(x, y + 0.2, z, 14, 0x9c7a4e, 1.2, 1.4);
      else if (e.type === 'buy') this.burst(x, y + 0.3, z, 16, 0xffffff, 1, 1.6);
    }
    s.events.length = 0;
    this.scanTiles();
  }

  // ------------------------------------------------------------------ frame
  frame() {
    const ses = this.ses, s = ses.state;
    const now = performance.now(), dtMs = Math.min(250, this.lastNow ? now - this.lastNow : 16), dt = dtMs / 1000; this.lastNow = now;
    this.uTime.value += dt; this.terrain.waterUniforms.uTime.value = this.uTime.value;

    // camera keys
    const K = this.keys, sp = 900 * dt;
    if (K.has('a') || K.has('arrowleft')) this.panBy(-sp, 0); if (K.has('d') || K.has('arrowright')) this.panBy(sp, 0);
    if (K.has('w') || K.has('arrowup')) this.panBy(0, -sp * 0.7); if (K.has('s') || K.has('arrowdown')) this.panBy(0, sp * 0.7);
    this.yaw += (this.yawGoal - this.yaw) * Math.min(1, dt * 9);

    if (ses.started && !ses.paused && !s.over) {
      this.acc += dtMs * ses.speed;
      let n = 0;
      while (this.acc >= 100 && n < 12) {
        for (const u of s.units) { const v = this.units.get(u.id); if (v) { v.px = u.x; v.py = u.y; } }
        step(s, ses.queue); ses.queue = [];
        this.acc -= 100; n++;
        this.afterStep();
      }
      if (n === 12) this.acc = 0;
    }
    // autosave once a game day, and whenever the game is paused
    const day = Math.floor(s.tick / TICKS_PER_DAY);
    if (ses.started && (day !== this.lastDay || (ses.paused && !this.wasPaused))) { if (this.lastDay >= 0 || ses.paused) ses.save(); this.lastDay = day; }
    this.wasPaused = ses.paused;
    const alpha = ses.paused || s.over ? 1 : Math.min(1, this.acc / 100);
    // The sky clock runs slightly ahead so each new day begins just after sunrise.
    this.dayF = ((s.tick + (ses.paused || s.over ? 0 : this.acc / 100)) / TICKS_PER_DAY + DAWN_OFFSET) % 1;

    this.syncUnits(alpha, dt);
    this.syncItems();
    this.updateSky(dt);

    // camera
    const cp = Math.cos(this.pitch);
    this.target.y += (this.ground(this.target.x, this.target.z) - this.target.y) * Math.min(1, dt * 4);
    this.camera.position.set(this.target.x + Math.sin(this.yaw) * cp * this.dist, this.target.y + Math.sin(this.pitch) * this.dist, this.target.z + Math.cos(this.yaw) * cp * this.dist);
    this.camera.lookAt(this.target); this.camera.updateMatrixWorld();

    this.updateHover();
    this.updateEffects(now, dt);
    this.updateMachines();
    if (ses.started) {
      const tx = Math.floor(this.target.x), tz = Math.floor(this.target.z), zoom = 1 - (this.dist - 8) / 70;
      let engines = 0; for (const it of s.items) if (it.running && it.kind !== 'sluice' && Math.hypot(it.x - tx, it.y - tz) < 16) engines += it.kind === 'pump' ? 0.5 : 1;
      ses.sfx.ambient((1 - smooth(0, 7, this.terrain.waterDist(tx, tz))) * zoom, ses.night, ses.paused || s.over ? 0 : engines * zoom);
    }
    this.composer.render();
  }

  syncUnits(alpha: number, dt: number) {
    const ses = this.ses, s = ses.state, t = this.uTime.value;
    for (const u of s.units) {
      let v = this.units.get(u.id);
      if (!v) {
        const m = makeMiner(u.boss ? 'boss' : (u.id % 3) as 0 | 1 | 2);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.37, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9be37a, transparent: true, opacity: 0.95, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
        this.world.add(ring);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffb55a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); glow.scale.setScalar(1.5); glow.position.y = 0.35; m.group.add(glow);
        const label = document.createElement('div'); label.className = 'ulabel'; label.innerHTML = '<b></b><div class="ubar"><i></i></div>'; this.labels.appendChild(label);
        this.world.add(m.group);
        v = { m, ring, glow, px: u.x, py: u.y, yaw: 0, label }; this.units.set(u.id, v);
        if (!u.boss) this.burst(u.x, this.ground(u.x, u.y) + 0.5, u.y, 24, 0x9be37a);
      }
      const x = v.px + (u.x - v.px) * alpha, z = v.py + (u.y - v.py) * alpha, g = v.m.group;
      const dx = u.x - v.px, dz = u.y - v.py;
      // face the way they walk, or the thing they are working on
      let want = v.yaw;
      if (u.moving && (dx || dz)) want = Math.atan2(dx, dz);
      else { const o = u.queue[0]; if (o && u.workTotal > 0) { let tx = x, tz = z; if ('tx' in o) { tx = o.tx + 0.5; tz = o.ty + 0.5; } else if ('station' in o) { const st = itemById(s, o.station); if (st) { tx = st.x + 0.5; tz = st.y + 0.5; } } if (Math.hypot(tx - x, tz - z) > 0.05) want = Math.atan2(tx - x, tz - z); } }
      let dy = want - v.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); v.yaw += dy * Math.min(1, dt * 12);
      const wading = this.terrain.heightAt(x, z) < -0.1;
      g.position.set(x, this.ground(x, z) - (wading ? 0.08 : 0), z); g.rotation.y = v.yaw;
      const driving = u.vehicle >= 0; g.visible = !driving;
      v.ring.position.set(x, g.position.y + 0.05, z); const vk = driving ? itemById(s, u.vehicle)?.kind ?? '' : ''; v.ring.scale.setScalar(driving ? (vk === 'excavator4' ? 4.2 : vk === 'excavator3' ? 3.4 : vk === 'excavator2' ? 2.8 : 2.4) : 1);
      const working = u.workTotal > 0, carrying = u.carrying >= 0, ph = t * 11 + u.id, P = v.m;
      const sw = u.moving ? Math.sin(ph) * 0.75 : 0;
      P.legL.rotation.x = sw; P.legR.rotation.x = -sw;
      P.torso.position.y = 0.3 + (u.moving ? Math.abs(Math.cos(ph)) * 0.025 : Math.sin(t * 2 + u.id) * 0.006);
      if (working) { const a = -1.15 + Math.sin(t * 13 + u.id) * 0.55; P.armL.rotation.x = a; P.armR.rotation.x = a; P.torso.rotation.x = 0.28 + Math.sin(t * 13 + u.id) * 0.08; }
      else { P.torso.rotation.x = u.moving ? 0.08 : 0; P.armL.rotation.x = carrying ? -1.25 : -sw; P.armR.rotation.x = carrying ? -1.25 : sw; }
      v.ring.visible = ses.selUnits.has(u.id);
      // label: progress bar and status mark
      const p = this.screenOf(g.position.x, g.position.y + (driving ? 1.25 : 1.02), g.position.z), L = v.label;
      const idle = !u.boss && !working && !u.moving && u.queue.length === 0;
      if (p.behind || (!working && !idle)) L.style.display = 'none';
      else {
        L.style.display = 'block'; L.style.left = p.x + 'px'; L.style.top = p.y + 'px';
        (L.firstChild as HTMLElement).textContent = idle ? (u.job ? '…' : '?') : '';
        (L.firstChild as HTMLElement).style.color = u.job ? '#fff' : '#ffd95a';
        const bar = L.lastChild as HTMLElement; bar.style.display = working ? 'block' : 'none';
        if (working) (bar.firstChild as HTMLElement).style.width = (100 * (1 - u.workLeft / u.workTotal)).toFixed(0) + '%';
      }
    }
    for (const [id, v] of this.units) if (!s.units.some(u => u.id === id)) { this.world.remove(v.m.group); this.world.remove(v.ring); v.label.remove(); this.units.delete(id); ses.selUnits.delete(id); }
  }

  syncItems() {
    const ses = this.ses, s = ses.state;
    this.itemRing.visible = false;
    for (const it of s.items) {
      let g = this.items.get(it.id);
      if (!g) {
        g = makeItem(it.kind); this.world.add(g); this.items.set(it.id, g);
        if (isFixture(it.kind) && !isVehicle(it.kind)) { const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffb55a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); glow.scale.setScalar(2.0); glow.position.y = 0.3; g.add(glow); this.itemGlows.set(it.id, glow); }
      }
      if (isContainer(it.kind) && g.userData.contents !== it.contents) { setContents(g, it.contents); g.userData.contents = it.contents; }
      const carrier = it.carriedBy >= 0 ? this.units.get(it.carriedBy) : undefined, st = it.inStation >= 0 ? itemById(s, it.inStation) : undefined;
      const drv = it.driver >= 0 ? this.units.get(it.driver) : undefined;
      if (isVehicle(it.kind)) {
        const du = unitById(s, it.driver), t = this.uTime.value;
        if (drv) { g.position.copy(drv.m.group.position); g.userData.yaw = drv.yaw; }
        else { const x = it.x + 0.5, z = it.y + 0.5; g.position.set(x, this.itemGround(x, z), z); }
        g.rotation.set(0, g.userData.yaw ?? 0.6, 0);
        const working = !!du && du.workTotal > 0;
        if (isDigger(it.kind)) {
          const boom = g.getObjectByName('boom')!, stick = g.getObjectByName('stick')!;
          boom.rotation.x += ((working ? -0.35 + Math.sin(t * 5) * 0.4 : -0.75) - boom.rotation.x) * 0.2;
          stick.rotation.x += ((working ? 1.9 + Math.sin(t * 5 + 1) * 0.5 : 1.6) - stick.rotation.x) * 0.2;
        }
        const load = g.getObjectByName('load');
        if (load) { load.visible = it.hopper > 0; if (it.kind === 'truck') load.scale.set(0.82, 0.25 + 0.6 * Math.min(1, it.hopper / HOPPER.truck), 1.25); }
        const head = g.getObjectByName('driver'); if (head) head.visible = !!drv;
        if (it.running) g.position.y += Math.sin(t * 30 + it.id) * (working ? 0.012 : 0.005);
      } else if (carrier) {
        const c = carrier.m.group, fx = Math.sin(carrier.yaw), fz = Math.cos(carrier.yaw);
        if (it.kind === 'barrow') { g.position.set(c.position.x + fx * 0.5, c.position.y, c.position.z + fz * 0.5); g.rotation.set(-0.12, carrier.yaw, 0); }
        else if (it.kind === 'atv') { g.position.copy(c.position); g.rotation.set(0, carrier.yaw, 0); c.position.y += 0.16; }   // the hand rides it
        else if (isFixture(it.kind)) { g.position.set(c.position.x, c.position.y + 1.05, c.position.z); g.rotation.set(0, carrier.yaw, 0); }
        else { g.position.set(c.position.x + fx * 0.24, c.position.y + 0.33 + carrier.m.torso.position.y - 0.3, c.position.z + fz * 0.24); g.rotation.set(0, carrier.yaw, 0); }
      } else if (st) {
        const side = st.inSlot === it.id ? -1 : 1, x = st.x + 0.5 + side * 0.4, z = st.y + 0.5 + 0.28;
        g.position.set(x, this.itemGround(x, z), z); g.rotation.set(0, 0, 0);
      } else {
        const stn = isFixture(it.kind), x = it.x + 0.5 + (stn ? 0 : ((it.id * 37) % 5 - 2) * 0.13), z = it.y + 0.5 + (stn ? 0 : ((it.id * 53) % 5 - 2) * 0.13);
        g.position.set(x, this.itemGround(x, z), z); g.rotation.set(0, stn ? 0 : it.id * 1.7, 0);
      }
      if (isProcessor(it.kind)) {
        const drum = g.getObjectByName('drum'), deck = g.getObjectByName('deck'), load = g.getObjectByName('load');
        if (it.running && drum) drum.rotation.y += it.kind === 'mill' ? 0.07 : 0.12;
        if (deck) deck.position.x = it.running ? Math.sin(this.uTime.value * 60) * 0.012 : 0;
        if (load) { load.visible = it.hopper > 0; load.scale.setScalar(0.45 + 0.75 * Math.min(1, it.hopper / HOPPER[it.kind])); }
      }
      // floating note: why a machine is stopped, or how much diesel a tank holds
      const dry = isWash(it.kind) && onGround(it) && !wet(s, it.x, it.y, it.owner);
      const text = it.note || (dry ? 'Needs water' : isTank(it.kind) && onGround(it) ? `${Math.round(it.fuel)} / ${TANKS[it.kind].capacity} gal` : '');
      let el = this.notes.get(it.id);
      if (text) {
        if (!el) { el = document.createElement('div'); this.labels.appendChild(el); this.notes.set(it.id, el); }
        const p = this.screenOf(g.position.x, g.position.y + (it.kind === 'washplant' ? 1.5 : isProcessor(it.kind) || isVehicle(it.kind) ? 1.3 : isTank(it.kind) ? 0.75 + 0.3 * (TANKS[it.kind].capacity > 100 ? 1.5 : 0) : 0.85), g.position.z);
        el.className = 'inote' + (isTank(it.kind) && !it.note && it.fuel > TANKS[it.kind].capacity * 0.15 ? ' ok' : ''); el.textContent = text;
        el.style.display = p.behind ? 'none' : 'block'; el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
      } else if (el) { el.remove(); this.notes.delete(it.id); }
      if (it.id === ses.selItem) { this.itemRing.visible = true; this.itemRing.position.set(g.position.x, g.position.y + 0.04, g.position.z); this.itemRing.scale.setScalar(isFixture(it.kind) ? 1.6 : 0.75); }
    }
    for (const [id, g] of this.items) if (!s.items.some(i => i.id === id)) { this.world.remove(g); this.items.delete(id); this.itemGlows.delete(id); this.notes.get(id)?.remove(); this.notes.delete(id); if (ses.selItem === id) ses.selItem = -1; }
  }

  /** Hoses from each running pump to the pans and sluices it waters. */
  updateMachines() {
    const s = this.ses.state;
    const pairs: [Item, Item][] = [];
    for (const p of s.items) {
      if (p.kind !== 'pump' || !p.running) continue;
      for (const w of s.items) if (needsWater(w.kind) && w.owner === p.owner && onGround(w) && !nearWater(s, w.x, w.y) && (w.x - p.x) ** 2 + (w.y - p.y) ** 2 <= PUMP.range ** 2) pairs.push([p, w]);
    }
    const key = pairs.map(([p, w]) => `${p.x},${p.y}>${w.x},${w.y}`).join('|');
    if (key === this.hoseKey) return;
    this.hoseKey = key;
    this.hoses.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    this.hoses.clear();
    const mat = new THREE.MeshStandardMaterial({ color: 0x1f3f2a, roughness: 0.7 });
    for (const [p, w] of pairs) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) { const k = i / 12, x = p.x + 0.5 + (w.x - p.x) * k, z = p.y + 0.5 + (w.y - p.y) * k + Math.sin(k * Math.PI * 3) * 0.12; pts.push(new THREE.Vector3(x, this.itemGround(x, z) + 0.04, z)); }
      const hose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.03, 6), mat); hose.castShadow = true; this.hoses.add(hose);
    }
  }

  /**
   * Time of day. Night is moonlit rather than dark: the light turns cool and
   * shadows swing round, camp gear glows and fireflies come out, but the
   * ground stays as readable as it is at noon.
   */
  updateSky(dt: number) {
    const f = this.dayF, e = 0.05;
    const night = f < e ? 0.5 - f / (2 * e) : f > 1 - e ? 1 - (f - (1 - e)) / (2 * e) * 1 + 0 : smooth(DAY_SHARE - e, DAY_SHARE + e, f);
    const nightK = f > 1 - e ? 1 - 0.5 * (f - (1 - e)) / e : night;
    const p = Math.min(1, f / DAY_SHARE), high = Math.sin(Math.PI * p);
    const el = nightK > 0.5 ? 1.0 : 0.3 + 0.85 * high, az = nightK > 0.5 ? -0.7 : -1.25 + 2.5 * p;
    const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    this.sun.target.position.copy(this.target); this.sun.position.copy(this.target).addScaledVector(dir, 60);
    const cross = 1 - Math.abs(2 * nightK - 1); // dips while sun hands over to moon
    const sunC = new THREE.Color(0xffb878).lerp(new THREE.Color(0xfff4e0), high), moonC = new THREE.Color(0xa9c4ff);
    this.sun.color.copy(sunC).lerp(moonC, nightK); this.sun.intensity = (2.7 + (1.7 - 2.7) * nightK) * (1 - 0.55 * cross);
    this.hemi.color.set(0xcfe6ff).lerp(new THREE.Color(0x8ea6ff), nightK); this.hemi.groundColor.set(0x8a7a55).lerp(new THREE.Color(0x46507e), nightK);
    this.hemi.intensity = 1.1 + 0.45 * nightK + 0.35 * cross;
    const warm = Math.pow(1 - high, 3) * (1 - nightK) * 0.75;
    const sky = new THREE.Color(0x9ed2f2).lerp(new THREE.Color(0xf4b47e), warm).lerp(new THREE.Color(0x2a3a7a), nightK);
    (this.scene.background as THREE.Color).copy(sky); (this.scene.fog as THREE.FogExp2).color.copy(sky);
    this.terrain.waterUniforms.uNight.value = nightK; this.terrain.waterUniforms.uSun.value.copy(this.sun.color);
    this.ses.night = nightK;
    // lantern light around the miner, glows on people and stations
    const b = this.units.get(this.ses.boss?.id ?? -1);
    if (b) this.lantern.position.set(b.m.group.position.x, b.m.group.position.y + 1.1, b.m.group.position.z);
    this.lantern.intensity = nightK * 9;
    for (const v of this.units.values()) (v.glow.material as THREE.SpriteMaterial).opacity = nightK * 0.16;
    for (const g of this.itemGlows.values()) (g.material as THREE.SpriteMaterial).opacity = nightK * 0.2;
    (this.fireflies.material as THREE.PointsMaterial).opacity = nightK * 0.9;
    if (nightK > 0.01) {
      const a = this.fireflies.geometry.attributes.position as THREE.BufferAttribute, t = this.uTime.value;
      for (let i = 0; i < a.count; i++) a.setY(i, 0.9 + Math.sin(t * 0.9 + i * 1.7) * 0.5 + Math.sin(t * 2.3 + i) * 0.12);
      a.needsUpdate = true;
      this.fireflies.position.set(this.target.x + Math.sin(t * 0.05) * 2, this.target.y, this.target.z + Math.cos(t * 0.04) * 2);
    }
    this.bloom.strength = 0.3 + 0.25 * nightK;
    void dt;
  }

  updateEffects(now: number, dt: number) {
    const ses = this.ses, s = ses.state, P = this.particles;
    for (let i = 0; i < P.life.length; i++) {
      if (P.life[i] <= 0) continue;
      P.life[i] -= dt; P.vel[i * 3 + 1] -= 4.5 * dt;
      for (let k = 0; k < 3; k++) P.pos[i * 3 + k] += P.vel[i * 3 + k] * dt;
      if (P.life[i] <= 0) P.pos[i * 3 + 1] = -999; else if (P.life[i] < 0.3) { for (let k = 0; k < 3; k++) P.col[i * 3 + k] *= 0.9; }
    }
    P.pts.geometry.attributes.position.needsUpdate = true; P.pts.geometry.attributes.color.needsUpdate = true;
    this.pings = this.pings.filter(p => { const a = (now - p.born) / 450; if (a >= 1) { this.world.remove(p.m); p.m.geometry.dispose(); return false; } p.m.scale.setScalar(1 + a * 1.6); (p.m.material as THREE.MeshBasicMaterial).opacity = 1 - a; return true; });
    this.floats = this.floats.filter(f => { const a = (now - f.born) / 1500; if (a >= 1) { f.el.remove(); return false; } const p = this.screenOf(f.p.x, f.p.y + a * 0.9, f.p.z); f.el.style.left = p.x + 'px'; f.el.style.top = p.y + 'px'; f.el.style.opacity = String(a < 0.6 ? 1 : 1 - (a - 0.6) / 0.4); return true; });
    for (const f of this.flags.values()) { const born = f.g.userData.born as number; const a = born ? Math.min(1, (now - born) / 350) : 1; f.g.scale.setScalar(a < 1 ? 1.6 - 0.6 * a : 1); const pn = f.g.getObjectByName('pennant'); if (pn) pn.rotation.y = Math.sin(this.uTime.value * 3 + f.g.position.x) * 0.35; }
    // job markers for selected hands
    let k = 0;
    for (const id of ses.selUnits) {
      const u = s.units.find(x => x.id === id); if (!u || !u.job) continue;
      let x: number, z: number;
      if (u.job.type === 'dig') { x = u.job.tx + 0.5; z = u.job.ty + 0.5; } else { const st = itemById(s, u.job.station); if (!st) continue; x = st.x + 0.5; z = st.y + 0.5; }
      let r = this.jobRings[k];
      if (!r) { r = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.46, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.8, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); this.world.add(r); this.jobRings[k] = r; }
      r.visible = true; r.position.set(x, this.ground(x, z) + 0.05, z); r.scale.setScalar(1 + Math.sin(this.uTime.value * 4) * 0.06); k++;
    }
    for (; k < this.jobRings.length; k++) this.jobRings[k].visible = false;
  }
}

// A flat patch that hugs the terrain: used for the hover tile and the claim preview.
function drapeGeometry(tiles: number): THREE.BufferGeometry {
  const G = tiles * 2 + 1, pos = new Float32Array(G * G * 3), idx: number[] = [];
  // same alternating diagonals as the terrain, so the patch never dips under it
  for (let j = 0; j < G - 1; j++) for (let i = 0; i < G - 1; i++) { const a = j * G + i, b = a + 1, d = a + G, e = d + 1; if ((i + j) % 2 === 0) idx.push(a, d, e, a, e, b); else idx.push(a, d, b, b, d, e); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); return g;
}
function drape(mesh: THREE.Mesh, T: Terrain, x0: number, z0: number, tiles: number) {
  const G = tiles * 2 + 1, a = mesh.geometry.attributes.position as THREE.BufferAttribute, inset = 0.04;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = Math.min(x0 + tiles - inset, Math.max(x0 + inset, x0 + i / 2)), z = Math.min(z0 + tiles - inset, Math.max(z0 + inset, z0 + j / 2));
    a.setXYZ(j * G + i, x, Math.max(T.heightAt(x, z), -0.04) + 0.03, z);
  }
  a.needsUpdate = true; mesh.geometry.computeBoundingSphere();
}
function glowTexture(): THREE.Texture {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
