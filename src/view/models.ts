import * as THREE from 'three';
import { VEHICLES, footprint } from '../data/balance';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Every model is built from primitives in code; there are no asset files.
// One world unit is one map tile.

const M = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, ...extra });
const cache = new Map<string, THREE.Material>();
const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => {
  const k = color + JSON.stringify(extra);
  if (!cache.has(k)) cache.set(k, M(color, extra));
  return cache.get(k)!;
};
function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; return o;
}

/** Paint a geometry one flat color so several can merge into a single vertex-colored mesh. */
export function tint(geo: THREE.BufferGeometry, hex: number, jitter = 0): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 3) {
    const k = 1 + (Math.sin(i * 12.9898) * 43758.5453 % 1) * jitter;
    for (let j = 0; j < 3 && i + j < n; j++) { arr[(i + j) * 3] = c.r * k; arr[(i + j) * 3 + 1] = c.g * k; arr[(i + j) * 3 + 2] = c.b * k; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => { g.scale(sx, sy, sz); g.translate(x, y, z); return g; };

export function pineGeometry(shade = 0): THREE.BufferGeometry {
  const greens = shade ? [0x1f5a3a, 0x2a6e47, 0x3a8557] : [0x24633a, 0x2f7a45, 0x43924f];
  return mergeGeometries([
    tint(at(new THREE.CylinderGeometry(0.06, 0.1, 0.55, 6), 0, 0.27, 0), 0x5b3d22),
    tint(at(new THREE.ConeGeometry(0.46, 0.75, 8), 0, 0.82, 0), greens[0], 0.12),
    tint(at(new THREE.ConeGeometry(0.36, 0.65, 8), 0, 1.22, 0), greens[1], 0.12),
    tint(at(new THREE.ConeGeometry(0.24, 0.55, 8), 0, 1.62, 0), greens[2], 0.12),
  ])!;
}
export function broadleafGeometry(golden: boolean): THREE.BufferGeometry {
  const c = golden ? [0xd9a02c, 0xeabf45, 0xf4d769] : [0x3f8a3a, 0x52a046, 0x6ab555];
  return mergeGeometries([
    tint(at(new THREE.CylinderGeometry(0.05, 0.08, 0.9, 6), 0, 0.45, 0), golden ? 0xd9d2c0 : 0x5b3d22),
    tint(at(new THREE.IcosahedronGeometry(0.44, 1), 0, 1.15, 0, 1, 0.9, 1), c[0], 0.1),
    tint(at(new THREE.IcosahedronGeometry(0.32, 1), 0.22, 1.38, 0.1), c[1], 0.1),
    tint(at(new THREE.IcosahedronGeometry(0.28, 1), -0.2, 1.42, -0.12), c[2], 0.1),
  ])!;
}
export const rockGeometry = () => tint(at(new THREE.DodecahedronGeometry(0.24, 0), 0, 0.1, 0, 1, 0.7, 1), 0x8a8f96, 0.18);
export function grassGeometry(): THREE.BufferGeometry {
  const blade = (x: number, z: number, h: number, lean: number) => { const g = new THREE.ConeGeometry(0.035, h, 3); g.translate(0, h / 2, 0); g.rotateZ(lean); g.translate(x, 0, z); return tint(g, 0x6fae4a, 0.25); };
  return mergeGeometries([blade(0, 0, 0.26, 0.15), blade(0.07, 0.04, 0.2, -0.25), blade(-0.06, 0.05, 0.22, 0.3), blade(0.02, -0.07, 0.18, -0.1)])!;
}
export function flowerGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    tint(at(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 4), 0, 0.08, 0), 0x4f8a3a),
    tint(at(new THREE.IcosahedronGeometry(0.045, 0), 0, 0.18, 0), 0xffffff),
  ])!;
}

export interface MinerParts {
  group: THREE.Group; torso: THREE.Group; head: THREE.Group;
  legL: THREE.Group; legR: THREE.Group; kneeL: THREE.Group; kneeR: THREE.Group;
  armL: THREE.Group; armR: THREE.Group; elbowL: THREE.Group; elbowR: THREE.Group;
  tools: Record<'pick' | 'shovel' | 'pan' | 'rifle' | 'club' | 'sack', THREE.Object3D>;
}
export type Look = 'boss' | 0 | 1 | 2 | 'guard' | 'bandit' | 'thief';
/** Height of the hip joint; the torso group sits here when standing still. */
export const HIP_Y = 0.5;

const LOOKS: Record<string, { shirt: number; pants: number; hat: number; skin: number; hair: number }> = {
  boss: { shirt: 0xb8402c, pants: 0x3b4f6e, hat: 0xb99257, skin: 0xe0ac86, hair: 0x7a5a3a },
  0: { shirt: 0x5f7d48, pants: 0x4a4036, hat: 0xf2c230, skin: 0xd9a47c, hair: 0x2c2018 },
  1: { shirt: 0xc98f3a, pants: 0x3e4a5c, hat: 0xf4f1e6, skin: 0xa8734f, hair: 0x1b1410 },
  2: { shirt: 0x4f79a8, pants: 0x4a4036, hat: 0xe8742c, skin: 0xecc09c, hair: 0x8a6a3c },
  guard: { shirt: 0x3f74b8, pants: 0x2b3a55, hat: 0x2b3a55, skin: 0xd9a47c, hair: 0x2c2018 },
  bandit: { shirt: 0x2a2523, pants: 0x1c1a19, hat: 0x141210, skin: 0xcf9f7c, hair: 0x1b1410 },
  thief: { shirt: 0x55524e, pants: 0x34322f, hat: 0x3f3d3a, skin: 0xcf9f7c, hair: 0x1b1410 },
};

