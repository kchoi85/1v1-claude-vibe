import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { ensureAudio, playAttackSound, sounds } from './audio.js';
import { makeWeapon } from './character.js';
import { ATTACK_CONFIG, CLASS_LABELS, CLASS_MAX_HP, CLASS_MOVE, GI_GUN } from './gameConfig.js';
import { Network } from './network.js';
import { RemotePlayers } from './remote.js';
import type { AttackEffect, AttackKind, DamageEvent, PlayerClass, PlayerState } from './types.js';

const app = document.getElementById('app')!;
const overlay = document.getElementById('overlay')!;
const overlayPanel = document.getElementById('overlay-panel')!;
const nameForm = document.getElementById('name-form')!;
const playText = document.getElementById('play-text')!;
const nameInput = document.getElementById('name-input') as HTMLInputElement;
const nameErrorEl = document.getElementById('name-error')!;
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
const statusEl = document.getElementById('status')!;
const scoreMeEl = document.getElementById('score-me')!;
const scoreOppEl = document.getElementById('score-opp')!;
const playerListEl = document.getElementById('player-list')!;
const weaponLabelEl = document.getElementById('weapon-label')!;
const ammoCountEl = document.getElementById('ammo-count')!;
const hpTextEl = document.getElementById('hp-text')!;
const hpFillEl = document.getElementById('hp-fill') as HTMLDivElement;
const hitXEl = document.getElementById('hit-x')!;
const damageLayer = document.getElementById('damage-layer')!;
const classCards = Array.from(document.querySelectorAll<HTMLButtonElement>('.class-card'));

const score = { me: 0, opp: 0 };
function renderScore() {
  scoreMeEl.textContent = String(score.me);
  scoreOppEl.textContent = String(score.opp);
}
renderScore();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202830);
scene.fog = new THREE.Fog(0x202830, 20, 80);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
camera.rotation.order = 'YXZ';
camera.position.set(0, 1.7, 5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
app.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(10, 20, 5);
sun.castShadow = true;
scene.add(sun);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x556677 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const wallMat = new THREE.MeshStandardMaterial({ color: 0x334455 });
const wallBoxes: THREE.Box3[] = [];
function addWall(x: number, z: number, w: number, d: number, h = 3) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
  m.position.set(x, h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  wallBoxes.push(
    new THREE.Box3(
      new THREE.Vector3(x - w / 2, 0, z - d / 2),
      new THREE.Vector3(x + w / 2, h, z + d / 2),
    ),
  );
}
addWall(0, -30, 60, 1);
addWall(0, 30, 60, 1);
addWall(-30, 0, 1, 60);
addWall(30, 0, 1, 60);
addWall(-6, -8, 4, 4);
addWall(8, 4, 6, 2);
addWall(-12, 10, 2, 8);

const controls = new PointerLockControls(camera, renderer.domElement);
scene.add(controls.getObject());

controls.addEventListener('lock', () => overlay.classList.add('hidden'));
controls.addEventListener('unlock', () => overlay.classList.remove('hidden'));

const keys = {
  w: false,
  a: false,
  s: false,
  d: false,
  sprint: false,
  jump: false,
  crouch: false,
};

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyW') keys.w = true;
  if (e.code === 'KeyA') keys.a = true;
  if (e.code === 'KeyS') keys.s = true;
  if (e.code === 'KeyD') keys.d = true;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.sprint = true;
  if (e.code === 'KeyR') reloadWeapon();
  if (e.code === 'Space') {
    keys.jump = true;
    e.preventDefault();
  }
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
    keys.crouch = true;
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyW') keys.w = false;
  if (e.code === 'KeyA') keys.a = false;
  if (e.code === 'KeyS') keys.s = false;
  if (e.code === 'KeyD') keys.d = false;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.sprint = false;
  if (e.code === 'Space') keys.jump = false;
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') keys.crouch = false;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!controls.isLocked || !hasJoined) return;
  if (e.button === 0) beginPrimary();
  if (e.button === 2) beginSecondary();
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) input.fireHeld = false;
  if (e.button === 2) endSecondary();
});

