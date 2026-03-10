import { TAU, THEME } from "../core/constants.js";
import { clamp, randn, wrapAngle } from "../core/math.js";
import { drawGrid, drawInfoPanel, drawRobot, getMapper } from "../core/canvas.js";

function matMul(a, b) {
  const rows = a.length;
  const cols = b[0].length;
  const inner = b.length;
  const out = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      let sum = 0;
      for (let k = 0; k < inner; k += 1) sum += a[r][k] * b[k][c];
      out[r][c] = sum;
    }
  }
  return out;
}

function matAdd(a, b) {
  return a.map((row, r) => row.map((v, c) => v + b[r][c]));
}

function matSub(a, b) {
  return a.map((row, r) => row.map((v, c) => v - b[r][c]));
}

function transpose(a) {
  return a[0].map((_, c) => a.map((row) => row[c]));
}

function matVecMul(a, v) {
  return a.map((row) => row.reduce((sum, val, i) => sum + val * v[i], 0));
}

function vecAdd(a, b) {
  return a.map((v, i) => v + b[i]);
}

function inv2x2(m) {
  const det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
  const s = Math.max(1e-8, Math.abs(det));
  const invDet = 1 / s;
  return [
    [m[1][1] * invDet, -m[0][1] * invDet],
    [-m[1][0] * invDet, m[0][0] * invDet],
  ];
}

function identity3() {
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
}

function subCov2(cov3) {
  return [
    [cov3[0][0], cov3[0][1]],
    [cov3[1][0], cov3[1][1]],
  ];
}

function ellipseFromCov2(cov) {
  const xx = cov[0][0];
  const xy = cov[0][1];
  const yy = cov[1][1];
  const trace = xx + yy;
  const disc = Math.sqrt(Math.max(0, (xx - yy) * (xx - yy) + 4 * xy * xy));
  const l1 = Math.max(1e-6, 0.5 * (trace + disc));
  const l2 = Math.max(1e-6, 0.5 * (trace - disc));
  return {
    a: Math.sqrt(l1),
    b: Math.sqrt(l2),
    theta: 0.5 * Math.atan2(2 * xy, xx - yy),
  };
}

export class LinkedSlamExampleDemo {
  constructor() {
    this.canvas = document.getElementById("linkedExampleCanvas");
    this.ctx = this.canvas.getContext("2d");

    this.procNoise = document.getElementById("linkedProcNoise");
    this.procNoiseValue = document.getElementById("linkedProcNoiseValue");
    this.measNoise = document.getElementById("linkedMeasNoise");
    this.measNoiseValue = document.getElementById("linkedMeasNoiseValue");
    this.stepSize = document.getElementById("linkedStepSize");
    this.stepSizeValue = document.getElementById("linkedStepSizeValue");
    this.turnRate = document.getElementById("linkedTurnRate");
    this.turnRateValue = document.getElementById("linkedTurnRateValue");

    this.predictBtn = document.getElementById("linkedPredict");
    this.correctBtn = document.getElementById("linkedCorrect");
    this.nextBtn = document.getElementById("linkedNext");
    this.stepBtn = document.getElementById("linkedStep");
    this.resetBtn = document.getElementById("linkedReset");

    this.landmarks = [
      { id: "L1", x: 66, y: 56 },
      { id: "L2", x: 42, y: 74 },
      { id: "L3", x: 72, y: 32 },
    ];

    this.bindEvents();
    this.reset();
  }

  bindEvents() {
    const updateLabels = () => {
      this.procNoiseValue.textContent = Number(this.procNoise.value).toFixed(2);
      this.measNoiseValue.textContent = Number(this.measNoise.value).toFixed(2);
      this.stepSizeValue.textContent = Number(this.stepSize.value).toFixed(2);
      this.turnRateValue.textContent = `${Number(this.turnRate.value).toFixed(2)} rad`;
    };

    this.procNoise.addEventListener("input", updateLabels);
    this.measNoise.addEventListener("input", updateLabels);
    this.stepSize.addEventListener("input", updateLabels);
    this.turnRate.addEventListener("input", updateLabels);
    updateLabels();

    this.predictBtn.addEventListener("click", () => this.predictOnly());
    this.correctBtn.addEventListener("click", () => this.correctOnly());
    this.nextBtn?.addEventListener("click", () => this.nextAction());
    this.stepBtn.addEventListener("click", () => this.fullStep());
    this.resetBtn.addEventListener("click", () => this.reset());
  }

