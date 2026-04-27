export type PlayerState = {
  id: string;
  name: string;
  className: PlayerClass;
  px: number;
  py: number;
  pz: number;
  ry: number;
  rx: number;
  lean: number;
  crouch: boolean;
  hp: number;
  maxHp: number;
  ammo: number;
  maxAmmo: number;
  score: number;
};

export type PlayerClass = 'gi' | 'mage' | 'assassin';
export type AttackKind =
  | 'gi-shot'
  | 'mage-shot'
  | 'mage-charged'
  | 'assassin-slash'
  | 'assassin-charged';

export type AttackEffect = {
  id: string;
  attackerId: string;
  className: PlayerClass;
  kind: AttackKind;
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
  ex: number;
  ey: number;
  ez: number;
  hit: boolean;
  blocked?: boolean;
  sound?: boolean;
};

export type DamageEvent = {
  id: string;
  attackerId: string;
  targetId: string;
  amount: number;
  hp: number;
  maxHp: number;
  part: 'head' | 'torso' | 'arm' | 'leg';
  headshot: boolean;
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
};

export type RoundOverEvent = {
  winnerId: string;
  loserId: string;
  scores: { id: string; score: number }[];
};

export type ServerMessage =
  | { t: 'welcome'; id: string; players: PlayerState[]; mapSeed: number; sessionId: string }
  | { t: 'state'; players: PlayerState[] }
  | { t: 'spawn'; x: number; z: number; ry: number }
  | { t: 'attack'; effect: AttackEffect }
  | { t: 'damage'; event: DamageEvent }
  | { t: 'reloaded'; ammo: number }
  | { t: 'roundOver'; event: RoundOverEvent }
  | { t: 'peerJoined'; name: string }
  | { t: 'peerLeft'; name: string }
  | { t: 'chat'; name: string; text: string }
  | { t: 'leave'; id: string };

export type ClientMessage =
  | { t: 'join'; name: string; className: PlayerClass; sessionId: string }
  | {
      t: 'input';
      px: number;
      py: number;
      pz: number;
      ry: number;
      rx: number;
      lean: number;
      crouch: boolean;
    }
  | {
      t: 'attack';
      kind: AttackKind;
      ox: number;
      oy: number;
      oz: number;
      dx: number;
      dy: number;
      dz: number;
      vox: number;
      voy: number;
      voz: number;
      charge: number;
    }
  | { t: 'reload' }
  | { t: 'chat'; text: string };