const PLAYER_RADIUS = 0.4;
const STAND_EYE = 1.7;
const CROUCH_EYE = 1.0;
const GRAVITY = 22;
const JUMP_SPEED = 7;

const player = {
  pos: new THREE.Vector3(0, 0, 5),
  vy: 0,
  eye: STAND_EYE,
  crouch: false,
};

const localStats = {
  className: 'gi' as PlayerClass,
  hp: 150,
  maxHp: 150,
  ammo: 30,
  maxAmmo: 30,
  score: 0,
  reloading: false,
};

const input = {
  fireHeld: false,
  aimHeld: false,
  charging: false,
  chargeStart: 0,
  nextAttackAt: 0,
  lastGiShotAt: -Infinity,
  reloadAnim: 0,
  localAnim: null as { kind: AttackKind; time: number } | null,
};

const recoil = {
  pitch: 0,
  yaw: 0,
  weaponKick: 0,
};

let hasJoined = false;
let selectedClass: PlayerClass = 'gi';
let viewWeapon: THREE.Group | null = null;
setViewWeapon(selectedClass);
renderAmmo();
renderHp();

classCards.forEach((card) => {
  card.addEventListener('click', () => {
    const next = card.dataset.class as PlayerClass | undefined;
    if (!next) return;
    selectedClass = next;
    if (!hasJoined) {
      localStats.hp = CLASS_MAX_HP[next];
      localStats.maxHp = CLASS_MAX_HP[next];
    }
    classCards.forEach((c) => c.classList.toggle('selected', c === card));
    setViewWeapon(selectedClass);
    renderAmmo();
    renderHp();
  });
});

function setViewWeapon(className: PlayerClass) {
  if (viewWeapon) camera.remove(viewWeapon);
  viewWeapon = makeWeapon(className);
  viewWeapon.position.set(0.36, -0.28, -0.62);
  viewWeapon.rotation.set(-0.05, -0.22, -0.08);
  viewWeapon.scale.setScalar(className === 'assassin' ? 1.25 : 1.05);
  camera.add(viewWeapon);
}

function moveWithCollision(pos: THREE.Vector3, dx: number, dz: number) {
  pos.x += dx;
  for (const b of wallBoxes) {
    if (
      pos.x + PLAYER_RADIUS > b.min.x &&
      pos.x - PLAYER_RADIUS < b.max.x &&
      pos.z + PLAYER_RADIUS > b.min.z &&
      pos.z - PLAYER_RADIUS < b.max.z
    ) {
      pos.x = dx > 0 ? b.min.x - PLAYER_RADIUS : b.max.x + PLAYER_RADIUS;
    }
  }
  pos.z += dz;
  for (const b of wallBoxes) {
    if (
      pos.x + PLAYER_RADIUS > b.min.x &&
      pos.x - PLAYER_RADIUS < b.max.x &&
      pos.z + PLAYER_RADIUS > b.min.z &&
      pos.z - PLAYER_RADIUS < b.max.z
    ) {
      pos.z = dz > 0 ? b.min.z - PLAYER_RADIUS : b.max.z + PLAYER_RADIUS;
    }
  }
}

const network = new Network();
const remotes = new RemotePlayers(scene);
let myName = '';
let lastPlayers: PlayerState[] = [];

