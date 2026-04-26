import * as THREE from 'three';
import { makeCharacter, type Character } from './character.js';
import type { PlayerState } from './types.js';

type Remote = {
  char: Character;
  target: { x: number; y: number; z: number; ry: number; rx: number; crouch: boolean };
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
      if (!r) {
        const char = makeCharacter(0xff5544);
        this.scene.add(char.group);
        r = {
          char,
          target: { x: p.px, y: p.py, z: p.pz, ry: p.ry, rx: p.rx, crouch: p.crouch },
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
    }
  }
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
