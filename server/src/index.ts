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

const SPAWNS = [
  { x: 0, z: -25, ry: Math.PI }, // north spawn, facing south
  { x: 0, z: 25, ry: 0 }, // south spawn, facing north
];

type Connected = {
  id: string;
  ws: WebSocket;
  state: PlayerState;
  joined: boolean;
  slot: number;
  lastAttackAt: number;
  reloadingUntil: number;
  reloadTimer: ReturnType<typeof setTimeout> | null;
  roundLocked: boolean;
};

const players = new Map<string, Connected>();
let nextId = 1;
let nextEventId = 1;

const CLASS_STATS: Record<
  PlayerClass,
  { maxHp: number; maxAmmo: number; cooldownMs: number; reloadMs: number }
> = {
  gi: { maxHp: 150, maxAmmo: 30, cooldownMs: 85, reloadMs: 1250 },
  mage: { maxHp: 100, maxAmmo: 999, cooldownMs: 650, reloadMs: 0 },
  assassin: { maxHp: 100, maxAmmo: 999, cooldownMs: 420, reloadMs: 0 },
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
  'gi-shot': { className: 'gi', damage: 10, range: 80, radius: 0.45 },
  'mage-shot': { className: 'mage', damage: 30, range: 55, radius: 0.75 },
  'mage-charged': { className: 'mage', damage: 60, range: 60, radius: 1.05, cooldownMs: 1100 },
  'assassin-slash': { className: 'assassin', damage: 25, range: 2.25, radius: 1.0, melee: true },
  'assassin-charged': {
    className: 'assassin',
    damage: 55,
    range: 3.0,
    radius: 1.2,
    cooldownMs: 850,
    melee: true,
  },
};

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  if (players.size >= 2) {
    ws.close(4000, 'match full');
    return;
  }

  const id = String(nextId++);
  const conn: Connected = {
    id,
    ws,
    state: {
      id,
      name: '',
      className: 'gi',
      px: 0,
      py: 0,
      pz: 0,
      ry: 0,
      rx: 0,
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
  console.log(`[server] +${id} connected (${players.size}/2)`);

  send(ws, { t: 'welcome', id, players: joinedSnapshot() });

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
      const slot = findFreeSlot();
      if (slot < 0) {
        ws.close(4001, 'no spawn slot');
        return;
      }
      const sp = SPAWNS[slot];
      conn.slot = slot;
      conn.state.name = name;
      conn.state.className = className;
      conn.state.px = sp.x;
      conn.state.py = 0;
      conn.state.pz = sp.z;
      conn.state.ry = sp.ry;
      conn.state.rx = 0;
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
    } else if (msg.t === 'input') {
      if (!conn.joined) return;
      conn.state.px = msg.px;
      conn.state.py = msg.py;
      conn.state.pz = msg.pz;
      conn.state.ry = msg.ry;
      conn.state.rx = msg.rx;
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
    console.log(`[server] -${id} disconnected (${players.size}/2)`);
    if (wasJoined) broadcast({ t: 'leave', id });
  });
});

setInterval(() => {
  const snapshot = joinedSnapshot();
  if (snapshot.length === 0) return;
  broadcast({ t: 'state', players: snapshot });
}, TICK_MS);

function joinedSnapshot(): PlayerState[] {
  const out: PlayerState[] = [];
  for (const p of players.values()) {
    if (p.joined) out.push(p.state);
  }
  return out;
}

function findFreeSlot(): number {
  const used = new Set<number>();
  for (const p of players.values()) {
    if (p.joined) used.add(p.slot);
  }
  for (let i = 0; i < SPAWNS.length; i++) {
    if (!used.has(i)) return i;
  }
  return -1;
}

