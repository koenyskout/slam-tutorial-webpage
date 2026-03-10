export function modelA(t) {
  const x = 50 + 24 * Math.cos(0.72 * t) + 10 * Math.cos(2.2 * t + 0.4);
  const y = 50 + 19 * Math.sin(1.05 * t) + 8 * Math.sin(2.6 * t);
  const dx = -24 * 0.72 * Math.sin(0.72 * t) - 10 * 2.2 * Math.sin(2.2 * t + 0.4);
  const dy = 19 * 1.05 * Math.cos(1.05 * t) + 8 * 2.6 * Math.cos(2.6 * t);
  return { x, y, theta: Math.atan2(dy, dx) };
}

export function modelB(t) {
  const x = 50 + 21 * Math.cos(0.78 * t) + 10 * Math.sin(1.4 * t);
  const y = 49 + 20 * Math.sin(0.9 * t) + 6 * Math.sin(2.8 * t + 0.3);
  const dx = -21 * 0.78 * Math.sin(0.78 * t) + 10 * 1.4 * Math.cos(1.4 * t);
  const dy = 20 * 0.9 * Math.cos(0.9 * t) + 6 * 2.8 * Math.cos(2.8 * t + 0.3);
  return { x, y, theta: Math.atan2(dy, dx) };
}

export function modelC(t) {
  const x = 50 + 28 * Math.cos(0.55 * t) + 7 * Math.cos(1.9 * t + 0.7);
  const y = 50 + 24 * Math.sin(0.64 * t) + 8 * Math.sin(2.1 * t);
  const dx = -28 * 0.55 * Math.sin(0.55 * t) - 7 * 1.9 * Math.sin(1.9 * t + 0.7);
  const dy = 24 * 0.64 * Math.cos(0.64 * t) + 8 * 2.1 * Math.cos(2.1 * t);
  return { x, y, theta: Math.atan2(dy, dx) };
}
