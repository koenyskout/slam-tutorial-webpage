import { TAU, THEME } from "../core/constants.js";
import { clamp, randn, wrapAngle } from "../core/math.js";
import { drawGrid, drawRobot, getMapper } from "../core/canvas.js";

export class DataAssociationDemo {
  constructor() {
    this.canvas = document.getElementById("associationCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.readout = document.getElementById("associationReadout");

    this.noiseDown = document.getElementById("assocNoiseDown");
    this.noiseUp = document.getElementById("assocNoiseUp");
    this.noiseValue = document.getElementById("assocNoiseValue");
    this.playPause = document.getElementById("assocPlayPause");
    this.resampleBtn = document.getElementById("assocResample");
    this.resetBtn = document.getElementById("assocReset");

    this.robot = { x: 32, y: 42, theta: 0.35, draggable: true };
    this.landmarks = [];
    this.dragTarget = null;
    this.noise = 1;
    this.running = true;
    this.bindEvents();
    this.reset();
  }

  bindEvents() {
    this.noiseDown.addEventListener("click", () => {
      this.noise = clamp(this.noise - 0.1, 0.1, 2.5);
      this.noiseValue.textContent = this.noise.toFixed(2);
      this.sampleObservation();
    });
    this.noiseUp.addEventListener("click", () => {
      this.noise = clamp(this.noise + 0.1, 0.1, 2.5);
      this.noiseValue.textContent = this.noise.toFixed(2);
      this.sampleObservation();
    });
    this.playPause.addEventListener("click", () => {
      this.running = !this.running;
      this.playPause.textContent = this.running ? "Pause" : "Play";
    });
    this.resampleBtn.addEventListener("click", () => this.sampleObservation());
    this.resetBtn.addEventListener("click", () => this.reset());

    this.canvas.addEventListener("mousedown", (event) => this.onPointerDown(event));
    window.addEventListener("mousemove", (event) => this.onPointerMove(event));
    window.addEventListener("mouseup", () => {
      if (this.dragTarget) {
        this.dragTarget = null;
        this.sampleObservation();
      }
    });
  }

  eventToWorld(event, mapper) {
    const rect = this.canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * this.canvas.width;
    const py = ((event.clientY - rect.top) / rect.height) * this.canvas.height;
    return { x: mapper.fromX(px), y: mapper.fromY(py) };
  }

  onPointerDown(event) {
    const mapper = getMapper(this.canvas);
    const p = this.eventToWorld(event, mapper);
    if (Math.hypot(p.x - this.robot.x, p.y - this.robot.y) < 3.8) {
      this.dragTarget = this.robot;
      return;
    }
    for (const lm of this.landmarks) {
      if (Math.hypot(p.x - lm.x, p.y - lm.y) < 3.5) {
        this.dragTarget = lm;
        return;
      }
    }
  }

  onPointerMove(event) {
    if (!this.dragTarget) return;
    const mapper = getMapper(this.canvas);
    const p = this.eventToWorld(event, mapper);
    this.dragTarget.x = clamp(p.x, 4, 96);
    this.dragTarget.y = clamp(p.y, 4, 96);

    if (this.dragTarget === this.robot) {
      const truthLm = this.landmarks[0];
      this.robot.theta = Math.atan2(truthLm.y - this.robot.y, truthLm.x - this.robot.x) - 0.35;
    }
  }

  reset() {
    this.noise = 1;
    this.noiseValue.textContent = "1.00";
    this.running = true;
    this.playPause.textContent = "Pause";
    this.timer = 0;
    this.totalSamples = 0;
    this.wrongSamples = 0;
    this.landmarks = [
      { id: "L1", x: 67, y: 60, truth: true },
      { id: "L2", x: 73, y: 60 },
      { id: "L3", x: 74, y: 38 },
    ];
    this.robot.x = 32;
    this.robot.y = 42;
    this.robot.theta = 0.35;
    this.sampleObservation();
  }

  sampleObservation() {
    const sigmaR = 0.55 + this.noise * 0.8;
    const sigmaB = 0.012 + this.noise * 0.018;
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
      `Drag robot/landmarks directly. Higher noise or tighter spacing increases ambiguity.`;
  }
}
