import * as THREE from 'three';

type Bounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

type CoverKind = 'crate' | 'van' | 'billboard';

type CoverSpec = {
  kind: CoverKind;
  x: number;
  z: number;
  rot: number;
  color: number;
};

export type Arena = {
  bounds: Bounds;
  collisionBoxes: THREE.Box3[];
};

const ARENA_HALF = 18;
const WALL_HEIGHT = 2.2;
const WALL_THICKNESS = 0.8;
const COVER_SEED = 311203;

export function buildArena(scene: THREE.Scene): Arena {
  const collisionBoxes: THREE.Box3[] = [];
  const bounds = {
    minX: -ARENA_HALF,
    maxX: ARENA_HALF,
    minZ: -ARENA_HALF,
    maxZ: ARENA_HALF,
  };

  addGround(scene);
  addOuterWalls(scene, collisionBoxes);
  addRoadDetails(scene);
  addGeneratedCover(scene, collisionBoxes);

  return { bounds, collisionBoxes };
}

function addGround(scene: THREE.Scene) {
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2),
    new THREE.MeshStandardMaterial({ color: 0x8acb88, roughness: 0.85 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);

  const river = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, ARENA_HALF * 2),
    new THREE.MeshStandardMaterial({
      color: 0x4fc3e8,
      emissive: 0x15526a,
      emissiveIntensity: 0.18,
      roughness: 0.4,
    }),
  );
  river.rotation.x = -Math.PI / 2;
  river.position.set(-13.4, 0.012, 0);
  river.receiveShadow = true;
  scene.add(river);

  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xf4d6e8, roughness: 0.82 });
  for (const x of [-10.8, -16.0]) {
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(0.55, ARENA_HALF * 2), sidewalkMat);
    walk.rotation.x = -Math.PI / 2;
    walk.position.set(x, 0.018, 0);
    walk.receiveShadow = true;
    scene.add(walk);
  }

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(6.8, ARENA_HALF * 2),
    new THREE.MeshStandardMaterial({ color: 0x50606d, roughness: 0.9 }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.02;
  road.receiveShadow = true;
  scene.add(road);
}

function addOuterWalls(scene: THREE.Scene, boxes: THREE.Box3[]) {
  const colors = [0xff9fb6, 0x7fd8be, 0xffd166, 0xa7c7ff];
  addBlock(scene, boxes, 0, -ARENA_HALF, ARENA_HALF * 2, WALL_THICKNESS, WALL_HEIGHT, colors[0]);
  addBlock(scene, boxes, 0, ARENA_HALF, ARENA_HALF * 2, WALL_THICKNESS, WALL_HEIGHT, colors[1]);
  addBlock(scene, boxes, -ARENA_HALF, 0, WALL_THICKNESS, ARENA_HALF * 2, WALL_HEIGHT, colors[2]);
  addBlock(scene, boxes, ARENA_HALF, 0, WALL_THICKNESS, ARENA_HALF * 2, WALL_HEIGHT, colors[3]);

  for (const [x, z] of [
    [-ARENA_HALF, -ARENA_HALF],
    [ARENA_HALF, -ARENA_HALF],
    [-ARENA_HALF, ARENA_HALF],
    [ARENA_HALF, ARENA_HALF],
  ]) {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }),
    );
    cap.position.set(x, WALL_HEIGHT + 0.15, z);
    cap.castShadow = true;
    scene.add(cap);
  }
}

function addRoadDetails(scene: THREE.Scene) {
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xffef8a, roughness: 0.45 });
  for (let z = -14; z <= 14; z += 4) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 1.6), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.035, z);
    scene.add(line);
  }

  const plankMat = new THREE.MeshStandardMaterial({ color: 0xa96f45, roughness: 0.75 });
  for (let z = -2.4; z <= 2.4; z += 0.8) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.12, 0.32), plankMat);
    plank.position.set(-13.4, 0.09, z);
    plank.castShadow = true;
    plank.receiveShadow = true;
    scene.add(plank);
  }

  const crosswalkMat = new THREE.MeshStandardMaterial({ color: 0xf4f7ed, roughness: 0.6 });
  for (const x of [-2.4, -1.6, -0.8, 0, 0.8, 1.6, 2.4]) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 3.3), crosswalkMat);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(x, 0.04, -8.2);
    scene.add(stripe);
  }
}

