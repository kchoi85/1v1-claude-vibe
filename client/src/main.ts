import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { Network } from './network.js';
import { RemotePlayers } from './remote.js';
import type { PlayerState } from './types.js';

const app = document.getElementById('app')!;
const overlay = document.getElementById('overlay')!;
const overlayPanel = document.getElementById('overlay-panel')!;
const nameForm = document.getElementById('name-form')!;
const playText = document.getElementById('play-text')!;
const nameInput = document.getElementById('name-input') as HTMLInputElement;
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
const statusEl = document.getElementById('status')!;
const scoreMeEl = document.getElementById('score-me')!;
const scoreOppEl = document.getElementById('score-opp')!;
const playerListEl = document.getElementById('player-list')!;

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

const PLAYER_RADIUS = 0.4;
const WALK_SPEED = 6;
const SPRINT_MULT = 1.6;
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
  statusEl.textContent = 'disconnected — start server: npm run dev:server';
  joinBtn.disabled = true;
};
network.onState = (players) => {
  lastPlayers = players;
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

function renderPlayerList() {
  playerListEl.innerHTML = '';
  for (const p of lastPlayers) {
    const isMe = p.id === network.myId;
    const row = document.createElement('div');
    row.className = `row ${isMe ? 'me' : 'opp'}`;
    const dot = document.createElement('span');
    dot.className = 'dot';
    const name = document.createElement('span');
    name.textContent = p.name || `Player ${p.id}`;
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

let hasJoined = false;
joinBtn.disabled = true;

function attemptJoin() {
  const raw = nameInput.value.trim().slice(0, 16);
  myName = raw.length > 0 ? raw : `Player`;
  if (!network.ws || network.ws.readyState !== WebSocket.OPEN) return;
  network.sendJoin(myName);
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

overlayPanel.addEventListener('click', () => {
  if (hasJoined) controls.lock();
});

network.connect('ws://localhost:8080');
nameInput.focus();

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

    // Horizontal movement
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
      const sprintMult = keys.sprint && !player.crouch ? SPRINT_MULT : 1;
      const crouchMult = player.crouch ? 0.55 : 1;
      const speed = WALK_SPEED * sprintMult * crouchMult;

      camera.getWorldDirection(tmpFwd);
      tmpFwd.y = 0;
      tmpFwd.normalize();
      tmpRight.crossVectors(tmpFwd, UP).normalize();

      const dx = (tmpFwd.x * fwd + tmpRight.x * strafe) * speed * dt;
      const dz = (tmpFwd.z * fwd + tmpRight.z * strafe) * speed * dt;
      moveWithCollision(player.pos, dx, dz);
    }

    // Vertical movement (jump + gravity)
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

    // Eye-height interpolation toward stand/crouch target
    const targetEye = player.crouch ? CROUCH_EYE : STAND_EYE;
    const eyeAlpha = 1 - Math.exp(-dt * 14);
    player.eye += (targetEye - player.eye) * eyeAlpha;

    obj.position.x = THREE.MathUtils.clamp(player.pos.x, -29.5, 29.5);
    obj.position.z = THREE.MathUtils.clamp(player.pos.z, -29.5, 29.5);
    player.pos.x = obj.position.x;
    player.pos.z = obj.position.z;
    obj.position.y = player.pos.y + player.eye;
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
