import { getBoolPref } from "@/lib/session";

export type SoundName = "flick" | "riffle" | "tick" | "flip";

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
function isMuted(): boolean {
  return getBoolPref("muted");
}

export function unlockAudio() {
  if (typeof window === "undefined" || isMuted()) return;
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

function noiseBuffer(ac: AudioContext): AudioBuffer {
  if (noise) return noise;
  const len = Math.floor(ac.sampleRate * 0.25);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noise = buf;
  return buf;
}

function burst(ac: AudioContext, at: number, opts: { freq: number; q: number; dur: number; gain: number }) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = opts.freq;
  filter.Q.value = opts.q;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(opts.gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + opts.dur);
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(at, Math.random() * 0.1, opts.dur + 0.02);
}

function blip(ac: AudioContext, at: number, freq: number, dur: number, gain: number) {
  const osc = ac.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, at);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.6, at + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

export function playSound(name: SoundName) {
  if (isMuted() || !ctx || ctx.state !== "running") return;
  const ac = ctx;
  const t = ac.currentTime + 0.005;
  try {
    switch (name) {
      case "flick":
        burst(ac, t, { freq: 2600, q: 0.9, dur: 0.07, gain: 0.22 });
        break;
      case "flip":
        burst(ac, t, { freq: 1800, q: 1.2, dur: 0.05, gain: 0.16 });
        burst(ac, t + 0.045, { freq: 3200, q: 1.2, dur: 0.04, gain: 0.1 });
        break;
      case "tick":
        blip(ac, t, 1400, 0.05, 0.08);
        burst(ac, t, { freq: 4000, q: 2, dur: 0.03, gain: 0.08 });
        break;
      case "riffle": {
        const n = 16;
        for (let i = 0; i < n; i++) {
          const jitter = Math.random() * 0.012;
          burst(ac, t + i * 0.024 + jitter, {
            freq: 2000 + Math.random() * 1800,
            q: 1.4,
            dur: 0.035,
            gain: 0.07 + 0.06 * Math.sin((i / n) * Math.PI),
          });
        }
        break;
      }
    }
  } catch {
  }
}

export function haptic(pattern: number | number[] = 8) {
  if (isMuted()) return;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
    }
  } catch {
  }
}
