import { TAU } from "./constants.js";

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function wrapAngle(angle) {
  let a = angle;
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export function randn() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

export function gaussianPdf(x, mean, sigma) {
  const s = Math.max(1e-6, sigma);
  const z = (x - mean) / s;
  return Math.exp(-0.5 * z * z) / (s * Math.sqrt(2 * Math.PI));
}

export function logistic(x) {
  return 1 / (1 + Math.exp(-x));
}

export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function makeLandmarks(count, seed) {
  const random = seededRandom(seed);
  const out = [];
  let attempts = 0;

  while (out.length < count && attempts < 5000) {
    attempts += 1;
    const x = 10 + random() * 80;
    const y = 10 + random() * 80;
    let ok = true;

    for (const p of out) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < 8) {
        ok = false;
        break;
      }
    }

    if (ok) {
      out.push({ id: out.length, x, y });
    }
  }

  return out;
}
