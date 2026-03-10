import { TAU, THEME } from "../core/constants.js";
import { clamp, gaussianPdf } from "../core/math.js";

export class BayesianUpdateDemo {
  constructor() {
    this.canvas = document.getElementById("bayesCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.readout = document.getElementById("bayesReadout");
    this.resetBtn = document.getElementById("bayesReset");
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
    this.priorMean = 45;
    this.priorSigma = 11;
    this.measMean = 62;
    this.measSigma = 7;
    this.draw();
  }

  eventToCanvas(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * this.canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * this.canvas.height,
    };
  }

  onPointerDown(event) {
    if (!this.graph) return;
    const p = this.eventToCanvas(event);
    const handles = this.getHandles();
    const radius = 12;
    for (const handle of handles) {
      if (Math.hypot(p.x - handle.x, p.y - handle.y) < radius) {
        this.dragMode = handle.kind;
        break;
      }
    }
  }

  onPointerMove(event) {
    if (!this.dragMode || !this.graph) return;
    const p = this.eventToCanvas(event);
    const valueX = clamp(this.graph.pxToX(p.x), 10, 90);

    if (this.dragMode === "priorMean") {
      this.priorMean = valueX;
    } else if (this.dragMode === "measMean") {
      this.measMean = valueX;
    } else if (this.dragMode === "priorSigma") {
      this.priorSigma = clamp(Math.abs(valueX - this.priorMean), 2, 24);
    } else if (this.dragMode === "measSigma") {
      this.measSigma = clamp(Math.abs(valueX - this.measMean), 2, 24);
    }
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

    const priorMean = this.priorMean;
    const priorSigma = this.priorSigma;
    const measValue = this.measMean;
    const measSigma = this.measSigma;

    const priorVar = this.priorSigma * this.priorSigma;
    const measVar = this.measSigma * this.measSigma;
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
    const pxToX = (px) => ((px - left) / (right - left)) * 100;
    this.graph = { left, right, top, bottom, xToPx, yToPx, pxToX, priorMean, priorSigma, measValue, measSigma };

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

    for (const handle of this.getHandles()) {
      ctx.fillStyle = handle.kind.includes("Sigma") ? "#8b5a2a" : "#2f668e";
      if (handle.kind.startsWith("meas")) ctx.fillStyle = handle.kind.includes("Sigma") ? "#8b5a2a" : "#a17034";
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, 4.8, 0, TAU);
      ctx.fill();
    }

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
      `Drag mean and sigma handles directly on the graph.`;
  }

  getHandles() {
    const g = this.graph;
    if (!g) return [];
    return [
      {
        kind: "priorMean",
        x: g.xToPx(g.priorMean),
        y: g.yToPx(gaussianPdf(g.priorMean, g.priorMean, g.priorSigma)),
      },
      {
        kind: "priorSigma",
        x: g.xToPx(g.priorMean + g.priorSigma),
        y: g.yToPx(gaussianPdf(g.priorMean + g.priorSigma, g.priorMean, g.priorSigma)),
      },
      {
        kind: "measMean",
        x: g.xToPx(g.measValue),
        y: g.yToPx(gaussianPdf(g.measValue, g.measValue, g.measSigma)),
      },
      {
        kind: "measSigma",
        x: g.xToPx(g.measValue + g.measSigma),
        y: g.yToPx(gaussianPdf(g.measValue + g.measSigma, g.measValue, g.measSigma)),
      },
    ];
  }
}