// A jointed figure about one tile tall: hips, knees, shoulders and elbows all bend,
// and the tools of the trade ride in the right hand, shown one at a time.
export function makeMiner(variant: Look): MinerParts {
  const L = LOOKS[variant], group = new THREE.Group();
  const skin = mat(L.skin), boots = mat(0x2e2219), shirt = mat(L.shirt), pants = mat(L.pants), steel = mat(0x8d949c, { metalness: 0.7, roughness: 0.4 }), wood = mat(0x8a6238);
  const seg = (m: THREE.Material, len: number, r0: number, r1: number) => mesh(new THREE.CylinderGeometry(r0, r1, len, 10), m, 0, -len / 2, 0);
  const joint = (m: THREE.Material, r: number, y = 0) => mesh(new THREE.SphereGeometry(r, 10, 8), m, 0, y, 0);
  const leg = (x: number) => {
    const hip = new THREE.Group(); hip.position.set(x, HIP_Y, 0);
    hip.add(joint(pants, 0.062), seg(pants, 0.24, 0.06, 0.048));
    const knee = new THREE.Group(); knee.position.y = -0.24;
    knee.add(joint(pants, 0.048), seg(pants, 0.2, 0.046, 0.038));
    knee.add(mesh(new THREE.BoxGeometry(0.075, 0.07, 0.15), boots, 0, -0.225, 0.03));
    hip.add(knee);
    return [hip, knee] as const;
  };
  const [legL, kneeL] = leg(-0.065), [legR, kneeR] = leg(0.065);
  const torso = new THREE.Group(); torso.position.y = HIP_Y;
  // pelvis, waist and chest: wider at the shoulders than at the belt
  torso.add(mesh(new THREE.CylinderGeometry(0.105, 0.115, 0.1, 12), pants, 0, 0.03, 0));
  torso.add(mesh(new THREE.CylinderGeometry(0.135, 0.105, 0.22, 12), shirt, 0, 0.19, 0).translateZ(0.005));
  torso.add(mesh(new THREE.SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), shirt, 0, 0.3, 0.005));
  torso.children.forEach(c => { c.scale.z = 0.72; });
  torso.add(mesh(new THREE.BoxGeometry(0.2, 0.025, 0.16), mat(0x2e2219), 0, 0.085, 0));                       // belt
  if (variant === 'boss') for (const x of [-0.06, 0.06]) torso.add(mesh(new THREE.BoxGeometry(0.03, 0.26, 0.2), pants, x, 0.22, 0)); // suspenders
  if (variant === 0 || variant === 1 || variant === 2) torso.add(mesh(new THREE.BoxGeometry(0.265, 0.035, 0.215), mat(0xe6e84a, { emissive: 0x33340a }), 0, 0.2, 0)); // hi-vis band
  if (variant === 'guard') torso.add(mesh(new THREE.BoxGeometry(0.04, 0.04, 0.01), mat(0xf2c14e, { metalness: 0.8, roughness: 0.3 }), -0.06, 0.26, 0.1));
  const arm = (x: number) => {
    const sh = new THREE.Group(); sh.position.set(x, 0.3, 0);
    sh.add(joint(shirt, 0.055), seg(shirt, 0.19, 0.048, 0.04));
    const el = new THREE.Group(); el.position.y = -0.19;
    el.add(joint(shirt, 0.04), seg(variant === 'boss' ? skin : shirt, 0.17, 0.038, 0.032), joint(skin, 0.04, -0.19));
    sh.add(el);
    return [sh, el] as const;
  };
  const [armL, elbowL] = arm(-0.175), [armR, elbowR] = arm(0.175);
  torso.add(armL, armR);
  const head = new THREE.Group(); head.position.y = 0.44;
  head.add(mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.06, 8), skin, 0, -0.085, 0));                        // neck
  const skull = mesh(new THREE.SphereGeometry(0.085, 16, 12), skin, 0, 0, 0); skull.scale.set(0.92, 1.1, 1); head.add(skull);
  head.add(mesh(new THREE.ConeGeometry(0.016, 0.04, 6), skin, 0, -0.01, 0.088).rotateX(Math.PI / 2));          // nose
  for (const x of [-0.032, 0.032]) { head.add(mesh(new THREE.SphereGeometry(0.011, 6, 6), mat(0x1b1208), x, 0.012, 0.076)); head.add(mesh(new THREE.BoxGeometry(0.03, 0.008, 0.01), mat(L.hair), x, 0.034, 0.078)); }
  for (const x of [-0.08, 0.08]) head.add(mesh(new THREE.SphereGeometry(0.018, 6, 6), skin, x, -0.005, 0));     // ears
  head.add(mesh(new THREE.SphereGeometry(0.088, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(L.hair), 0, 0.006, -0.012)); // hair
  if (variant === 'boss') {
    const beard = mesh(new THREE.SphereGeometry(0.07, 10, 8), mat(L.hair), 0, -0.055, 0.035); beard.scale.set(1, 1.05, 0.8); head.add(beard);
    head.add(mesh(new THREE.CylinderGeometry(0.17, 0.18, 0.014, 18), mat(L.hat), 0, 0.068, 0), mesh(new THREE.CylinderGeometry(0.075, 0.092, 0.09, 14), mat(L.hat), 0, 0.118, 0), mesh(new THREE.CylinderGeometry(0.094, 0.094, 0.02, 14), mat(0x3a2a1c), 0, 0.085, 0));
  } else if (variant === 'guard') {
    head.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 14), mat(L.hat), 0, 0.085, 0), mesh(new THREE.BoxGeometry(0.13, 0.012, 0.09), mat(L.hat), 0, 0.064, 0.085));
  } else if (variant === 'bandit') {
    head.add(mesh(new THREE.CylinderGeometry(0.155, 0.165, 0.014, 18), mat(L.hat), 0, 0.068, 0), mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.085, 14), mat(L.hat), 0, 0.115, 0));
    const mask = mesh(new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.4), mat(0xa32a22), 0, 0, 0.004); mask.scale.set(0.95, 1.1, 1.02); head.add(mask);
  } else if (variant === 'thief') {
    const hood = mesh(new THREE.SphereGeometry(0.1, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), mat(L.hat), 0, 0.004, -0.012); hood.scale.set(1, 1.12, 1.08); head.add(hood);
    const mask = mesh(new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.4), mat(0x22201e), 0, 0, 0.004); mask.scale.set(0.95, 1.1, 1.02); head.add(mask);
  } else {
    // hard hat with a brim
    head.add(mesh(new THREE.SphereGeometry(0.098, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(L.hat, { roughness: 0.45 }), 0, 0.04, 0), mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.012, 16), mat(L.hat, { roughness: 0.45 }), 0, 0.042, 0.012));
  }
  torso.add(head);
  // Tools hang from the right hand, pointing on past it, so swinging the arm swings the tool.
  const hand = new THREE.Group(); hand.position.y = -0.19; elbowR.add(hand);
  const pick = new THREE.Group(); pick.add(mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.5, 6), wood, 0, -0.2, 0));
  const pickHead = mesh(new THREE.TorusGeometry(0.19, 0.016, 6, 12, Math.PI * 0.55), steel, 0, -0.615, 0); pickHead.rotation.set(0, Math.PI / 2, Math.PI * 0.225); pick.add(pickHead);
  const shovel = new THREE.Group(); shovel.add(mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.5, 6), wood, 0, -0.2, 0));
  const blade = mesh(new THREE.BoxGeometry(0.11, 0.15, 0.012), steel, 0, -0.52, 0.01); blade.rotation.x = -0.15; shovel.add(blade);
  const rifle = new THREE.Group(); rifle.add(mesh(new THREE.BoxGeometry(0.03, 0.2, 0.05), wood, 0, 0.04, 0), mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.36, 6), mat(0x2b2d31, { metalness: 0.8, roughness: 0.35 }), 0, -0.22, 0.008));
  const club = new THREE.Group(); club.add(mesh(new THREE.CylinderGeometry(0.03, 0.016, 0.36, 8), mat(0x5a4028), 0, -0.14, 0));
  hand.add(pick, shovel, rifle, club);
  const pan = new THREE.Group(); pan.add(mesh(new THREE.CylinderGeometry(0.13, 0.085, 0.035, 16, 1, true), mat(0x3a3d42, { metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide }), 0, 0, 0), mesh(new THREE.CircleGeometry(0.086, 14).rotateX(-Math.PI / 2), mat(0x6b4a2b), 0, -0.012, 0));
  pan.position.set(0, 0.1, 0.3); torso.add(pan);
  const sack = mesh(new THREE.SphereGeometry(0.12, 10, 8), mat(0x9a8458), 0, 0.2, -0.16); sack.scale.set(1, 1.25, 0.8); torso.add(sack);
  const tools = { pick, shovel, pan, rifle, club, sack };
  for (const t of Object.values(tools)) t.visible = false;
  group.add(legL, legR, torso);
  return { group, torso, head, legL, legR, kneeL, kneeR, armL, armR, elbowL, elbowR, tools };
}

