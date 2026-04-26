export type PlayerState = {
  id: string;
  name: string;
  px: number;
  py: number;
  pz: number;
  ry: number;
  rx: number;
  crouch: boolean;
};

export type ServerMessage =
  | { t: 'welcome'; id: string; players: PlayerState[] }
  | { t: 'state'; players: PlayerState[] }
  | { t: 'spawn'; x: number; z: number; ry: number }
  | { t: 'leave'; id: string };

export type ClientMessage =
  | { t: 'join'; name: string }
  | {
      t: 'input';
      px: number;
      py: number;
      pz: number;
      ry: number;
      rx: number;
      crouch: boolean;
    };
