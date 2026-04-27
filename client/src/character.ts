import * as THREE from 'three';
import type { PlayerClass } from './types.js';

export interface Character {
  group: THREE.Group;
  head: THREE.Group;
  weapon: THREE.Group;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
}

export function makeCharacter(bodyColor: number, className: PlayerClass = 'gi'): Character {
  const group = new THREE.Group();

  const style = CLASS_STYLE[className];
  const skin = 0xffd9b3;
  const softBlack = 0x1f2730;

  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.34, className === 'mage' ? 0.58 : 0.5, 6, 14),
    makeMat(style.body),
  );
  torso.position.y = 1.0;
  torso.castShadow = true;
  group.add(torso);

  const tummy = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), makeMat(style.belly));
  tummy.position.set(0, 0.96, -0.19);
  tummy.scale.set(1.05, 0.85, 0.35);
  tummy.castShadow = true;
  group.add(tummy);

  const armGeo = new THREE.CapsuleGeometry(0.105, 0.45, 5, 10);
  const armMat = makeMat(style.accent);
  const lArm = new THREE.Mesh(armGeo, armMat);
  lArm.position.set(-0.42, 1.08, -0.02);
  lArm.rotation.z = 0.18;
  lArm.castShadow = true;
  group.add(lArm);
  const rArm = new THREE.Mesh(armGeo, armMat);
  rArm.position.set(0.42, 1.08, -0.02);
  rArm.rotation.z = -0.18;
  rArm.castShadow = true;
  group.add(rArm);

  const handGeo = new THREE.SphereGeometry(0.11, 12, 10);
  const lHand = new THREE.Mesh(handGeo, makeMat(skin));
  lHand.position.set(-0.45, 0.78, -0.03);
  lHand.castShadow = true;
  group.add(lHand);
  const rHand = new THREE.Mesh(handGeo, makeMat(skin));
  rHand.position.set(0.45, 0.78, -0.03);
  rHand.castShadow = true;
  group.add(rHand);

  const legGeo = new THREE.CapsuleGeometry(0.13, 0.42, 5, 10);
  const legMat = makeMat(className === 'mage' ? style.bodyDark : softBlack);
  const lLeg = new THREE.Mesh(legGeo, legMat);
  lLeg.position.set(-0.16, 0.36, 0);
  lLeg.castShadow = true;
  group.add(lLeg);
  const rLeg = new THREE.Mesh(legGeo, legMat);
  rLeg.position.set(0.16, 0.36, 0);
  rLeg.castShadow = true;
  group.add(rLeg);

  const head = new THREE.Group();
  head.position.y = 1.43;
  group.add(head);

  const skull = new THREE.Mesh(
    new THREE.SphereGeometry(0.255, 20, 18),
    makeMat(className === 'assassin' ? style.hood : skin),
  );
  skull.position.y = 0.2;
  skull.castShadow = true;
  head.add(skull);

  if (className === 'assassin') {
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.205, 18, 14), makeMat(skin));
    face.position.set(0, 0.18, -0.07);
    face.scale.set(0.86, 0.86, 0.5);
    face.castShadow = true;
    head.add(face);
  }

  addCuteFace(head, className === 'assassin' ? 0.235 : 0.22);
  addClassDetails(group, head, className, bodyColor);

  const weapon = makeWeapon(className);
  weapon.position.set(0.46, 1.08, -0.28);
  weapon.rotation.set(0.08, -0.2, -0.12);
  group.add(weapon);

  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  return { group, head, weapon, leftArm: lArm, rightArm: rArm, leftLeg: lLeg, rightLeg: rLeg };
}

const CLASS_STYLE: Record<
  PlayerClass,
  { body: number; bodyDark: number; belly: number; accent: number; hood: number }
> = {
  gi: { body: 0x8acb88, bodyDark: 0x4f7f61, belly: 0xd5f3c4, accent: 0x5aa476, hood: 0x49645b },
  mage: { body: 0x8b73ff, bodyDark: 0x5845b8, belly: 0xf0d8ff, accent: 0xffb7e6, hood: 0x6751db },
  assassin: {
    body: 0x3d4356,
    bodyDark: 0x242938,
    belly: 0x69718c,
    accent: 0xff8fb1,
    hood: 0x2f3548,
  },
};