  reset() {
    this.truth = { x: 37, y: 50, theta: 0.15 };
    this.estimate = { x: 34, y: 53, theta: -0.03 };
    this.predicted = null;
    this.corrected = { ...this.estimate };

    this.P = [
      [6.4, 0, 0],
      [0, 6.4, 0],
      [0, 0, 0.22],
    ];
    this.PPred = this.P.map((r) => [...r]);
    this.last = null;
    this.phase = "reset";
    this.updateControls();
    this.draw();
  }

  needsCorrection() {
    return this.phase === "predicted";
  }

  nextAction() {
    if (this.needsCorrection()) this.correctOnly();
    else this.predictOnly();
  }

  updateControls() {
    if (this.nextBtn) {
      this.nextBtn.textContent = this.needsCorrection() ? "Next: Correct" : "Next: Predict";
    }
  }

  pickObservedLandmark() {
    let best = this.landmarks[0];
    let bestDist = Infinity;
    for (const lm of this.landmarks) {
      const d = Math.hypot(lm.x - this.truth.x, lm.y - this.truth.y);
      if (d < bestDist) {
        bestDist = d;
        best = lm;
      }
    }
    return best;
  }

  moveTruth(control) {
    this.truth.theta = wrapAngle(this.truth.theta + control.dtheta);
    this.truth.x += control.ds * Math.cos(this.truth.theta);
    this.truth.y += control.ds * Math.sin(this.truth.theta);
    this.truth.x = clamp(this.truth.x, 8, 92);
    this.truth.y = clamp(this.truth.y, 8, 92);
  }

  controlInput() {
    return {
      ds: Number(this.stepSize.value),
      dtheta: Number(this.turnRate.value),
    };
  }

  measurementFromTruth(landmark) {
    const noise = Number(this.measNoise.value);
    const sigmaR = 0.4 + noise * 1.0;
    const sigmaB = 0.01 + noise * 0.06;
    const dx = landmark.x - this.truth.x;
    const dy = landmark.y - this.truth.y;
    return {
      range: Math.hypot(dx, dy) + randn() * sigmaR,
      bearing: wrapAngle(Math.atan2(dy, dx) - this.truth.theta + randn() * sigmaB),
      sigmaR,
      sigmaB,
    };
  }

  predictOnly() {
    const u = this.controlInput();
    this.moveTruth(u);

    const x = [this.estimate.x, this.estimate.y, this.estimate.theta];
    const ds = u.ds;
    const dtheta = u.dtheta;
    const t = x[2];
    const xPred = [x[0] + ds * Math.cos(t), x[1] + ds * Math.sin(t), wrapAngle(x[2] + dtheta)];

    const F = [
      [1, 0, -ds * Math.sin(t)],
      [0, 1, ds * Math.cos(t)],
      [0, 0, 1],
    ];
    const pn = Number(this.procNoise.value);
    const qPos = 0.08 + pn * pn * 0.38;
    const qTheta = 0.0015 + pn * pn * 0.008;
    const Q = [
      [qPos, 0, 0],
      [0, qPos, 0],
      [0, 0, qTheta],
    ];

    const FPFt = matMul(matMul(F, this.P), transpose(F));
    const PPred = matAdd(FPFt, Q);

    this.predicted = { x: xPred[0], y: xPred[1], theta: xPred[2] };
    this.PPred = PPred;
    this.phase = "predicted";
    this.last = {
      u,
      F,
      Q,
      landmark: this.pickObservedLandmark(),
      z: null,
      innovation: null,
      K: null,
      errPred: Math.hypot(this.truth.x - this.predicted.x, this.truth.y - this.predicted.y),
      errPost: null,
    };
    this.updateControls();
    this.draw();
  }

