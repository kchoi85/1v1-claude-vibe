import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, PlayerState, ServerMessage } from './types.js';

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
};

const players = new Map<string, Connected>();
let nextId = 1;

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
      px: 0,
      py: 0,
      pz: 0,
      ry: 0,
      rx: 0,
      crouch: false,
    },
    joined: false,
    slot: -1,
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
      if (conn.joined) {
        conn.state.name = name;
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
      conn.state.px = sp.x;
      conn.state.py = 0;
      conn.state.pz = sp.z;
      conn.state.ry = sp.ry;
      conn.state.rx = 0;
      conn.state.crouch = false;
      conn.joined = true;
      console.log(`[server] ${id} joined as "${name}" (slot ${slot})`);
      send(ws, { t: 'spawn', x: sp.x, z: sp.z, ry: sp.ry });
    } else if (msg.t === 'input') {
      if (!conn.joined) return;
      conn.state.px = msg.px;
      conn.state.py = msg.py;
      conn.state.pz = msg.pz;
      conn.state.ry = msg.ry;
      conn.state.rx = msg.rx;
      conn.state.crouch = !!msg.crouch;
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