const FILL = { paydirt: 0x6b4a2b, fines: 0xb39563 } as const;

function bucket(): THREE.Group {
  const g = new THREE.Group(), metal = mat(0x9aa7b4, { metalness: 0.55, roughness: 0.45, side: THREE.DoubleSide });
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.2, 14, 1, true), metal, 0, 0.1, 0));
  g.add(mesh(new THREE.CircleGeometry(0.09, 14).rotateX(-Math.PI / 2), metal, 0, 0.012, 0));
  g.add(mesh(new THREE.TorusGeometry(0.12, 0.008, 5, 14, Math.PI), mat(0x5c6670, { metalness: 0.6, roughness: 0.4 }), 0, 0.2, 0));
  const fill = mesh(new THREE.SphereGeometry(0.115, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), M(FILL.paydirt, { roughness: 1 }), 0, 0.15, 0); fill.scale.y = 0.45; fill.name = 'fill'; g.add(fill);
  return g;
}
function barrow(): THREE.Group {
  const g = new THREE.Group(), red = mat(0xb5522d, { roughness: 0.6 }), wood = mat(0x6b4a2b);
  const tub = mesh(new THREE.CylinderGeometry(0.26, 0.17, 0.18, 4, 1, true).rotateY(Math.PI / 4), mat(0xb5522d, { roughness: 0.6, side: THREE.DoubleSide }), 0, 0.3, 0); tub.scale.set(1, 1, 1.35); g.add(tub);
  g.add(mesh(new THREE.BoxGeometry(0.24, 0.02, 0.33), red, 0, 0.22, 0));
  const wheel = mesh(new THREE.TorusGeometry(0.1, 0.035, 8, 16).rotateY(Math.PI / 2), mat(0x2c2c2c), 0, 0.13, 0.36); g.add(wheel);
  for (const x of [-0.14, 0.14]) { const h = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.8, 6).rotateX(Math.PI / 2 - 0.18), wood, x, 0.26, -0.06); g.add(h); g.add(mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.2, 6), wood, x, 0.1, -0.22)); }
  const fill = mesh(new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M(FILL.paydirt, { roughness: 1 }), 0, 0.33, 0); fill.scale.set(0.95, 0.55, 1.3); fill.name = 'fill'; g.add(fill);
  return g;
}
function sieve(): THREE.Group {
  const g = new THREE.Group(), wood = mat(0x8a5a2f), dark = mat(0x5b3d22);
  for (const [x, z] of [[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24]]) { const leg = mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.46, 6), dark, x * 1.1, 0.23, z * 1.1); leg.rotation.set(z * 0.3, 0, -x * 0.3); g.add(leg); }
  for (const [x, z, w, d] of [[0, -0.26, 0.58, 0.05], [0, 0.26, 0.58, 0.05], [-0.26, 0, 0.05, 0.58], [0.26, 0, 0.05, 0.58]]) g.add(mesh(new THREE.BoxGeometry(w, 0.1, d), wood, x, 0.47, z));
  // wire mesh screen
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const c = cv.getContext('2d')!;
  c.fillStyle = '#d8cfae'; c.fillRect(0, 0, 64, 64); c.strokeStyle = '#6f6248'; c.lineWidth = 2;
  for (let i = 0; i <= 64; i += 8) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 64); c.moveTo(0, i); c.lineTo(64, i); c.stroke(); }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  g.add(mesh(new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.2 }), 0, 0.455, 0));
  return g;
}
function pan(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.11, 0.07, 18, 1, true), mat(0x4a5f52, { metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }), 0, 0.045, 0));
  g.add(mesh(new THREE.CircleGeometry(0.11, 18).rotateX(-Math.PI / 2), mat(0x3b4b3f, { metalness: 0.6, roughness: 0.4 }), 0, 0.012, 0));
  g.add(mesh(new THREE.CircleGeometry(0.165, 18).rotateX(-Math.PI / 2), M(0x6fc0d6, { roughness: 0.15, transparent: true, opacity: 0.8 }), 0, 0.058, 0));
  for (const [x, z] of [[0.04, 0.02], [-0.05, 0.05], [0.0, -0.06]]) g.add(mesh(new THREE.SphereGeometry(0.012, 6, 6), M(0xffd95a, { emissive: 0xffb000, emissiveIntensity: 1.6, metalness: 1, roughness: 0.3 }), x, 0.062, z));
  return g;
}
function sluice(): THREE.Group {
  const g = new THREE.Group(), wood = mat(0x8a5a2f), dark = mat(0x5b3d22);
  const run = new THREE.Group(); run.position.y = 0.3; run.rotation.x = 0.22;
  run.add(mesh(new THREE.BoxGeometry(0.3, 0.03, 0.95), wood));
  for (const x of [-0.15, 0.15]) run.add(mesh(new THREE.BoxGeometry(0.03, 0.12, 0.95), wood, x, 0.05, 0));
  for (let i = 0; i < 7; i++) run.add(mesh(new THREE.BoxGeometry(0.27, 0.035, 0.022), dark, 0, 0.03, -0.38 + i * 0.125));
  run.add(mesh(new THREE.PlaneGeometry(0.27, 0.93).rotateX(-Math.PI / 2), M(0x6fc0d6, { roughness: 0.1, transparent: true, opacity: 0.7 }), 0, 0.045, 0));
  for (let i = 0; i < 4; i++) run.add(mesh(new THREE.SphereGeometry(0.012, 6, 6), M(0xffd95a, { emissive: 0xffb000, emissiveIntensity: 1.6, metalness: 1, roughness: 0.3 }), -0.08 + i * 0.05, 0.055, -0.3 + i * 0.19));
  g.add(run);
  for (const [x, z, h] of [[-0.13, -0.38, 0.42], [0.13, -0.38, 0.42], [-0.13, 0.3, 0.24], [0.13, 0.3, 0.24]]) g.add(mesh(new THREE.CylinderGeometry(0.022, 0.026, h, 6), dark, x, h / 2, z));
  return g;
}