  correctOnly() {
    if (!this.predicted) this.predictOnly();
    const landmark = this.pickObservedLandmark();
    const z = this.measurementFromTruth(landmark);

    const xPred = [this.predicted.x, this.predicted.y, this.predicted.theta];
    const dx = landmark.x - xPred[0];
    const dy = landmark.y - xPred[1];
    const q = Math.max(1e-8, dx * dx + dy * dy);
    const r = Math.sqrt(q);
    const h = [r, wrapAngle(Math.atan2(dy, dx) - xPred[2])];

    const H = [
      [-dx / r, -dy / r, 0],
      [dy / q, -dx / q, -1],
    ];

    const R = [
      [z.sigmaR * z.sigmaR, 0],
      [0, z.sigmaB * z.sigmaB],
    ];

    const HP = matMul(H, this.PPred);
    const S = matAdd(matMul(HP, transpose(H)), R);
    const Sinv = inv2x2(S);
    const K = matMul(matMul(this.PPred, transpose(H)), Sinv);

    const innovation = [z.range - h[0], wrapAngle(z.bearing - h[1])];
    const delta = matVecMul(K, innovation);
    const xPost = vecAdd(xPred, delta);
    xPost[2] = wrapAngle(xPost[2]);

    const KH = matMul(K, H);
    const IminusKH = matSub(identity3(), KH);
    const PPost = matMul(IminusKH, this.PPred);

    this.corrected = { x: xPost[0], y: xPost[1], theta: xPost[2] };
    this.estimate = { ...this.corrected };
    this.P = PPost;
    this.phase = "corrected";
    this.last = {
      ...this.last,
      landmark,
      z,
      innovation,
      K,
      errPred: Math.hypot(this.truth.x - this.predicted.x, this.truth.y - this.predicted.y),
      errPost: Math.hypot(this.truth.x - this.corrected.x, this.truth.y - this.corrected.y),
    };
    this.updateControls();
    this.draw();
  }

  fullStep() {
    this.predictOnly();
    this.correctOnly();
  }

  drawLandmarks(mapper) {
    this.ctx.fillStyle = THEME.landmark;
    this.ctx.font = "11px IBM Plex Mono";
    for (const lm of this.landmarks) {
      const x = mapper.toX(lm.x);
      const y = mapper.toY(lm.y);
      this.ctx.beginPath();
      this.ctx.arc(x, y, 3.6, 0, TAU);
      this.ctx.fill();
      this.ctx.fillText(lm.id, x + 6, y - 6);
    }
  }