function addGeneratedCover(scene: THREE.Scene, boxes: THREE.Box3[]) {
  const rng = seededRandom(COVER_SEED);
  const specs: CoverSpec[] = [];
  const palette = [0xff6f91, 0x58c7df, 0xffc857, 0x95d475, 0xb692f6, 0xff9f68];

  for (let i = 0; specs.length < 12 && i < 140; i++) {
    const mirrored = specs.length % 2 === 1;
    const base = specs[specs.length - 1];
    if (mirrored && base) {
      specs.push({ ...base, z: -base.z, rot: -base.rot });
      continue;
    }

    const kind = pickCoverKind(rng());
    const x = snap(rng() * 26 - 11, 1.5);
    const z = snap(3.5 + rng() * 10, 1.5);
    const rot = rng() > 0.5 ? Math.PI / 2 : 0;
    const color = palette[Math.floor(rng() * palette.length)];
    const spec = { kind, x, z, rot, color };
    if (isCoverClear(spec, specs)) specs.push(spec);
  }

  specs.push(
    { kind: 'billboard', x: -5.5, z: 0, rot: Math.PI / 2, color: 0xffc857 },
    { kind: 'billboard', x: 5.5, z: 0, rot: Math.PI / 2, color: 0x58c7df },
  );

  for (const spec of specs) {
    if (spec.kind === 'van') addVan(scene, boxes, spec);
    if (spec.kind === 'crate') addCrates(scene, boxes, spec);
    if (spec.kind === 'billboard') addBillboard(scene, boxes, spec);
  }
}

function pickCoverKind(value: number): CoverKind {
  if (value < 0.34) return 'van';
  if (value < 0.7) return 'crate';
  return 'billboard';
}

function isCoverClear(next: CoverSpec, existing: CoverSpec[]) {
  const nextBox = coverBounds(next).expandByScalar(1.2);
  const spawnPads = [
    new THREE.Box3(new THREE.Vector3(-4, 0, -17), new THREE.Vector3(4, 2, -11)),
    new THREE.Box3(new THREE.Vector3(-4, 0, 11), new THREE.Vector3(4, 2, 17)),
  ];
  if (spawnPads.some((pad) => pad.intersectsBox(nextBox))) return false;
  return existing.every((spec) => !coverBounds(spec).expandByScalar(1.0).intersectsBox(nextBox));
}

function coverBounds(spec: CoverSpec) {
  const size = coverSize(spec);
  return new THREE.Box3(
    new THREE.Vector3(spec.x - size.w / 2, 0, spec.z - size.d / 2),
    new THREE.Vector3(spec.x + size.w / 2, size.h, spec.z + size.d / 2),
  );
}

function coverSize(spec: CoverSpec) {
  const turned = Math.abs(Math.sin(spec.rot)) > 0.5;
  if (spec.kind === 'van')
    return turned ? { w: 1.8, d: 3.35, h: 2.15 } : { w: 3.35, d: 1.8, h: 2.15 };
  if (spec.kind === 'crate') return { w: 2.25, d: 1.6, h: 2.2 };
  return turned ? { w: 0.95, d: 4.1, h: 2.25 } : { w: 4.1, d: 0.95, h: 2.25 };
}