network.onConnect = () => {
  statusEl.textContent = 'connected';
  joinBtn.disabled = false;
};
network.onDisconnect = () => {
  statusEl.textContent = 'disconnected - start server: npm run dev:server';
  joinBtn.disabled = true;
};
network.onState = (players) => {
  lastPlayers = players;
  const me = players.find((p) => p.id === network.myId);
  if (me) {
    localStats.className = me.className;
    localStats.hp = me.hp;
    localStats.maxHp = me.maxHp;
    localStats.ammo = me.ammo;
    localStats.maxAmmo = me.maxAmmo;
    localStats.score = me.score;
    if (selectedClass !== me.className) {
      selectedClass = me.className;
      setViewWeapon(selectedClass);
    }
    renderAmmo();
    renderHp();
  }
  updateScoreFromPlayers(players);
  remotes.sync(network.myId, players);
  renderPlayerList();
};
network.onLeave = (id) => {
  remotes.remove(id);
  lastPlayers = lastPlayers.filter((p) => p.id !== id);
  renderPlayerList();
};
network.onSpawn = ({ x, z, ry }) => {
  player.pos.set(x, 0, z);
  player.vy = 0;
  player.eye = STAND_EYE;
  camera.rotation.x = 0;
  camera.rotation.y = ry;
  const obj = controls.getObject();
  obj.position.set(x, player.eye, z);
};
network.onAttack = (effect) => {
  drawAttack(effect);
  if (effect.attackerId !== network.myId) {
    remotes.playAttack(effect.attackerId, effect.kind);
    playAttackSound(effect.kind);
  }
  if (effect.attackerId === network.myId) playLocalAttack(effect.kind);
};
network.onDamage = (event) => {
  showDamageNumber(event);
  if (event.attackerId === network.myId) showHitX();
  if (event.targetId === network.myId) {
    localStats.hp = event.hp;
    localStats.maxHp = event.maxHp;
    renderHp();
  }
};
network.onReloaded = (ammo) => {
  localStats.reloading = false;
  localStats.ammo = ammo;
  renderAmmo();
};
network.onRoundOver = (event) => {
  sounds.ding();
  for (const item of event.scores) {
    if (item.id === network.myId) score.me = item.score;
    else score.opp = item.score;
  }
  renderScore();
};

function updateScoreFromPlayers(players: PlayerState[]) {
  const me = players.find((p) => p.id === network.myId);
  const opp = players.find((p) => p.id !== network.myId);
  if (me) score.me = me.score;
  if (opp) score.opp = opp.score;
  renderScore();
}

function renderPlayerList() {
  playerListEl.innerHTML = '';
  for (const p of lastPlayers) {
    const isMe = p.id === network.myId;
    const row = document.createElement('div');
    row.className = `row ${isMe ? 'me' : 'opp'}`;
    const dot = document.createElement('span');
    dot.className = 'dot';
    const name = document.createElement('span');
    name.textContent = `${p.name || `Player ${p.id}`} - ${CLASS_LABELS[p.className]} ${p.hp}/${p.maxHp}`;
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

function renderAmmo() {
  if (!hasJoined) {
    weaponLabelEl.textContent = selectedClass === 'gi' ? 'Ammo' : 'Weapon';
    ammoCountEl.textContent =
      selectedClass === 'gi' ? '30/30' : selectedClass === 'mage' ? 'Wand' : 'Dagger';
  } else if (localStats.className === 'gi') {
    weaponLabelEl.textContent = 'Ammo';
    ammoCountEl.textContent = localStats.reloading
      ? 'Reloading'
      : `${localStats.ammo}/${localStats.maxAmmo}`;
  } else {
    weaponLabelEl.textContent = 'Weapon';
    ammoCountEl.textContent =
      selectedClass === 'mage' || localStats.className === 'mage' ? 'Wand' : 'Dagger';
  }
}

function renderHp() {
  hpTextEl.textContent = `${localStats.hp}/${localStats.maxHp}`;
  const pct =
    localStats.maxHp > 0 ? THREE.MathUtils.clamp(localStats.hp / localStats.maxHp, 0, 1) : 0;
  hpFillEl.style.width = `${pct * 100}%`;
  hpFillEl.style.background =
    pct > 0.55
      ? 'linear-gradient(90deg, #35d07f, #b9f36b)'
      : pct > 0.25
        ? 'linear-gradient(90deg, #f2c94c, #f2994a)'
        : 'linear-gradient(90deg, #eb5757, #ff8a65)';
}

joinBtn.disabled = true;

function attemptJoin() {
  const raw = nameInput.value.trim().slice(0, 16);
  if (!raw) {
    nameErrorEl.textContent = 'Name is required';
    nameInput.setAttribute('aria-invalid', 'true');
    nameInput.focus();
    return;
  }
  ensureAudio();
  nameErrorEl.textContent = '';
  nameInput.removeAttribute('aria-invalid');
  myName = raw;
  if (!network.ws || network.ws.readyState !== WebSocket.OPEN) return;
  localStats.className = selectedClass;
  setViewWeapon(selectedClass);
  network.sendJoin(myName, selectedClass);
  hasJoined = true;
  nameForm.style.display = 'none';
  playText.style.display = 'block';
  overlayPanel.classList.add('clickable');
  controls.lock();
}

joinBtn.addEventListener('click', attemptJoin);
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') attemptJoin();
});
nameInput.addEventListener('input', () => {
  if (!nameInput.value.trim()) return;
  nameErrorEl.textContent = '';
  nameInput.removeAttribute('aria-invalid');
});

