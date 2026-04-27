import type { AttackKind, PlayerClass } from './types.js';

export const CLASS_LABELS: Record<PlayerClass, string> = {
  gi: 'G.I.',
  mage: 'Mage',
  assassin: 'Assassin',
};

export const CLASS_MOVE: Record<PlayerClass, { walk: number; sprint: number }> = {
  gi: { walk: 6, sprint: 1.6 },
  mage: { walk: 6, sprint: 1.6 },
  assassin: { walk: 8.2, sprint: 2.25 },
};

export const CLASS_MAX_HP: Record<PlayerClass, number> = {
  gi: 200,
  mage: 150,
  assassin: 100,
};

export const ATTACK_CONFIG: Record<
  AttackKind,
  { color: number; cooldown: number; localAmmo?: boolean; flash?: number; projectile?: boolean }
> = {
  'gi-shot': { color: 0xffd45c, cooldown: 85, localAmmo: true, flash: 0xfff0a0 },
  'mage-shot': { color: 0x8df5ff, cooldown: 650, projectile: true, flash: 0x80f6ff },
  'mage-charged': { color: 0xff8df5, cooldown: 1100, projectile: true, flash: 0xffb3fb },
  'assassin-slash': { color: 0xe8f6ff, cooldown: 620 },
  'assassin-charged': { color: 0xff4f72, cooldown: 850 },
};

export const GI_GUN = {
  spreadRad: 0.02,
  aimedSpreadRad: 0.007,
  recoilPitchRad: 0.026,
  recoilYawRad: 0.007,
  aimedRecoilMult: 0.55,
  maxRecoverablePitchRad: 0.34,
  maxRecoverableYawRad: 0.09,
  firstShotResetMs: 340,
};
