import type { ClientMessage, PlayerState, ServerMessage } from './types.js';

export type SpawnInfo = { x: number; z: number; ry: number };

export class Network {
  ws: WebSocket | null = null;
  myId = '';
  onState?: (players: PlayerState[]) => void;
  onLeave?: (id: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onSpawn?: (info: SpawnInfo) => void;

  connect(url: string) {
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => this.onConnect?.();
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.onDisconnect?.();
    };
    ws.onerror = () => {};
    ws.onmessage = (e) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(typeof e.data === 'string' ? e.data : '');
      } catch {
        return;
      }
      if (msg.t === 'welcome') {
        this.myId = msg.id;
        this.onState?.(msg.players);
      } else if (msg.t === 'state') {
        this.onState?.(msg.players);
      } else if (msg.t === 'spawn') {
        this.onSpawn?.({ x: msg.x, z: msg.z, ry: msg.ry });
      } else if (msg.t === 'leave') {
        this.onLeave?.(msg.id);
      }
    };
  }

  sendJoin(name: string) {
    this.send({ t: 'join', name });
  }

  sendInput(px: number, py: number, pz: number, ry: number, rx: number, crouch: boolean) {
    this.send({ t: 'input', px, py, pz, ry, rx, crouch });
  }

  private send(msg: ClientMessage) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  }
}
