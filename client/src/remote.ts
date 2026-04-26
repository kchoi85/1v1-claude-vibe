import * as THREE from 'three';
import { makeCharacter, type Character } from './character.js';
import type { AttackKind, PlayerClass, PlayerState } from './types.js';

type Remote = {
  char: Character;
  className: PlayerClass;
  target: {
    x: number;
    y: number;
    z: number;
    ry: number;
    rx: number;
    lean: number;
    crouch: boolean;
  };
  attackAnim: { kind: AttackKind; time: number } | null;
};

const STAND_SCALE = 1;
const CROUCH_SCALE = 0.65;
const WEAPON_BASE_POS = new THREE.Vector3(0.46, 1.08, -0.28);
const WEAPON_BASE_ROT = new THREE.Euler(0.08, -0.2, -0.12);

export class RemotePlayers {
  private remotes = new Map<string, Remote>();

  constructor(private scene: THREE.Scene) {}

  sync(myId: string, players: PlayerState[]) {
    const seen = new Set<string>();
    for (const p of players) {
      if (p.id === myId) continue;
      seen.add(p.id);
      let r = this.remotes.get(p.id);
      if (r && r.className !== p.className) {
        this.scene.remove(r.char.group);
        this.remotes.delete(p.id);
        r = undefined;
      }
      if (!r) {
        const char = makeCharacter(0xff5544, p.className);
        this.scene.add(char.group);
        r = {
          char,
          className: p.className,
          target: {
            x: p.px,
            y: p.py,
            z: p.pz,
            ry: p.ry,
            rx: p.rx,
            lean: p.lean,
            crouch: p.crouch,
          },
          attackAnim: null,
        };
        this.remotes.set(p.id, r);
      }
      r.target.x = p.px;
      r.target.y = p.py;
      r.target.z = p.pz;
      r.target.ry = p.ry;
      r.target.rx = p.rx;
      r.target.lean = p.lean;
      r.target.crouch = p.crouch;
    }
    for (const [id, r] of this.remotes) {
      if (!seen.has(id)) {
        this.scene.remove(r.char.group);
        this.remotes.delete(id);
      }
    }
  }

  remove(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.scene.remove(r.char.group);
    this.remotes.delete(id);
  }

  playAttack(id: string, kind: AttackKind) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.attackAnim = { kind, time: 0.18 };
  }

  interpolate(dt: number) {
    const a = 1 - Math.exp(-dt * 18);
    for (const r of this.remotes.values()) {
      const g = r.char.group;
      g.position.x += (r.target.x - g.position.x) * a;
      g.position.y += (r.target.y - g.position.y) * a;
      g.position.z += (r.target.z - g.position.z) * a;
      g.rotation.y += shortestAngle(g.rotation.y, r.target.ry) * a;
      g.rotation.z += (r.target.lean * -0.16 - g.rotation.z) * a;

      r.char.head.rotation.x += (r.target.rx - r.char.head.rotation.x) * a;

      const targetScale = r.target.crouch ? CROUCH_SCALE : STAND_SCALE;
      g.scale.y += (targetScale - g.scale.y) * a;

      if (r.attackAnim) {
        r.attackAnim.time -= dt;
        const p = Math.max(0, r.attackAnim.time / 0.18);
        const aimRot = weaponAimRotation(r.target.rx);
        if (r.attackAnim.kind === 'assassin-slash' || r.attackAnim.kind === 'assassin-charged') {
          r.char.weapon.position.copy(WEAPON_BASE_POS);
          r.char.weapon.rotation.set(
            aimRot.x - 0.12,
            aimRot.y - 0.7 * Math.sin((1 - p) * Math.PI),
            aimRot.z - 0.45 * Math.sin((1 - p) * Math.PI),
          );
        } else {
          r.char.weapon.position.set(
            WEAPON_BASE_POS.x,
            WEAPON_BASE_POS.y,
            WEAPON_BASE_POS.z + 0.14 * Math.sin((1 - p) * Math.PI),
          );
          r.char.weapon.rotation.copy(aimRot);
        }
        if (r.attackAnim.time <= 0) {
          r.attackAnim = null;
        }
      } else {
        r.char.weapon.position.lerp(WEAPON_BASE_POS, a);
        r.char.weapon.rotation.x +=
          (weaponAimRotation(r.target.rx).x - r.char.weapon.rotation.x) * a;
        r.char.weapon.rotation.y += (WEAPON_BASE_ROT.y - r.char.weapon.rotation.y) * a;
        r.char.weapon.rotation.z += (WEAPON_BASE_ROT.z - r.char.weapon.rotation.z) * a;
      }

      r.char.rightArm.rotation.x +=
        (THREE.MathUtils.clamp(r.target.rx, -0.9, 0.9) - r.char.rightArm.rotation.x) * a;
    }
  }

  addHitMark(id: string, worldPoint: THREE.Vector3, headshot: boolean) {
    const r = this.remotes.get(id);
    if (!r) return;
    const local = r.char.group.worldToLocal(worldPoint.clone());
    const mark = new THREE.Mesh(
      new THREE.SphereGeometry(headshot ? 0.085 : 0.065, 10, 8),
      new THREE.MeshBasicMaterial({ color: headshot ? 0xff1111 : 0x8b0000 }),
    );
    mark.position.copy(local);
    r.char.group.add(mark);
  }

  clearHitMarks() {
    for (const r of this.remotes.values()) {
      const remove: THREE.Object3D[] = [];
      r.char.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshBasicMaterial) {
          const color = obj.material.color.getHex();
          if (color === 0xff1111 || color === 0x8b0000) remove.push(obj);
        }
      });
      for (const obj of remove) {
        obj.parent?.remove(obj);
      }
    }
  }
}

function weaponAimRotation(pitch: number) {
  return new THREE.Euler(
    WEAPON_BASE_ROT.x + THREE.MathUtils.clamp(pitch, -1.05, 1.05),
    WEAPON_BASE_ROT.y,
    WEAPON_BASE_ROT.z,
  );
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