function makeMat(
  color: number,
  options: {
    metalness?: number;
    roughness?: number;
    emissive?: number;
    emissiveIntensity?: number;
  } = {},
) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.58,
    metalness: options.metalness ?? 0.05,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
  });
}

function addCuteFace(head: THREE.Group, z: number) {
  const eyeMat = makeMat(0x18212b, { roughness: 0.3 });
  const cheekMat = makeMat(0xff9fb6, { emissive: 0x3a0b16, emissiveIntensity: 0.2 });

  for (const x of [-0.085, 0.085]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), eyeMat);
    eye.position.set(x, 0.245, -z);
    eye.scale.set(0.75, 1.25, 0.35);
    head.add(eye);

    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), cheekMat);
    cheek.position.set(x * 1.7, 0.18, -z + 0.012);
    cheek.scale.set(1.15, 0.55, 0.25);
    head.add(cheek);
  }

  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.005, 6, 14, Math.PI), eyeMat);
  smile.position.set(0, 0.16, -z + 0.018);
  smile.rotation.set(Math.PI, 0, 0);
  head.add(smile);
}

function addClassDetails(
  group: THREE.Group,
  head: THREE.Group,
  className: PlayerClass,
  bodyColor: number,
) {
  if (className === 'gi') {
    addGiDetails(group, head, bodyColor);
    return;
  }
  if (className === 'mage') {
    addMageDetails(group, head);
    return;
  }
  addAssassinDetails(group, head);
}

function addGiDetails(group: THREE.Group, head: THREE.Group, bodyColor: number) {
  const helmetMat = makeMat(0x59755f, { roughness: 0.72 });
  const stripeMat = makeMat(bodyColor);
  const packMat = makeMat(0x35433a);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.268, 18, 10), helmetMat);
  helmet.position.y = 0.28;
  helmet.scale.set(1.06, 0.5, 1.02);
  helmet.castShadow = true;
  head.add(helmet);

  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.045, 0.14), helmetMat);
  brim.position.set(0, 0.22, -0.22);
  brim.castShadow = true;
  head.add(brim);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.035, 0.22), stripeMat);
  stripe.position.set(0, 0.33, -0.18);
  stripe.castShadow = true;
  head.add(stripe);

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.48, 0.14), packMat);
  backpack.position.set(0, 1.02, 0.3);
  backpack.castShadow = true;
  group.add(backpack);

  for (const x of [-0.24, 0.24]) {
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), helmetMat);
    pad.position.set(x, 1.33, -0.02);
    pad.scale.set(1.2, 0.55, 0.85);
    pad.castShadow = true;
    group.add(pad);
  }
}

function addMageDetails(group: THREE.Group, head: THREE.Group) {
  const hatMat = makeMat(0x6b56db, { roughness: 0.62 });
  const brimMat = makeMat(0xffd76d, { metalness: 0.1, roughness: 0.4 });
  const glowMat = makeMat(0x8df5ff, { emissive: 0x67dfff, emissiveIntensity: 1.1 });

  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.88, 18), makeMat(0x7357d6));
  robe.position.y = 0.82;
  robe.castShadow = true;
  group.add(robe);

  const brim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.035, 8, 24), brimMat);
  brim.position.set(0, 0.42, 0);
  brim.scale.set(1.08, 0.7, 1);
  brim.castShadow = true;
  head.add(brim);

  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.48, 18), hatMat);
  hat.position.set(0.02, 0.65, 0);
  hat.rotation.z = -0.22;
  hat.castShadow = true;
  head.add(hat);

  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), glowMat);
  pom.position.set(-0.035, 0.9, -0.03);
  head.add(pom);

  for (const x of [-0.2, 0.2]) {
    const sparkle = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), glowMat);
    sparkle.position.set(x, 1.18, -0.3);
    group.add(sparkle);
  }
}