function excavator(): THREE.Group {
  const g = new THREE.Group(), yellow = mat(0xf2b01e, { roughness: 0.55 }), dark = mat(0x2b2b2e, { roughness: 0.9 }), steel = mat(0x8a8f96, { metalness: 0.6, roughness: 0.45 });
  for (const x of [-0.27, 0.27]) {
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.13, 0.86), dark, x, 0.075, 0));
    for (const z of [-0.36, 0.36]) g.add(mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.17, 10).rotateZ(Math.PI / 2), dark, x, 0.075, z));
  }
  g.add(mesh(new THREE.BoxGeometry(0.56, 0.1, 0.62), yellow, 0, 0.2, 0));
  g.add(mesh(new THREE.BoxGeometry(0.52, 0.2, 0.26), yellow, 0, 0.35, -0.2));                       // engine cover
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 6), dark, 0.18, 0.55, -0.24));             // exhaust
  g.add(mesh(new THREE.BoxGeometry(0.28, 0.36, 0.3), yellow, -0.13, 0.43, 0.08));                   // cab
  g.add(mesh(new THREE.BoxGeometry(0.24, 0.2, 0.31), M(0x2c4a66, { roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.75 }), -0.13, 0.47, 0.09));
  g.add(mesh(new THREE.BoxGeometry(0.3, 0.03, 0.34), dark, -0.13, 0.625, 0.08));
  const driver = new THREE.Group(); driver.name = 'driver'; driver.position.set(-0.13, 0.45, 0.06);
  driver.add(mesh(new THREE.SphereGeometry(0.07, 10, 8), mat(0xe8b98d), 0, 0.03, 0)); driver.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 12), mat(0x8a8f96), 0, 0.085, 0)); driver.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.06, 10), mat(0x8a8f96), 0, 0.12, 0));
  g.add(driver);
  const boom = new THREE.Group(); boom.name = 'boom'; boom.position.set(0.14, 0.3, 0.22); boom.rotation.x = -0.75;
  boom.add(mesh(new THREE.BoxGeometry(0.08, 0.08, 0.6), yellow, 0, 0, 0.3));
  const stick = new THREE.Group(); stick.name = 'stick'; stick.position.set(0, 0, 0.6); stick.rotation.x = 1.6;
  stick.add(mesh(new THREE.BoxGeometry(0.065, 0.065, 0.42), yellow, 0, 0, 0.21));
  stick.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.36, 6).rotateX(Math.PI / 2), steel, 0, 0.06, 0.12));
  const bucket = new THREE.Group(); bucket.name = 'bucket'; bucket.position.set(0, 0, 0.42); bucket.rotation.x = 0.5;
  bucket.add(mesh(new THREE.BoxGeometry(0.24, 0.16, 0.03), dark, 0, -0.06, -0.02)); bucket.add(mesh(new THREE.BoxGeometry(0.24, 0.03, 0.18), dark, 0, -0.14, 0.07));
  for (const x of [-0.12, 0.12]) bucket.add(mesh(new THREE.BoxGeometry(0.02, 0.16, 0.18), dark, x, -0.07, 0.07));
  const load = mesh(new THREE.SphereGeometry(0.11, 8, 6), M(FILL.paydirt, { roughness: 1 }), 0, -0.06, 0.07); load.scale.set(1, 0.7, 0.8); load.name = 'load'; load.visible = false; bucket.add(load);
  stick.add(bucket); boom.add(stick); g.add(boom);
  return g;
}
function trommel(): THREE.Group {
  const g = new THREE.Group(), steel = mat(0x7f8891, { metalness: 0.55, roughness: 0.5 }), dark = mat(0x3a3f45, { roughness: 0.8 }), green = mat(0x3f7a4a, { roughness: 0.6 });
  for (const [x, z, h] of [[-0.3, -0.36, 0.62], [0.3, -0.36, 0.62], [-0.3, 0.36, 0.44], [0.3, 0.36, 0.44]]) g.add(mesh(new THREE.BoxGeometry(0.05, h, 0.05), dark, x, h / 2, z));
  g.add(mesh(new THREE.BoxGeometry(0.66, 0.04, 0.8), dark, 0, 0.3, 0));
  const tilt = new THREE.Group(); tilt.position.set(0, 0.55, 0); tilt.rotation.x = Math.PI / 2 - 0.2;
  const drum = new THREE.Group(); drum.name = 'drum';
  drum.add(mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.8, 14, 1, true), mat(0x9aa3ad, { metalness: 0.5, roughness: 0.55, side: THREE.DoubleSide })));
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; drum.add(mesh(new THREE.BoxGeometry(0.03, 0.8, 0.03), dark, Math.cos(a) * 0.215, 0, Math.sin(a) * 0.215)); }
  for (const y of [-0.38, 0, 0.38]) drum.add(mesh(new THREE.TorusGeometry(0.215, 0.018, 6, 16).rotateX(Math.PI / 2), dark, 0, y, 0));
  tilt.add(drum); g.add(tilt);
  // hopper at the high end
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.14, 0.26, 4, 1, true).rotateY(Math.PI / 4), mat(0x7f8891, { metalness: 0.55, roughness: 0.5, side: THREE.DoubleSide }), 0, 0.92, -0.36));
  const load = mesh(new THREE.SphereGeometry(0.2, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), M(FILL.paydirt, { roughness: 1 }), 0, 0.93, -0.36); load.name = 'load'; load.visible = false; g.add(load);
  g.add(mesh(new THREE.BoxGeometry(0.2, 0.2, 0.26), green, 0.44, 0.42, -0.2));       // engine
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 6), dark, 0.44, 0.63, -0.26));
  g.add(mesh(new THREE.BoxGeometry(0.22, 0.03, 0.36).rotateX(0.5), steel, 0, 0.3, 0.5)); // discharge chute
  void steel;
  return g;
}
function pump(): THREE.Group {
  const g = new THREE.Group(), red = mat(0xc23b2a, { roughness: 0.55 }), dark = mat(0x2b2b2e), steel = mat(0x8a8f96, { metalness: 0.6, roughness: 0.4 });
  g.add(mesh(new THREE.BoxGeometry(0.46, 0.04, 0.34), dark, 0, 0.04, 0));
  g.add(mesh(new THREE.BoxGeometry(0.24, 0.22, 0.24), red, -0.08, 0.17, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 14).rotateZ(Math.PI / 2), steel, 0.14, 0.16, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 6), dark, -0.14, 0.36, -0.06));
  g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8).rotateX(Math.PI / 2 - 0.5), mat(0x1f3f2a), 0.14, 0.1, 0.22));
  return g;
}
function tank(): THREE.Group {
  const g = new THREE.Group(), body = mat(0xb5382c, { roughness: 0.5, metalness: 0.2 }), dark = mat(0x2b2b2e);
  for (const z of [-0.26, 0.26]) { g.add(mesh(new THREE.BoxGeometry(0.4, 0.2, 0.05), dark, 0, 0.1, z)); }
  g.add(mesh(new THREE.CapsuleGeometry(0.2, 0.5, 6, 16).rotateX(Math.PI / 2), body, 0, 0.36, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 10), dark, 0, 0.58, 0.1));
  g.add(mesh(new THREE.TorusGeometry(0.203, 0.012, 6, 20), mat(0xf2e6c8), 0, 0.36, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6), dark, 0.2, 0.2, 0.3));
  return g;
}

