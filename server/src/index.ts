import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  AttackEffect,
  AttackKind,
  ClientMessage,
  PlayerClass,
  PlayerState,
  ServerMessage,
} from './types.js';

const PORT = Number(process.env.PORT ?? 8080);
const TICK_MS = 50;

type SpawnPoint = { x: number; z: number; ry: number };

type Connected = {
  id: string;
  ws: WebSocket;
  state: PlayerState;
  roomId: string;
  joined: boolean;
  slot: number;
  lastAttackAt: number;
  reloadingUntil: number;
  reloadTimer: ReturnType<typeof setTimeout> | null;
  roundLocked: boolean;
};

type TrainingDummy = {
  id: string;
  state: PlayerState;
  joined: true;
  roundLocked: boolean;
  respawnTimer: ReturnType<typeof setTimeout> | null;
};

type CombatTarget = Connected | TrainingDummy;

type Room = {
  id: string;
  players: Map<string, Connected>;
  trainingDummy: TrainingDummy;
  mapSeed: number;
  mapBlockers: MapBlocker[];
  roundSpawns: [SpawnPoint, SpawnPoint];
};

const players = new Map<string, Connected>();
const rooms = new Map<string, Room>();
let nextId = 1;
let nextEventId = 1;

const CLASS_STATS: Record<
  PlayerClass,
  { maxHp: number; maxAmmo: number; cooldownMs: number; reloadMs: number }
> = {
  gi: { maxHp: 150, maxAmmo: 30, cooldownMs: 85, reloadMs: 1250 },
  mage: { maxHp: 100, maxAmmo: 999, cooldownMs: 650, reloadMs: 0 },
  assassin: { maxHp: 100, maxAmmo: 999, cooldownMs: 620, reloadMs: 0 },
};

const ATTACKS: Record<
  AttackKind,
  {
    className: PlayerClass;
    damage: number;
    range: number;
    radius: number;
    cooldownMs?: number;
    melee?: boolean;
  }
> = {
  'gi-shot': { className: 'gi', damage: 10, range: 80, radius: 0.04 },
  'mage-shot': { className: 'mage', damage: 30, range: 55, radius: 0.28 },
  'mage-charged': { className: 'mage', damage: 18, range: 48, radius: 0.24, cooldownMs: 1100 },
  'assassin-slash': { className: 'assassin', damage: 25, range: 2.25, radius: 0.22, melee: true },
  'assassin-charged': {
    className: 'assassin',
    damage: 35,
    range: 3.0,
    radius: 0.35,
    cooldownMs: 850,
    melee: true,
  },
};

type MapCoverKind = 'crate' | 'van' | 'billboard';
type MapCoverSpec = { kind: MapCoverKind; x: number; z: number; rot: number };
type MapBlocker = { min: Vec3; max: Vec3 };

