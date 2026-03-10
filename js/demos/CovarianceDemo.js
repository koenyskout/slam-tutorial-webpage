import { TAU } from "../core/constants.js";
import { clamp } from "../core/math.js";
import { drawGrid, drawInfoPanel, getMapper } from "../core/canvas.js";

const CHI2_2D_95 = Math.sqrt(5.991);
const COLORS = {
  truth: "#2f668e",
  prior: "#8d949c",
  meas: "#a17034",
  post: "#2d8377",
};

function invert2x2(m) {
  const det = m.xx * m.yy - m.xy * m.xy;
  const safeDet = Math.max(1e-8, det);
  const invDet = 1 / safeDet;
  return {
    xx: m.yy * invDet,
    xy: -m.xy * invDet,
    yy: m.xx * invDet,
  };
}

function covFromAxes(a, b, theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const a2 = a * a;
  const b2 = b * b;
  return {
    xx: a2 * c * c + b2 * s * s,
    xy: (a2 - b2) * s * c,
    yy: a2 * s * s + b2 * c * c,
  };
}

function addCov(a, b) {
  return { xx: a.xx + b.xx, xy: a.xy + b.xy, yy: a.yy + b.yy };
}

function mulCovVec(m, v) {
  return {
    x: m.xx * v.x + m.xy * v.y,
    y: m.xy * v.x + m.yy * v.y,
  };
}

function axesFromCov(cov) {
  const trace = cov.xx + cov.yy;
  const disc = Math.sqrt(Math.max(0, (cov.xx - cov.yy) * (cov.xx - cov.yy) + 4 * cov.xy * cov.xy));
  const l1 = Math.max(1e-8, 0.5 * (trace + disc));
  const l2 = Math.max(1e-8, 0.5 * (trace - disc));
  const angle = 0.5 * Math.atan2(2 * cov.xy, cov.xx - cov.yy);
  return {
    a: Math.sqrt(l1),
    b: Math.sqrt(l2),
    theta: angle,
  };
}