function driverHead(x: number, y: number, z: number): THREE.Group {
  const d = new THREE.Group(); d.name = 'driver'; d.position.set(x, y, z);
  d.add(mesh(new THREE.SphereGeometry(0.07, 10, 8), mat(0xe8b98d), 0, 0.03, 0)); d.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 12), mat(0x8a8f96), 0, 0.085, 0)); d.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.06, 10), mat(0x8a8f96), 0, 0.12, 0));
  return d;
}
function cab(color: number, x: number, y: number, z: number, w = 0.3, h = 0.34, d = 0.3): THREE.Group {
  const g = new THREE.Group(); g.position.set(x, y, z);
  g.add(mesh(new THREE.BoxGeometry(w, h, d), mat(color, { roughness: 0.55 })));
  g.add(mesh(new THREE.BoxGeometry(w * 0.86, h * 0.5, d * 1.03), M(0x2c4a66, { roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.75 }), 0, h * 0.14, 0.01));
  g.add(mesh(new THREE.BoxGeometry(w * 1.06, 0.03, d * 1.1), mat(0x2b2b2e), 0, h / 2 + 0.01, 0));
  g.add(driverHead(0, 0.02, 0));
  return g;
}
function wheels(g: THREE.Group, xs: number[], zs: number[], r = 0.12) {
  for (const x of xs) for (const z of zs) g.add(mesh(new THREE.CylinderGeometry(r, r, 0.1, 14).rotateZ(Math.PI / 2), mat(0x1e1e20, { roughness: 0.95 }), x, r, z));
}
function dozer(): THREE.Group {
  const g = new THREE.Group(), yellow = mat(0xe8a516, { roughness: 0.55 }), dark = mat(0x2b2b2e, { roughness: 0.9 }), steel = mat(0x9aa3ad, { metalness: 0.6, roughness: 0.45 });
  for (const x of [-0.3, 0.3]) { g.add(mesh(new THREE.BoxGeometry(0.18, 0.2, 1.0), dark, x, 0.11, 0)); for (const z of [-0.42, 0.42]) g.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.19, 10).rotateZ(Math.PI / 2), dark, x, 0.11, z)); }
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.26, 0.8), yellow, 0, 0.32, -0.02));
  g.add(mesh(new THREE.BoxGeometry(0.4, 0.14, 0.34), yellow, 0, 0.5, 0.2));
  g.add(cab(0xe8a516, 0, 0.62, -0.14, 0.34, 0.3, 0.3));
  g.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.26, 6), dark, 0.16, 0.7, 0.26));
  const blade = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.86, 12, 1, true, Math.PI * 0.75, Math.PI * 0.5).rotateZ(Math.PI / 2), mat(0x9aa3ad, { metalness: 0.6, roughness: 0.45, side: THREE.DoubleSide }), 0, 0.26, 0.42); g.add(blade);
  for (const x of [-0.3, 0.3]) g.add(mesh(new THREE.BoxGeometry(0.05, 0.06, 0.5), yellow, x, 0.2, 0.42));
  for (const x of [-0.16, 0, 0.16]) { const r = mesh(new THREE.BoxGeometry(0.04, 0.3, 0.06), steel, x, 0.16, -0.58); r.rotation.x = -0.4; g.add(r); }   // ripper
  g.add(mesh(new THREE.BoxGeometry(0.44, 0.06, 0.1), yellow, 0, 0.3, -0.5));
  return g;
}
function truck(fuel = false): THREE.Group {
  const g = new THREE.Group(), body = mat(fuel ? 0xc23b2a : 0xe8a516, { roughness: 0.55 }), dark = mat(0x2b2b2e, { roughness: 0.9 });
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.08, 1.3), dark, 0, 0.26, 0));
  wheels(g, [-0.27, 0.27], [0.45, -0.2, -0.47], 0.13);
  g.add(cab(fuel ? 0xc23b2a : 0xe8a516, 0, 0.5, 0.43, 0.46, 0.36, 0.3));
  g.add(mesh(new THREE.BoxGeometry(0.46, 0.14, 0.14), body, 0, 0.36, 0.63));
  if (fuel) {
    g.add(mesh(new THREE.CapsuleGeometry(0.22, 0.42, 6, 14).rotateX(Math.PI / 2), mat(0xd9d2c0, { roughness: 0.4, metalness: 0.3 }), 0, 0.55, -0.22));
    g.add(mesh(new THREE.TorusGeometry(0.223, 0.012, 6, 18), body, 0, 0.55, -0.22));
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10), dark, 0, 0.79, -0.22));
  } else {
    const bed = mat(0x8a8f96, { metalness: 0.5, roughness: 0.55 });
    g.add(mesh(new THREE.BoxGeometry(0.56, 0.04, 0.84), bed, 0, 0.33, -0.22));
    for (const x of [-0.27, 0.27]) g.add(mesh(new THREE.BoxGeometry(0.03, 0.26, 0.84), bed, x, 0.46, -0.22));
    g.add(mesh(new THREE.BoxGeometry(0.56, 0.3, 0.03), bed, 0, 0.48, 0.2)); g.add(mesh(new THREE.BoxGeometry(0.56, 0.22, 0.03), bed, 0, 0.44, -0.64));
    const load = mesh(new THREE.SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M(FILL.paydirt, { roughness: 1 }), 0, 0.5, -0.22); load.scale.set(0.82, 0.7, 1.25); load.name = 'load'; load.visible = false; g.add(load);
  }
  return g;
}
function washplant(): THREE.Group {
  const g = new THREE.Group(), steel = mat(0x7f8891, { metalness: 0.55, roughness: 0.5 }), dark = mat(0x3a3f45, { roughness: 0.8 }), blue = mat(0x2f6f9a, { roughness: 0.55 });
  for (const [x, z] of [[-0.34, -0.36], [0.34, -0.36], [-0.34, 0.2], [0.34, 0.2]]) g.add(mesh(new THREE.BoxGeometry(0.06, 0.8, 0.06), dark, x, 0.4, z));
  g.add(mesh(new THREE.BoxGeometry(0.76, 0.05, 0.66), dark, 0, 0.8, -0.08));
  g.add(mesh(new THREE.CylinderGeometry(0.42, 0.2, 0.34, 4, 1, true).rotateY(Math.PI / 4), mat(0x2f6f9a, { roughness: 0.55, side: THREE.DoubleSide }), 0, 1.02, -0.2));   // feed hopper
  const load = mesh(new THREE.SphereGeometry(0.28, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), M(FILL.paydirt, { roughness: 1 }), 0, 1.03, -0.2); load.name = 'load'; load.visible = false; g.add(load);
  const deck = new THREE.Group(); deck.name = 'deck'; deck.position.set(0, 0.62, 0.12); deck.rotation.x = 0.28;       // shaker screen
  deck.add(mesh(new THREE.BoxGeometry(0.62, 0.05, 0.8), steel)); for (const x of [-0.31, 0.31]) deck.add(mesh(new THREE.BoxGeometry(0.03, 0.14, 0.8), blue, x, 0.05, 0));
  g.add(deck);
  for (const x of [-0.2, 0.2]) {                                                                                          // twin sluice runs
    const run = new THREE.Group(); run.position.set(x, 0.3, 0.62); run.rotation.x = 0.2;
    run.add(mesh(new THREE.BoxGeometry(0.26, 0.03, 0.8), mat(0x8a5a2f))); run.add(mesh(new THREE.PlaneGeometry(0.22, 0.78).rotateX(-Math.PI / 2), M(0x6fc0d6, { roughness: 0.1, transparent: true, opacity: 0.7 }), 0, 0.03, 0));
    for (let i = 0; i < 5; i++) run.add(mesh(new THREE.BoxGeometry(0.22, 0.03, 0.02), dark, 0, 0.03, -0.3 + i * 0.15));
    g.add(run);
  }
  const belt = mesh(new THREE.BoxGeometry(0.2, 0.04, 1.0), dark, 0.62, 0.5, 0.1); belt.rotation.set(-0.5, 0.5, 0); g.add(belt);    // tailings stacker
  g.add(mesh(new THREE.ConeGeometry(0.28, 0.3, 8), M(0x8a8f96, { roughness: 1 }), 0.86, 0.15, 0.52));
  g.add(mesh(new THREE.BoxGeometry(0.24, 0.24, 0.3), mat(0x3f7a4a, { roughness: 0.6 }), -0.56, 0.3, -0.2)); g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), dark, -0.56, 0.56, -0.28));
  return g;
}
function crusher(): THREE.Group {
  const g = new THREE.Group(), steel = mat(0x7f8891, { metalness: 0.55, roughness: 0.5 }), dark = mat(0x3a3f45, { roughness: 0.8 }), orange = mat(0xd9772b, { roughness: 0.55 });
  for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) g.add(mesh(new THREE.BoxGeometry(0.07, 0.4, 0.07), dark, x, 0.2, z));
  g.add(mesh(new THREE.BoxGeometry(0.62, 0.42, 0.56), orange, 0, 0.6, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.4, 0.26, 0.26, 4, 1, true).rotateY(Math.PI / 4), mat(0x7f8891, { metalness: 0.55, roughness: 0.5, side: THREE.DoubleSide }), 0, 0.94, 0));
  const load = mesh(new THREE.DodecahedronGeometry(0.2, 0), M(0x8b8f96, { roughness: 1, flatShading: true }), 0, 0.96, 0); load.name = 'load'; load.visible = false; g.add(load);
  const fly = new THREE.Group(); fly.name = 'drum'; fly.position.set(0.36, 0.62, 0); fly.rotation.z = Math.PI / 2;
  fly.add(mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 18), dark)); fly.add(mesh(new THREE.BoxGeometry(0.4, 0.07, 0.05), steel));
  g.add(fly);
  const chute = mesh(new THREE.BoxGeometry(0.3, 0.04, 0.4), steel, 0, 0.3, 0.42); chute.rotation.x = 0.6; g.add(chute);
  return g;
}
function mill(): THREE.Group {
  const g = new THREE.Group(), dark = mat(0x3a3f45, { roughness: 0.8 }), teal = mat(0x2f8f86, { roughness: 0.5, metalness: 0.2 });
  for (const z of [-0.36, 0.36]) { g.add(mesh(new THREE.BoxGeometry(0.6, 0.3, 0.08), dark, 0, 0.15, z)); }
  const spin = new THREE.Group(); spin.position.set(0, 0.5, 0); spin.rotation.x = Math.PI / 2;
  const drum = new THREE.Group(); drum.name = 'drum';
  drum.add(mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.6, 18), teal));
  for (const y of [-0.31, 0.31]) drum.add(mesh(new THREE.CylinderGeometry(0.22, 0.33, 0.06, 18), teal, 0, y * 1.05, 0));
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; drum.add(mesh(new THREE.BoxGeometry(0.04, 0.6, 0.04), dark, Math.cos(a) * 0.335, 0, Math.sin(a) * 0.335)); }
  drum.add(mesh(new THREE.TorusGeometry(0.345, 0.03, 6, 22).rotateX(Math.PI / 2), mat(0x9aa3ad, { metalness: 0.6, roughness: 0.4 })));
  spin.add(drum); g.add(spin);
  g.add(mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), mat(0x3f7a4a, { roughness: 0.6 }), 0.46, 0.2, 0));
  return g;
}
function atv(): THREE.Group {
  const g = new THREE.Group(), green = mat(0x3f7a4a, { roughness: 0.5 }), dark = mat(0x2b2b2e);
  wheels(g, [-0.15, 0.15], [0.3, 0.02], 0.085); wheels(g, [-0.15, 0.15], [-0.44], 0.075);
  g.add(mesh(new THREE.BoxGeometry(0.2, 0.1, 0.44), green, 0, 0.17, 0.16)); g.add(mesh(new THREE.BoxGeometry(0.16, 0.05, 0.2), dark, 0, 0.24, 0.08));
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6).rotateZ(Math.PI / 2), dark, 0, 0.3, 0.3)); g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 6), dark, 0, 0.24, 0.3));
  g.add(mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 5).rotateX(Math.PI / 2), dark, 0, 0.12, -0.2));
  g.add(mesh(new THREE.BoxGeometry(0.36, 0.03, 0.36), dark, 0, 0.13, -0.44));
  for (const [x, z, w, d] of [[-0.17, -0.44, 0.02, 0.36], [0.17, -0.44, 0.02, 0.36], [0, -0.27, 0.36, 0.02], [0, -0.61, 0.36, 0.02]]) g.add(mesh(new THREE.BoxGeometry(w, 0.14, d), mat(0x8a5a2f), x, 0.21, z));
  const fill = mesh(new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M(FILL.paydirt, { roughness: 1 }), 0, 0.24, -0.44); fill.scale.set(0.95, 0.6, 0.95); fill.name = 'fill'; g.add(fill);
  return g;
}
function woodfence(): THREE.Group {
  const g = new THREE.Group(), w = mat(0x9a7446);
  for (const x of [-0.45, 0, 0.45]) g.add(mesh(new THREE.BoxGeometry(0.07, 0.62, 0.07), w, x, 0.31, 0));
  for (const y of [0.2, 0.42]) g.add(mesh(new THREE.BoxGeometry(1.0, 0.07, 0.035), w, 0, y, 0.04));
  for (let i = 0; i < 7; i++) g.add(mesh(new THREE.BoxGeometry(0.09, 0.6 + (i % 2) * 0.05, 0.02), mat(0xb08a58), -0.42 + i * 0.14, 0.33, 0.065));
  return g;
}
function chainfence(): THREE.Group {
  const g = new THREE.Group(), st = mat(0x9aa1a8, { metalness: 0.8, roughness: 0.4 });
  for (const x of [-0.48, 0.48]) g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8), st, x, 0.45, 0));
  for (const y of [0.06, 0.86]) { const r = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.96, 6), st, 0, y, 0); r.rotation.z = Math.PI / 2; g.add(r); }
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d')!;
  x.strokeStyle = '#c9d0d6'; x.lineWidth = 2.5; for (let i = -64; i < 128; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 64, 64); x.stroke(); x.beginPath(); x.moveTo(i + 64, 0); x.lineTo(i, 64); x.stroke(); }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(3, 2.6);
  g.add(mesh(new THREE.PlaneGeometry(0.96, 0.8), new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 }), 0, 0.46, 0));
  for (let i = 0; i < 3; i++) { const b = mesh(new THREE.TorusGeometry(0.06, 0.008, 4, 10), st, -0.3 + i * 0.3, 0.93, 0); b.rotation.y = Math.PI / 2; g.add(b); }  // razor coil
  return g;
}
function tower(): THREE.Group {
  const g = new THREE.Group(), w = mat(0x8a6238), dark = mat(0x5a4028);
  for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) { const l = mesh(new THREE.BoxGeometry(0.07, 1.5, 0.07), w, x, 0.75, z); l.rotation.set(z > 0 ? -0.05 : 0.05, 0, x > 0 ? 0.05 : -0.05); g.add(l); }
  for (const y of [0.45, 0.95]) for (const r of [0, Math.PI / 2]) { const b = mesh(new THREE.BoxGeometry(0.85, 0.045, 0.045), dark, 0, y, 0); b.rotation.set(0, r + Math.PI / 4, 0.5); g.add(b); }
  g.add(mesh(new THREE.BoxGeometry(0.9, 0.06, 0.9), w, 0, 1.5, 0));
  for (const [x, z, sx, sz] of [[0, 0.43, 0.9, 0.04], [0, -0.43, 0.9, 0.04], [0.43, 0, 0.04, 0.9], [-0.43, 0, 0.04, 0.9]]) g.add(mesh(new THREE.BoxGeometry(sx, 0.3, sz), dark, x, 1.68, z));
  for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) g.add(mesh(new THREE.BoxGeometry(0.05, 0.75, 0.05), w, x, 1.9, z));
  const roof = mesh(new THREE.ConeGeometry(0.78, 0.36, 4), mat(0x6e2f24), 0, 2.45, 0); roof.rotation.y = Math.PI / 4; g.add(roof);
  const lamp = mesh(new THREE.SphereGeometry(0.06, 8, 8), mat(0xfff2c2, { emissive: 0xffd27a, emissiveIntensity: 1.5 }), 0, 2.2, 0); g.add(lamp);
  const watch = makeMiner('guard'); watch.group.scale.setScalar(0.8); watch.group.position.set(0, 1.53, 0); watch.tools.rifle.visible = true; watch.armR.rotation.x = -0.9; watch.elbowR.rotation.x = -0.9; g.add(watch.group);
  return g;
}
function armory(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(1.7, 0.9, 1.5), mat(0x6f7480, { metalness: 0.5, roughness: 0.6 }), 0, 0.45, 0));
  const roof = mesh(new THREE.CylinderGeometry(0.78, 0.78, 1.72, 14, 1, false, 0, Math.PI), mat(0x4c525c, { metalness: 0.6, roughness: 0.5 }), 0, 0.88, 0); roof.rotation.set(0, 0, Math.PI / 2); roof.rotation.y = Math.PI / 2; roof.scale.set(1, 1, 0.5); g.add(roof);
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.65, 0.04), mat(0x2b2d31), 0, 0.33, 0.76), mesh(new THREE.BoxGeometry(0.3, 0.2, 0.03), mat(0xf2c14e, { metalness: 0.7, roughness: 0.35 }), 0.55, 0.6, 0.76));
  for (const x of [-0.6, -0.45]) g.add(mesh(new THREE.BoxGeometry(0.1, 0.5, 0.3), mat(0x5f7d48), x, 0.25, 0.92));   // crates by the door
  return g;
}