function addVan(scene: THREE.Scene, boxes: THREE.Box3[], spec: CoverSpec) {
  const bodyMat = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.55 });
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0xf5fbff,
    roughness: 0.35,
    metalness: 0.05,
  });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.8 });
  const van = new THREE.Group();

  const body = new THREE.Mesh(new THREE.BoxGeometry(3.05, 1.35, 1.48), bodyMat);
  body.position.y = 0.92;
  body.castShadow = true;
  body.receiveShadow = true;
  van.add(body);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 1.18), roofMat);
  roof.position.set(-0.25, 1.75, 0);
  roof.castShadow = true;
  van.add(roof);

  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.22, 0.12),
    new THREE.MeshStandardMaterial({ color: 0xfff1a8, roughness: 0.4 }),
  );
  sign.position.set(0.35, 1.72, -0.78);
  sign.castShadow = true;
  van.add(sign);

  for (const x of [-0.95, 0.95]) {
    for (const z of [-0.73, 0.73]) {
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.18, 12), tireMat);
      tire.rotation.x = Math.PI / 2;
      tire.position.set(x, 0.26, z);
      tire.castShadow = true;
      van.add(tire);
    }
  }

  van.position.set(spec.x, 0, spec.z);
  van.rotation.y = spec.rot;
  scene.add(van);
  boxes.push(coverBounds(spec));
}

function addCrates(scene: THREE.Scene, boxes: THREE.Box3[], spec: CoverSpec) {
  const crateMat = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.78 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x7a5c42, roughness: 0.7 });
  const stack = new THREE.Group();

  const positions = [
    [-0.48, 0.34, 0],
    [0.48, 0.34, 0],
    [-0.48, 1.02, -0.08],
    [0.48, 1.02, 0.08],
    [0, 1.7, 0],
  ];
  for (const [x, y, z] of positions) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.68, 0.82), crateMat);
    crate.position.set(x, y, z);
    crate.castShadow = true;
    crate.receiveShadow = true;
    stack.add(crate);

    const band = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.9), trimMat);
    band.position.set(x, y + 0.02, z);
    band.castShadow = true;
    stack.add(band);
  }

  stack.position.set(spec.x, 0, spec.z);
  stack.rotation.y = spec.rot;
  scene.add(stack);
  boxes.push(coverBounds(spec));
}

function addBillboard(scene: THREE.Scene, boxes: THREE.Box3[], spec: CoverSpec) {
  const railMat = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.6 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0xf7f0ff, roughness: 0.48 });
  const billboard = new THREE.Group();

  const panel = new THREE.Mesh(new THREE.BoxGeometry(3.65, 1.1, 0.2), panelMat);
  panel.position.y = 1.45;
  panel.castShadow = true;
  panel.receiveShadow = true;
  billboard.add(panel);

  for (const y of [0.55, 2.05]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.18, 0.2), railMat);
    rail.position.y = y;
    rail.castShadow = true;
    rail.receiveShadow = true;
    billboard.add(rail);
  }
  for (const x of [-1.5, 1.5]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.25, 0.22), postMat);
    post.position.set(x, 1.12, 0);
    post.castShadow = true;
    post.receiveShadow = true;
    billboard.add(post);
  }

  const heart = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 10),
    new THREE.MeshStandardMaterial({
      color: spec.color,
      emissive: spec.color,
      emissiveIntensity: 0.15,
    }),
  );
  heart.position.set(0, 1.47, -0.14);
  heart.scale.set(1.3, 0.9, 0.28);
  billboard.add(heart);

  billboard.position.set(spec.x, 0, spec.z);
  billboard.rotation.y = spec.rot;
  scene.add(billboard);
  boxes.push(coverBounds(spec));
}

function addBlock(
  scene: THREE.Scene,
  boxes: THREE.Box3[],
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  color: number,
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.65 }),
  );
  mesh.position.set(x, h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  boxes.push(
    new THREE.Box3(
      new THREE.Vector3(x - w / 2, 0, z - d / 2),
      new THREE.Vector3(x + w / 2, h, z + d / 2),
    ),
  );
}

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function snap(value: number, step: number) {
  return Math.round(value / step) * step;
}