  drawCovariance(mapper, pose, cov3, color, alphaFill = 0.1) {
    const e = ellipseFromCov2(subCov2(cov3));
    const s = 2.4;
    const rx = e.a * mapper.scale * s;
    const ry = e.b * mapper.scale * s;
    const cx = mapper.toX(pose.x);
    const cy = mapper.toY(pose.y);
    this.ctx.save();
    this.ctx.translate(cx, cy);
    this.ctx.rotate(-e.theta);
    this.ctx.fillStyle = color.replace("1)", `${alphaFill})`).replace("0.95)", `${alphaFill})`);
    this.ctx.beginPath();
    this.ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
    this.ctx.fill();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1.7;
    this.ctx.beginPath();
    this.ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawMeasurementRays(mapper) {
    if (!this.last || !this.last.landmark) return;
    const lm = this.last.landmark;

    this.ctx.strokeStyle = "rgba(47,102,142,0.55)";
    this.ctx.lineWidth = 1.3;
    this.ctx.setLineDash([5, 4]);
    this.ctx.beginPath();
    this.ctx.moveTo(mapper.toX(this.truth.x), mapper.toY(this.truth.y));
    this.ctx.lineTo(mapper.toX(lm.x), mapper.toY(lm.y));
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    if (!this.predicted) return;
    this.ctx.strokeStyle = "rgba(161,112,52,0.72)";
    this.ctx.setLineDash([7, 5]);
    this.ctx.beginPath();
    this.ctx.moveTo(mapper.toX(this.predicted.x), mapper.toY(this.predicted.y));
    this.ctx.lineTo(mapper.toX(lm.x), mapper.toY(lm.y));
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  drawLegend(mapper) {
    const x = mapper.toX(2);
    const y = mapper.toY(98);
    this.ctx.font = "12px IBM Plex Mono";
    this.ctx.fillStyle = THEME.truePath;
    this.ctx.fillText("truth", x, y);
    this.ctx.fillStyle = THEME.odomPath;
    this.ctx.fillText("predicted", x, y + 16);
    this.ctx.fillStyle = THEME.correctedPath;
    this.ctx.fillText("corrected", x, y + 32);
  }

  drawCoordinatePanel() {
    const errPred = this.predicted ? Math.hypot(this.truth.x - this.predicted.x, this.truth.y - this.predicted.y) : null;
    const errPost = Math.hypot(this.truth.x - this.estimate.x, this.truth.y - this.estimate.y);
    const lines = [
      { text: `truth: (${this.truth.x.toFixed(1)}, ${this.truth.y.toFixed(1)})`, color: THEME.truePath },
    ];
    if (this.predicted) {
      lines.push({ text: `pred : (${this.predicted.x.toFixed(1)}, ${this.predicted.y.toFixed(1)})`, color: THEME.odomPath });
    }
    lines.push({ text: `corr : (${this.estimate.x.toFixed(1)}, ${this.estimate.y.toFixed(1)})`, color: THEME.correctedPath });

    if (this.last && this.last.landmark) {
      lines.push({
        text: `landmark ${this.last.landmark.id}: (${this.last.landmark.x.toFixed(1)}, ${this.last.landmark.y.toFixed(1)})`,
        color: THEME.landmark,
      });
      if (this.last.z) {
        lines.push({ text: `z=(r=${this.last.z.range.toFixed(1)}, b=${this.last.z.bearing.toFixed(2)} rad)`, color: "#a17034" });
      }
    }
    lines.push(
      errPred == null
        ? `error to truth: ${errPost.toFixed(2)}`
        : `error pred/corr: ${errPred.toFixed(2)} / ${errPost.toFixed(2)}`,
    );

    drawInfoPanel(this.ctx, this.canvas, {
      title: "In-Figure Coordinates",
      width: 272,
      lines,
    });
  }

  draw() {
    const mapper = getMapper(this.canvas);
    drawGrid(this.ctx, this.canvas, mapper);
    this.drawLandmarks(mapper);
    this.drawMeasurementRays(mapper);

    if (this.predicted) {
      this.drawCovariance(mapper, this.predicted, this.PPred, "rgba(161,112,52,0.95)");
      drawRobot(this.ctx, mapper, this.predicted, THEME.odomPath, "pred");
    }

    this.drawCovariance(mapper, this.estimate, this.P, "rgba(45,131,119,0.95)");
    drawRobot(this.ctx, mapper, this.estimate, THEME.correctedPath, "belief");
    drawRobot(this.ctx, mapper, this.truth, THEME.truePath, "truth");

    if (this.predicted && this.corrected) {
      this.ctx.strokeStyle = "rgba(45,131,119,0.72)";
      this.ctx.lineWidth = 1.5;
      this.ctx.beginPath();
      this.ctx.moveTo(mapper.toX(this.predicted.x), mapper.toY(this.predicted.y));
      this.ctx.lineTo(mapper.toX(this.corrected.x), mapper.toY(this.corrected.y));
      this.ctx.stroke();
    }

    this.drawLegend(mapper);
    this.drawCoordinatePanel();
  }

  step() {
    this.draw();
  }
}