// Machines are scaled to the ground they cover: the widest side of each model
// spans its footprint, so a mining excavator really does dwarf a mini.
const BUILD: Record<string, () => THREE.Group> = {
  bucket, barrow, atv, sieve, pan, sluice, excavator, excavator2: excavator, excavator3: excavator, excavator4: excavator, dozer, truck: () => truck(false), fueltruck: () => truck(true),
  trommel, washplant, crusher, mill, pump, tank, tank2: tank, tank3: tank, woodfence, chainfence, tower, armory,
};
const FILL_SHARE: Record<string, number> = { excavator: 1.35, excavator2: 1.2, excavator3: 1.15, excavator4: 1.1, dozer: 0.98, truck: 0.98, fueltruck: 0.98, tank: 0.8, pump: 0.7, trommel: 0.98 };
const NO_FIT = new Set(['bucket', 'barrow', 'atv', 'sieve', 'pan', 'sluice', 'woodfence', 'chainfence', 'tower', 'armory']);

export function makeItem(kind: string): THREE.Group {
  const inner = (BUILD[kind] ?? sluice)();
  const g = new THREE.Group(); g.add(inner);
  if (!NO_FIT.has(kind)) {
    const [w, h] = footprint(kind), size = new THREE.Box3().setFromObject(inner).getSize(new THREE.Vector3());
    const long = Math.max(w, h), short = Math.min(w, h), mLong = Math.max(size.x, size.z), mShort = Math.min(size.x, size.z);
    inner.scale.setScalar(Math.min(long / mLong, short / mShort * 1.25) * (FILL_SHARE[kind] ?? 0.94));
    // Lay the long side of the model along the long side of the footprint.
    if (!(kind in VEHICLES) && (size.x >= size.z) !== (w >= h)) inner.rotation.y = Math.PI / 2;
  }
  g.userData.kind = kind;
  return g;
}
export function setContents(g: THREE.Group, contents: string) {
  const fill = g.getObjectByName('fill') as THREE.Mesh | undefined; if (!fill) return;
  fill.visible = contents !== 'empty';
  if (fill.visible) (fill.material as THREE.MeshStandardMaterial).color.setHex(FILL[contents as 'paydirt' | 'fines']);
}

