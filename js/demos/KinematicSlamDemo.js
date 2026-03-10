import { THEME } from "../core/constants.js";
import { clamp, makeLandmarks, randn, wrapAngle } from "../core/math.js";
import { clampPose, drawGrid, drawPath, drawRobot, getMapper } from "../core/canvas.js";
import { modelB } from "../core/models.js";

export class KinematicSlamDemo {
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
    this.lastLoopClosureTime = -1e9;
    this.loopClosureCooldown = 6;
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

  updateLoopClosureCount(observations) {
    if (observations.length < 3) return;
    if (this.mapKin.size < 8) return;
    if (this.t - this.lastLoopClosureTime < this.loopClosureCooldown) return;
    const backHome = Math.hypot(this.kinPose.x - this.startPose.x, this.kinPose.y - this.startPose.y);
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

    this.updateLoopClosureCount(observations);

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
      this.ctx.arc(x, y, radius, 0, Math.PI * 2);
      this.ctx.stroke();

      this.ctx.fillStyle = `rgba(45,131,119,${0.36 + intensity * 0.5})`;
      this.ctx.beginPath();
      this.ctx.arc(x, y, 2.7, 0, Math.PI * 2);
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
    this.ctx.arc(mapper.toX(this.truePose.x), mapper.toY(this.truePose.y), 11, 0, Math.PI * 2);
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
