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

export function playSpecialPlaySound(): void {
  const ac = getCtx();
  if (!ac) return;
  const t = ac.currentTime;
  tone(400, t,        0.12, 0.3, ac);
  tone(600, t + 0.11, 0.15, 0.3, ac);
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
