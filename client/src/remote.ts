import * as THREE from 'three';
import { makeCharacter, type Character } from './character.js';
import type { AttackKind, PlayerClass, PlayerState } from './types.js';

type Remote = {
  char: Character;
  className: PlayerClass;
  target: { x: number; y: number; z: number; ry: number; rx: number; crouch: boolean };
  attackAnim: { kind: AttackKind; time: number } | null;
};

const STAND_SCALE = 1;
const CROUCH_SCALE = 0.65;

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
          target: { x: p.px, y: p.py, z: p.pz, ry: p.ry, rx: p.rx, crouch: p.crouch },
          attackAnim: null,
        };
        this.remotes.set(p.id, r);
      }
      r.target.x = p.px;
      r.target.y = p.py;
      r.target.z = p.pz;
      r.target.ry = p.ry;
      r.target.rx = p.rx;
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

      r.char.head.rotation.x += (r.target.rx - r.char.head.rotation.x) * a;

      const targetScale = r.target.crouch ? CROUCH_SCALE : STAND_SCALE;
      g.scale.y += (targetScale - g.scale.y) * a;

      if (r.attackAnim) {
        r.attackAnim.time -= dt;
        const p = Math.max(0, r.attackAnim.time / 0.18);
        if (r.attackAnim.kind === 'assassin-slash' || r.attackAnim.kind === 'assassin-charged') {
          r.char.weapon.rotation.y = -0.7 * Math.sin((1 - p) * Math.PI);
          r.char.weapon.rotation.z = -0.12 - 0.45 * Math.sin((1 - p) * Math.PI);
        } else {
          r.char.weapon.position.z = -0.28 + 0.14 * Math.sin((1 - p) * Math.PI);
        }
        if (r.attackAnim.time <= 0) {
          r.attackAnim = null;
          r.char.weapon.position.set(0.46, 1.08, -0.28);
          r.char.weapon.rotation.set(0.08, -0.2, -0.12);
        }
      }
    }
  }
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