overlayPanel.addEventListener('click', () => {
  if (hasJoined) controls.lock();
});

network.connect('ws://localhost:8080');
nameInput.focus();

function beginPrimary() {
  if (localStats.className === 'gi') {
    input.fireHeld = true;
    fireAttack('gi-shot');
  } else if (localStats.className === 'mage') {
    fireAttack('mage-shot');
  } else {
    fireAttack('assassin-slash');
  }
}

function beginSecondary() {
  if (localStats.className === 'gi') {
    input.aimHeld = true;
    return;
  }
  input.charging = true;
  input.chargeStart = performance.now();
}

function endSecondary() {
  if (localStats.className === 'gi') {
    input.aimHeld = false;
    return;
  }
  if (!input.charging) return;
  const held = performance.now() - input.chargeStart;
  input.charging = false;
  if (localStats.className === 'mage' && held >= 1000) fireAttack('mage-charged', held / 1000);
  if (localStats.className === 'assassin' && held >= 300)
    fireAttack('assassin-charged', held / 1000);
}

function reloadWeapon() {
  if (!hasJoined || localStats.className !== 'gi' || localStats.reloading) return;
  if (localStats.ammo >= localStats.maxAmmo) return;
  localStats.reloading = true;
  input.fireHeld = false;
  input.reloadAnim = 1.25;
  sounds.reload();
  dropMagazine();
  renderAmmo();
  network.sendReload();
}

function fireAttack(kind: AttackKind, charge = 0) {
  const now = performance.now();
  const config = ATTACK_CONFIG[kind];
  if (now < input.nextAttackAt) return;
  if (config.localAmmo && (localStats.ammo <= 0 || localStats.reloading)) return;
  const isSettledGiShot = kind === 'gi-shot' && now - input.lastGiShotAt >= GI_GUN.firstShotResetMs;
  input.nextAttackAt = now + config.cooldown;
  if (kind === 'gi-shot') input.lastGiShotAt = now;
  if (config.localAmmo) {
    localStats.ammo = Math.max(0, localStats.ammo - 1);
    renderAmmo();
    sounds.giShot();
    sounds.caseDrop();
    dropBulletCase();
    if (localStats.ammo <= 0) setTimeout(reloadWeapon, 80);
  } else if (kind === 'mage-shot' || kind === 'mage-charged') {
    sounds.magic(kind === 'mage-charged');
  } else {
    sounds.slash();
  }

  const origin = new THREE.Vector3();
  const visualOrigin = getWeaponTipWorld();
  const direction = new THREE.Vector3();
  camera.getWorldPosition(origin);
  camera.getWorldDirection(direction);
  if (kind === 'gi-shot' && !isSettledGiShot) applyGiSpread(direction);
  network.sendAttack(kind, origin, direction, charge, visualOrigin);
  if (kind === 'gi-shot' && !isSettledGiShot) applyGiRecoil();
}

function applyGiSpread(direction: THREE.Vector3) {
  const spread = input.aimHeld ? GI_GUN.aimedSpreadRad : GI_GUN.spreadRad;
  const yaw = (Math.random() * 2 - 1) * spread;
  const pitch = (Math.random() * 2 - 1) * spread;
  const right = new THREE.Vector3().crossVectors(direction, UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, direction).normalize();
  direction.addScaledVector(right, yaw).addScaledVector(up, pitch).normalize();
}