function handleAttack(conn: Connected, msg: Extract<ClientMessage, { t: 'attack' }>) {
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

  const origin = sanitizeOrigin(conn.state, { x: msg.ox, y: msg.oy, z: msg.oz });
  const dir = normalizeVector(
    msg.dx,
    msg.dy,
    msg.dz,
    yawPitchDirection(conn.state.ry, conn.state.rx),
  );
  const hit = findHit(conn, origin, dir, spec);
  const endpoint = hit
    ? hit.point
    : {
        x: origin.x + dir.x * spec.range,
        y: origin.y + dir.y * spec.range,
        z: origin.z + dir.z * spec.range,
      };

  const effect: AttackEffect = {
    id: String(nextEventId++),
    attackerId: conn.id,
    className: conn.state.className,
    kind: msg.kind,
    ox: origin.x,
    oy: origin.y,
    oz: origin.z,
    dx: dir.x,
    dy: dir.y,
    dz: dir.z,
    ex: endpoint.x,
    ey: endpoint.y,
    ez: endpoint.z,
    hit: !!hit,
  };
  broadcast({ t: 'attack', effect });

  if (!hit) return;
  hit.target.state.hp = Math.max(0, hit.target.state.hp - spec.damage);
  broadcast({
    t: 'damage',
    event: {
      id: String(nextEventId++),
      attackerId: conn.id,
      targetId: hit.target.id,
      amount: spec.damage,
      hp: hit.target.state.hp,
      maxHp: hit.target.state.maxHp,
      x: hit.target.state.px,
      y: hit.target.state.py + (hit.target.state.crouch ? 1.25 : 1.9),
      z: hit.target.state.pz,
    },
  });

  if (hit.target.state.hp <= 0) {
    finishRound(conn, hit.target);
  }
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

function finishRound(winner: Connected, loser: Connected) {
  if (winner.roundLocked || loser.roundLocked) return;
  winner.roundLocked = true;
  loser.roundLocked = true;
  winner.state.score += 1;
  broadcast({
    t: 'roundOver',
    event: {
      winnerId: winner.id,
      loserId: loser.id,
      scores: [...players.values()]
        .filter((p) => p.joined)
        .map((p) => ({ id: p.id, score: p.state.score })),
    },
  });
  setTimeout(() => {
    for (const p of players.values()) {
      if (!p.joined) continue;
      respawn(p);
      p.roundLocked = false;
    }
  }, 900);
}

function findHit(
  attacker: Connected,
  origin: Vec3,
  dir: Vec3,
  spec: (typeof ATTACKS)[AttackKind],
): { target: Connected; point: Vec3; dist: number } | null {
  let best: { target: Connected; point: Vec3; dist: number } | null = null;
  for (const target of players.values()) {
    if (!target.joined || target.id === attacker.id) continue;
    const center = {
      x: target.state.px,
      y: target.state.py + (target.state.crouch ? 0.8 : 1.05),
      z: target.state.pz,
    };
    const toTarget = sub(center, origin);
    const distToCenter = length(toTarget);
    if (distToCenter > spec.range + spec.radius) continue;

    if (spec.melee) {
      const facing = dot(normalize(toTarget), dir);
      if (distToCenter <= spec.range && facing > 0.45) {
        const point = {
          x: origin.x + dir.x * Math.min(distToCenter, spec.range),
          y: origin.y + dir.y * Math.min(distToCenter, spec.range),
          z: origin.z + dir.z * Math.min(distToCenter, spec.range),
        };
        best = chooseCloser(best, { target, point, dist: distToCenter });
      }
      continue;
    }

    const along = dot(toTarget, dir);
    if (along < 0 || along > spec.range) continue;
    const closest = {
      x: origin.x + dir.x * along,
      y: origin.y + dir.y * along,
      z: origin.z + dir.z * along,
    };
    const miss = length(sub(center, closest));
    if (miss <= spec.radius) {
      best = chooseCloser(best, { target, point: closest, dist: along });
    }
  }
  return best;
}

function respawn(conn: Connected) {
  const sp = SPAWNS[conn.slot >= 0 ? conn.slot : 0];
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
  conn.state.crouch = false;
  send(conn.ws, { t: 'spawn', x: sp.x, z: sp.z, ry: sp.ry });
}

function normalizeClass(value: unknown): PlayerClass {
  return value === 'mage' || value === 'assassin' || value === 'gi' ? value : 'gi';
}

type Vec3 = { x: number; y: number; z: number };

function eyePoint(state: PlayerState): Vec3 {
  return { x: state.px, y: state.py + (state.crouch ? 1.0 : 1.65), z: state.pz };
}

function sanitizeOrigin(state: PlayerState, requested: Vec3): Vec3 {
  const eye = eyePoint(state);
  if (![requested.x, requested.y, requested.z].every(Number.isFinite)) return eye;
  return length(sub(requested, eye)) <= 2.4 ? requested : eye;
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

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function chooseCloser<T extends { dist: number }>(current: T | null, next: T): T {
  return !current || next.dist < current.dist ? next : current;
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  }
}

console.log(`[server] listening on :${PORT}`);
