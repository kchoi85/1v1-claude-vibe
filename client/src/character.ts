import * as THREE from 'three';

export interface Character {
  group: THREE.Group;
  head: THREE.Group;
}

export function makeCharacter(bodyColor: number): Character {
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
  visor.position.set(0, 0.23, 0.18);
  head.add(visor);

  return { group, head };
}