function applyGiRecoil() {
  const mult = input.aimHeld ? GI_GUN.aimedRecoilMult : 1;
  const pitchKick = GI_GUN.recoilPitchRad * mult * (0.75 + Math.random() * 0.5);
  const yawKick = GI_GUN.recoilYawRad * mult * (Math.random() * 2 - 1);
  const nextPitch = THREE.MathUtils.clamp(
    camera.rotation.x + pitchKick,
    -Math.PI / 2 + 0.01,
    Math.PI / 2 - 0.01,
  );
  const appliedPitch = nextPitch - camera.rotation.x;
  camera.rotation.x = nextPitch;
  camera.rotation.y += yawKick;
  recoil.pitch = THREE.MathUtils.clamp(
    recoil.pitch + appliedPitch,
    -GI_GUN.maxRecoverablePitchRad,
    GI_GUN.maxRecoverablePitchRad,
  );
  recoil.yaw = THREE.MathUtils.clamp(
    recoil.yaw + yawKick,
    -GI_GUN.maxRecoverableYawRad,
    GI_GUN.maxRecoverableYawRad,
  );
  recoil.weaponKick = Math.min(1, recoil.weaponKick + 0.42);
}

function getWeaponTipWorld(): THREE.Vector3 {
  if (!viewWeapon) return camera.getWorldPosition(new THREE.Vector3());
  const tipByClass: Record<PlayerClass, THREE.Vector3> = {
    gi: new THREE.Vector3(0, 0.02, -0.9),
    mage: new THREE.Vector3(0, 0, -0.78),
    assassin: new THREE.Vector3(0, 0, -0.66),
  };
  return viewWeapon.localToWorld(tipByClass[localStats.className].clone());
}

function playLocalAttack(kind: AttackKind) {
  input.localAnim = {
    kind,
    time: kind === 'mage-charged' || kind === 'assassin-charged' ? 0.28 : 0.18,
  };
}

function updateWeaponAnimation(dt: number) {
  if (!viewWeapon) return;
  const basePos = new THREE.Vector3(0.36, -0.28, -0.62);
  if (localStats.className === 'gi') {
    basePos.y -= recoil.weaponKick * 0.025;
    basePos.z += recoil.weaponKick * 0.1;
  }
  const baseRot = new THREE.Euler(-0.05, -0.22, -0.08);
  const magazine = viewWeapon.getObjectByName('magazine');

  if (input.reloadAnim > 0 && localStats.className === 'gi') {
    input.reloadAnim = Math.max(0, input.reloadAnim - dt);
    const p = 1 - input.reloadAnim / 1.25;
    if (magazine) magazine.visible = p < 0.18 || p > 0.72;
    viewWeapon.position.set(
      basePos.x - 0.08 * Math.sin(p * Math.PI),
      basePos.y - 0.06 * Math.sin(p * Math.PI * 1.5),
      basePos.z + 0.08 * Math.sin(p * Math.PI),
    );
    viewWeapon.rotation.set(
      baseRot.x - 0.25 * Math.sin(p * Math.PI),
      baseRot.y - 0.18,
      baseRot.z + 0.25 * Math.sin(p * Math.PI),
    );
    if (input.reloadAnim <= 0 && magazine) magazine.visible = true;
    return;
  }

  if (magazine) magazine.visible = true;

  if (input.charging && localStats.className === 'mage') {
    const t = (performance.now() - input.chargeStart) / 1000;
    viewWeapon.position.copy(basePos);
    viewWeapon.rotation.set(
      baseRot.x + Math.sin(t * 9) * 0.18,
      baseRot.y + Math.cos(t * 7) * 0.22,
      baseRot.z + t * 5,
    );
    if (t >= 1) {
      input.charging = false;
      fireAttack('mage-charged', t);
    }
    return;
  }

  if (input.charging && localStats.className === 'assassin') {
    const t = (performance.now() - input.chargeStart) / 1000;
    viewWeapon.position.set(0.3 + Math.min(t, 0.7) * 0.06, -0.2, -0.5);
    viewWeapon.rotation.set(baseRot.x - 0.45, baseRot.y - 0.2, baseRot.z + 0.9);
    return;
  }

  if (input.localAnim) {
    input.localAnim.time -= dt;
    const duration =
      input.localAnim.kind === 'mage-charged' || input.localAnim.kind === 'assassin-charged'
        ? 0.28
        : 0.18;
    const p = 1 - Math.max(0, input.localAnim.time / duration);
    if (input.localAnim.kind === 'assassin-slash' || input.localAnim.kind === 'assassin-charged') {
      viewWeapon.position.set(0.36, -0.24 + Math.sin(p * Math.PI) * 0.08, -0.62);
      viewWeapon.rotation.set(
        baseRot.x - 0.35,
        baseRot.y - Math.sin(p * Math.PI) * 0.75,
        baseRot.z + 0.75,
      );
    } else {
      viewWeapon.position.set(0.36, -0.28, -0.62 + Math.sin(p * Math.PI) * 0.12);
      viewWeapon.rotation.copy(baseRot);
    }
    if (input.localAnim.time <= 0) input.localAnim = null;
    return;
  }

  viewWeapon.position.lerp(basePos, 1 - Math.exp(-dt * 16));
  viewWeapon.rotation.x += (baseRot.x - viewWeapon.rotation.x) * (1 - Math.exp(-dt * 16));
  viewWeapon.rotation.y += (baseRot.y - viewWeapon.rotation.y) * (1 - Math.exp(-dt * 16));
  viewWeapon.rotation.z += (baseRot.z - viewWeapon.rotation.z) * (1 - Math.exp(-dt * 16));
}

