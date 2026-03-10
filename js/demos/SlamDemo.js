import { TAU, THEME } from "../core/constants.js";
import { clamp, makeLandmarks, randn, wrapAngle } from "../core/math.js";
import { clampPose, drawGrid, drawPath, drawRobot, getMapper } from "../core/canvas.js";
import { modelC } from "../core/models.js";

export class SlamDemo {
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
    this.lastLoopClosureTime = -1e9;
    this.loopClosureCooldown = 6;
  }

  updateLoopClosureCount(observations) {
    if (observations.length < 3) return;
    if (this.map.size < 8) return;
    if (this.t - this.lastLoopClosureTime < this.loopClosureCooldown) return;
    const backHome = Math.hypot(this.estPose.x - this.startPose.x, this.estPose.y - this.startPose.y);
    if (backHome < 5.5) {
      this.loopClosures += 1;
      this.lastLoopClosureTime = this.t;
    }
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

    this.updateLoopClosureCount(observations);

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

    const showTruth = this.showTruth.checked;
    if (showTruth) {
      this.drawTruthLandmarks(mapper);
      drawPath(this.ctx, mapper, this.truePath, THEME.truthHintPath, 1.8);
    }

    this.drawMap(mapper);
    this.drawVisibleHints(mapper);
    drawPath(this.ctx, mapper, this.estPath, THEME.odomPath, 2.35);
    drawRobot(this.ctx, mapper, this.estPose, THEME.odomPath, "estimate");

    if (showTruth) {
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
    }

    const poseErr = Math.hypot(this.truePose.x - this.estPose.x, this.truePose.y - this.estPose.y);
    const mapped = this.map.size;
    const meanMapErr = this.mapError();

    this.readout.textContent =
      `Mapped landmarks: ${mapped}/${this.trueLandmarks.length}\n` +
      `Pose error (true vs estimate): ${poseErr.toFixed(2)} units\n` +
      `Mean landmark error: ${meanMapErr.toFixed(2)} units\n` +
      `Loop closures detected: ${this.loopClosures}\n` +
      `Truth overlay: ${showTruth ? "visible" : "hidden"}`;
  }
}