const ARENA_HALF = 18;
const WALL_HEIGHT = 2.2;
const WALL_THICKNESS = 0.8;
const STATIC_ROOT = resolve(fileURLToPath(new URL('../../client/dist', import.meta.url)));
const httpServer = createServer(serveStatic);
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  const room = getRoom(sessionFromRequest(req));
  if (room.players.size >= 2) {
    ws.close(4000, 'match full');
    return;
  }

  const id = String(nextId++);
  const conn: Connected = {
    id,
    ws,
    roomId: room.id,
    state: {
      id,
      name: '',
      className: 'gi',
      px: 0,
      py: 0,
      pz: 0,
      ry: 0,
      rx: 0,
      lean: 0,
      crouch: false,
      hp: 150,
      maxHp: 150,
      ammo: 30,
      maxAmmo: 30,
      score: 0,
    },
    joined: false,
    slot: -1,
    lastAttackAt: 0,
    reloadingUntil: 0,
    reloadTimer: null,
    roundLocked: false,
  };
  players.set(id, conn);
  room.players.set(id, conn);
  console.log(`[server] +${id} connected to ${room.id} (${room.players.size}/2)`);

  send(ws, {
    t: 'welcome',
    id,
    players: joinedSnapshot(room),
    mapSeed: room.mapSeed,
    sessionId: room.id,
  });

  ws.on('message', (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.t === 'join') {
      const name = String(msg.name ?? '')
        .trim()
        .slice(0, 16);
      if (!name) return;
      const className = normalizeClass(msg.className);
      const stats = CLASS_STATS[className];
      if (conn.joined) {
        conn.state.name = name;
        conn.state.className = className;
        return;
      }
      const slot = findFreeSlot(room);
      if (slot < 0) {
        ws.close(4001, 'no spawn slot');
        return;
      }
      const sp = room.roundSpawns[slot];
      conn.slot = slot;
      conn.state.name = name;
      conn.state.className = className;
      conn.state.px = sp.x;
      conn.state.py = 0;
      conn.state.pz = sp.z;
      conn.state.ry = sp.ry;
      conn.state.rx = 0;
      conn.state.lean = 0;
      conn.state.crouch = false;
      conn.state.maxHp = stats.maxHp;
      conn.state.hp = stats.maxHp;
      conn.state.maxAmmo = stats.maxAmmo;
      conn.state.ammo = stats.maxAmmo;
      conn.joined = true;
      conn.lastAttackAt = 0;
      conn.reloadingUntil = 0;
      conn.roundLocked = false;
      console.log(`[server] ${id} joined as "${name}" (${className}, slot ${slot})`);
      send(ws, { t: 'spawn', x: sp.x, z: sp.z, ry: sp.ry });
      broadcastToRoom(room, { t: 'peerJoined', name }, id);
    } else if (msg.t === 'input') {
      if (!conn.joined) return;
      conn.state.px = msg.px;
      conn.state.py = msg.py;
      conn.state.pz = msg.pz;
      conn.state.ry = msg.ry;
      conn.state.rx = msg.rx;
      conn.state.lean = clamp(Number(msg.lean) || 0, -1, 1);
      conn.state.crouch = !!msg.crouch;
    } else if (msg.t === 'attack') {
      if (!conn.joined) return;
      handleAttack(conn, msg);
    } else if (msg.t === 'reload') {
      if (!conn.joined || conn.state.className !== 'gi') return;
      beginReload(conn);
    }
  });

  ws.on('close', () => {
    const wasJoined = conn.joined;
    players.delete(id);
    room.players.delete(id);
    console.log(`[server] -${id} disconnected from ${room.id} (${room.players.size}/2)`);
    if (wasJoined) {
      broadcastToRoom(room, { t: 'leave', id });
      broadcastToRoom(room, { t: 'peerLeft', name: conn.state.name || 'Player' });
    }
    if (room.players.size === 0) rooms.delete(room.id);
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    const snapshot = joinedSnapshot(room);
    if (snapshot.length <= 1) continue;
    broadcastToRoom(room, { t: 'state', players: snapshot });
  }
}, TICK_MS);

function joinedSnapshot(room: Room): PlayerState[] {
  const out: PlayerState[] = [];
  for (const p of room.players.values()) {
    if (p.joined) out.push(p.state);
  }
  out.push(room.trainingDummy.state);
  return out;
}

function findFreeSlot(room: Room): number {
  const used = new Set<number>();
  for (const p of room.players.values()) {
    if (p.joined) used.add(p.slot);
  }
  for (let i = 0; i < room.roundSpawns.length; i++) {
    if (!used.has(i)) return i;
  }
  return -1;
}

function handleAttack(conn: Connected, msg: Extract<ClientMessage, { t: 'attack' }>) {
  const room = rooms.get(conn.roomId);
  if (!room) return;
  const spec = ATTACKS[msg.kind];
  if (!spec || spec.className !== conn.state.className) return;
  if (conn.roundLocked) return;
  if (msg.kind === 'mage-charged' && msg.charge < 1) return;

  const now = Date.now();
  const classCooldown = CLASS_STATS[conn.state.className].cooldownMs;
  const cooldown = spec.cooldownMs ?? classCooldown;
  if (now < conn.reloadingUntil || now - conn.lastAttackAt < cooldown) return;

  if (conn.state.className === 'gi') {
    if (conn.state.ammo <= 0) return;
    conn.state.ammo -= 1;
    if (conn.state.ammo <= 0) beginReload(conn);
  }
  conn.lastAttackAt = now;

  const rayOrigin = sanitizeOrigin(conn.state, { x: msg.ox, y: msg.oy, z: msg.oz });
  const visualOrigin = sanitizeVisualOrigin(
    conn.state,
    { x: msg.vox, y: msg.voy, z: msg.voz },
    rayOrigin,
  );
  const dir = normalizeVector(
    msg.dx,
    msg.dy,
    msg.dz,
    yawPitchDirection(conn.state.ry, conn.state.rx),
  );
  if (msg.kind === 'mage-charged') {
    const dirs = shotgunDirs(dir, conn.state.ry, conn.state.rx);
    for (let i = 0; i < dirs.length; i++) {
      processAttackRay(room, conn, msg.kind, spec, visualOrigin, rayOrigin, dirs[i], i === 0);
    }
    return;
  }
  processAttackRay(room, conn, msg.kind, spec, visualOrigin, rayOrigin, dir, true);
}