function updateRecoil(dt: number) {
  const alpha = 1 - Math.exp(-dt * 9);
  const pitchRecover = recoil.pitch * alpha;
  const yawRecover = recoil.yaw * alpha;
  camera.rotation.x = THREE.MathUtils.clamp(
    camera.rotation.x - pitchRecover,
    -Math.PI / 2 + 0.01,
    Math.PI / 2 - 0.01,
  );
  camera.rotation.y -= yawRecover;
  recoil.pitch -= pitchRecover;
  recoil.yaw -= yawRecover;
  recoil.weaponKick += (0 - recoil.weaponKick) * (1 - Math.exp(-dt * 18));
}

type TimedObject = { obj: THREE.Object3D; life: number; maxLife: number };
const timedObjects: TimedObject[] = [];
type FlyingPart = { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number };
const flyingParts: FlyingPart[] = [];

function dropBulletCase() {
  if (!viewWeapon) return;
  const casing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.12, 10),
    new THREE.MeshStandardMaterial({ color: 0xd0a34a, metalness: 0.55, roughness: 0.35 }),
  );
  casing.rotation.z = Math.PI / 2;
  casing.position.copy(viewWeapon.localToWorld(new THREE.Vector3(0.14, -0.02, -0.32)));
  scene.add(casing);
  flyingParts.push({
    mesh: casing,
    vel: new THREE.Vector3(1.4, 0.8, 0.35).applyQuaternion(camera.quaternion),
    spin: new THREE.Vector3(9, 12, 6),
    life: 1.2,
  });
}

function dropMagazine() {
  if (!viewWeapon) return;
  const mag = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, 0.28, 0.14),
    new THREE.MeshStandardMaterial({ color: 0x111416, roughness: 0.7 }),
  );
  mag.position.copy(viewWeapon.localToWorld(new THREE.Vector3(0, -0.2, -0.17)));
  mag.quaternion.copy(viewWeapon.getWorldQuaternion(new THREE.Quaternion()));
  scene.add(mag);
  flyingParts.push({
    mesh: mag,
    vel: new THREE.Vector3(0.15, -0.1, -0.1).applyQuaternion(camera.quaternion),
    spin: new THREE.Vector3(4, 2, 6),
    life: 1.5,
  });
}

