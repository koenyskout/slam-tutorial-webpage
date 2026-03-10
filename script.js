const TAU = Math.PI * 2;
const THEME = {
  truePath: "#2f668e",
  truePose: "#2f668e",
  odomPath: "#a17034",
  correctedPath: "#2d8377",
  rawBaseline: "#8d949c",
  landmark: "#5f86a5",
  map: "#2d8377",
  gridMinor: "rgba(125, 145, 162, 0.22)",
  gridMajor: "rgba(104, 126, 145, 0.46)",
  ray: "rgba(161, 112, 52, 0.26)",
  link: "rgba(161, 112, 52, 0.45)",
  truthGap: "rgba(47, 102, 142, 0.42)",
  truthHalo: "rgba(47, 102, 142, 0.14)",
  truthHintPath: "rgba(47, 102, 142, 0.46)",
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function wrapAngle(angle) {
  let a = angle;
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

function randn() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

function gaussianPdf(x, mean, sigma) {
  const s = Math.max(1e-6, sigma);
  const z = (x - mean) / s;
  return Math.exp(-0.5 * z * z) / (s * Math.sqrt(2 * Math.PI));
}

function logistic(x) {
  return 1 / (1 + Math.exp(-x));
}

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeLandmarks(count, seed) {
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

function getMapper(canvas) {
  const margin = 32;
  const worldSize = 100;
  const scale = Math.min((canvas.width - margin * 2) / worldSize, (canvas.height - margin * 2) / worldSize);
  const ox = (canvas.width - worldSize * scale) / 2;
  const oy = (canvas.height - worldSize * scale) / 2;

  return {
    scale,
    toX: (x) => ox + x * scale,
    toY: (y) => canvas.height - (oy + y * scale),
  };
}

function drawGrid(ctx, canvas, mapper) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = THEME.gridMinor;
  ctx.lineWidth = 1;

  for (let v = 0; v <= 100; v += 10) {
    const x = mapper.toX(v);
    const y = mapper.toY(v);

    ctx.beginPath();
    ctx.moveTo(x, mapper.toY(0));
    ctx.lineTo(x, mapper.toY(100));
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(mapper.toX(0), y);
    ctx.lineTo(mapper.toX(100), y);
    ctx.stroke();
  }

  ctx.strokeStyle = THEME.gridMajor;
  ctx.beginPath();
  ctx.moveTo(mapper.toX(0), mapper.toY(0));
  ctx.lineTo(mapper.toX(100), mapper.toY(0));
  ctx.lineTo(mapper.toX(100), mapper.toY(100));
  ctx.lineTo(mapper.toX(0), mapper.toY(100));
  ctx.closePath();
  ctx.stroke();
}

function drawPath(ctx, mapper, points, color, width, dash = []) {
  if (points.length < 2) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(mapper.toX(points[0].x), mapper.toY(points[0].y));

  for (let i = 1; i < points.length; i += 1) {
    const p = points[i];
    ctx.lineTo(mapper.toX(p.x), mapper.toY(p.y));
  }

  ctx.stroke();
  ctx.setLineDash([]);
}

function drawRobot(ctx, mapper, pose, color, label) {
  const x = mapper.toX(pose.x);
  const y = mapper.toY(pose.y);
  const heading = -pose.theta;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 5.8, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(heading) * 16, y + Math.sin(heading) * 16);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = "12px IBM Plex Mono";
  ctx.fillText(label, x + 8, y - 10);
}

function clampPose(pose) {
  pose.x = clamp(pose.x, 2, 98);
  pose.y = clamp(pose.y, 2, 98);
}

function modelA(t) {
  const x = 50 + 24 * Math.cos(0.72 * t) + 10 * Math.cos(2.2 * t + 0.4);
  const y = 50 + 19 * Math.sin(1.05 * t) + 8 * Math.sin(2.6 * t);
  const dx = -24 * 0.72 * Math.sin(0.72 * t) - 10 * 2.2 * Math.sin(2.2 * t + 0.4);
  const dy = 19 * 1.05 * Math.cos(1.05 * t) + 8 * 2.6 * Math.cos(2.6 * t);
  return { x, y, theta: Math.atan2(dy, dx) };
}

function modelB(t) {
  const x = 50 + 21 * Math.cos(0.78 * t) + 10 * Math.sin(1.4 * t);
  const y = 49 + 20 * Math.sin(0.9 * t) + 6 * Math.sin(2.8 * t + 0.3);
  const dx = -21 * 0.78 * Math.sin(0.78 * t) + 10 * 1.4 * Math.cos(1.4 * t);
  const dy = 20 * 0.9 * Math.cos(0.9 * t) + 6 * 2.8 * Math.cos(2.8 * t + 0.3);
  return { x, y, theta: Math.atan2(dy, dx) };
}

function modelC(t) {
  const x = 50 + 28 * Math.cos(0.55 * t) + 7 * Math.cos(1.9 * t + 0.7);
  const y = 50 + 24 * Math.sin(0.64 * t) + 8 * Math.sin(2.1 * t);
  const dx = -28 * 0.55 * Math.sin(0.55 * t) - 7 * 1.9 * Math.sin(1.9 * t + 0.7);
  const dy = 24 * 0.64 * Math.cos(0.64 * t) + 8 * 2.1 * Math.cos(2.1 * t);
  return { x, y, theta: Math.atan2(dy, dx) };
}

class FrameTransformDemo {
  constructor() {
    this.canvas = document.getElementById("framesCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.readout = document.getElementById("framesReadout");

    this.frameX = document.getElementById("frameX");
    this.frameY = document.getElementById("frameY");
    this.frameTheta = document.getElementById("frameTheta");
    this.localX = document.getElementById("frameLocalX");
    this.localY = document.getElementById("frameLocalY");

    this.frameXValue = document.getElementById("frameXValue");
    this.frameYValue = document.getElementById("frameYValue");
    this.frameThetaValue = document.getElementById("frameThetaValue");
    this.localXValue = document.getElementById("frameLocalXValue");
    this.localYValue = document.getElementById("frameLocalYValue");

    this.resetBtn = document.getElementById("frameReset");
    this.bindEvents();
    this.reset();
  }

  bindEvents() {
    const update = () => this.updateLabels();
    this.frameX.addEventListener("input", update);
    this.frameY.addEventListener("input", update);
    this.frameTheta.addEventListener("input", update);
    this.localX.addEventListener("input", update);
    this.localY.addEventListener("input", update);
    this.resetBtn.addEventListener("click", () => this.reset());
  }

  reset() {
    this.frameX.value = "45";
    this.frameY.value = "40";
    this.frameTheta.value = "0.8";
    this.localX.value = "12";
    this.localY.value = "7";
    this.updateLabels();
    this.draw();
  }

  updateLabels() {
    this.frameXValue.textContent = Number(this.frameX.value).toFixed(1);
    this.frameYValue.textContent = Number(this.frameY.value).toFixed(1);
    this.frameThetaValue.textContent = `${Number(this.frameTheta.value).toFixed(2)} rad`;
    this.localXValue.textContent = Number(this.localX.value).toFixed(1);
    this.localYValue.textContent = Number(this.localY.value).toFixed(1);
  }

  step() {
    this.draw();
  }

  draw() {
    const mapper = getMapper(this.canvas);
    drawGrid(this.ctx, this.canvas, mapper);

    const rx = Number(this.frameX.value);
    const ry = Number(this.frameY.value);
    const theta = Number(this.frameTheta.value);
    const lx = Number(this.localX.value);
    const ly = Number(this.localY.value);

    const wx = rx + lx * Math.cos(theta) - ly * Math.sin(theta);
    const wy = ry + lx * Math.sin(theta) + ly * Math.cos(theta);

    const originX = mapper.toX(rx);
    const originY = mapper.toY(ry);
    const ux = Math.cos(theta);
    const uy = Math.sin(theta);
    const vx = -Math.sin(theta);
    const vy = Math.cos(theta);

    this.ctx.strokeStyle = "#4d7394";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(originX, originY);
    this.ctx.lineTo(mapper.toX(rx + ux * 10), mapper.toY(ry + uy * 10));
    this.ctx.stroke();

    this.ctx.strokeStyle = "#7f9b59";
    this.ctx.beginPath();
    this.ctx.moveTo(originX, originY);
    this.ctx.lineTo(mapper.toX(rx + vx * 10), mapper.toY(ry + vy * 10));
    this.ctx.stroke();

    this.ctx.strokeStyle = "rgba(161,112,52,0.7)";
    this.ctx.setLineDash([6, 5]);
    this.ctx.beginPath();
    this.ctx.moveTo(originX, originY);
    this.ctx.lineTo(mapper.toX(wx), mapper.toY(wy));
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    this.ctx.fillStyle = "#a17034";
    this.ctx.beginPath();
    this.ctx.arc(mapper.toX(wx), mapper.toY(wy), 5.5, 0, TAU);
    this.ctx.fill();
    this.ctx.font = "12px IBM Plex Mono";
    this.ctx.fillText("transformed point", mapper.toX(wx) + 7, mapper.toY(wy) - 8);

    drawRobot(this.ctx, mapper, { x: rx, y: ry, theta }, THEME.truePath, "robot frame");

    this.readout.textContent =
      `Robot pose: (${rx.toFixed(1)}, ${ry.toFixed(1)}, ${theta.toFixed(2)} rad)\n` +
      `Local point: (${lx.toFixed(1)}, ${ly.toFixed(1)})\n` +
      `World point: (${wx.toFixed(2)}, ${wy.toFixed(2)})\n` +
      `Transform: [R(θ)|t] · p_local = p_world`;
  }
}

class BayesianUpdateDemo {
  constructor() {
    this.canvas = document.getElementById("bayesCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.readout = document.getElementById("bayesReadout");

    this.priorMean = document.getElementById("bayesPriorMean");
    this.priorSigma = document.getElementById("bayesPriorSigma");
    this.measValue = document.getElementById("bayesMeasValue");
    this.measSigma = document.getElementById("bayesMeasSigma");

    this.priorMeanValue = document.getElementById("bayesPriorMeanValue");
    this.priorSigmaValue = document.getElementById("bayesPriorSigmaValue");
    this.measValueValue = document.getElementById("bayesMeasValueValue");
    this.measSigmaValue = document.getElementById("bayesMeasSigmaValue");

    this.resetBtn = document.getElementById("bayesReset");
    this.bindEvents();
    this.reset();
  }

  bindEvents() {
    const update = () => this.updateLabels();
    this.priorMean.addEventListener("input", update);
    this.priorSigma.addEventListener("input", update);
    this.measValue.addEventListener("input", update);
    this.measSigma.addEventListener("input", update);
    this.resetBtn.addEventListener("click", () => this.reset());
  }

  reset() {
    this.priorMean.value = "45";
    this.priorSigma.value = "11";
    this.measValue.value = "62";
    this.measSigma.value = "7";
    this.updateLabels();
    this.draw();
  }

  updateLabels() {
    this.priorMeanValue.textContent = Number(this.priorMean.value).toFixed(1);
    this.priorSigmaValue.textContent = Number(this.priorSigma.value).toFixed(1);
    this.measValueValue.textContent = Number(this.measValue.value).toFixed(1);
    this.measSigmaValue.textContent = Number(this.measSigma.value).toFixed(1);
  }

  step() {
    this.draw();
  }

  drawCurve(xToPx, yToPx, mean, sigma, color) {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 2.2;
    this.ctx.beginPath();
    for (let x = 0; x <= 100; x += 0.5) {
      const y = gaussianPdf(x, mean, sigma);
      const px = xToPx(x);
      const py = yToPx(y);
      if (x === 0) this.ctx.moveTo(px, py);
      else this.ctx.lineTo(px, py);
    }
    this.ctx.stroke();
  }

  draw() {
    const ctx = this.ctx;
    const canvas = this.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const priorMean = Number(this.priorMean.value);
    const priorSigma = Number(this.priorSigma.value);
    const measValue = Number(this.measValue.value);
    const measSigma = Number(this.measSigma.value);

    const priorVar = priorSigma * priorSigma;
    const measVar = measSigma * measSigma;
    const gain = priorVar / (priorVar + measVar);
    const postMean = priorMean + gain * (measValue - priorMean);
    const postSigma = Math.sqrt((1 - gain) * priorVar);

    const left = 66;
    const right = canvas.width - 28;
    const top = 26;
    const bottom = canvas.height - 54;
    const maxPdf =
      Math.max(
        gaussianPdf(priorMean, priorMean, priorSigma),
        gaussianPdf(measValue, measValue, measSigma),
        gaussianPdf(postMean, postMean, postSigma),
      ) * 1.15;

    const xToPx = (x) => left + (x / 100) * (right - left);
    const yToPx = (y) => bottom - (y / maxPdf) * (bottom - top);

    ctx.strokeStyle = "rgba(113,132,148,0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.stroke();

    for (let x = 0; x <= 100; x += 10) {
      const px = xToPx(x);
      ctx.strokeStyle = "rgba(125,145,162,0.2)";
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(px, bottom);
      ctx.stroke();
      ctx.fillStyle = "#4e6475";
      ctx.font = "11px IBM Plex Mono";
      ctx.fillText(`${x}`, px - 8, bottom + 16);
    }

    this.drawCurve(xToPx, yToPx, priorMean, priorSigma, THEME.truePath);
    this.drawCurve(xToPx, yToPx, measValue, measSigma, THEME.odomPath);
    this.drawCurve(xToPx, yToPx, postMean, postSigma, THEME.correctedPath);

    ctx.strokeStyle = THEME.correctedPath;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(xToPx(postMean), top);
    ctx.lineTo(xToPx(postMean), bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = THEME.truePath;
    ctx.fillText("prior belief", left + 8, top + 16);
    ctx.fillStyle = THEME.odomPath;
    ctx.fillText("measurement likelihood", left + 8, top + 33);
    ctx.fillStyle = THEME.correctedPath;
    ctx.fillText("posterior belief", left + 8, top + 50);

    this.readout.textContent =
      `Kalman gain K: ${gain.toFixed(3)}\n` +
      `Posterior mean: ${postMean.toFixed(2)}\n` +
      `Posterior sigma: ${postSigma.toFixed(2)}\n` +
      `Interpretation: trust the lower-variance source more strongly.`;
  }
}

class DataAssociationDemo {
  constructor() {
    this.canvas = document.getElementById("associationCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.readout = document.getElementById("associationReadout");

    this.noise = document.getElementById("assocNoise");
    this.noiseValue = document.getElementById("assocNoiseValue");
    this.spacing = document.getElementById("assocSpacing");
    this.spacingValue = document.getElementById("assocSpacingValue");
    this.playPause = document.getElementById("assocPlayPause");
    this.resampleBtn = document.getElementById("assocResample");
    this.resetBtn = document.getElementById("assocReset");

    this.robot = { x: 32, y: 42, theta: 0.35 };
    this.running = true;
    this.bindEvents();
    this.reset();
  }

  bindEvents() {
    this.noise.addEventListener("input", () => {
      this.noiseValue.textContent = Number(this.noise.value).toFixed(2);
      this.sampleObservation();
    });
    this.spacing.addEventListener("input", () => {
      this.spacingValue.textContent = Number(this.spacing.value).toFixed(1);
      this.createLandmarks();
      this.sampleObservation();
    });
    this.playPause.addEventListener("click", () => {
      this.running = !this.running;
      this.playPause.textContent = this.running ? "Pause" : "Play";
    });
    this.resampleBtn.addEventListener("click", () => this.sampleObservation());
    this.resetBtn.addEventListener("click", () => this.reset());
  }

  reset() {
    this.noise.value = "1";
    this.spacing.value = "6";
    this.noiseValue.textContent = "1.00";
    this.spacingValue.textContent = "6.0";
    this.running = true;
    this.playPause.textContent = "Pause";
    this.timer = 0;
    this.totalSamples = 0;
    this.wrongSamples = 0;
    this.createLandmarks();
    this.sampleObservation();
  }

  createLandmarks() {
    const separation = Number(this.spacing.value);
    this.landmarks = [
      { id: "L1", x: 70 - separation / 2, y: 60, truth: true },
      { id: "L2", x: 70 + separation / 2, y: 60 },
      { id: "L3", x: 74, y: 38 },
    ];
  }

  sampleObservation() {
    const noise = Number(this.noise.value);
    const sigmaR = 0.55 + noise * 0.8;
    const sigmaB = 0.012 + noise * 0.018;
    const truthLm = this.landmarks[0];

    const tdx = truthLm.x - this.robot.x;
    const tdy = truthLm.y - this.robot.y;
    const trueRange = Math.hypot(tdx, tdy);
    const trueBearing = wrapAngle(Math.atan2(tdy, tdx) - this.robot.theta);

    const obsRange = trueRange + randn() * sigmaR;
    const obsBearing = wrapAngle(trueBearing + randn() * sigmaB);
    const likelihoods = [];

    for (const lm of this.landmarks) {
      const dx = lm.x - this.robot.x;
      const dy = lm.y - this.robot.y;
      const predRange = Math.hypot(dx, dy);
      const predBearing = wrapAngle(Math.atan2(dy, dx) - this.robot.theta);
      const dr = obsRange - predRange;
      const db = wrapAngle(obsBearing - predBearing);
      const n2 = (dr * dr) / (sigmaR * sigmaR) + (db * db) / (sigmaB * sigmaB);
      likelihoods.push(Math.exp(-0.5 * n2));
    }

    const sum = likelihoods.reduce((acc, value) => acc + value, 0);
    const probs = likelihoods.map((v) => (sum > 0 ? v / sum : 1 / likelihoods.length));
    let selected = 0;
    for (let i = 1; i < probs.length; i += 1) {
      if (probs[i] > probs[selected]) selected = i;
    }

    this.totalSamples += 1;
    if (selected !== 0) this.wrongSamples += 1;

    this.observation = {
      range: obsRange,
      bearing: obsBearing,
      probs,
      selected,
      sigmaR,
      sigmaB,
    };
  }

  step(dt) {
    if (this.running) {
      this.timer += dt;
      if (this.timer > 0.85) {
        this.timer = 0;
        this.sampleObservation();
      }
    }
    this.draw();
  }

  drawProbabilityBars() {
    const ctx = this.ctx;
    const x0 = 24;
    const y0 = 26;
    const barW = 145;
    const barH = 10;
    ctx.fillStyle = "#2b3f50";
    ctx.font = "12px IBM Plex Mono";
    ctx.fillText("Association probability", x0, y0 - 8);

    this.observation.probs.forEach((p, idx) => {
      const y = y0 + idx * 18;
      ctx.strokeStyle = "rgba(124, 141, 156, 0.55)";
      ctx.strokeRect(x0, y, barW, barH);
      ctx.fillStyle = idx === this.observation.selected ? "rgba(45,131,119,0.75)" : "rgba(79,111,138,0.45)";
      ctx.fillRect(x0, y, barW * p, barH);
      ctx.fillStyle = "#2b3f50";
      ctx.fillText(`${this.landmarks[idx].id}: ${(p * 100).toFixed(1)}%`, x0 + barW + 12, y + 9);
    });
  }

  draw() {
    const mapper = getMapper(this.canvas);
    drawGrid(this.ctx, this.canvas, mapper);
    this.drawProbabilityBars();

    for (let i = 0; i < this.landmarks.length; i += 1) {
      const lm = this.landmarks[i];
      const selected = i === this.observation.selected;
      this.ctx.fillStyle = lm.truth ? THEME.truePath : THEME.landmark;
      this.ctx.beginPath();
      this.ctx.arc(mapper.toX(lm.x), mapper.toY(lm.y), 4.8, 0, TAU);
      this.ctx.fill();

      if (selected) {
        this.ctx.strokeStyle = lm.truth ? "rgba(45,131,119,0.9)" : "rgba(171,79,66,0.9)";
        this.ctx.lineWidth = 2.2;
        this.ctx.beginPath();
        this.ctx.arc(mapper.toX(lm.x), mapper.toY(lm.y), 8.2, 0, TAU);
        this.ctx.stroke();
      }

      this.ctx.fillStyle = "#2d3f4f";
      this.ctx.font = "11px IBM Plex Mono";
      this.ctx.fillText(lm.id, mapper.toX(lm.x) + 6, mapper.toY(lm.y) - 6);
    }

    const truth = this.landmarks[0];
    this.ctx.strokeStyle = "rgba(47,102,142,0.52)";
    this.ctx.setLineDash([5, 4]);
    this.ctx.beginPath();
    this.ctx.moveTo(mapper.toX(this.robot.x), mapper.toY(this.robot.y));
    this.ctx.lineTo(mapper.toX(truth.x), mapper.toY(truth.y));
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    const measuredHeading = this.robot.theta + this.observation.bearing;
    const mx = this.robot.x + this.observation.range * Math.cos(measuredHeading);
    const my = this.robot.y + this.observation.range * Math.sin(measuredHeading);
    this.ctx.strokeStyle = "rgba(161,112,52,0.8)";
    this.ctx.setLineDash([8, 5]);
    this.ctx.beginPath();
    this.ctx.moveTo(mapper.toX(this.robot.x), mapper.toY(this.robot.y));
    this.ctx.lineTo(mapper.toX(mx), mapper.toY(my));
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    const selectedLm = this.landmarks[this.observation.selected];
    this.ctx.strokeStyle = this.observation.selected === 0 ? "rgba(45,131,119,0.8)" : "rgba(171,79,66,0.85)";
    this.ctx.lineWidth = 1.8;
    this.ctx.beginPath();
    this.ctx.moveTo(mapper.toX(this.robot.x), mapper.toY(this.robot.y));
    this.ctx.lineTo(mapper.toX(selectedLm.x), mapper.toY(selectedLm.y));
    this.ctx.stroke();

    drawRobot(this.ctx, mapper, this.robot, THEME.odomPath, "robot");

    const wrongRate = this.totalSamples > 0 ? (100 * this.wrongSamples) / this.totalSamples : 0;
    this.readout.textContent =
      `Selected landmark: ${selectedLm.id} (${this.observation.selected === 0 ? "correct" : "wrong"})\n` +
      `p(L1/L2/L3): ${this.observation.probs.map((p) => p.toFixed(2)).join(" / ")}\n` +
      `Wrong association rate: ${wrongRate.toFixed(1)}% (${this.wrongSamples}/${this.totalSamples})\n` +
      `Lower separation + higher noise => more ambiguous matches.`;
  }
}

class OdometryDemo {
  constructor() {
    this.canvas = document.getElementById("odometryCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.readout = document.getElementById("odometryReadout");

    this.noise = document.getElementById("odomNoise");
    this.noiseValue = document.getElementById("odomNoiseValue");
    this.speed = document.getElementById("odomSpeed");
    this.speedValue = document.getElementById("odomSpeedValue");
    this.playPause = document.getElementById("odomPlayPause");
    this.resetBtn = document.getElementById("odomReset");

    this.running = true;
    this.reset();
    this.bindEvents();
  }

  bindEvents() {
    this.noise.addEventListener("input", () => {
      this.noiseValue.textContent = Number(this.noise.value).toFixed(2);
    });

    this.speed.addEventListener("input", () => {
      this.speedValue.textContent = `${Number(this.speed.value).toFixed(2)}x`;
    });

    this.playPause.addEventListener("click", () => {
      this.running = !this.running;
      this.playPause.textContent = this.running ? "Pause" : "Play";
    });

    this.resetBtn.addEventListener("click", () => {
      this.reset();
    });
  }

  reset() {
    this.t = 0;
    this.running = true;
    this.playPause.textContent = "Pause";

    this.truePose = modelA(0);
    this.estPose = { ...this.truePose };

    this.truePath = [{ x: this.truePose.x, y: this.truePose.y }];
    this.estPath = [{ x: this.estPose.x, y: this.estPose.y }];
    this.travel = 0;
    this.drift = 0;
  }

  step(dt) {
    if (!this.running) {
      this.draw();
      return;
    }

    const speed = Number(this.speed.value);
    const odomNoise = Number(this.noise.value);
    const substeps = 2;
    const step = (dt * speed) / substeps;

    for (let i = 0; i < substeps; i += 1) {
      this.t += step;
      const prevTrue = this.truePose;
      const currentTrue = modelA(this.t);

      const deltaS = Math.hypot(currentTrue.x - prevTrue.x, currentTrue.y - prevTrue.y);
      const deltaTheta = wrapAngle(currentTrue.theta - prevTrue.theta);

      this.truePose = currentTrue;
      this.estPose.theta = wrapAngle(this.estPose.theta + deltaTheta + randn() * odomNoise * 0.04);

      const noisyDelta = deltaS + randn() * odomNoise * 0.4;
      this.estPose.x += noisyDelta * Math.cos(this.estPose.theta);
      this.estPose.y += noisyDelta * Math.sin(this.estPose.theta);
      clampPose(this.estPose);

      this.truePath.push({ x: this.truePose.x, y: this.truePose.y });
      this.estPath.push({ x: this.estPose.x, y: this.estPose.y });
      this.travel += deltaS;

      if (this.truePath.length > 1400) {
        this.truePath.shift();
        this.estPath.shift();
      }
    }

    this.drift = Math.hypot(this.truePose.x - this.estPose.x, this.truePose.y - this.estPose.y);
    this.draw();
  }

  drawLegend(mapper) {
    this.ctx.font = "12px IBM Plex Mono";
    this.ctx.fillStyle = THEME.truePath;
    this.ctx.fillText("True path", mapper.toX(2), mapper.toY(98));
    this.ctx.fillStyle = THEME.odomPath;
    this.ctx.fillText("Odometry estimate", mapper.toX(2), mapper.toY(94));
  }

  draw() {
    const mapper = getMapper(this.canvas);
    drawGrid(this.ctx, this.canvas, mapper);

    drawPath(this.ctx, mapper, this.truePath, THEME.truePath, 2.3);
    drawPath(this.ctx, mapper, this.estPath, THEME.odomPath, 2.3);

    this.ctx.strokeStyle = THEME.link;
    this.ctx.setLineDash([6, 6]);
    this.ctx.beginPath();
    this.ctx.moveTo(mapper.toX(this.truePose.x), mapper.toY(this.truePose.y));
    this.ctx.lineTo(mapper.toX(this.estPose.x), mapper.toY(this.estPose.y));
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    drawRobot(this.ctx, mapper, this.truePose, THEME.truePath, "true");
    drawRobot(this.ctx, mapper, this.estPose, THEME.odomPath, "odom");
    this.drawLegend(mapper);

    this.readout.textContent =
      `Drift: ${this.drift.toFixed(2)} units\n` +
      `Distance traveled: ${this.travel.toFixed(1)} units\n` +
      `Observation: drift grows even when each step error is tiny.`;
  }
}

class CorrectionDemo {
  constructor() {
    this.canvas = document.getElementById("correctionCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.readout = document.getElementById("correctionReadout");

    this.odomNoise = document.getElementById("corrOdomNoise");
    this.odomNoiseValue = document.getElementById("corrOdomNoiseValue");
    this.sensorNoise = document.getElementById("corrSensorNoise");
    this.sensorNoiseValue = document.getElementById("corrSensorNoiseValue");
    this.gain = document.getElementById("corrGain");
    this.gainValue = document.getElementById("corrGainValue");
    this.playPause = document.getElementById("corrPlayPause");
    this.resetBtn = document.getElementById("corrReset");

    this.landmarks = makeLandmarks(16, 42);
    this.running = true;
    this.reset();
    this.bindEvents();
  }

  bindEvents() {
    this.odomNoise.addEventListener("input", () => {
      this.odomNoiseValue.textContent = Number(this.odomNoise.value).toFixed(2);
    });
    this.sensorNoise.addEventListener("input", () => {
      this.sensorNoiseValue.textContent = Number(this.sensorNoise.value).toFixed(2);
    });
    this.gain.addEventListener("input", () => {
      this.gainValue.textContent = Number(this.gain.value).toFixed(2);
    });

    this.playPause.addEventListener("click", () => {
      this.running = !this.running;
      this.playPause.textContent = this.running ? "Pause" : "Play";
    });

    this.resetBtn.addEventListener("click", () => this.reset());
  }

  reset() {
    this.t = 0;
    this.running = true;
    this.playPause.textContent = "Pause";

    const p = modelB(0);
    this.truePose = p;
    this.odomPose = { ...p };
    this.correctedPose = { ...p };

    this.truePath = [{ x: p.x, y: p.y }];
    this.odomPath = [{ x: p.x, y: p.y }];
    this.correctedPath = [{ x: p.x, y: p.y }];
    this.visible = [];
  }

  step(dt) {
    if (!this.running) {
      this.draw();
      return;
    }

    const odomNoise = Number(this.odomNoise.value);
    const sensorNoise = Number(this.sensorNoise.value);
    const gain = Number(this.gain.value);

    this.t += dt;
    const previousTrue = this.truePose;
    this.truePose = modelB(this.t);

    const deltaS = Math.hypot(this.truePose.x - previousTrue.x, this.truePose.y - previousTrue.y);
    const deltaTheta = wrapAngle(this.truePose.theta - previousTrue.theta);

    const advance = (pose) => {
      pose.theta = wrapAngle(pose.theta + deltaTheta + randn() * odomNoise * 0.045);
      const noisyStep = deltaS + randn() * odomNoise * 0.44;
      pose.x += noisyStep * Math.cos(pose.theta);
      pose.y += noisyStep * Math.sin(pose.theta);
      clampPose(pose);
    };

    advance(this.odomPose);
    advance(this.correctedPose);

    const observations = [];
    for (const lm of this.landmarks) {
      const dx = lm.x - this.truePose.x;
      const dy = lm.y - this.truePose.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 30 || Math.random() < 0.15) continue;

      observations.push({
        id: lm.id,
        x: lm.x,
        y: lm.y,
        range: dist + randn() * sensorNoise * 0.5,
        bearing: wrapAngle(Math.atan2(dy, dx) - this.truePose.theta + randn() * sensorNoise * 0.03),
      });
    }
    this.visible = observations;

    if (observations.length > 0) {
      let xSum = 0;
      let ySum = 0;
      let headingCorrection = 0;

      for (const obs of observations) {
        const beam = this.correctedPose.theta + obs.bearing;
        const candidateX = obs.x - obs.range * Math.cos(beam);
        const candidateY = obs.y - obs.range * Math.sin(beam);
        xSum += candidateX;
        ySum += candidateY;

        const expectedBearing = wrapAngle(
          Math.atan2(obs.y - this.correctedPose.y, obs.x - this.correctedPose.x) - this.correctedPose.theta,
        );
        const innovation = wrapAngle(obs.bearing - expectedBearing);
        headingCorrection += innovation;
      }

      const avgX = xSum / observations.length;
      const avgY = ySum / observations.length;
      this.correctedPose.x = lerp(this.correctedPose.x, avgX, gain * 0.46);
      this.correctedPose.y = lerp(this.correctedPose.y, avgY, gain * 0.46);
      this.correctedPose.theta = wrapAngle(
        this.correctedPose.theta - (headingCorrection / observations.length) * gain * 0.13,
      );
      clampPose(this.correctedPose);
    }

    this.truePath.push({ x: this.truePose.x, y: this.truePose.y });
    this.odomPath.push({ x: this.odomPose.x, y: this.odomPose.y });
    this.correctedPath.push({ x: this.correctedPose.x, y: this.correctedPose.y });

    if (this.truePath.length > 1500) {
      this.truePath.shift();
      this.odomPath.shift();
      this.correctedPath.shift();
    }

    this.draw();
  }

  drawLandmarks(mapper) {
    this.ctx.fillStyle = THEME.landmark;
    this.ctx.font = "10px IBM Plex Mono";

    for (const lm of this.landmarks) {
      const x = mapper.toX(lm.x);
      const y = mapper.toY(lm.y);
      this.ctx.beginPath();
      this.ctx.arc(x, y, 3.1, 0, TAU);
      this.ctx.fill();
      this.ctx.fillText(`${lm.id}`, x + 4, y - 4);
    }
  }

  drawVisibleRays(mapper) {
    this.ctx.strokeStyle = THEME.ray;
    this.ctx.lineWidth = 1.2;

    for (const obs of this.visible) {
      this.ctx.beginPath();
      this.ctx.moveTo(mapper.toX(this.truePose.x), mapper.toY(this.truePose.y));
      this.ctx.lineTo(mapper.toX(obs.x), mapper.toY(obs.y));
      this.ctx.stroke();
    }
  }

  draw() {
    const mapper = getMapper(this.canvas);
    drawGrid(this.ctx, this.canvas, mapper);

    this.drawLandmarks(mapper);
    this.drawVisibleRays(mapper);

    drawPath(this.ctx, mapper, this.truePath, THEME.truePath, 2.1);
    drawPath(this.ctx, mapper, this.odomPath, THEME.odomPath, 2.1, [7, 5]);
    drawPath(this.ctx, mapper, this.correctedPath, THEME.correctedPath, 2.4);

    drawRobot(this.ctx, mapper, this.truePose, THEME.truePath, "true");
    drawRobot(this.ctx, mapper, this.odomPose, THEME.odomPath, "odom");
    drawRobot(this.ctx, mapper, this.correctedPose, THEME.correctedPath, "corrected");

    const odomErr = Math.hypot(this.truePose.x - this.odomPose.x, this.truePose.y - this.odomPose.y);
    const correctedErr = Math.hypot(this.truePose.x - this.correctedPose.x, this.truePose.y - this.correctedPose.y);

    this.readout.textContent =
      `Visible landmarks: ${this.visible.length}\n` +
      `Odometry error: ${odomErr.toFixed(2)} units\n` +
      `Corrected error: ${correctedErr.toFixed(2)} units\n` +
      `Observation: landmarks anchor the estimate against drift.`;
  }
}

class SlamDemo {
  constructor() {
    this.canvas = document.getElementById("slamCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.readout = document.getElementById("slamReadout");

    this.odomNoise = document.getElementById("slamOdomNoise");
    this.odomNoiseValue = document.getElementById("slamOdomNoiseValue");
    this.sensorNoise = document.getElementById("slamSensorNoise");
    this.sensorNoiseValue = document.getElementById("slamSensorNoiseValue");
    this.gain = document.getElementById("slamGain");
    this.gainValue = document.getElementById("slamGainValue");
    this.showTruth = document.getElementById("slamShowTruth");

    this.playPause = document.getElementById("slamPlayPause");
    this.resetBtn = document.getElementById("slamReset");

    this.trueLandmarks = makeLandmarks(26, 7);
    this.running = true;
    this.reset();
    this.bindEvents();
  }

  bindEvents() {
    this.odomNoise.addEventListener("input", () => {
      this.odomNoiseValue.textContent = Number(this.odomNoise.value).toFixed(2);
    });
    this.sensorNoise.addEventListener("input", () => {
      this.sensorNoiseValue.textContent = Number(this.sensorNoise.value).toFixed(2);
    });
    this.gain.addEventListener("input", () => {
      this.gainValue.textContent = Number(this.gain.value).toFixed(2);
    });

    this.playPause.addEventListener("click", () => {
      this.running = !this.running;
      this.playPause.textContent = this.running ? "Pause" : "Play";
    });

    this.resetBtn.addEventListener("click", () => this.reset());
  }

  reset() {
    this.t = 0;
    this.running = true;
    this.playPause.textContent = "Pause";

    const p = modelC(0);
    this.truePose = p;
    this.estPose = { ...p };
    this.startPose = { ...p };

    this.truePath = [{ x: p.x, y: p.y }];
    this.estPath = [{ x: p.x, y: p.y }];
    this.map = new Map();
    this.visible = [];
    this.loopClosures = 0;
  }

  step(dt) {
    if (!this.running) {
      this.draw();
      return;
    }

    const odomNoise = Number(this.odomNoise.value);
    const sensorNoise = Number(this.sensorNoise.value);
    const gain = Number(this.gain.value);

    this.t += dt;
    const prevTrue = this.truePose;
    this.truePose = modelC(this.t);

    const deltaS = Math.hypot(this.truePose.x - prevTrue.x, this.truePose.y - prevTrue.y);
    const deltaTheta = wrapAngle(this.truePose.theta - prevTrue.theta);

    this.estPose.theta = wrapAngle(this.estPose.theta + deltaTheta + randn() * odomNoise * 0.05);
    const noisyStep = deltaS + randn() * odomNoise * 0.47;
    this.estPose.x += noisyStep * Math.cos(this.estPose.theta);
    this.estPose.y += noisyStep * Math.sin(this.estPose.theta);
    clampPose(this.estPose);

    const observations = [];
    for (const lm of this.trueLandmarks) {
      const dx = lm.x - this.truePose.x;
      const dy = lm.y - this.truePose.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 35 || Math.random() < 0.18) continue;

      observations.push({
        id: lm.id,
        range: dist + randn() * sensorNoise * 0.65,
        bearing: wrapAngle(Math.atan2(dy, dx) - this.truePose.theta + randn() * sensorNoise * 0.033),
      });
    }
    this.visible = observations;

    for (const obs of observations) {
      const globalBearing = this.estPose.theta + obs.bearing;
      const predicted = {
        x: this.estPose.x + obs.range * Math.cos(globalBearing),
        y: this.estPose.y + obs.range * Math.sin(globalBearing),
      };

      const existing = this.map.get(obs.id);
      if (!existing) {
        this.map.set(obs.id, { x: predicted.x, y: predicted.y, count: 1, sigma: 7.5 });
        continue;
      }

      const weight = 1 / (existing.count + 1);
      existing.x = existing.x * (1 - weight) + predicted.x * weight;
      existing.y = existing.y * (1 - weight) + predicted.y * weight;
      existing.count += 1;
      existing.sigma = Math.max(1.4, existing.sigma * 0.93);

      const rx = existing.x - predicted.x;
      const ry = existing.y - predicted.y;
      this.estPose.x += rx * gain * 0.23;
      this.estPose.y += ry * gain * 0.23;

      const expectedBearing = wrapAngle(Math.atan2(existing.y - this.estPose.y, existing.x - this.estPose.x) - this.estPose.theta);
      const innovation = wrapAngle(obs.bearing - expectedBearing);
      this.estPose.theta = wrapAngle(this.estPose.theta - innovation * gain * 0.11);
      clampPose(this.estPose);
    }

    if (this.t > 45 && observations.length > 2) {
      const backHome = Math.hypot(this.estPose.x - this.startPose.x, this.estPose.y - this.startPose.y);
      if (backHome < 7 && Math.random() < 0.02) {
        this.loopClosures += 1;
      }
    }

    this.truePath.push({ x: this.truePose.x, y: this.truePose.y });
    this.estPath.push({ x: this.estPose.x, y: this.estPose.y });

    if (this.truePath.length > 1800) {
      this.truePath.shift();
      this.estPath.shift();
    }

    this.draw();
  }

  drawMap(mapper) {
    for (const lm of this.map.values()) {
      const x = mapper.toX(lm.x);
      const y = mapper.toY(lm.y);
      const radius = lm.sigma * mapper.scale;
      const intensity = clamp(lm.count / 9, 0.2, 1);

      this.ctx.strokeStyle = `rgba(45,131,119,${0.12 + intensity * 0.24})`;
      this.ctx.lineWidth = 1.2;
      this.ctx.beginPath();
      this.ctx.arc(x, y, radius, 0, TAU);
      this.ctx.stroke();

      this.ctx.fillStyle = `rgba(45,131,119,${0.4 + intensity * 0.55})`;
      this.ctx.beginPath();
      this.ctx.arc(x, y, 2.8, 0, TAU);
      this.ctx.fill();
    }
  }

  drawTruthLandmarks(mapper) {
    this.ctx.fillStyle = "rgba(95, 134, 165, 0.32)";
    for (const lm of this.trueLandmarks) {
      this.ctx.beginPath();
      this.ctx.arc(mapper.toX(lm.x), mapper.toY(lm.y), 2.2, 0, TAU);
      this.ctx.fill();
    }
  }

  drawVisibleHints(mapper) {
    this.ctx.strokeStyle = THEME.ray;
    this.ctx.lineWidth = 1;
    for (const obs of this.visible) {
      const lm = this.map.get(obs.id);
      if (!lm) continue;
      this.ctx.beginPath();
      this.ctx.moveTo(mapper.toX(this.estPose.x), mapper.toY(this.estPose.y));
      this.ctx.lineTo(mapper.toX(lm.x), mapper.toY(lm.y));
      this.ctx.stroke();
    }
  }

  mapError() {
    let sum = 0;
    let count = 0;
    for (const truth of this.trueLandmarks) {
      const est = this.map.get(truth.id);
      if (!est) continue;
      sum += Math.hypot(est.x - truth.x, est.y - truth.y);
      count += 1;
    }
    return count > 0 ? sum / count : 0;
  }

  draw() {
    const mapper = getMapper(this.canvas);
    drawGrid(this.ctx, this.canvas, mapper);

    if (this.showTruth.checked) {
      this.drawTruthLandmarks(mapper);
      drawPath(this.ctx, mapper, this.truePath, THEME.truthHintPath, 1.8);
    }

    this.drawMap(mapper);
    this.drawVisibleHints(mapper);
    drawPath(this.ctx, mapper, this.estPath, THEME.odomPath, 2.35);
    drawRobot(this.ctx, mapper, this.estPose, THEME.odomPath, "estimate");

    this.ctx.strokeStyle = THEME.truthGap;
    this.ctx.lineWidth = 1.4;
    this.ctx.setLineDash([5, 4]);
    this.ctx.beginPath();
    this.ctx.moveTo(mapper.toX(this.truePose.x), mapper.toY(this.truePose.y));
    this.ctx.lineTo(mapper.toX(this.estPose.x), mapper.toY(this.estPose.y));
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    this.ctx.fillStyle = THEME.truthHalo;
    this.ctx.beginPath();
    this.ctx.arc(mapper.toX(this.truePose.x), mapper.toY(this.truePose.y), 11, 0, TAU);
    this.ctx.fill();
    drawRobot(this.ctx, mapper, this.truePose, THEME.truePose, "true");

    const poseErr = Math.hypot(this.truePose.x - this.estPose.x, this.truePose.y - this.estPose.y);
    const mapped = this.map.size;
    const meanMapErr = this.mapError();

    this.readout.textContent =
      `Mapped landmarks: ${mapped}/${this.trueLandmarks.length}\n` +
      `Pose error (true vs estimate): ${poseErr.toFixed(2)} units\n` +
      `Mean landmark error: ${meanMapErr.toFixed(2)} units\n` +
      `Loop closures detected: ${this.loopClosures}`;
  }
}

class OccupancyGridDemo {
  constructor() {
    this.canvas = document.getElementById("occupancyCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.readout = document.getElementById("occupancyReadout");

    this.beams = document.getElementById("occBeams");
    this.beamsValue = document.getElementById("occBeamsValue");
    this.sensorNoise = document.getElementById("occSensorNoise");
    this.sensorNoiseValue = document.getElementById("occSensorNoiseValue");
    this.maxRange = document.getElementById("occRange");
    this.maxRangeValue = document.getElementById("occRangeValue");
    this.playPause = document.getElementById("occPlayPause");
    this.resetBtn = document.getElementById("occReset");

    this.gridW = 28;
    this.gridH = 20;
    this.truth = this.createTruthGrid();
    this.running = true;
    this.bindEvents();
    this.reset();
  }

  bindEvents() {
    this.beams.addEventListener("input", () => {
      this.beamsValue.textContent = `${Number(this.beams.value)}`;
    });
    this.sensorNoise.addEventListener("input", () => {
      this.sensorNoiseValue.textContent = Number(this.sensorNoise.value).toFixed(2);
    });
    this.maxRange.addEventListener("input", () => {
      this.maxRangeValue.textContent = Number(this.maxRange.value).toFixed(1);
    });
    this.playPause.addEventListener("click", () => {
      this.running = !this.running;
      this.playPause.textContent = this.running ? "Pause" : "Play";
    });
    this.resetBtn.addEventListener("click", () => this.reset());
  }

  createTruthGrid() {
    const map = Array.from({ length: this.gridH }, () => Array(this.gridW).fill(false));
    const addRect = (x0, y0, x1, y1) => {
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          if (x >= 0 && x < this.gridW && y >= 0 && y < this.gridH) map[y][x] = true;
        }
      }
    };

    addRect(0, 0, this.gridW - 1, 0);
    addRect(0, this.gridH - 1, this.gridW - 1, this.gridH - 1);
    addRect(0, 0, 0, this.gridH - 1);
    addRect(this.gridW - 1, 0, this.gridW - 1, this.gridH - 1);

    addRect(8, 3, 8, 15);
    addRect(19, 4, 19, 16);
    addRect(12, 13, 15, 15);
    addRect(4, 5, 6, 7);
    addRect(22, 10, 24, 12);

    // Doorway openings
    map[9][8] = false;
    map[10][8] = false;
    map[7][19] = false;
    map[8][19] = false;

    return map;
  }

  reset() {
    this.beams.value = "18";
    this.sensorNoise.value = "0.8";
    this.maxRange.value = "9";
    this.beamsValue.textContent = "18";
    this.sensorNoiseValue.textContent = "0.80";
    this.maxRangeValue.textContent = "9.0";

    this.running = true;
    this.playPause.textContent = "Pause";
    this.t = 0;
    this.scanCount = 0;
    this.pose = this.getPose(0);
    this.beamEndpoints = [];
    this.logOdds = Array.from({ length: this.gridH }, () => Array(this.gridW).fill(0));
  }

  getPose(t) {
    const x = 14 + 8 * Math.cos(0.42 * t) + 1.8 * Math.cos(1.1 * t + 0.2);
    const y = 10 + 6 * Math.sin(0.36 * t) + 1.4 * Math.sin(1.3 * t);
    const dx = -8 * 0.42 * Math.sin(0.42 * t) - 1.8 * 1.1 * Math.sin(1.1 * t + 0.2);
    const dy = 6 * 0.36 * Math.cos(0.36 * t) + 1.4 * 1.3 * Math.cos(1.3 * t);
    return {
      x: clamp(x, 1.2, this.gridW - 1.2),
      y: clamp(y, 1.2, this.gridH - 1.2),
      theta: Math.atan2(dy, dx),
    };
  }

  inBounds(cx, cy) {
    return cx >= 0 && cy >= 0 && cx < this.gridW && cy < this.gridH;
  }

  castRay(pose, angle, maxRange) {
    const free = [];
    let hit = null;
    let endX = pose.x;
    let endY = pose.y;
    let lastKey = "";

    for (let r = 0.2; r <= maxRange; r += 0.2) {
      const wx = pose.x + r * Math.cos(angle);
      const wy = pose.y + r * Math.sin(angle);
      const cx = Math.floor(wx);
      const cy = Math.floor(wy);
      endX = wx;
      endY = wy;

      if (!this.inBounds(cx, cy)) break;

      const key = `${cx}:${cy}`;
      if (this.truth[cy][cx]) {
        hit = { cx, cy };
        break;
      }

      if (key !== lastKey) {
        free.push({ cx, cy });
        lastKey = key;
      }
    }

    return { free, hit, endX, endY };
  }

  performScan() {
    const noise = Number(this.sensorNoise.value);
    const beamCount = Number(this.beams.value);
    const maxRange = Number(this.maxRange.value);
    const occUpdate = 0.46 / (1 + noise * 0.7);
    const freeUpdate = 0.16 / (1 + noise * 0.6);
    const beams = [];

    for (let i = 0; i < beamCount; i += 1) {
      const rel = -1.2 + (2.4 * i) / Math.max(1, beamCount - 1);
      const angle = this.pose.theta + rel + randn() * noise * 0.01;
      const ray = this.castRay(this.pose, angle, maxRange);
      beams.push(ray);

      for (const c of ray.free) {
        if (!this.inBounds(c.cx, c.cy)) continue;
        this.logOdds[c.cy][c.cx] = clamp(this.logOdds[c.cy][c.cx] - freeUpdate, -3.5, 3.5);
      }

      if (ray.hit && Math.random() > noise * 0.08) {
        this.logOdds[ray.hit.cy][ray.hit.cx] = clamp(this.logOdds[ray.hit.cy][ray.hit.cx] + occUpdate, -3.5, 3.5);
      }
    }

    this.beamEndpoints = beams;
    this.scanCount += 1;
  }

  step(dt) {
    if (this.running) {
      const nextPose = this.getPose(this.t + dt * 1.1);
      const cx = Math.floor(nextPose.x);
      const cy = Math.floor(nextPose.y);
      if (!this.truth[cy][cx]) {
        this.t += dt * 1.1;
        this.pose = nextPose;
      } else {
        this.t += dt * 0.25;
      }

      this.performScan();
    }

    this.draw();
  }

  drawGridPanel(panel, mode) {
    const { x, y, size } = panel;
    const ctx = this.ctx;
    const cell = size;

    for (let cy = 0; cy < this.gridH; cy += 1) {
      for (let cx = 0; cx < this.gridW; cx += 1) {
        const px = x + cx * cell;
        const py = y + (this.gridH - cy - 1) * cell;
        if (mode === "truth") {
          ctx.fillStyle = this.truth[cy][cx] ? "#1f2e3a" : "#f9fcff";
        } else {
          const p = logistic(this.logOdds[cy][cx]);
          const shade = Math.round(255 * (1 - p));
          ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
        }
        ctx.fillRect(px, py, cell, cell);
      }
    }

    ctx.strokeStyle = "rgba(110,130,145,0.45)";
    ctx.strokeRect(x, y, this.gridW * cell, this.gridH * cell);
  }

  drawRobotOnPanel(panel, color) {
    const ctx = this.ctx;
    const { x, y, size } = panel;
    const px = x + this.pose.x * size;
    const py = y + (this.gridH - this.pose.y) * size;
    const len = 9;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, 4.4, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(this.pose.theta) * len, py - Math.sin(this.pose.theta) * len);
    ctx.stroke();
  }

  mapStats() {
    let known = 0;
    let correct = 0;
    let entropySum = 0;
    for (let cy = 0; cy < this.gridH; cy += 1) {
      for (let cx = 0; cx < this.gridW; cx += 1) {
        const p = logistic(this.logOdds[cy][cx]);
        const entropy = -(p * Math.log2(Math.max(1e-8, p)) + (1 - p) * Math.log2(Math.max(1e-8, 1 - p)));
        entropySum += entropy;
        if (Math.abs(p - 0.5) > 0.2) {
          known += 1;
          const estOcc = p > 0.5;
          if (estOcc === this.truth[cy][cx]) correct += 1;
        }
      }
    }

    return {
      known,
      accuracy: known > 0 ? correct / known : 0,
      meanEntropy: entropySum / (this.gridW * this.gridH),
    };
  }

  draw() {
    const ctx = this.ctx;
    const canvas = this.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fbfdff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const top = 46;
    const sidePad = 30;
    const gap = 28;
    const size = Math.min((canvas.width - sidePad * 2 - gap) / (this.gridW * 2), (canvas.height - 84) / this.gridH);
    const leftPanel = { x: sidePad, y: top, size };
    const rightPanel = { x: sidePad + this.gridW * size + gap, y: top, size };

    this.drawGridPanel(leftPanel, "estimate");
    this.drawGridPanel(rightPanel, "truth");

    ctx.fillStyle = "#2f4353";
    ctx.font = "12px IBM Plex Mono";
    ctx.fillText("Estimated occupancy", leftPanel.x, top - 10);
    ctx.fillText("Hidden ground truth + rays", rightPanel.x, top - 10);

    ctx.strokeStyle = "rgba(161,112,52,0.28)";
    ctx.lineWidth = 1;
    for (const beam of this.beamEndpoints) {
      const sx = rightPanel.x + this.pose.x * size;
      const sy = rightPanel.y + (this.gridH - this.pose.y) * size;
      const ex = rightPanel.x + beam.endX * size;
      const ey = rightPanel.y + (this.gridH - beam.endY) * size;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }

    this.drawRobotOnPanel(leftPanel, THEME.correctedPath);
    this.drawRobotOnPanel(rightPanel, THEME.odomPath);

    const stats = this.mapStats();
    this.readout.textContent =
      `Scans integrated: ${this.scanCount}\n` +
      `Confident cells: ${stats.known}/${this.gridW * this.gridH}\n` +
      `Accuracy on confident cells: ${(stats.accuracy * 100).toFixed(1)}%\n` +
      `Mean map entropy: ${stats.meanEntropy.toFixed(3)} bits\n` +
      `Left map converges as free/occupied evidence accumulates.`;
  }
}

class KinematicSlamDemo {
  constructor() {
    this.canvas = document.getElementById("kinematicCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.readout = document.getElementById("kinematicReadout");

    this.odomNoise = document.getElementById("kinOdomNoise");
    this.odomNoiseValue = document.getElementById("kinOdomNoiseValue");
    this.sensorNoise = document.getElementById("kinSensorNoise");
    this.sensorNoiseValue = document.getElementById("kinSensorNoiseValue");
    this.gain = document.getElementById("kinGain");
    this.gainValue = document.getElementById("kinGainValue");
    this.yawRate = document.getElementById("kinYawRate");
    this.yawRateValue = document.getElementById("kinYawRateValue");
    this.showRaw = document.getElementById("kinShowRaw");

    this.playPause = document.getElementById("kinPlayPause");
    this.resetBtn = document.getElementById("kinReset");

    this.trueLandmarks = makeLandmarks(24, 83);
    this.running = true;
    this.reset();
    this.bindEvents();
  }

  bindEvents() {
    this.odomNoise.addEventListener("input", () => {
      this.odomNoiseValue.textContent = Number(this.odomNoise.value).toFixed(2);
    });
    this.sensorNoise.addEventListener("input", () => {
      this.sensorNoiseValue.textContent = Number(this.sensorNoise.value).toFixed(2);
    });
    this.gain.addEventListener("input", () => {
      this.gainValue.textContent = Number(this.gain.value).toFixed(2);
    });
    this.yawRate.addEventListener("input", () => {
      this.yawRateValue.textContent = `${Number(this.yawRate.value).toFixed(2)} rad/s`;
    });

    this.playPause.addEventListener("click", () => {
      this.running = !this.running;
      this.playPause.textContent = this.running ? "Pause" : "Play";
    });

    this.resetBtn.addEventListener("click", () => this.reset());
  }

  reset() {
    this.t = 0;
    this.running = true;
    this.playPause.textContent = "Pause";

    const p = modelB(0);
    this.truePose = p;
    this.rawPose = { ...p };
    this.kinPose = { ...p, v: 0, omega: 0 };
    this.startPose = { ...p };

    this.truePath = [{ x: p.x, y: p.y }];
    this.rawPath = [{ x: p.x, y: p.y }];
    this.kinPath = [{ x: p.x, y: p.y }];

    this.mapRaw = new Map();
    this.mapKin = new Map();
    this.visible = [];
    this.rawJump = 0;
    this.kinJump = 0;
    this.maxRawJump = 0;
    this.maxKinJump = 0;
    this.loopClosures = 0;
  }

  observations(sensorNoise) {
    const out = [];
    for (const lm of this.trueLandmarks) {
      const dx = lm.x - this.truePose.x;
      const dy = lm.y - this.truePose.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 34 || Math.random() < 0.18) continue;

      out.push({
        id: lm.id,
        range: dist + randn() * sensorNoise * 0.65,
        bearing: wrapAngle(Math.atan2(dy, dx) - this.truePose.theta + randn() * sensorNoise * 0.03),
      });
    }
    return out;
  }

  updateMapPoint(map, id, predicted) {
    const existing = map.get(id);
    if (!existing) {
      const created = { x: predicted.x, y: predicted.y, count: 1, sigma: 7.7 };
      map.set(id, created);
      return created;
    }

    const weight = 1 / (existing.count + 1);
    existing.x = existing.x * (1 - weight) + predicted.x * weight;
    existing.y = existing.y * (1 - weight) + predicted.y * weight;
    existing.count += 1;
    existing.sigma = Math.max(1.3, existing.sigma * 0.93);
    return existing;
  }

  step(dt) {
    if (!this.running) {
      this.draw();
      return;
    }

    const odomNoise = Number(this.odomNoise.value);
    const sensorNoise = Number(this.sensorNoise.value);
    const gain = Number(this.gain.value);
    const yawRateLimit = Number(this.yawRate.value);

    this.t += dt;
    const prevTrue = this.truePose;
    this.truePose = modelB(this.t);

    const deltaS = Math.hypot(this.truePose.x - prevTrue.x, this.truePose.y - prevTrue.y);
    const deltaTheta = wrapAngle(this.truePose.theta - prevTrue.theta);
    const prevRaw = { x: this.rawPose.x, y: this.rawPose.y };
    const prevKin = { x: this.kinPose.x, y: this.kinPose.y };

    this.rawPose.theta = wrapAngle(this.rawPose.theta + deltaTheta + randn() * odomNoise * 0.05);
    const rawStep = deltaS + randn() * odomNoise * 0.5;
    this.rawPose.x += rawStep * Math.cos(this.rawPose.theta);
    this.rawPose.y += rawStep * Math.sin(this.rawPose.theta);
    clampPose(this.rawPose);

    const vMeasured = Math.max(0, deltaS + randn() * odomNoise * 0.5) / Math.max(dt, 1e-3);
    const omegaMeasured = (deltaTheta + randn() * odomNoise * 0.05) / Math.max(dt, 1e-3);
    const accelLimit = 20;
    const yawAccelLimit = 4.3;

    this.kinPose.v += clamp(vMeasured - this.kinPose.v, -accelLimit * dt, accelLimit * dt);
    this.kinPose.omega += clamp(omegaMeasured - this.kinPose.omega, -yawAccelLimit * dt, yawAccelLimit * dt);
    this.kinPose.omega = clamp(this.kinPose.omega, -yawRateLimit, yawRateLimit);
    this.kinPose.theta = wrapAngle(this.kinPose.theta + this.kinPose.omega * dt);
    this.kinPose.x += this.kinPose.v * dt * Math.cos(this.kinPose.theta);
    this.kinPose.y += this.kinPose.v * dt * Math.sin(this.kinPose.theta);
    clampPose(this.kinPose);

    const observations = this.observations(sensorNoise);
    this.visible = observations;

    let kinCorrX = 0;
    let kinCorrY = 0;
    let kinCorrTheta = 0;
    let kinCorrCount = 0;

    for (const obs of observations) {
      const rawGlobal = this.rawPose.theta + obs.bearing;
      const rawPred = {
        x: this.rawPose.x + obs.range * Math.cos(rawGlobal),
        y: this.rawPose.y + obs.range * Math.sin(rawGlobal),
      };
      const rawLm = this.updateMapPoint(this.mapRaw, obs.id, rawPred);
      if (rawLm.count > 1) {
        const rx = rawLm.x - rawPred.x;
        const ry = rawLm.y - rawPred.y;
        this.rawPose.x += rx * gain * 0.25;
        this.rawPose.y += ry * gain * 0.25;

        const rawBearing = wrapAngle(Math.atan2(rawLm.y - this.rawPose.y, rawLm.x - this.rawPose.x) - this.rawPose.theta);
        const rawInnovation = wrapAngle(obs.bearing - rawBearing);
        this.rawPose.theta = wrapAngle(this.rawPose.theta - rawInnovation * gain * 0.12);
        clampPose(this.rawPose);
      }

      const kinGlobal = this.kinPose.theta + obs.bearing;
      const kinPred = {
        x: this.kinPose.x + obs.range * Math.cos(kinGlobal),
        y: this.kinPose.y + obs.range * Math.sin(kinGlobal),
      };
      const kinLm = this.updateMapPoint(this.mapKin, obs.id, kinPred);
      if (kinLm.count > 1) {
        kinCorrX += kinLm.x - kinPred.x;
        kinCorrY += kinLm.y - kinPred.y;

        const kinBearing = wrapAngle(Math.atan2(kinLm.y - this.kinPose.y, kinLm.x - this.kinPose.x) - this.kinPose.theta);
        kinCorrTheta += -wrapAngle(obs.bearing - kinBearing);
        kinCorrCount += 1;
      }
    }

    if (kinCorrCount > 0) {
      let adjustX = (kinCorrX / kinCorrCount) * gain * 0.25;
      let adjustY = (kinCorrY / kinCorrCount) * gain * 0.25;
      const maxPositionAdjust = 4.2 * dt;
      const adjustMag = Math.hypot(adjustX, adjustY);
      if (adjustMag > maxPositionAdjust) {
        const s = maxPositionAdjust / adjustMag;
        adjustX *= s;
        adjustY *= s;
      }

      this.kinPose.x += adjustX;
      this.kinPose.y += adjustY;

      const desiredYawAdjust = (kinCorrTheta / kinCorrCount) * gain * 0.15;
      const maxYawAdjust = yawRateLimit * 0.2 * dt;
      this.kinPose.theta = wrapAngle(this.kinPose.theta + clamp(desiredYawAdjust, -maxYawAdjust, maxYawAdjust));
      clampPose(this.kinPose);
    }

    if (this.t > 45 && observations.length > 2) {
      const backHome = Math.hypot(this.kinPose.x - this.startPose.x, this.kinPose.y - this.startPose.y);
      if (backHome < 7 && Math.random() < 0.02) {
        this.loopClosures += 1;
      }
    }

    this.rawJump = Math.hypot(this.rawPose.x - prevRaw.x, this.rawPose.y - prevRaw.y);
    this.kinJump = Math.hypot(this.kinPose.x - prevKin.x, this.kinPose.y - prevKin.y);
    this.maxRawJump = Math.max(this.maxRawJump, this.rawJump);
    this.maxKinJump = Math.max(this.maxKinJump, this.kinJump);

    this.truePath.push({ x: this.truePose.x, y: this.truePose.y });
    this.rawPath.push({ x: this.rawPose.x, y: this.rawPose.y });
    this.kinPath.push({ x: this.kinPose.x, y: this.kinPose.y });

    if (this.truePath.length > 1800) {
      this.truePath.shift();
      this.rawPath.shift();
      this.kinPath.shift();
    }

    this.draw();
  }

  drawMap(mapper) {
    for (const lm of this.mapKin.values()) {
      const x = mapper.toX(lm.x);
      const y = mapper.toY(lm.y);
      const radius = lm.sigma * mapper.scale;
      const intensity = clamp(lm.count / 9, 0.2, 1);

      this.ctx.strokeStyle = `rgba(45,131,119,${0.1 + intensity * 0.22})`;
      this.ctx.lineWidth = 1.15;
      this.ctx.beginPath();
      this.ctx.arc(x, y, radius, 0, TAU);
      this.ctx.stroke();

      this.ctx.fillStyle = `rgba(45,131,119,${0.36 + intensity * 0.5})`;
      this.ctx.beginPath();
      this.ctx.arc(x, y, 2.7, 0, TAU);
      this.ctx.fill();
    }
  }

  drawVisibleHints(mapper) {
    this.ctx.strokeStyle = THEME.ray;
    this.ctx.lineWidth = 1;
    for (const obs of this.visible) {
      const lm = this.mapKin.get(obs.id);
      if (!lm) continue;
      this.ctx.beginPath();
      this.ctx.moveTo(mapper.toX(this.kinPose.x), mapper.toY(this.kinPose.y));
      this.ctx.lineTo(mapper.toX(lm.x), mapper.toY(lm.y));
      this.ctx.stroke();
    }
  }

  mapError(map) {
    let sum = 0;
    let count = 0;
    for (const truth of this.trueLandmarks) {
      const est = map.get(truth.id);
      if (!est) continue;
      sum += Math.hypot(est.x - truth.x, est.y - truth.y);
      count += 1;
    }
    return count > 0 ? sum / count : 0;
  }

  draw() {
    const mapper = getMapper(this.canvas);
    drawGrid(this.ctx, this.canvas, mapper);

    drawPath(this.ctx, mapper, this.truePath, THEME.truthHintPath, 1.7);
    this.drawMap(mapper);
    this.drawVisibleHints(mapper);

    if (this.showRaw.checked) {
      drawPath(this.ctx, mapper, this.rawPath, THEME.rawBaseline, 1.8, [7, 5]);
      drawRobot(this.ctx, mapper, this.rawPose, THEME.rawBaseline, "raw");
    }

    drawPath(this.ctx, mapper, this.kinPath, THEME.correctedPath, 2.3);
    drawRobot(this.ctx, mapper, this.kinPose, THEME.correctedPath, "kin");

    this.ctx.strokeStyle = THEME.truthGap;
    this.ctx.lineWidth = 1.35;
    this.ctx.setLineDash([5, 4]);
    this.ctx.beginPath();
    this.ctx.moveTo(mapper.toX(this.truePose.x), mapper.toY(this.truePose.y));
    this.ctx.lineTo(mapper.toX(this.kinPose.x), mapper.toY(this.kinPose.y));
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    this.ctx.fillStyle = THEME.truthHalo;
    this.ctx.beginPath();
    this.ctx.arc(mapper.toX(this.truePose.x), mapper.toY(this.truePose.y), 11, 0, TAU);
    this.ctx.fill();
    drawRobot(this.ctx, mapper, this.truePose, THEME.truePose, "true");

    const rawErr = Math.hypot(this.truePose.x - this.rawPose.x, this.truePose.y - this.rawPose.y);
    const kinErr = Math.hypot(this.truePose.x - this.kinPose.x, this.truePose.y - this.kinPose.y);
    const meanMapErr = this.mapError(this.mapKin);

    this.readout.textContent =
      `Visible landmarks: ${this.visible.length}\n` +
      `Pose error raw/kin: ${rawErr.toFixed(2)} / ${kinErr.toFixed(2)} units\n` +
      `Step jump raw/kin: ${this.rawJump.toFixed(2)} / ${this.kinJump.toFixed(2)} units\n` +
      `Max jump raw/kin: ${this.maxRawJump.toFixed(2)} / ${this.maxKinJump.toFixed(2)} units\n` +
      `Mean landmark error (kin map): ${meanMapErr.toFixed(2)} units\n` +
      `Loop closures detected: ${this.loopClosures}`;
  }
}

function init() {
  const demos = [
    new FrameTransformDemo(),
    new OdometryDemo(),
    new BayesianUpdateDemo(),
    new CorrectionDemo(),
    new DataAssociationDemo(),
    new SlamDemo(),
    new OccupancyGridDemo(),
    new KinematicSlamDemo(),
  ];
  let last = performance.now();

  const animate = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    for (const demo of demos) {
      demo.step(dt);
    }

    requestAnimationFrame(animate);
  };

  requestAnimationFrame(animate);
}

window.addEventListener("DOMContentLoaded", init);
