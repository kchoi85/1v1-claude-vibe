export type PlayerState = {
  id: string;
  name: string;
  className: PlayerClass;
  px: number;
  py: number;
  pz: number;
  ry: number;
  rx: number;
  crouch: boolean;
  hp: number;
  maxHp: number;
  ammo: number;
  maxAmmo: number;
};

export type PlayerClass = 'gi' | 'mage' | 'assassin';
export type AttackKind = 'gi-shot' | 'mage-shot' | 'mage-charged' | 'assassin-slash' | 'assassin-charged';

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
};

export type DamageEvent = {
  id: string;
  attackerId: string;
  targetId: string;
  amount: number;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  z: number;
};

export type ServerMessage =
  | { t: 'welcome'; id: string; players: PlayerState[] }
  | { t: 'state'; players: PlayerState[] }
  | { t: 'spawn'; x: number; z: number; ry: number }
  | { t: 'attack'; effect: AttackEffect }
  | { t: 'damage'; event: DamageEvent }
  | { t: 'reloaded'; ammo: number }
  | { t: 'leave'; id: string };

export type ClientMessage =
  | { t: 'join'; name: string; className: PlayerClass }
  | {
      t: 'input';
      px: number;
      py: number;
      pz: number;
      ry: number;
      rx: number;
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
      charge: number;
    }
  | { t: 'reload' };