function drawAttack(effect: AttackEffect) {
  const origin = new THREE.Vector3(effect.ox, effect.oy, effect.oz);
  const end = new THREE.Vector3(effect.ex, effect.ey, effect.ez);
  const color = ATTACK_CONFIG[effect.kind].color;

  if (effect.kind === 'assassin-slash' || effect.kind === 'assassin-charged') {
    const radius = effect.kind === 'assassin-charged' ? 1.45 : 1.05;
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.025, 8, 36, Math.PI * 1.1),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }),
    );
    arc.position
      .copy(origin)
      .add(new THREE.Vector3(effect.dx, effect.dy, effect.dz).multiplyScalar(1.1));
    arc.rotation.set(Math.PI / 2, 0, Math.atan2(effect.dx, effect.dz));
    scene.add(arc);
    timedObjects.push({ obj: arc, life: 0.18, maxLife: 0.18 });
    return;
  }

  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([origin, end]),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: effect.className === 'gi' ? 0.95 : 0.55,
    }),
  );
  scene.add(line);
  timedObjects.push({
    obj: line,
    life: effect.className === 'gi' ? 0.12 : 0.4,
    maxLife: effect.className === 'gi' ? 0.12 : 0.4,
  });

  if (ATTACK_CONFIG[effect.kind].flash) {
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 12),
      new THREE.MeshBasicMaterial({
        color: ATTACK_CONFIG[effect.kind].flash,
        transparent: true,
        opacity: 1,
      }),
    );
    flash.position.copy(origin);
    scene.add(flash);
    timedObjects.push({ obj: flash, life: 0.08, maxLife: 0.08 });
  }

  if (ATTACK_CONFIG[effect.kind].projectile) {
    addMagicTrail(origin, end, effect.kind === 'mage-charged');
  }
}

function addMagicTrail(origin: THREE.Vector3, end: THREE.Vector3, charged: boolean) {
  const count = charged ? 18 : 10;
  for (let i = 0; i < count; i++) {
    const p = origin.clone().lerp(end, i / Math.max(1, count - 1));
    const wave = i * 1.7;
    p.x += Math.sin(wave) * (charged ? 0.18 : 0.09);
    p.y += Math.cos(wave) * (charged ? 0.18 : 0.09);
    const sparkle = new THREE.Mesh(
      new THREE.SphereGeometry(charged ? 0.055 : 0.035, 8, 8),
      new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0x8df5ff : 0xffb7f7,
        transparent: true,
        opacity: 0.85,
      }),
    );
    sparkle.position.copy(p);
    scene.add(sparkle);
    timedObjects.push({ obj: sparkle, life: charged ? 0.7 : 0.45, maxLife: charged ? 0.7 : 0.45 });
  }
}

function updateTimedObjects(dt: number) {
  for (let i = timedObjects.length - 1; i >= 0; i--) {
    const item = timedObjects[i];
    item.life -= dt;
    const opacity = Math.max(0, item.life / item.maxLife);
    item.obj.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        const material = obj.material;
        if (!Array.isArray(material)) material.opacity = opacity;
      }
    });
    if (item.life <= 0) {
      scene.remove(item.obj);
      timedObjects.splice(i, 1);
    }
  }
}

function updateFlyingParts(dt: number) {
  for (let i = flyingParts.length - 1; i >= 0; i--) {
    const part = flyingParts[i];
    part.life -= dt;
    part.vel.y -= 5.5 * dt;
    part.mesh.position.addScaledVector(part.vel, dt);
    part.mesh.rotation.x += part.spin.x * dt;
    part.mesh.rotation.y += part.spin.y * dt;
    part.mesh.rotation.z += part.spin.z * dt;
    if (part.mesh.position.y < 0.04) {
      part.mesh.position.y = 0.04;
      part.vel.multiplyScalar(0.35);
      part.vel.y = Math.abs(part.vel.y) * 0.18;
    }
    if (part.life <= 0) {
      scene.remove(part.mesh);
      flyingParts.splice(i, 1);
    }
  }
}

type DamageMarker = {
  el: HTMLDivElement;
  targetId: string;
  pos: THREE.Vector3;
  age: number;
  offset: number;
};
const damageMarkers: DamageMarker[] = [];

function showDamageNumber(event: DamageEvent) {
  const activeForTarget = damageMarkers.filter(
    (m) => m.targetId === event.targetId && m.age < 0.55,
  ).length;
  const el = document.createElement('div');
  el.className = 'damage-number';
  el.textContent = `-${event.amount}`;
  damageLayer.appendChild(el);
  damageMarkers.push({
    el,
    targetId: event.targetId,
    pos: new THREE.Vector3(event.x, event.y, event.z),
    age: 0,
    offset: activeForTarget * 22,
  });
}