function processAttackRay(
  room: Room,
  conn: Connected,
  kind: AttackKind,
  spec: (typeof ATTACKS)[AttackKind],
  visualOrigin: Vec3,
  rayOrigin: Vec3,
  dir: Vec3,
  sound: boolean,
) {
  const hit = findHit(room, conn, rayOrigin, dir, spec);
  const blocker = findShotBlocker(room, rayOrigin, dir, spec.range, spec.radius);
  const blocked = !!blocker && (!hit || blocker.dist < hit.dist);
  const endpoint = blocked
    ? blocker.point
    : hit
      ? hit.point
      : {
          x: visualOrigin.x + dir.x * spec.range,
          y: visualOrigin.y + dir.y * spec.range,
          z: visualOrigin.z + dir.z * spec.range,
        };

  const effect: AttackEffect = {
    id: String(nextEventId++),
    attackerId: conn.id,
    className: conn.state.className,
    kind,
    ox: visualOrigin.x,
    oy: visualOrigin.y,
    oz: visualOrigin.z,
    dx: dir.x,
    dy: dir.y,
    dz: dir.z,
    ex: endpoint.x,
    ey: endpoint.y,
    ez: endpoint.z,
    hit: !!hit && !blocked,
    blocked,
    sound,
  };
  broadcastToRoom(room, { t: 'attack', effect });

  if (blocked || !hit) return;
  const damage = damageForHit(spec, hit);
  if (!isTrainingDummy(hit.target)) {
    hit.target.state.hp = Math.max(0, hit.target.state.hp - damage);
    applyAttackPush(spec, hit.target, dir);
  }
  const headshot = hit.part === 'head' && spec.className !== 'assassin';
  broadcastToRoom(room, {
    t: 'damage',
    event: {
      id: String(nextEventId++),
      attackerId: conn.id,
      targetId: hit.target.id,
      amount: damage,
      hp: hit.target.state.hp,
      maxHp: hit.target.state.maxHp,
      part: hit.part,
      headshot,
      x: hit.target.state.px,
      y: hit.target.state.py + (hit.target.state.crouch ? 1.25 : 1.9),
      z: hit.target.state.pz,
      hx: hit.point.x,
      hy: hit.point.y,
      hz: hit.point.z,
    },
  });

  if (hit.target.state.hp <= 0) {
    if (isTrainingDummy(hit.target)) {
      scheduleTrainingDummyRespawn(room);
    } else {
      finishRound(room, conn, hit.target);
    }
  }
}

function shotgunDirs(dir: Vec3, ry: number, rx: number): Vec3[] {
  const base = yawPitchDirection(ry, rx);
  const right = normalize({ x: Math.cos(ry), y: 0, z: -Math.sin(ry) });
  const up = normalize(cross(right, base));
  const offsets = [
    [0, 0],
    [0.09, 0],
    [-0.09, 0],
    [0, 0.08],
    [0, -0.08],
    [0.07, 0.07],
    [-0.07, -0.07],
  ];
  return offsets.map(([x, y]) => normalize(add(add(dir, scale(right, x)), scale(up, y))));
}

function applyAttackPush(spec: (typeof ATTACKS)[AttackKind], target: Connected, dir: Vec3) {
  if (spec.className !== 'mage') return;
  const push = spec.damage >= 30 ? 0.55 : 0.8;
  target.state.px = clamp(target.state.px + dir.x * push, -17.2, 17.2);
  target.state.pz = clamp(target.state.pz + dir.z * push, -17.2, 17.2);
}

function beginReload(conn: Connected) {
  if (conn.reloadingUntil > Date.now() || conn.state.ammo >= conn.state.maxAmmo) return;
  const stats = CLASS_STATS.gi;
  conn.reloadingUntil = Date.now() + stats.reloadMs;
  if (conn.reloadTimer) clearTimeout(conn.reloadTimer);
  conn.reloadTimer = setTimeout(() => {
    conn.reloadTimer = null;
    if (!players.has(conn.id) || conn.state.className !== 'gi') return;
    conn.state.ammo = stats.maxAmmo;
    conn.reloadingUntil = 0;
    send(conn.ws, { t: 'reloaded', ammo: conn.state.ammo });
  }, stats.reloadMs);
}