export class CovarianceDemo {
  constructor() {
    this.canvas = document.getElementById("covarianceCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.resetBtn = document.getElementById("covarianceReset");
    this.dragMode = null;

    this.bindEvents();
    this.reset();
  }

  bindEvents() {
    this.resetBtn.addEventListener("click", () => this.reset());
    this.canvas.addEventListener("mousedown", (event) => this.onPointerDown(event));
    window.addEventListener("mousemove", (event) => this.onPointerMove(event));
    window.addEventListener("mouseup", () => {
      this.dragMode = null;
    });
  }

  reset() {
    this.truth = { x: 52, y: 50 };
    this.prior = {
      mean: { x: 30, y: 34 },
      a: 11,
      b: 6.2,
      theta: 0.35,
    };
    this.measurement = {
      mean: { x: 64, y: 60 },
      a: 7,
      b: 3.8,
      theta: -0.62,
    };
    this.draw();
  }

  eventToWorld(event, mapper) {
    const rect = this.canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * this.canvas.width;
    const py = ((event.clientY - rect.top) / rect.height) * this.canvas.height;
    return { x: mapper.fromX(px), y: mapper.fromY(py) };
  }

  handlesFor(distKey, dist) {
    const c = Math.cos(dist.theta);
    const s = Math.sin(dist.theta);
    const major = {
      x: dist.mean.x + dist.a * c,
      y: dist.mean.y + dist.a * s,
    };
    const minor = {
      x: dist.mean.x - dist.b * s,
      y: dist.mean.y + dist.b * c,
    };

    return [
      { kind: `${distKey}:mean`, x: dist.mean.x, y: dist.mean.y },
      { kind: `${distKey}:major`, x: major.x, y: major.y },
      { kind: `${distKey}:minor`, x: minor.x, y: minor.y },
    ];
  }

  getHandles() {
    return [
      { kind: "truth:mean", x: this.truth.x, y: this.truth.y },
      ...this.handlesFor("prior", this.prior),
      ...this.handlesFor("measurement", this.measurement),
    ];
  }

  onPointerDown(event) {
    const mapper = getMapper(this.canvas);
    const p = this.eventToWorld(event, mapper);
    let best = null;
    let bestDist = Infinity;

    for (const h of this.getHandles()) {
      const d = Math.hypot(p.x - h.x, p.y - h.y);
      if (d < bestDist) {
        bestDist = d;
        best = h;
      }
    }

    if (best && bestDist < 3.4) {
      this.dragMode = best.kind;
    }
  }

  onPointerMove(event) {
    if (!this.dragMode) return;
    const mapper = getMapper(this.canvas);
    const p = this.eventToWorld(event, mapper);
    const [distKey, part] = this.dragMode.split(":");
    if (distKey === "truth" && part === "mean") {
      this.truth.x = clamp(p.x, 5, 95);
      this.truth.y = clamp(p.y, 5, 95);
      return;
    }

    const dist = distKey === "prior" ? this.prior : this.measurement;

    if (part === "mean") {
      dist.mean.x = clamp(p.x, 5, 95);
      dist.mean.y = clamp(p.y, 5, 95);
      return;
    }

    const dx = p.x - dist.mean.x;
    const dy = p.y - dist.mean.y;
    if (part === "major") {
      dist.a = clamp(Math.hypot(dx, dy), 2, 26);
      dist.theta = Math.atan2(dy, dx);
      return;
    }

    if (part === "minor") {
      const normalX = -Math.sin(dist.theta);
      const normalY = Math.cos(dist.theta);
      const projection = Math.abs(dx * normalX + dy * normalY);
      dist.b = clamp(projection, 1.5, 22);
    }
  }

  posterior() {
    const pCov = covFromAxes(this.prior.a, this.prior.b, this.prior.theta);
    const zCov = covFromAxes(this.measurement.a, this.measurement.b, this.measurement.theta);

    const pInfo = invert2x2(pCov);
    const zInfo = invert2x2(zCov);
    const postInfo = addCov(pInfo, zInfo);
    const postCov = invert2x2(postInfo);

    const rhs = {
      x:
        pInfo.xx * this.prior.mean.x +
        pInfo.xy * this.prior.mean.y +
        zInfo.xx * this.measurement.mean.x +
        zInfo.xy * this.measurement.mean.y,
      y:
        pInfo.xy * this.prior.mean.x +
        pInfo.yy * this.prior.mean.y +
        zInfo.xy * this.measurement.mean.x +
        zInfo.yy * this.measurement.mean.y,
    };

    const postMean = mulCovVec(postCov, rhs);
    const postAxes = axesFromCov(postCov);
    return {
      priorCov: pCov,
      measurementCov: zCov,
      postCov,
      postMean,
      postAxes,
    };
  }

  drawEllipse(mapper, mean, cov, stroke, fill, width = 2) {
    const { a, b, theta } = axesFromCov(cov);
    const rx = a * CHI2_2D_95 * mapper.scale;
    const ry = b * CHI2_2D_95 * mapper.scale;
    const cx = mapper.toX(mean.x);
    const cy = mapper.toY(mean.y);

    this.ctx.save();
    this.ctx.translate(cx, cy);
    this.ctx.rotate(-theta);
    this.ctx.fillStyle = fill;
    this.ctx.beginPath();
    this.ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
    this.ctx.fill();

    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = width;
    this.ctx.beginPath();
    this.ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawHandle(mapper, x, y, color) {
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(mapper.toX(x), mapper.toY(y), 3.8, 0, TAU);
    this.ctx.fill();
  }

  drawCenter(mapper, mean, color, label) {
    const x = mapper.toX(mean.x);
    const y = mapper.toY(mean.y);
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(x, y, 5, 0, TAU);
    this.ctx.fill();
    this.ctx.font = "12px IBM Plex Mono";
    this.ctx.fillText(label, x + 7, y - 8);
  }

  drawLegend(mapper) {
    const x = mapper.toX(2);
    const y = mapper.toY(98);
    this.ctx.font = "12px IBM Plex Mono";
    this.ctx.fillStyle = COLORS.truth;
    this.ctx.fillText("Ground truth state", x, y);
    this.ctx.fillStyle = COLORS.prior;
    this.ctx.fillText("Prior belief covariance", x, y + 16);
    this.ctx.fillStyle = COLORS.meas;
    this.ctx.fillText("Measurement covariance", x, y + 32);
    this.ctx.fillStyle = COLORS.post;
    this.ctx.fillText("Posterior belief covariance", x, y + 48);
  }

  drawCoordinatePanel(post) {
    drawInfoPanel(this.ctx, this.canvas, {
      title: "In-Figure Coordinates",
      width: 252,
      lines: [
        { text: `truth: (${this.truth.x.toFixed(1)}, ${this.truth.y.toFixed(1)})`, color: COLORS.truth },
        { text: `prior: (${this.prior.mean.x.toFixed(1)}, ${this.prior.mean.y.toFixed(1)})`, color: COLORS.prior },
        { text: `meas : (${this.measurement.mean.x.toFixed(1)}, ${this.measurement.mean.y.toFixed(1)})`, color: COLORS.meas },
        { text: `post : (${post.postMean.x.toFixed(1)}, ${post.postMean.y.toFixed(1)})`, color: COLORS.post },
        { text: `post sigma: a=${post.postAxes.a.toFixed(2)} b=${post.postAxes.b.toFixed(2)}` },
      ],
    });
  }

  step() {
    this.draw();
  }

  draw() {
    const mapper = getMapper(this.canvas);
    drawGrid(this.ctx, this.canvas, mapper);

    const post = this.posterior();
    this.drawEllipse(
      mapper,
      this.prior.mean,
      post.priorCov,
      "rgba(141, 148, 156, 0.92)",
      "rgba(141, 148, 156, 0.12)",
      1.7,
    );
    this.drawEllipse(
      mapper,
      this.measurement.mean,
      post.measurementCov,
      "rgba(161, 112, 52, 0.9)",
      "rgba(161, 112, 52, 0.12)",
      1.7,
    );
    this.drawEllipse(
      mapper,
      post.postMean,
      post.postCov,
      "rgba(45, 131, 119, 0.95)",
      "rgba(45, 131, 119, 0.15)",
      2.2,
    );

    this.ctx.strokeStyle = "rgba(95,134,165,0.44)";
    this.ctx.setLineDash([4, 4]);
    this.ctx.beginPath();
    this.ctx.moveTo(mapper.toX(this.prior.mean.x), mapper.toY(this.prior.mean.y));
    this.ctx.lineTo(mapper.toX(this.truth.x), mapper.toY(this.truth.y));
    this.ctx.moveTo(mapper.toX(post.postMean.x), mapper.toY(post.postMean.y));
    this.ctx.lineTo(mapper.toX(this.truth.x), mapper.toY(this.truth.y));
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    this.drawCenter(mapper, this.truth, COLORS.truth, "truth");
    this.drawCenter(mapper, this.prior.mean, COLORS.prior, "prior");
    this.drawCenter(mapper, this.measurement.mean, COLORS.meas, "meas");
    this.drawCenter(mapper, post.postMean, COLORS.post, "post");
    this.drawLegend(mapper);
    this.drawCoordinatePanel(post);

    this.drawHandle(mapper, this.truth.x, this.truth.y, COLORS.truth);
    for (const h of this.handlesFor("prior", this.prior)) {
      this.drawHandle(mapper, h.x, h.y, COLORS.prior);
    }
    for (const h of this.handlesFor("measurement", this.measurement)) {
      this.drawHandle(mapper, h.x, h.y, COLORS.meas);
    }

    const dx = this.measurement.mean.x - this.prior.mean.x;
    const dy = this.measurement.mean.y - this.prior.mean.y;
    const preGap = Math.hypot(dx, dy);
    const postGap = Math.hypot(post.postMean.x - this.prior.mean.x, post.postMean.y - this.prior.mean.y);
    const shiftFraction = preGap > 1e-6 ? postGap / preGap : 0;
    const priorErr = Math.hypot(this.prior.mean.x - this.truth.x, this.prior.mean.y - this.truth.y);
    const postErr = Math.hypot(post.postMean.x - this.truth.x, post.postMean.y - this.truth.y);
    const reduction = priorErr > 1e-6 ? ((priorErr - postErr) / priorErr) * 100 : 0;

    drawInfoPanel(this.ctx, this.canvas, {
      title: "Fusion Metrics",
      width: 330,
      y: 140,
      lines: [
        `prior/post error: ${priorErr.toFixed(2)} / ${postErr.toFixed(2)}`,
        `error reduction: ${reduction.toFixed(1)}%`,
        `post axes: a=${post.postAxes.a.toFixed(2)}, b=${post.postAxes.b.toFixed(2)}`,
        `post theta: ${post.postAxes.theta.toFixed(2)} rad`,
        `mean shift fraction: ${shiftFraction.toFixed(3)}`,
      ],
    });
  }
}
