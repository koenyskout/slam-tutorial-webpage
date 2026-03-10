import { TAU } from "../core/constants.js";
import { clamp, randn, wrapAngle } from "../core/math.js";
import { drawGrid, getMapper } from "../core/canvas.js";

export class BayesianUpdateDemo {
  constructor() {
    this.canvas = document.getElementById("bayesCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.readout = document.getElementById("bayesReadout");
    this.resetBtn = document.getElementById("bayesReset");
    this.dragMode = null;

    this.cartSamples = this.makeCartesianSamples(900);
    this.polarSamples = this.makeCartesianSamples(950);

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

  makeCartesianSamples(count) {
    const out = [];
    for (let i = 0; i < count; i += 1) {
      out.push({ gx: randn(), gy: randn() });
    }
    return out;
  }

  reset() {
    this.prior = { x: 30, y: 35, sigma: 13 };
    this.landmark = { x: 72, y: 62 };
    this.measurement = {
      range: 49,
      angle: -2.55,
      sigmaR: 5.8,
      sigmaA: 0.28,
    };
    this.draw();
  }

  eventToWorld(event, mapper) {
    const rect = this.canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * this.canvas.width;
    const py = ((event.clientY - rect.top) / rect.height) * this.canvas.height;
    return { x: mapper.fromX(px), y: mapper.fromY(py) };
  }

  measurementModePoint() {
    return {
      x: this.landmark.x + this.measurement.range * Math.cos(this.measurement.angle),
      y: this.landmark.y + this.measurement.range * Math.sin(this.measurement.angle),
    };
  }

  getHandles() {
    const mode = this.measurementModePoint();
    return [
      { kind: "priorMean", x: this.prior.x, y: this.prior.y, color: "#2f668e" },
      { kind: "priorSigma", x: this.prior.x + this.prior.sigma, y: this.prior.y, color: "#2f668e" },
      { kind: "landmark", x: this.landmark.x, y: this.landmark.y, color: "#3f5568" },
      { kind: "measMode", x: mode.x, y: mode.y, color: "#a17034" },
      {
        kind: "measSigmaR",
        x: this.landmark.x + (this.measurement.range + this.measurement.sigmaR) * Math.cos(this.measurement.angle),
        y: this.landmark.y + (this.measurement.range + this.measurement.sigmaR) * Math.sin(this.measurement.angle),
        color: "#a17034",
      },
      {
        kind: "measSigmaA",
        x: this.landmark.x + this.measurement.range * Math.cos(this.measurement.angle + this.measurement.sigmaA),
        y: this.landmark.y + this.measurement.range * Math.sin(this.measurement.angle + this.measurement.sigmaA),
        color: "#a17034",
      },
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

    if (this.dragMode === "priorMean") {
      this.prior.x = clamp(p.x, 6, 94);
      this.prior.y = clamp(p.y, 6, 94);
      return;
    }

    if (this.dragMode === "priorSigma") {
      const d = Math.hypot(p.x - this.prior.x, p.y - this.prior.y);
      this.prior.sigma = clamp(d, 2, 24);
      return;
    }

    if (this.dragMode === "landmark") {
      this.landmark.x = clamp(p.x, 6, 94);
      this.landmark.y = clamp(p.y, 6, 94);
      return;
    }

    if (this.dragMode === "measMode") {
      const dx = p.x - this.landmark.x;
      const dy = p.y - this.landmark.y;
      this.measurement.range = clamp(Math.hypot(dx, dy), 4, 88);
      this.measurement.angle = Math.atan2(dy, dx);
      return;
    }

    if (this.dragMode === "measSigmaR") {
      const d = Math.hypot(p.x - this.landmark.x, p.y - this.landmark.y);
      this.measurement.sigmaR = clamp(Math.abs(d - this.measurement.range), 0.8, 13);
      return;
    }

    if (this.dragMode === "measSigmaA") {
      const a = Math.atan2(p.y - this.landmark.y, p.x - this.landmark.x);
      this.measurement.sigmaA = clamp(Math.abs(wrapAngle(a - this.measurement.angle)), 0.05, 1.15);
    }
  }

  measurementLikelihood(x, y) {
    const dx = x - this.landmark.x;
    const dy = y - this.landmark.y;
    const r = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx);

    const dr = (r - this.measurement.range) / this.measurement.sigmaR;
    const da = wrapAngle(a - this.measurement.angle) / this.measurement.sigmaA;
    return Math.exp(-0.5 * (dr * dr + da * da));
  }

  computePosteriorGrid(stepSize) {
    const cells = [];
    const priorVar = this.prior.sigma * this.prior.sigma;
    let maxW = 0;
    let sumW = 0;
    let sumX = 0;
    let sumY = 0;
    let mapX = this.prior.x;
    let mapY = this.prior.y;

    for (let y = 0; y <= 100; y += stepSize) {
      for (let x = 0; x <= 100; x += stepSize) {
        const dx = x - this.prior.x;
        const dy = y - this.prior.y;
        const priorWeight = Math.exp(-0.5 * (dx * dx + dy * dy) / priorVar);
        const measWeight = this.measurementLikelihood(x, y);
        const w = priorWeight * measWeight;

        cells.push({ x, y, w });
        if (w > maxW) {
          maxW = w;
          mapX = x;
          mapY = y;
        }

        sumW += w;
        sumX += x * w;
        sumY += y * w;
      }
    }

    const meanX = sumW > 1e-12 ? sumX / sumW : this.prior.x;
    const meanY = sumW > 1e-12 ? sumY / sumW : this.prior.y;

    let varAcc = 0;
    for (const c of cells) {
      const dx = c.x - meanX;
      const dy = c.y - meanY;
      varAcc += (dx * dx + dy * dy) * c.w;
    }
    const eqSigma = sumW > 1e-12 ? Math.sqrt(varAcc / (2 * sumW)) : this.prior.sigma;

    return {
      cells,
      maxW,
      meanX,
      meanY,
      eqSigma,
      mapX,
      mapY,
      sumW,
    };
  }

  drawPriorCloud(mapper) {
    this.ctx.fillStyle = "rgba(47, 102, 142, 0.2)";
    for (const s of this.cartSamples) {
      const x = this.prior.x + s.gx * this.prior.sigma;
      const y = this.prior.y + s.gy * this.prior.sigma;
      if (x < 0 || x > 100 || y < 0 || y > 100) continue;
      this.ctx.fillRect(mapper.toX(x) - 1, mapper.toY(y) - 1, 2, 2);
    }
  }

  drawMeasurementCloud(mapper) {
    this.ctx.fillStyle = "rgba(161, 112, 52, 0.2)";
    for (const s of this.polarSamples) {
      const r = this.measurement.range + s.gx * this.measurement.sigmaR;
      if (r < 0.5) continue;
      const a = this.measurement.angle + s.gy * this.measurement.sigmaA;
      const x = this.landmark.x + r * Math.cos(a);
      const y = this.landmark.y + r * Math.sin(a);
      if (x < 0 || x > 100 || y < 0 || y > 100) continue;
      this.ctx.fillRect(mapper.toX(x) - 1, mapper.toY(y) - 1, 2, 2);
    }
  }

  drawMeasurementGeometry(mapper) {
    const r = this.measurement.range;
    const sr = this.measurement.sigmaR;
    const sa = this.measurement.sigmaA;
    const inner = Math.max(0.8, r - sr);
    const outer = r + sr;
    const a0 = this.measurement.angle - sa;
    const a1 = this.measurement.angle + sa;

    this.ctx.fillStyle = "rgba(161, 112, 52, 0.13)";
    this.ctx.beginPath();
    this.ctx.arc(mapper.toX(this.landmark.x), mapper.toY(this.landmark.y), outer * mapper.scale, -a1, -a0, false);
    this.ctx.arc(mapper.toX(this.landmark.x), mapper.toY(this.landmark.y), inner * mapper.scale, -a0, -a1, true);
    this.ctx.closePath();
    this.ctx.fill();

    this.ctx.strokeStyle = "rgba(161, 112, 52, 0.58)";
    this.ctx.lineWidth = 1.2;
    this.ctx.setLineDash([6, 4]);
    this.ctx.beginPath();
    this.ctx.arc(mapper.toX(this.landmark.x), mapper.toY(this.landmark.y), r * mapper.scale, 0, TAU);
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    const rayLength = r + sr * 1.6;
    this.ctx.strokeStyle = "rgba(161, 112, 52, 0.7)";
    this.ctx.beginPath();
    this.ctx.moveTo(mapper.toX(this.landmark.x), mapper.toY(this.landmark.y));
    this.ctx.lineTo(
      mapper.toX(this.landmark.x + rayLength * Math.cos(this.measurement.angle - sa)),
      mapper.toY(this.landmark.y + rayLength * Math.sin(this.measurement.angle - sa)),
    );
    this.ctx.moveTo(mapper.toX(this.landmark.x), mapper.toY(this.landmark.y));
    this.ctx.lineTo(
      mapper.toX(this.landmark.x + rayLength * Math.cos(this.measurement.angle + sa)),
      mapper.toY(this.landmark.y + rayLength * Math.sin(this.measurement.angle + sa)),
    );
    this.ctx.stroke();
  }

  drawPosteriorHeatmap(mapper, posterior, stepSize) {
    if (posterior.maxW <= 1e-12) return;
    const cellPx = Math.max(3, stepSize * mapper.scale + 0.2);

    for (const c of posterior.cells) {
      const n = c.w / posterior.maxW;
      if (n < 0.035) continue;
      const alpha = 0.02 + Math.pow(n, 0.62) * 0.48;
      this.ctx.fillStyle = `rgba(45, 131, 119, ${alpha.toFixed(3)})`;
      this.ctx.fillRect(mapper.toX(c.x) - cellPx * 0.5, mapper.toY(c.y) - cellPx * 0.5, cellPx, cellPx);
    }
  }

  drawCenter(mapper, point, color, label) {
    const px = mapper.toX(point.x);
    const py = mapper.toY(point.y);
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(px, py, 4.8, 0, TAU);
    this.ctx.fill();

    this.ctx.fillStyle = color;
    this.ctx.font = "12px IBM Plex Mono";
    this.ctx.fillText(label, px + 7, py - 7);
  }

  drawHandles(mapper) {
    for (const h of this.getHandles()) {
      this.ctx.fillStyle = h.color;
      this.ctx.beginPath();
      this.ctx.arc(mapper.toX(h.x), mapper.toY(h.y), 3.8, 0, TAU);
      this.ctx.fill();
    }
  }

  drawLegend(mapper) {
    const x = mapper.toX(2);
    const y = mapper.toY(98);
    this.ctx.font = "12px IBM Plex Mono";

    this.ctx.fillStyle = "#2f668e";
    this.ctx.fillText("Prior belief (blue)", x, y);
    this.ctx.fillStyle = "#a17034";
    this.ctx.fillText("Range-bearing likelihood (orange)", x, y + 16);
    this.ctx.fillStyle = "#2d8377";
    this.ctx.fillText("Posterior belief (green)", x, y + 32);
  }

  step() {
    this.draw();
  }

  draw() {
    const mapper = getMapper(this.canvas);
    drawGrid(this.ctx, this.canvas, mapper);

    const stepSize = 3;
    const posterior = this.computePosteriorGrid(stepSize);
    const mode = this.measurementModePoint();

    this.drawPriorCloud(mapper);
    this.drawMeasurementGeometry(mapper);
    this.drawMeasurementCloud(mapper);
    this.drawPosteriorHeatmap(mapper, posterior, stepSize);

    this.ctx.strokeStyle = "rgba(47,102,142,0.68)";
    this.ctx.lineWidth = 1.4;
    this.ctx.beginPath();
    this.ctx.arc(mapper.toX(this.prior.x), mapper.toY(this.prior.y), this.prior.sigma * mapper.scale, 0, TAU);
    this.ctx.stroke();

    this.ctx.strokeStyle = "rgba(45,131,119,0.92)";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(mapper.toX(posterior.meanX), mapper.toY(posterior.meanY), posterior.eqSigma * mapper.scale, 0, TAU);
    this.ctx.stroke();

    this.drawCenter(mapper, this.landmark, "#3f5568", "landmark");
    this.drawCenter(mapper, this.prior, "#2f668e", "prior");
    this.drawCenter(mapper, mode, "#a17034", "meas mode");
    this.drawCenter(mapper, { x: posterior.meanX, y: posterior.meanY }, "#2d8377", "post");

    this.drawHandles(mapper);
    this.drawLegend(mapper);

    const priorToMode = Math.hypot(mode.x - this.prior.x, mode.y - this.prior.y);
    const priorToPost = Math.hypot(posterior.meanX - this.prior.x, posterior.meanY - this.prior.y);
    const effectiveGain = priorToMode > 1e-5 ? priorToPost / priorToMode : 0;

    this.readout.textContent =
      `Posterior mean: (${posterior.meanX.toFixed(2)}, ${posterior.meanY.toFixed(2)})\n` +
      `Posterior equivalent sigma: ${posterior.eqSigma.toFixed(2)}\n` +
      `MAP location: (${posterior.mapX.toFixed(1)}, ${posterior.mapY.toFixed(1)})\n` +
      `Effective shift fraction (prior->measurement): ${effectiveGain.toFixed(3)}\n` +
      `Green posterior = compromise between blue prior and orange measurement likelihood.`;
  }
}
