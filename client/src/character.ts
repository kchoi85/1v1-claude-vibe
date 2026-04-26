import * as THREE from 'three';
import type { PlayerClass } from './types.js';

export interface Character {
  group: THREE.Group;
  head: THREE.Group;
  weapon: THREE.Group;
  rightArm: THREE.Mesh;
}

export function makeCharacter(bodyColor: number, className: PlayerClass = 'gi'): Character {
  const group = new THREE.Group();

  const skin = 0xffd9b3;
  const dark = 0x222a33;

  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.7, 4, 8),
    new THREE.MeshStandardMaterial({ color: bodyColor }),
  );
  torso.position.y = 1.05;
  torso.castShadow = true;
  group.add(torso);

  const armGeo = new THREE.CapsuleGeometry(0.1, 0.5, 4, 8);
  const armMat = new THREE.MeshStandardMaterial({ color: bodyColor });
  const lArm = new THREE.Mesh(armGeo, armMat);
  lArm.position.set(-0.42, 1.15, 0);
  lArm.castShadow = true;
  group.add(lArm);
  const rArm = new THREE.Mesh(armGeo, armMat);
  rArm.position.set(0.42, 1.15, 0);
  rArm.castShadow = true;
  group.add(rArm);

  const legGeo = new THREE.CapsuleGeometry(0.13, 0.55, 4, 8);
  const legMat = new THREE.MeshStandardMaterial({ color: dark });
  const lLeg = new THREE.Mesh(legGeo, legMat);
  lLeg.position.set(-0.17, 0.4, 0);
  lLeg.castShadow = true;
  group.add(lLeg);
  const rLeg = new THREE.Mesh(legGeo, legMat);
  rLeg.position.set(0.17, 0.4, 0);
  rLeg.castShadow = true;
  group.add(rLeg);

  // Head pivots at the neck so pitch is applied around a sensible point.
  const head = new THREE.Group();
  head.position.y = 1.5;
  group.add(head);

  const skull = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 16, 16),
    new THREE.MeshStandardMaterial({ color: skin }),
  );
  skull.position.y = 0.2;
  skull.castShadow = true;
  head.add(skull);

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.09, 0.06),
    new THREE.MeshStandardMaterial({
      color: 0x111820,
      emissive: 0x335577,
      emissiveIntensity: 0.6,
    }),
  );
  // Visor faces -Z so the model's forward matches the Three.js camera convention
  // (camera looks down -Z). Without this, body yaw and head pitch render mirrored.
  visor.position.set(0, 0.23, -0.18);
  head.add(visor);

  const weapon = makeWeapon(className);
  weapon.position.set(0.46, 1.08, -0.28);
  weapon.rotation.set(0.08, -0.2, -0.12);
  group.add(weapon);

  return { group, head, weapon, rightArm: rArm };
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
    if (obj instanceof THREE.Mesh) obj.castShadow = true;
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
    if (obj instanceof THREE.Mesh) obj.castShadow = true;
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
    if (obj instanceof THREE.Mesh) obj.castShadow = true;
  });
  return dagger;
}