function drillIcon(): THREE.Group {
  const g = new THREE.Group(), dark = mat(0x3a3f45), red = mat(0xc23b2a, { roughness: 0.5 });
  for (const a of [0, 2.1, 4.2]) { const leg = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), dark, Math.cos(a) * 0.18, 0.42, Math.sin(a) * 0.18); leg.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4); g.add(leg); }
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.012, 0.8, 8), mat(0x9aa3ad, { metalness: 0.7, roughness: 0.3 }), 0, 0.4, 0)); g.add(mesh(new THREE.BoxGeometry(0.16, 0.14, 0.16), red, 0, 0.84, 0));
  return g;
}

export function makeFlag(color: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 5), mat(0x4a3320), 0, 0.3, 0));
  const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(0.26, -0.09); shape.lineTo(0, -0.18);
  const p = mesh(new THREE.ShapeGeometry(shape), M(color, { side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.35, roughness: 0.6 }), 0.012, 0.6, 0); p.name = 'pennant'; g.add(p);
  return g;
}

/** Render models to small PNGs for the HUD (store cards, selection panel). */
export function renderIcons(): Record<string, string> {
  const out: Record<string, string> = {};
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(128, 128); r.setPixelRatio(1); r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a5a, 2.2));
  const d = new THREE.DirectionalLight(0xfff1d6, 3); d.position.set(2, 4, 3); scene.add(d);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  const shot = (key: string, obj: THREE.Object3D) => {
    scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
    cam.position.set(c.x + size * 1.0, c.y + size * 0.75, c.z + size * 1.25); cam.lookAt(c);
    r.render(scene, cam); out[key] = r.domElement.toDataURL('image/png'); scene.remove(obj);
  };
  for (const kind of ['bucket', 'barrow', 'atv']) for (const c of ['empty', 'paydirt', 'fines']) { const g = makeItem(kind); setContents(g, c); shot(`${kind}_${c}`, g); }
  for (const kind of Object.keys(BUILD)) if (!(kind in out) && !['bucket', 'barrow', 'atv'].includes(kind)) shot(kind, makeItem(kind));
  shot('drill', drillIcon());
  for (const v of ['boss', 0, 1, 2, 'guard', 'bandit', 'thief'] as const) { const m = makeMiner(v); if (v === 'guard') m.tools.rifle.visible = true; shot('miner_' + v, m.group); }
  r.dispose(); r.forceContextLoss();
  return out;
}
