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
    vx: number;
    vz: number;
  };
  attackAnim: { kind: AttackKind; time: number } | null;
  flinch: number;
  flinchDir: THREE.Vector3;
  flinchLocal: THREE.Vector3;
  movePhase: number;
  lastSync: number;
};

type HitMark = {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
};

const STAND_SCALE = 1;
const CROUCH_SCALE = 0.65;
const PEEK_OFFSET = 0.48;
const WEAPON_BASE_POS = new THREE.Vector3(0.46, 1.08, -0.28);
const WEAPON_BASE_ROT = new THREE.Euler(0.08, -0.2, -0.12);

export class RemotePlayers {
  private remotes = new Map<string, Remote>();
  private hitMarks: HitMark[] = [];

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
            vx: 0,
            vz: 0,
          },
          attackAnim: null,
          flinch: 0,
          flinchDir: new THREE.Vector3(),
          flinchLocal: new THREE.Vector3(),
          movePhase: 0,
          lastSync: performance.now(),
        };
        this.remotes.set(p.id, r);
      }
      const now = performance.now();
      const dt = Math.max(0.016, (now - r.lastSync) / 1000);
      r.target.vx = (p.px - r.target.x) / dt;
      r.target.vz = (p.pz - r.target.z) / dt;
      r.lastSync = now;
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

  playHit(id: string, dir: THREE.Vector3) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.flinch = 0.28;
    r.flinchDir.copy(dir);
    r.flinchLocal.copy(dir).applyAxisAngle(new THREE.Vector3(0, 1, 0), -r.char.group.rotation.y);
  }

  weaponTipWorld(id: string, className: PlayerClass): THREE.Vector3 | null {
    const r = this.remotes.get(id);
    if (!r) return null;
    return r.char.weapon.localToWorld(weaponTipLocal(className).clone());
  }

  interpolate(dt: number) {
    const a = 1 - Math.exp(-dt * 18);
    for (const r of this.remotes.values()) {
      const g = r.char.group;
      if (r.flinch > 0) r.flinch = Math.max(0, r.flinch - dt);
      const flinchP = r.flinch > 0 ? Math.sin((r.flinch / 0.28) * Math.PI) : 0;
      const flinchOffsetX = r.flinchDir.x * flinchP * 0.18;
      const flinchOffsetZ = r.flinchDir.z * flinchP * 0.18;
      const flinchPitch = r.flinchLocal.z * flinchP * 0.22;
      const flinchRoll = -r.flinchLocal.x * flinchP * 0.2;
      g.position.x += (r.target.x + flinchOffsetX - g.position.x) * a;
      g.position.y += (r.target.y - g.position.y) * a;
      g.position.z += (r.target.z + flinchOffsetZ - g.position.z) * a;
      g.rotation.y += shortestAngle(g.rotation.y, r.target.ry) * a;
      g.rotation.x += (flinchPitch - g.rotation.x) * a;
      g.rotation.z += (r.target.lean * -0.16 + flinchRoll - g.rotation.z) * a;
      const peekX = Math.cos(g.rotation.y) * r.target.lean * PEEK_OFFSET;
      const peekZ = -Math.sin(g.rotation.y) * r.target.lean * PEEK_OFFSET;

      r.char.head.rotation.x += (r.target.rx - r.char.head.rotation.x) * a;
      r.char.head.rotation.z += (flinchP * 0.18 - r.char.head.rotation.z) * a;
      r.char.head.position.x += (peekX - r.char.head.position.x) * a;
      r.char.head.position.z += (peekZ - r.char.head.position.z) * a;
      r.char.weapon.position.x += (WEAPON_BASE_POS.x + peekX - r.char.weapon.position.x) * a;
      r.char.weapon.position.z += (WEAPON_BASE_POS.z + peekZ - r.char.weapon.position.z) * a;

      const targetScale = r.target.crouch ? CROUCH_SCALE : STAND_SCALE;
      g.scale.y += (targetScale - g.scale.y) * a;

      const speed = Math.hypot(r.target.vx, r.target.vz);
      const running = speed > 7.2;
      if (speed > 0.08) r.movePhase += dt * (running ? 12 : 8) * Math.min(1.6, speed / 6);
      const localVx = Math.cos(g.rotation.y) * r.target.vx - Math.sin(g.rotation.y) * r.target.vz;
      const localVz = Math.sin(g.rotation.y) * r.target.vx + Math.cos(g.rotation.y) * r.target.vz;
      const stride = Math.min(1, speed / 8);
      const frontSwing = Math.sin(r.movePhase) * stride * (running ? 0.75 : 0.48);
      const sideSwing = Math.sin(r.movePhase) * THREE.MathUtils.clamp(localVx / 8, -1, 1) * 0.35;
      const forwardBias = THREE.MathUtils.clamp(-localVz / 8, -1, 1);
      r.char.leftLeg.rotation.x += (frontSwing * forwardBias - r.char.leftLeg.rotation.x) * a;
      r.char.rightLeg.rotation.x += (-frontSwing * forwardBias - r.char.rightLeg.rotation.x) * a;
      r.char.leftLeg.rotation.z += (sideSwing - r.char.leftLeg.rotation.z) * a;
      r.char.rightLeg.rotation.z += (sideSwing - r.char.rightLeg.rotation.z) * a;
      r.char.leftArm.rotation.x += (-frontSwing * forwardBias - r.char.leftArm.rotation.x) * a;
      r.char.leftArm.rotation.z += (0.18 - sideSwing * 0.65 - r.char.leftArm.rotation.z) * a;

      if (r.attackAnim) {
        r.attackAnim.time -= dt;
        const p = Math.max(0, r.attackAnim.time / 0.18);
        const aimRot = weaponAimRotation(r.target.rx);
        if (r.attackAnim.kind === 'assassin-slash' || r.attackAnim.kind === 'assassin-charged') {
          r.char.weapon.position.set(
            WEAPON_BASE_POS.x + peekX,
            WEAPON_BASE_POS.y,
            WEAPON_BASE_POS.z + peekZ,
          );
          r.char.weapon.rotation.set(
            aimRot.x - 0.12,
            aimRot.y - 0.7 * Math.sin((1 - p) * Math.PI),
            aimRot.z - 0.45 * Math.sin((1 - p) * Math.PI),
          );
        } else {
          r.char.weapon.position.set(
            WEAPON_BASE_POS.x + peekX,
            WEAPON_BASE_POS.y,
            WEAPON_BASE_POS.z + peekZ + 0.14 * Math.sin((1 - p) * Math.PI),
          );
          r.char.weapon.rotation.copy(aimRot);
        }
        if (r.attackAnim.time <= 0) {
          r.attackAnim = null;
        }
      } else {
        r.char.weapon.position.y += (WEAPON_BASE_POS.y - r.char.weapon.position.y) * a;
        r.char.weapon.rotation.x +=
          (weaponAimRotation(r.target.rx).x - r.char.weapon.rotation.x) * a;
        r.char.weapon.rotation.y += (WEAPON_BASE_ROT.y - r.char.weapon.rotation.y) * a;
        r.char.weapon.rotation.z += (WEAPON_BASE_ROT.z - r.char.weapon.rotation.z) * a;
      }

      const rightArmAim = THREE.MathUtils.clamp(r.target.rx, -0.9, 0.9) + frontSwing * forwardBias;
      r.char.rightArm.rotation.x += (rightArmAim - r.char.rightArm.rotation.x) * a;
      r.char.rightArm.rotation.z += (-0.18 + sideSwing * 0.65 - r.char.rightArm.rotation.z) * a;
    }
  }

  addHitMark(id: string, worldPoint: THREE.Vector3, headshot: boolean) {
    const r = this.remotes.get(id);
    if (!r) return;
    const local = r.char.group.worldToLocal(worldPoint.clone());
    const mark = new THREE.Mesh(
      new THREE.SphereGeometry(headshot ? 0.085 : 0.065, 10, 8),
      new THREE.MeshBasicMaterial({
        color: headshot ? 0xff1111 : 0x8b0000,
        transparent: true,
        opacity: 0.9,
      }),
    );
    mark.position.copy(local);
    r.char.group.add(mark);
    this.hitMarks.push({ mesh: mark, life: 5, maxLife: 5 });
  }

  updateHitMarks(dt: number) {
    for (let i = this.hitMarks.length - 1; i >= 0; i--) {
      const mark = this.hitMarks[i];
      mark.life -= dt;
      const opacity = Math.max(0, mark.life / mark.maxLife);
      if (mark.mesh.material instanceof THREE.MeshBasicMaterial) {
        mark.mesh.material.opacity = opacity * 0.9;
      }
      if (mark.life <= 0) {
        mark.mesh.parent?.remove(mark.mesh);
        this.hitMarks.splice(i, 1);
      }
    }
  }

  clearHitMarks() {
    for (const mark of this.hitMarks) {
      mark.mesh.parent?.remove(mark.mesh);
    }
    this.hitMarks.length = 0;
  }
}

function weaponAimRotation(pitch: number) {
  return new THREE.Euler(
    WEAPON_BASE_ROT.x + THREE.MathUtils.clamp(pitch, -1.05, 1.05),
    WEAPON_BASE_ROT.y,
    WEAPON_BASE_ROT.z,
  );
}

function weaponTipLocal(className: PlayerClass): THREE.Vector3 {
  if (className === 'mage') return new THREE.Vector3(0, 0, -0.78);
  if (className === 'assassin') return new THREE.Vector3(0, 0, -0.66);
  return new THREE.Vector3(0, 0.02, -0.9);
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
