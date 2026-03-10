import { THEME } from "../core/constants.js";
import { randn, wrapAngle } from "../core/math.js";
import { clampPose, drawGrid, drawInfoPanel, drawPath, drawRobot, getMapper } from "../core/canvas.js";
import { installPlayOverlay } from "../core/playOverlay.js";
import { modelA } from "../core/models.js";

export class OdometryDemo {
  constructor() {
    this.canvas = document.getElementById("odometryCanvas");
    this.ctx = this.canvas.getContext("2d");

    this.noise = document.getElementById("odomNoise");
    this.noiseValue = document.getElementById("odomNoiseValue");
    this.speed = document.getElementById("odomSpeed");
    this.speedValue = document.getElementById("odomSpeedValue");
    this.playPause = document.getElementById("odomPlayPause");
    this.resetBtn = document.getElementById("odomReset");

    this.running = false;
    this.reset();
    this.bindEvents();
    this.playOverlay = installPlayOverlay({
      canvas: this.canvas,
      onPlay: () => {
        this.running = true;
        this.playPause.textContent = "Pause";
        this.playOverlay.update();
      },
      getVisible: () => !this.running,
      label: "Play odometry demo",
    });
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
      this.playOverlay?.update();
    });

    this.resetBtn.addEventListener("click", () => {
      this.reset();
      this.playOverlay?.update();
    });
  }

  reset() {
    this.t = 0;
    this.running = false;
    this.playPause.textContent = "Play";

    this.truePose = modelA(0);
    this.estPose = { ...this.truePose };

    this.truePath = [{ x: this.truePose.x, y: this.truePose.y }];
    this.estPath = [{ x: this.estPose.x, y: this.estPose.y }];
    this.travel = 0;
    this.drift = 0;
  }

  step(dt) {
    this.playOverlay?.update();
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

    drawInfoPanel(this.ctx, this.canvas, {
      title: "Prediction-Only Drift",
      lines: [
        `drift: ${this.drift.toFixed(2)} units`,
        `distance: ${this.travel.toFixed(1)} units`,
        "Small odometry errors accumulate over time.",
      ],
    });
  }
}