function finishRound(room: Room, winner: Connected, loser: Connected) {
  if (winner.roundLocked || loser.roundLocked) return;
  winner.roundLocked = true;
  loser.roundLocked = true;
  winner.state.score += 1;
  broadcastToRoom(room, {
    t: 'roundOver',
    event: {
      winnerId: winner.id,
      loserId: loser.id,
      scores: [...room.players.values()]
        .filter((p) => p.joined)
        .map((p) => ({ id: p.id, score: p.state.score })),
    },
  });
  setTimeout(() => {
    room.roundSpawns = makeSpawnPair(room.mapBlockers);
    for (const p of room.players.values()) {
      if (!p.joined) continue;
      respawn(p);
      p.roundLocked = false;
    }
  }, 900);
}

function findHit(
  room: Room,
  attacker: Connected,
  origin: Vec3,
  dir: Vec3,
  spec: (typeof ATTACKS)[AttackKind],
): HitResult | null {
  let best: HitResult | null = null;
  for (const target of combatTargets(room)) {
    if (!target.joined || target.id === attacker.id) continue;
    if (target.roundLocked || target.state.hp <= 0) continue;
    const roughCenter = {
      x: target.state.px,
      y: target.state.py + (target.state.crouch ? 0.8 : 1.05),
      z: target.state.pz,
    };
    const roughDist = length(sub(roughCenter, origin));
    if (roughDist > spec.range + 2) continue;

    if (spec.melee && dot(normalize(sub(roughCenter, origin)), dir) < 0.35) continue;

    for (const capsule of playerHitCapsules(target.state)) {
      const hit = rayCapsuleHit(origin, dir, capsule, spec.radius, spec.range);
      if (!hit) continue;
      best = chooseCloser(best, {
        target,
        point: hit.point,
        dist: hit.dist,
        part: capsule.part,
      });
    }
  }
  return best;
}

function damageForHit(spec: (typeof ATTACKS)[AttackKind], hit: HitResult): number {
  if (hit.part === 'head' && spec.className !== 'assassin') {
    return isTrainingDummy(hit.target) ? spec.damage * 3 : hit.target.state.hp;
  }
  if (spec.className !== 'gi') return spec.damage;
  if (hit.part === 'torso') return spec.damage;
  return Math.max(1, Math.round(spec.damage * 0.5));
}

function combatTargets(room: Room): CombatTarget[] {
  return [...room.players.values(), room.trainingDummy];
}

function isTrainingDummy(target: CombatTarget): target is TrainingDummy {
  return target.id === 'training-dummy';
}

function scheduleTrainingDummyRespawn(room: Room) {
  const trainingDummy = room.trainingDummy;
  if (trainingDummy.respawnTimer) return;
  trainingDummy.roundLocked = true;
  trainingDummy.respawnTimer = setTimeout(() => {
    trainingDummy.respawnTimer = null;
    respawnTrainingDummy(room);
  }, 700);
}

function respawnTrainingDummy(room: Room) {
  const trainingDummy = room.trainingDummy;
  trainingDummy.state.hp = trainingDummy.state.maxHp;
  trainingDummy.state.px = 0;
  trainingDummy.state.py = 0;
  trainingDummy.state.pz = 0;
  trainingDummy.state.ry = Math.PI;
  trainingDummy.state.rx = 0;
  trainingDummy.state.lean = 0;
  trainingDummy.state.crouch = false;
  trainingDummy.roundLocked = false;
}

function buildMapBlockers(seed: number): MapBlocker[] {
  const blockers: MapBlocker[] = [];
  addBlocker(blockers, 0, -ARENA_HALF, ARENA_HALF * 2, WALL_THICKNESS, WALL_HEIGHT);
  addBlocker(blockers, 0, ARENA_HALF, ARENA_HALF * 2, WALL_THICKNESS, WALL_HEIGHT);
  addBlocker(blockers, -ARENA_HALF, 0, WALL_THICKNESS, ARENA_HALF * 2, WALL_HEIGHT);
  addBlocker(blockers, ARENA_HALF, 0, WALL_THICKNESS, ARENA_HALF * 2, WALL_HEIGHT);

  for (const spec of generatedCoverSpecs(seed)) {
    const size = coverSize(spec);
    addBlocker(blockers, spec.x, spec.z, size.w, size.d, size.h);
  }
  return blockers;
}

