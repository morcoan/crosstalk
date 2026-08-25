/** All game audio is synthesized with WebAudio — zero asset files. */

let ctx: AudioContext | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

let muted = storage()?.getItem("crosstalk.muted") === "1";

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  storage()?.setItem("crosstalk.muted", m ? "1" : "0");
}

/** Ensure the AudioContext is unlocked; call from a user gesture. */
export function unlock(): void {
  void ac();
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0): void {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + when;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sfx = {
  /** Signal-module beep. */
  beep(long: boolean): void {
    tone(880, long ? 0.4 : 0.12, "sine", 0.12);
  },
  click(): void {
    tone(1400, 0.03, "square", 0.05);
  },
  timerTick(): void {
    tone(1100, 0.025, "square", 0.035);
  },
  strike(): void {
    tone(220, 0.28, "sawtooth", 0.14);
    tone(160, 0.34, "sawtooth", 0.12, 0.06);
  },
  solve(): void {
    tone(660, 0.09, "sine", 0.1);
    tone(880, 0.12, "sine", 0.1, 0.09);
  },
  win(): void {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, "triangle", 0.12, i * 0.12));
  },
  boom(): void {
    const a = ac();
    if (!a) return;
    const dur = 1.4;
    const buffer = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.2);
    }
    const src = a.createBufferSource();
    src.buffer = buffer;
    const filter = a.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(3000, a.currentTime);
    filter.frequency.exponentialRampToValueAtTime(60, a.currentTime + dur);
    const g = a.createGain();
    g.gain.value = 0.5;
    src.connect(filter).connect(g).connect(a.destination);
    src.start();
    tone(55, 1.1, "sine", 0.4);
  }
};
