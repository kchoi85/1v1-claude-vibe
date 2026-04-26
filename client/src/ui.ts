import { CLASS_LABELS } from './gameConfig.js';
import type { PlayerClass, PlayerState } from './types.js';

type ScoreState = {
  me: number;
  opp: number;
};

type AmmoState = {
  className: PlayerClass;
  ammo: number;
  maxAmmo: number;
  reloading: boolean;
};

type HpState = {
  hp: number;
  maxHp: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function showNameError(input: HTMLInputElement, errorEl: HTMLElement, message: string) {
  errorEl.textContent = message;
  input.setAttribute('aria-invalid', 'true');
  input.focus();
}

export function clearNameError(input: HTMLInputElement, errorEl: HTMLElement) {
  errorEl.textContent = '';
  input.removeAttribute('aria-invalid');
}

export function renderScore(scoreMeEl: HTMLElement, scoreOppEl: HTMLElement, score: ScoreState) {
  scoreMeEl.textContent = String(score.me);
  scoreOppEl.textContent = String(score.opp);
}

export function renderPlayerList(playerListEl: HTMLElement, players: PlayerState[], myId: string) {
  playerListEl.innerHTML = '';
  for (const player of players) {
    const isMe = player.id === myId;
    const row = document.createElement('div');
    row.className = `row ${isMe ? 'me' : 'opp'}`;

    const dot = document.createElement('span');
    dot.className = 'dot';

    const name = document.createElement('span');
    name.textContent = `${player.name || `Player ${player.id}`} - ${
      CLASS_LABELS[player.className]
    } ${player.hp}/${player.maxHp}`;

    row.appendChild(dot);
    row.appendChild(name);
    if (isMe) {
      const you = document.createElement('span');
      you.className = 'you';
      you.textContent = '(you)';
      row.appendChild(you);
    }
    playerListEl.appendChild(row);
  }
}

export function renderAmmo(
  weaponLabelEl: HTMLElement,
  ammoCountEl: HTMLElement,
  hasJoined: boolean,
  selectedClass: PlayerClass,
  stats: AmmoState,
) {
  if (!hasJoined) {
    weaponLabelEl.textContent = selectedClass === 'gi' ? 'Ammo' : 'Weapon';
    ammoCountEl.textContent =
      selectedClass === 'gi' ? '30/30' : selectedClass === 'mage' ? 'Wand' : 'Dagger';
    return;
  }

  if (stats.className === 'gi') {
    weaponLabelEl.textContent = 'Ammo';
    ammoCountEl.textContent = stats.reloading ? 'Reloading' : `${stats.ammo}/${stats.maxAmmo}`;
    return;
  }

  weaponLabelEl.textContent = 'Weapon';
  ammoCountEl.textContent =
    selectedClass === 'mage' || stats.className === 'mage' ? 'Wand' : 'Dagger';
}

export function renderHp(hpTextEl: HTMLElement, hpFillEl: HTMLDivElement, stats: HpState) {
  hpTextEl.textContent = `${stats.hp}/${stats.maxHp}`;
  const pct = stats.maxHp > 0 ? clamp(stats.hp / stats.maxHp, 0, 1) : 0;
  hpFillEl.style.width = `${pct * 100}%`;
  hpFillEl.style.background =
    pct > 0.55
      ? 'linear-gradient(90deg, #35d07f, #b9f36b)'
      : pct > 0.25
        ? 'linear-gradient(90deg, #f2c94c, #f2994a)'
        : 'linear-gradient(90deg, #eb5757, #ff8a65)';
}
