let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
    }
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  frequency: number,
  startTime: number,
  duration: number,
  gain: number,
  ac: AudioContext
): void {
  const osc = ac.createOscillator();
  const gainNode = ac.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, startTime);

  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  osc.connect(gainNode);
  gainNode.connect(ac.destination);

  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

export function playCardSound(): void {
  const ac = getCtx();
  if (!ac) return;
  const t = ac.currentTime;
  tone(220, t, 0.07, 0.25, ac);
}

export function playTurnStartSound(): void {
  const ac = getCtx();
  if (!ac) return;
  const t = ac.currentTime;
  tone(440, t, 0.10, 0.2, ac);
}

export function playWinSound(): void {
  const ac = getCtx();
  if (!ac) return;
  const t = ac.currentTime;
  // C major arpeggio: C4 E4 G4 C5
  [262, 330, 392, 523].forEach((freq, i) => {
    tone(freq, t + i * 0.13, 0.18, 0.3, ac);
  });
}

export function playLoseSound(): void {
  const ac = getCtx();
  if (!ac) return;
  const t = ac.currentTime;
  // Descending minor: A3 F3 C3
  [220, 175, 131].forEach((freq, i) => {
    tone(freq, t + i * 0.15, 0.22, 0.28, ac);
  });
}

function noiseBurst(start: number, duration: number, gain: number, frequency: number, ac: AudioContext, rampUp = 0.005): void {
  const length = Math.max(1, Math.floor(ac.sampleRate * duration));
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  const source = ac.createBufferSource();
  source.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = frequency;
  const env = ac.createGain();
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(gain, start + rampUp);
  env.gain.exponentialRampToValueAtTime(0.001, start + duration);
  source.connect(filter);
  filter.connect(env);
  env.connect(ac.destination);
  source.start(start);
}

// A big jump: a short falling groan, kept quiet so it nudges rather than scolds.
export function playGroanSound(): void {
  const ac = getCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const env = ac.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(170, t);
  osc.frequency.exponentialRampToValueAtTime(70, t + 0.5);
  filter.type = 'lowpass';
  filter.frequency.value = 520;
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.18, t + 0.04);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
  osc.connect(filter);
  filter.connect(env);
  env.connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.6);
}

// A tiny move: polite golf clap, a few soft claps that fade.
export function playGolfClapSound(): void {
  const ac = getCtx();
  if (!ac) return;
  const t = ac.currentTime;
  [0, 0.13, 0.25, 0.4].forEach((offset, i) => noiseBurst(t + offset, 0.05, 0.22 - i * 0.04, 1600, ac));
}

// Backward ten: crowd swell with a rising chord.
export function playCheerSound(): void {
  const ac = getCtx();
  if (!ac) return;
  const t = ac.currentTime;
  noiseBurst(t, 1.0, 0.3, 1800, ac, 0.35);
  [523, 659, 784, 1047].forEach((freq, i) => tone(freq, t + i * 0.09, 0.35, 0.18, ac));
}