function generatedCoverSpecs(seed: number): MapCoverSpec[] {
  const rng = seededRandom(seed);
  const specs: MapCoverSpec[] = [];

  for (let i = 0; specs.length < 12 && i < 140; i++) {
    const mirrored = specs.length % 2 === 1;
    const base = specs[specs.length - 1];
    if (mirrored && base) {
      specs.push({ ...base, z: -base.z, rot: -base.rot });
      continue;
    }

    const kind: MapCoverKind = 'crate';
    const x = snap(rng() * 26 - 11, 1.5);
    const z = snap(3.5 + rng() * 10, 1.5);
    const rot = 0;
    rng();
    const spec = { kind, x, z, rot };
    if (isCoverClear(spec, specs)) specs.push(spec);
  }

  return specs;
}

function pickCoverKind(value: number): MapCoverKind {
  return value < 1 ? 'crate' : 'crate';
}

function isCoverClear(next: MapCoverSpec, existing: MapCoverSpec[]) {
  const nextBox = expandBlocker(coverBounds(next), 1.2);
  const spawnPads = [
    { min: { x: -4, y: 0, z: -17 }, max: { x: 4, y: 2, z: -11 } },
    { min: { x: -4, y: 0, z: 11 }, max: { x: 4, y: 2, z: 17 } },
    { min: { x: -17, y: 0, z: -4 }, max: { x: -11, y: 2, z: 4 } },
    { min: { x: 11, y: 0, z: -4 }, max: { x: 17, y: 2, z: 4 } },
  ];
  if (spawnPads.some((pad) => boxesIntersect(pad, nextBox))) return false;
  return existing.every((spec) => !boxesIntersect(expandBlocker(coverBounds(spec), 1), nextBox));
}

function coverBounds(spec: MapCoverSpec): MapBlocker {
  const size = coverSize(spec);
  return {
    min: { x: spec.x - size.w / 2, y: 0, z: spec.z - size.d / 2 },
    max: { x: spec.x + size.w / 2, y: size.h, z: spec.z + size.d / 2 },
  };
}

function coverSize(spec: MapCoverSpec) {
  const turned = Math.abs(Math.sin(spec.rot)) > 0.5;
  if (spec.kind === 'van')
    return turned ? { w: 1.8, d: 3.35, h: 2.15 } : { w: 3.35, d: 1.8, h: 2.15 };
  if (spec.kind === 'crate')
    return turned ? { w: 1.25, d: 2.1, h: 2.05 } : { w: 2.1, d: 1.25, h: 2.05 };
  return turned ? { w: 0.95, d: 4.1, h: 2.25 } : { w: 4.1, d: 0.95, h: 2.25 };
}

function addBlocker(blockers: MapBlocker[], x: number, z: number, w: number, d: number, h: number) {
  blockers.push({
    min: { x: x - w / 2, y: 0, z: z - d / 2 },
    max: { x: x + w / 2, y: h, z: z + d / 2 },
  });
}

function findShotBlocker(
  room: Room,
  origin: Vec3,
  dir: Vec3,
  maxRange: number,
  extraRadius: number,
): { point: Vec3; dist: number } | null {
  const mapHit = findMapBlocker(room.mapBlockers, origin, dir, maxRange, extraRadius);
  const groundHit = findGroundBlocker(origin, dir, maxRange);
  if (!groundHit) return mapHit;
  return chooseCloser(mapHit, groundHit);
}

function findMapBlocker(
  blockers: MapBlocker[],
  origin: Vec3,
  dir: Vec3,
  maxRange: number,
  extraRadius: number,
): { point: Vec3; dist: number } | null {
  let best: { point: Vec3; dist: number } | null = null;
  const blockerPadding = Math.min(extraRadius, 0.015);
  for (const blocker of blockers) {
    const hit = rayBoxHit(origin, dir, blocker, blockerPadding, maxRange);
    if (!hit) continue;
    if (hit.dist < 0.08) continue;
    best = chooseCloser(best, hit);
  }
  return best;
}

function findGroundBlocker(origin: Vec3, dir: Vec3, maxRange: number) {
  if (dir.y >= -0.0001 || origin.y <= 0.02) return null;
  const dist = -origin.y / dir.y;
  if (dist < 0.08 || dist > maxRange) return null;
  return { point: add(origin, scale(dir, dist)), dist };
}