function updateDamageMarkers(dt: number) {
  for (let i = damageMarkers.length - 1; i >= 0; i--) {
    const marker = damageMarkers[i];
    marker.age += dt;
    const screen = marker.pos.clone();
    screen.y += marker.age * 0.65;
    screen.project(camera);
    const visible = screen.z > -1 && screen.z < 1;
    const x = (screen.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-screen.y * 0.5 + 0.5) * window.innerHeight - marker.offset;
    marker.el.style.left = `${x}px`;
    marker.el.style.top = `${y}px`;
    marker.el.style.opacity = visible ? String(Math.max(0, 1 - marker.age / 0.95)) : '0';
    marker.el.style.transform = `translate(-50%, -50%) scale(${1 + marker.age * 0.25})`;
    if (marker.age >= 0.95) {
      marker.el.remove();
      damageMarkers.splice(i, 1);
    }
  }
}

let hitXTimer = 0;
function showHitX() {
  hitXTimer = 0.18;
  hitXEl.classList.add('show');
}

const SEND_HZ = 20;
let lastSent = 0;
const tmpFwd = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const clock = new THREE.Clock();

function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const obj = controls.getObject();

  if (controls.isLocked) {
    player.crouch = keys.crouch;

    let fwd = 0;
    let strafe = 0;
    if (keys.w) fwd += 1;
    if (keys.s) fwd -= 1;
    if (keys.d) strafe += 1;
    if (keys.a) strafe -= 1;

    const len = Math.hypot(fwd, strafe);
    if (len > 0) {
      fwd /= len;
      strafe /= len;
      const move = CLASS_MOVE[localStats.className];
      const sprintMult = keys.sprint && !player.crouch ? move.sprint : 1;
      const crouchMult = player.crouch ? 0.55 : 1;
      const speed = move.walk * sprintMult * crouchMult;

      camera.getWorldDirection(tmpFwd);
      tmpFwd.y = 0;
      tmpFwd.normalize();
      tmpRight.crossVectors(tmpFwd, UP).normalize();

      const dx = (tmpFwd.x * fwd + tmpRight.x * strafe) * speed * dt;
      const dz = (tmpFwd.z * fwd + tmpRight.z * strafe) * speed * dt;
      moveWithCollision(player.pos, dx, dz);
    }

    const grounded = player.pos.y <= 0.0001 && player.vy <= 0;
    if (grounded && keys.jump && !player.crouch) {
      player.vy = JUMP_SPEED;
    }
    player.vy -= GRAVITY * dt;
    player.pos.y += player.vy * dt;
    if (player.pos.y < 0) {
      player.pos.y = 0;
      player.vy = 0;
    }

    const targetEye = player.crouch ? CROUCH_EYE : STAND_EYE;
    const eyeAlpha = 1 - Math.exp(-dt * 14);
    player.eye += (targetEye - player.eye) * eyeAlpha;

    obj.position.x = THREE.MathUtils.clamp(player.pos.x, -29.5, 29.5);
    obj.position.z = THREE.MathUtils.clamp(player.pos.z, -29.5, 29.5);
    player.pos.x = obj.position.x;
    player.pos.z = obj.position.z;
    obj.position.y = player.pos.y + player.eye;
  }

  if (input.fireHeld && localStats.className === 'gi' && controls.isLocked) {
    fireAttack('gi-shot');
  }

  const targetFov = input.aimHeld && localStats.className === 'gi' ? 50 : 75;
  camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-dt * 16));
  camera.updateProjectionMatrix();

  updateRecoil(dt);
  updateWeaponAnimation(dt);
  updateTimedObjects(dt);
  updateFlyingParts(dt);
  updateDamageMarkers(dt);
  if (hitXTimer > 0) {
    hitXTimer -= dt;
    if (hitXTimer <= 0) hitXEl.classList.remove('show');
  }

  const now = performance.now();
  if (now - lastSent > 1000 / SEND_HZ) {
    lastSent = now;
    network.sendInput(
      player.pos.x,
      player.pos.y,
      player.pos.z,
      camera.rotation.y,
      camera.rotation.x,
      player.crouch,
    );
  }

  remotes.interpolate(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