function addAssassinDetails(group: THREE.Group, head: THREE.Group) {
  const hoodMat = makeMat(0x242938, { roughness: 0.75 });
  const scarfMat = makeMat(0xff8fb1, { roughness: 0.66 });
  const capeMat = makeMat(0x1d2130, { roughness: 0.7 });

  const hoodPeak = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.22, 4), hoodMat);
  hoodPeak.position.set(0, 0.45, -0.05);
  hoodPeak.rotation.y = Math.PI / 4;
  hoodPeak.castShadow = true;
  head.add(hoodPeak);

  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 8, 20), scarfMat);
  scarf.position.set(0, 1.35, -0.01);
  scarf.scale.set(1, 0.45, 0.9);
  scarf.castShadow = true;
  group.add(scarf);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.055), scarfMat);
  tail.position.set(0.25, 1.15, 0.03);
  tail.rotation.z = -0.45;
  tail.castShadow = true;
  group.add(tail);

  const cape = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.78, 0.045), capeMat);
  cape.position.set(0, 0.9, 0.29);
  cape.rotation.x = -0.08;
  cape.castShadow = true;
  group.add(cape);
}

export function makeWeapon(className: PlayerClass): THREE.Group {
  if (className === 'mage') return makeWand();
  if (className === 'assassin') return makeDagger();
  return makeGun();
}

function makeGun(): THREE.Group {
  const gun = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({
    color: 0x1a2430,
    roughness: 0.55,
    metalness: 0.35,
  });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x111416, roughness: 0.7 });
  const barrelMat = new THREE.MeshStandardMaterial({
    color: 0x56606a,
    roughness: 0.35,
    metalness: 0.55,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.56), metal);
  body.position.z = -0.16;
  gun.add(body);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.58, 12), barrelMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.58);
  gun.add(barrel);

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.24), metal);
  stock.position.set(0, 0.02, 0.24);
  gun.add(stock);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, 0.12), gripMat);
  grip.position.set(0, -0.18, 0.03);
  grip.rotation.x = -0.25;
  gun.add(grip);

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.28, 0.14), gripMat);
  mag.name = 'magazine';
  mag.position.set(0, -0.2, -0.17);
  mag.rotation.x = 0.08;
  gun.add(mag);

  gun.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  return gun;
}

function makeWand(): THREE.Group {
  const wand = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a341d, roughness: 0.75 });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xcaa85c,
    metalness: 0.35,
    roughness: 0.35,
  });
  const orb = new THREE.MeshStandardMaterial({
    color: 0x7be7ff,
    emissive: 0x4ecfff,
    emissiveIntensity: 1.5,
    transparent: true,
    opacity: 0.9,
  });

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.82, 10), wood);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -0.22;
  wand.add(shaft);

  const band = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.01, 8, 18), gold);
  band.position.z = -0.66;
  wand.add(band);

  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.095, 18, 18), orb);
  glow.position.z = -0.74;
  wand.add(glow);

  const light = new THREE.PointLight(0x7be7ff, 0.45, 2);
  light.position.z = -0.74;
  wand.add(light);

  wand.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  return wand;
}

function makeDagger(): THREE.Group {
  const dagger = new THREE.Group();
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xcfd8df,
    metalness: 0.65,
    roughness: 0.25,
  });
  const handleMat = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.65 });
  const guardMat = new THREE.MeshStandardMaterial({
    color: 0x8d7f5b,
    metalness: 0.45,
    roughness: 0.3,
  });

  const blade = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.52, 4), bladeMat);
  blade.rotation.x = -Math.PI / 2;
  blade.position.z = -0.36;
  dagger.add(blade);

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.3, 10), handleMat);
  handle.rotation.x = Math.PI / 2;
  handle.position.z = -0.02;
  dagger.add(handle);

  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.055, 0.055), guardMat);
  guard.position.z = -0.19;
  dagger.add(guard);

  dagger.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  return dagger;
}