function rayBoxHit(
  origin: Vec3,
  dir: Vec3,
  box: MapBlocker,
  extraRadius: number,
  maxRange: number,
): { point: Vec3; dist: number } | null {
  const expanded = expandBlocker(box, extraRadius);
  let near = 0;
  let far = maxRange;

  for (const axis of ['x', 'y', 'z'] as const) {
    const originAxis = origin[axis];
    const dirAxis = dir[axis];
    if (Math.abs(dirAxis) < 0.000001) {
      if (originAxis < expanded.min[axis] || originAxis > expanded.max[axis]) return null;
      continue;
    }
    const inv = 1 / dirAxis;
    let t1 = (expanded.min[axis] - originAxis) * inv;
    let t2 = (expanded.max[axis] - originAxis) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return null;
  }

  if (near < 0 || near > maxRange) return null;
  return { point: add(origin, scale(dir, near)), dist: near };
}

function expandBlocker(box: MapBlocker, amount: number): MapBlocker {
  return {
    min: { x: box.min.x - amount, y: box.min.y - amount, z: box.min.z - amount },
    max: { x: box.max.x + amount, y: box.max.y + amount, z: box.max.z + amount },
  };
}

function boxesIntersect(a: MapBlocker, b: MapBlocker) {
  return (
    a.min.x <= b.max.x &&
    a.max.x >= b.min.x &&
    a.min.y <= b.max.y &&
    a.max.y >= b.min.y &&
    a.min.z <= b.max.z &&
    a.max.z >= b.min.z
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

function makeSpawnPair(mapBlockers: MapBlocker[]): [SpawnPoint, SpawnPoint] {
  for (let i = 0; i < 80; i++) {
    const eastWest = Math.random() > 0.5;
    const offset = Math.round((Math.random() * 18 - 9) * 10) / 10;
    const jitterA = Math.round((Math.random() * 2 - 1) * 10) / 10;
    const jitterB = Math.round((Math.random() * 2 - 1) * 10) / 10;
    const pair: [SpawnPoint, SpawnPoint] = eastWest
      ? [
          { x: -15 + jitterA, z: offset, ry: -Math.PI / 2 },
          { x: 15 + jitterB, z: -offset, ry: Math.PI / 2 },
        ]
      : [
          { x: offset, z: -15 + jitterA, ry: Math.PI },
          { x: -offset, z: 15 + jitterB, ry: 0 },
        ];
    if (pair.every((spawn) => isSpawnClear(spawn, mapBlockers)))
      return Math.random() > 0.5 ? pair : [pair[1], pair[0]];
  }

  return [
    { x: 0, z: -15, ry: Math.PI },
    { x: 0, z: 15, ry: 0 },
  ];
}

function isSpawnClear(spawn: SpawnPoint, mapBlockers: MapBlocker[]) {
  const pad = {
    min: { x: spawn.x - 1.2, y: 0, z: spawn.z - 1.2 },
    max: { x: spawn.x + 1.2, y: 2, z: spawn.z + 1.2 },
  };
  return !mapBlockers.some((blocker) => boxesIntersect(blocker, pad));
}

function respawn(conn: Connected) {
  const room = rooms.get(conn.roomId);
  if (!room) return;
  const sp = room.roundSpawns[conn.slot >= 0 ? conn.slot : 0];
  if (conn.reloadTimer) {
    clearTimeout(conn.reloadTimer);
    conn.reloadTimer = null;
  }
  conn.reloadingUntil = 0;
  conn.state.hp = conn.state.maxHp;
  conn.state.ammo = conn.state.maxAmmo;
  conn.state.px = sp.x;
  conn.state.py = 0;
  conn.state.pz = sp.z;
  conn.state.ry = sp.ry;
  conn.state.rx = 0;
  conn.state.lean = 0;
  conn.state.crouch = false;
  send(conn.ws, { t: 'spawn', x: sp.x, z: sp.z, ry: sp.ry });
}

function normalizeClass(value: unknown): PlayerClass {
  return value === 'mage' || value === 'assassin' || value === 'gi' ? value : 'gi';
}

function getRoom(sessionId: string): Room {
  let room = rooms.get(sessionId);
  if (room) return room;
  const mapSeed = Math.floor(Math.random() * 1_000_000_000);
  const mapBlockers = buildMapBlockers(mapSeed);
  room = {
    id: sessionId,
    players: new Map(),
    trainingDummy: makeTrainingDummy(),
    mapSeed,
    mapBlockers,
    roundSpawns: makeSpawnPair(mapBlockers),
  };
  rooms.set(sessionId, room);
  return room;
}

function makeTrainingDummy(): TrainingDummy {
  return {
    id: 'training-dummy',
    state: {
      id: 'training-dummy',
      name: 'Training Dummy',
      className: 'mage',
      px: 0,
      py: 0,
      pz: 0,
      ry: Math.PI,
      rx: 0,
      lean: 0,
      crouch: false,
      hp: 999999,
      maxHp: 999999,
      ammo: CLASS_STATS.mage.maxAmmo,
      maxAmmo: CLASS_STATS.mage.maxAmmo,
      score: 0,
    },
    joined: true,
    roundLocked: false,
    respawnTimer: null,
  };
}

function sessionFromRequest(req: IncomingMessage): string {
  const raw = new URL(req.url ?? '/', 'http://localhost').searchParams.get('session');
  return normalizeSessionId(raw);
}

function normalizeSessionId(value: string | null): string {
  const cleaned =
    value
      ?.toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 32) ?? '';
  return cleaned.length >= 4 ? cleaned : 'lobby';
}

type Vec3 = { x: number; y: number; z: number };
type HitPart = 'head' | 'torso' | 'arm' | 'leg';
type HitCapsule = { part: HitPart; a: Vec3; b: Vec3; radius: number };
type HitResult = { target: CombatTarget; point: Vec3; dist: number; part: HitPart };

function playerHitCapsules(state: PlayerState): HitCapsule[] {
  const crouchScale = state.crouch ? 0.65 : 1;
  const capsules: HitCapsule[] = [
    capsuleFromLocal(
      state,
      crouchScale,
      'head',
      { x: 0, y: 1.58, z: 0 },
      { x: 0, y: 1.82, z: 0 },
      0.21,
    ),
    capsuleFromLocal(
      state,
      crouchScale,
      'torso',
      { x: 0, y: 0.72, z: 0 },
      { x: 0, y: 1.25, z: 0 },
      0.27,
    ),
    capsuleFromLocal(
      state,
      crouchScale,
      'arm',
      { x: -0.42, y: 0.9, z: 0 },
      { x: -0.42, y: 1.4, z: 0 },
      0.095,
    ),
    capsuleFromLocal(
      state,
      crouchScale,
      'arm',
      { x: 0.42, y: 0.9, z: 0 },
      { x: 0.42, y: 1.4, z: 0 },
      0.095,
    ),
    capsuleFromLocal(
      state,
      crouchScale,
      'leg',
      { x: -0.17, y: 0.12, z: 0 },
      { x: -0.17, y: 0.7, z: 0 },
      0.12,
    ),
    capsuleFromLocal(
      state,
      crouchScale,
      'leg',
      { x: 0.17, y: 0.12, z: 0 },
      { x: 0.17, y: 0.7, z: 0 },
      0.12,
    ),
  ];
  return capsules;
}

function capsuleFromLocal(
  state: PlayerState,
  yScale: number,
  part: HitPart,
  a: Vec3,
  b: Vec3,
  radius: number,
): HitCapsule {
  return {
    part,
    a: localToPlayerWorld(state, { x: a.x, y: a.y * yScale, z: a.z }),
    b: localToPlayerWorld(state, { x: b.x, y: b.y * yScale, z: b.z }),
    radius,
  };
}

function localToPlayerWorld(state: PlayerState, p: Vec3): Vec3 {
  const roll = state.lean * -0.16;
  const rollCos = Math.cos(roll);
  const rollSin = Math.sin(roll);
  const rolled = {
    x: p.x * rollCos - p.y * rollSin,
    y: p.x * rollSin + p.y * rollCos,
    z: p.z,
  };
  const cos = Math.cos(state.ry);
  const sin = Math.sin(state.ry);
  return {
    x: state.px + rolled.x * cos + rolled.z * sin,
    y: state.py + rolled.y,
    z: state.pz - rolled.x * sin + rolled.z * cos,
  };
}

function rayCapsuleHit(
  origin: Vec3,
  dir: Vec3,
  capsule: HitCapsule,
  extraRadius: number,
  maxRange: number,
): { point: Vec3; dist: number } | null {
  const closest = closestRaySegment(origin, dir, capsule.a, capsule.b);
  if (closest.rayT < 0 || closest.rayT > maxRange) return null;
  const hitRadius = capsule.radius + extraRadius;
  if (length(sub(closest.rayPoint, closest.segmentPoint)) > hitRadius) return null;

  const entryDist = Math.max(0, closest.rayT - hitRadius);
  return {
    point: {
      x: origin.x + dir.x * entryDist,
      y: origin.y + dir.y * entryDist,
      z: origin.z + dir.z * entryDist,
    },
    dist: entryDist,
  };
}

function closestRaySegment(origin: Vec3, dir: Vec3, a: Vec3, b: Vec3) {
  const seg = sub(b, a);
  const segLenSq = dot(seg, seg);
  if (segLenSq < 0.000001) {
    const rayT = Math.max(0, dot(sub(a, origin), dir));
    return {
      rayT,
      rayPoint: add(origin, scale(dir, rayT)),
      segmentPoint: a,
    };
  }

  const w0 = sub(origin, a);
  const raySeg = dot(dir, seg);
  const segSeg = segLenSq;
  const rayW = dot(dir, w0);
  const segW = dot(seg, w0);
  const denom = segSeg - raySeg * raySeg;

  let rayT = 0;
  let segT = 0;
  if (Math.abs(denom) > 0.000001) {
    rayT = (raySeg * segW - segSeg * rayW) / denom;
    segT = (segW + raySeg * rayT) / segSeg;
  } else {
    segT = segW / segSeg;
  }

  if (segT < 0) {
    segT = 0;
    rayT = dot(sub(a, origin), dir);
  } else if (segT > 1) {
    segT = 1;
    rayT = dot(sub(b, origin), dir);
  }

  if (rayT < 0) {
    rayT = 0;
    segT = clamp(dot(sub(origin, a), seg) / segSeg, 0, 1);
  }

  return {
    rayT,
    rayPoint: add(origin, scale(dir, rayT)),
    segmentPoint: add(a, scale(seg, segT)),
  };
}

function eyePoint(state: PlayerState): Vec3 {
  return { x: state.px, y: state.py + (state.crouch ? 1.0 : 1.65), z: state.pz };
}

function sanitizeOrigin(state: PlayerState, requested: Vec3): Vec3 {
  const eye = eyePoint(state);
  if (![requested.x, requested.y, requested.z].every(Number.isFinite)) return eye;
  return length(sub(requested, eye)) <= 2.4 ? requested : eye;
}

function sanitizeVisualOrigin(state: PlayerState, requested: Vec3, fallback: Vec3): Vec3 {
  const eye = eyePoint(state);
  if (![requested.x, requested.y, requested.z].every(Number.isFinite)) return fallback;
  return length(sub(requested, eye)) <= 3 ? requested : fallback;
}

function yawPitchDirection(ry: number, rx: number): Vec3 {
  const cp = Math.cos(rx);
  return normalize({ x: -Math.sin(ry) * cp, y: Math.sin(rx), z: -Math.cos(ry) * cp });
}

function normalizeVector(x: number, y: number, z: number, fallback: Vec3): Vec3 {
  if (![x, y, z].every(Number.isFinite)) return fallback;
  const len = Math.hypot(x, y, z);
  if (len < 0.001) return fallback;
  return { x: x / len, y: y / len, z: z / len };
}

function normalize(v: Vec3): Vec3 {
  const len = length(v);
  if (len < 0.001) return { x: 0, y: 0, z: -1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function chooseCloser<T extends { dist: number }>(current: T | null, next: T): T {
  return !current || next.dist < current.dist ? next : current;
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastToRoom(room: Room, msg: ServerMessage, exceptId?: string) {
  const data = JSON.stringify(msg);
  for (const p of room.players.values()) {
    if (p.id === exceptId) continue;
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  }
}

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  if (req.url?.startsWith('/?') || req.url === '/') {
    sendStaticFile(res, join(STATIC_ROOT, 'index.html'));
    return;
  }

  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  const requested = resolve(join(STATIC_ROOT, pathname));
  if (!requested.startsWith(STATIC_ROOT) || !existsSync(requested)) {
    sendStaticFile(res, join(STATIC_ROOT, 'index.html'));
    return;
  }

  const filePath = statSync(requested).isDirectory() ? join(requested, 'index.html') : requested;
  sendStaticFile(res, filePath);
}

function sendStaticFile(res: ServerResponse, filePath: string) {
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('Build the client first with npm --prefix client run build.');
    return;
  }
  res.writeHead(200, { 'content-type': mimeType(filePath) });
  createReadStream(filePath).pipe(res);
}

function mimeType(filePath: string) {
  const ext = extname(filePath);
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] listening on :${PORT}`);
});
