import type { AttackKind } from './types.js';

let audioCtx: AudioContext | null = null;

export function ensureAudio(): AudioContext | null {
  const AudioContextCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  audioCtx ??= new AudioContextCtor();
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

function tone(freq: number, duration: number, type: OscillatorType, gain = 0.08, delay = 0) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const vol = ctx.createGain();
  const start = ctx.currentTime + delay;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  vol.gain.setValueAtTime(gain, start);
  vol.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(vol).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration);
}

function noise(duration: number, gain = 0.05, delay = 0) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const samples = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  const vol = ctx.createGain();
  const start = ctx.currentTime + delay;
  source.buffer = buffer;
  vol.gain.setValueAtTime(gain, start);
  vol.gain.exponentialRampToValueAtTime(0.001, start + duration);
  source.connect(vol).connect(ctx.destination);
  source.start(start);
  source.stop(start + duration);
}

export const sounds = {
  giShot() {
    noise(0.045, 0.08);
    tone(95, 0.055, 'square', 0.045);
  },
  caseDrop() {
    tone(980, 0.035, 'triangle', 0.025, 0.16);
    tone(1320, 0.025, 'triangle', 0.018, 0.22);
  },
  reload() {
    tone(280, 0.08, 'sawtooth', 0.045);
    tone(460, 0.06, 'triangle', 0.035, 0.42);
    tone(210, 0.08, 'square', 0.035, 0.86);
  },
  magic(charged = false) {
    tone(charged ? 330 : 520, charged ? 0.22 : 0.12, 'sine', 0.055);
    tone(charged ? 880 : 760, charged ? 0.28 : 0.16, 'triangle', 0.04, 0.02);
  },
  slash() {
    noise(0.09, 0.045);
    tone(620, 0.07, 'sawtooth', 0.035);
  },
  ding() {
    tone(784, 0.16, 'sine', 0.08);
    tone(1175, 0.22, 'sine', 0.06, 0.08);
  },
};

export function playAttackSound(kind: AttackKind) {
  if (kind === 'gi-shot') {
    sounds.giShot();
    sounds.caseDrop();
  } else if (kind === 'mage-shot' || kind === 'mage-charged') {
    sounds.magic(kind === 'mage-charged');
  } else {
    sounds.slash();
  }
}
