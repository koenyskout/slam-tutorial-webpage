import { THEME } from "../core/constants.js";
import { clamp, lerp, seededRandom } from "../core/math.js";
import { drawGrid, drawInfoPanel, drawPath, getMapper } from "../core/canvas.js";
import { installPlayOverlay } from "../core/playOverlay.js";

function randomNormal(random) {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class PoseGraphDemo {
  constructor() {
    this.canvas = document.getElementById("poseGraphCanvas");
    this.ctx = this.canvas.getContext("2d");

    this.loopWeight = document.getElementById("pgLoopWeight");
    this.loopWeightValue = document.getElementById("pgLoopWeightValue");
    this.rate = document.getElementById("pgRate");
    this.rateValue = document.getElementById("pgRateValue");
    this.showTruth = document.getElementById("pgShowTruth");

    this.playPause = document.getElementById("pgPlayPause");
    this.stepBtn = document.getElementById("pgStep");
    this.resetBtn = document.getElementById("pgReset");

    this.running = false;
    this.bindEvents();
    this.reset();
    this.playOverlay = installPlayOverlay({
      canvas: this.canvas,
      onPlay: () => {
        this.running = true;
        this.playPause.textContent = "Pause";
        this.playOverlay.update();
      },
      getVisible: () => !this.running,
      label: "Play pose-graph optimization demo",
    });
  }

  bindEvents() {
    this.loopWeight.addEventListener("input", () => {
      this.loopWeightValue.textContent = Number(this.loopWeight.value).toFixed(2);
    });
    this.rate.addEventListener("input", () => {
      this.rateValue.textContent = Number(this.rate.value).toFixed(2);
    });
    this.playPause.addEventListener("click", () => {
      this.running = !this.running;
      this.playPause.textContent = this.running ? "Pause" : "Play";
      this.playOverlay?.update();
    });
    this.stepBtn.addEventListener("click", () => {
      this.iterate();
      this.draw();
      this.playOverlay?.update();
    });
    this.resetBtn.addEventListener("click", () => {
      this.reset();
      this.playOverlay?.update();
    });
  }

  makeTrueNodes(count) {
    const nodes = [];
    for (let i = 0; i < count; i += 1) {
      const t = (i / count) * Math.PI * 2;
      const x = 50 + 25 * Math.cos(t) + 4 * Math.cos(3 * t + 0.35);
      const y = 50 + 19 * Math.sin(t) + 3 * Math.sin(2 * t);
      nodes.push({ x, y });
    }
    return nodes;
  }

  makeOdometryDeltas(trueNodes) {
    const random = seededRandom(20260310);
    const noise = 0.24;
    const biasX = 0.07;
    const biasY = -0.04;
    const deltas = [];

    for (let i = 0; i < trueNodes.length - 1; i += 1) {
      const a = trueNodes[i];
      const b = trueNodes[i + 1];
      deltas.push({
        x: b.x - a.x + biasX + randomNormal(random) * noise,
        y: b.y - a.y + biasY + randomNormal(random) * noise,
      });
    }
    return deltas;
  }

  integrateNodes(start, deltas) {
    const nodes = [{ x: start.x, y: start.y }];
    for (const d of deltas) {
      const prev = nodes[nodes.length - 1];
      nodes.push({ x: prev.x + d.x, y: prev.y + d.y });
    }
    return nodes;
  }

  reset() {
    this.loopWeight.value = "0.55";
    this.rate.value = "0.26";
    this.loopWeightValue.textContent = "0.55";
    this.rateValue.textContent = "0.26";
    this.running = false;
    this.playPause.textContent = "Play";
    this.iterations = 0;

    this.trueNodes = this.makeTrueNodes(40);
    this.odomDeltas = this.makeOdometryDeltas(this.trueNodes);
    this.odomNodes = this.integrateNodes(this.trueNodes[0], this.odomDeltas);
    this.estNodes = this.odomNodes.map((p) => ({ x: p.x, y: p.y }));
    this.start = { ...this.trueNodes[0] };
    this.closureDelta = {
      x: this.trueNodes[0].x - this.trueNodes[this.trueNodes.length - 1].x,
      y: this.trueNodes[0].y - this.trueNodes[this.trueNodes.length - 1].y,
    };
    this.initialRmse = this.rmse(this.odomNodes);
  }

  rmse(nodes) {
    let sum = 0;
    const n = Math.min(nodes.length, this.trueNodes.length);
    for (let i = 0; i < n; i += 1) {
      const dx = nodes[i].x - this.trueNodes[i].x;
      const dy = nodes[i].y - this.trueNodes[i].y;
      sum += dx * dx + dy * dy;
    }
    return Math.sqrt(sum / Math.max(1, n));
  }

  iterate() {
    const alpha = Number(this.rate.value);
    const wLoop = Number(this.loopWeight.value);
    const wAnchor = 0.42;
    const n = this.estNodes.length;
    if (n < 3) return;

    for (let i = 0; i < n - 1; i += 1) {
      const a = this.estNodes[i];
      const b = this.estNodes[i + 1];
      const d = this.odomDeltas[i];
      const ex = b.x - a.x - d.x;
      const ey = b.y - a.y - d.y;
      const cx = ex * alpha * 0.5;
      const cy = ey * alpha * 0.5;
      a.x += cx;
      a.y += cy;
      b.x -= cx;
      b.y -= cy;
    }

    const first = this.estNodes[0];
    const last = this.estNodes[n - 1];
    const clEx = first.x - last.x - this.closureDelta.x;
    const clEy = first.y - last.y - this.closureDelta.y;
    const clCx = clEx * alpha * wLoop * 0.5;
    const clCy = clEy * alpha * wLoop * 0.5;
    first.x -= clCx;
    first.y -= clCy;
    last.x += clCx;
    last.y += clCy;

    const ax = first.x - this.start.x;
    const ay = first.y - this.start.y;
    first.x -= ax * alpha * wAnchor;
    first.y -= ay * alpha * wAnchor;

    for (let i = 1; i < n - 1; i += 1) {
      const prev = this.estNodes[i - 1];
      const next = this.estNodes[i + 1];
      const cur = this.estNodes[i];
      const sx = (prev.x + next.x) * 0.5;
      const sy = (prev.y + next.y) * 0.5;
      cur.x = lerp(cur.x, sx, alpha * 0.07);
      cur.y = lerp(cur.y, sy, alpha * 0.07);
    }

    for (const p of this.estNodes) {
      p.x = clamp(p.x, 2, 98);
      p.y = clamp(p.y, 2, 98);
    }

    this.iterations += 1;
  }

  step(dt) {
    this.playOverlay?.update();
    if (this.running) {
      const batch = Math.max(1, Math.round(dt * 60 * 1.5));
      for (let i = 0; i < batch; i += 1) this.iterate();
    }
    this.draw();
  }

  drawNodes(mapper, nodes, color, radius) {
    this.ctx.fillStyle = color;
    for (const p of nodes) {
      this.ctx.beginPath();
      this.ctx.arc(mapper.toX(p.x), mapper.toY(p.y), radius, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  drawClosure(mapper) {
    const n = this.estNodes.length;
    const a = this.estNodes[0];
    const b = this.estNodes[n - 1];
    this.ctx.strokeStyle = "rgba(161, 112, 52, 0.92)";
    this.ctx.lineWidth = 1.8;
    this.ctx.setLineDash([7, 5]);
    this.ctx.beginPath();
    this.ctx.moveTo(mapper.toX(a.x), mapper.toY(a.y));
    this.ctx.lineTo(mapper.toX(b.x), mapper.toY(b.y));
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  draw() {
    const mapper = getMapper(this.canvas);
    drawGrid(this.ctx, this.canvas, mapper);

    if (this.showTruth.checked) {
      drawPath(this.ctx, mapper, this.trueNodes, THEME.truthHintPath, 1.8);
      this.drawNodes(mapper, this.trueNodes, "rgba(95, 134, 165, 0.55)", 2.2);
    }

    drawPath(this.ctx, mapper, this.odomNodes, THEME.rawBaseline, 1.8, [8, 5]);
    drawPath(this.ctx, mapper, this.estNodes, THEME.correctedPath, 2.4);
    this.drawNodes(mapper, this.estNodes, "rgba(45, 131, 119, 0.76)", 2.5);
    this.drawClosure(mapper);

    const s = this.estNodes[0];
    const e = this.estNodes[this.estNodes.length - 1];
    this.ctx.fillStyle = "#2f668e";
    this.ctx.beginPath();
    this.ctx.arc(mapper.toX(s.x), mapper.toY(s.y), 5.5, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.fillStyle = "#a17034";
    this.ctx.beginPath();
    this.ctx.arc(mapper.toX(e.x), mapper.toY(e.y), 5.5, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.font = "12px IBM Plex Mono";
    this.ctx.fillStyle = "#2f4353";
    this.ctx.fillText("start", mapper.toX(s.x) + 8, mapper.toY(s.y) - 8);
    this.ctx.fillText("end", mapper.toX(e.x) + 8, mapper.toY(e.y) - 8);

    const rmse = this.rmse(this.estNodes);
    const improvement = this.initialRmse > 1e-8 ? (1 - rmse / this.initialRmse) * 100 : 0;
    const closureResidual = Math.hypot(
      this.estNodes[0].x - this.estNodes[this.estNodes.length - 1].x - this.closureDelta.x,
      this.estNodes[0].y - this.estNodes[this.estNodes.length - 1].y - this.closureDelta.y,
    );

    drawInfoPanel(this.ctx, this.canvas, {
      title: "Graph Optimization",
      lines: [
        `iterations: ${this.iterations}`,
        `RMSE vs truth: ${rmse.toFixed(2)} units`,
        `improvement: ${improvement.toFixed(1)}%`,
        `closure residual: ${closureResidual.toFixed(2)} units`,
        "Loop closure redistributes trajectory drift.",
      ],
      width: 330,
    });
  }
}
