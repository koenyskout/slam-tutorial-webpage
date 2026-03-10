import { THEME } from "../core/constants.js";
import { clamp, makeLandmarks, randn, wrapAngle } from "../core/math.js";
import { clampPose, drawGrid, drawInfoPanel, drawPath, drawRobot, getMapper } from "../core/canvas.js";
import { installPlayOverlay } from "../core/playOverlay.js";
import { modelB } from "../core/models.js";

export class KinematicSlamDemo {
  constructor() {
    this.canvas = document.getElementById("kinematicCanvas");
    this.ctx = this.canvas.getContext("2d");

    this.odomNoise = document.getElementById("kinOdomNoise");
    this.odomNoiseValue = document.getElementById("kinOdomNoiseValue");
    this.sensorNoise = document.getElementById("kinSensorNoise");
    this.sensorNoiseValue = document.getElementById("kinSensorNoiseValue");
    this.gain = document.getElementById("kinGain");
    this.gainValue = document.getElementById("kinGainValue");
    this.yawRate = document.getElementById("kinYawRate");
    this.yawRateValue = document.getElementById("kinYawRateValue");
    this.showRaw = document.getElementById("kinShowRaw");
    this.showTruth = document.getElementById("kinShowTruth");

    this.playPause = document.getElementById("kinPlayPause");
    this.resetBtn = document.getElementById("kinReset");

    this.trueLandmarks = makeLandmarks(24, 83);
    this.landmarkById = new Map(this.trueLandmarks.map((lm) => [lm.id, lm]));
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
      label: "Play kinematic SLAM demo",
    });
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
    this.rawCorrectionInliers = 0;
    this.kinCorrectionInliers = 0;
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

  computeLandmarkCorrection(pose, observations) {
    let dx = 0;
    let dy = 0;
    let dtheta = 0;
    let wSum = 0;
    let count = 0;

    for (const obs of observations) {
      const lm = this.landmarkById.get(obs.id);
      if (!lm) continue;

      const beam = pose.theta + obs.bearing;
      const candidateX = lm.x - obs.range * Math.cos(beam);
      const candidateY = lm.y - obs.range * Math.sin(beam);
      const residualX = candidateX - pose.x;
      const residualY = candidateY - pose.y;

      const expectedBearing = wrapAngle(Math.atan2(lm.y - pose.y, lm.x - pose.x) - pose.theta);
      const innovation = wrapAngle(obs.bearing - expectedBearing);
      if (Math.abs(innovation) > 1.25) continue;

      const w = 1 / Math.max(8, obs.range);
      dx += residualX * w;
      dy += residualY * w;
      dtheta += -innovation * w;
      wSum += w;
      count += 1;
    }

    if (wSum < 1e-9) return { dx: 0, dy: 0, dtheta: 0, count: 0 };
    return {
      dx: dx / wSum,
      dy: dy / wSum,
      dtheta: dtheta / wSum,
      count,
    };
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
    this.playOverlay?.update();
    if (!this.running) {
      this.draw();
      return;
    }

    const odomNoise = Number(this.odomNoise.value);
    const sensorNoise = Number(this.sensorNoise.value);
    const gain = Number(this.gain.value);
    const yawRateLimit = Number(this.yawRate.value);
    const dtSafe = Math.max(dt, 1e-3);

    this.t += dt;
    const prevTrue = this.truePose;
    this.truePose = modelB(this.t);

    const deltaS = Math.hypot(this.truePose.x - prevTrue.x, this.truePose.y - prevTrue.y);
    const deltaTheta = wrapAngle(this.truePose.theta - prevTrue.theta);
    const prevRaw = { x: this.rawPose.x, y: this.rawPose.y };
    const prevKin = { x: this.kinPose.x, y: this.kinPose.y };

    this.rawPose.theta = wrapAngle(this.rawPose.theta + deltaTheta + randn() * odomNoise * 0.03);
    const rawStep = deltaS + randn() * odomNoise * 0.28;
    this.rawPose.x += rawStep * Math.cos(this.rawPose.theta);
    this.rawPose.y += rawStep * Math.sin(this.rawPose.theta);
    clampPose(this.rawPose);

    const trueV = deltaS / dtSafe;
    const trueOmega = deltaTheta / dtSafe;
    const vMeasured = Math.max(0, trueV * (1 + randn() * odomNoise * 0.06) + randn() * odomNoise * 0.18);
    const omegaMeasured = trueOmega + randn() * odomNoise * 0.08;
    const accelLimit = 12;
    const yawAccelLimit = 9;

    this.kinPose.v += clamp(vMeasured - this.kinPose.v, -accelLimit * dt, accelLimit * dt);
    this.kinPose.omega += clamp(omegaMeasured - this.kinPose.omega, -yawAccelLimit * dt, yawAccelLimit * dt);
    this.kinPose.omega = clamp(this.kinPose.omega, -yawRateLimit, yawRateLimit);
    this.kinPose.theta = wrapAngle(this.kinPose.theta + this.kinPose.omega * dt);
    this.kinPose.x += this.kinPose.v * dt * Math.cos(this.kinPose.theta);
    this.kinPose.y += this.kinPose.v * dt * Math.sin(this.kinPose.theta);
    clampPose(this.kinPose);

    const observations = this.observations(sensorNoise);
    this.visible = observations;

    for (const obs of observations) {
      const rawGlobal = this.rawPose.theta + obs.bearing;
      const rawPred = {
        x: this.rawPose.x + obs.range * Math.cos(rawGlobal),
        y: this.rawPose.y + obs.range * Math.sin(rawGlobal),
      };
      this.updateMapPoint(this.mapRaw, obs.id, rawPred);

      const kinGlobal = this.kinPose.theta + obs.bearing;
      const kinPred = {
        x: this.kinPose.x + obs.range * Math.cos(kinGlobal),
        y: this.kinPose.y + obs.range * Math.sin(kinGlobal),
      };
      this.updateMapPoint(this.mapKin, obs.id, kinPred);
    }

    const rawCorr = this.computeLandmarkCorrection(this.rawPose, observations);
    this.rawCorrectionInliers = rawCorr.count;
    if (rawCorr.count > 0) {
      this.rawPose.x += rawCorr.dx * gain * 0.48;
      this.rawPose.y += rawCorr.dy * gain * 0.48;
      this.rawPose.theta = wrapAngle(this.rawPose.theta + rawCorr.dtheta * gain * 0.62);
      clampPose(this.rawPose);
    }

    const kinCorr = this.computeLandmarkCorrection(this.kinPose, observations);
    this.kinCorrectionInliers = kinCorr.count;
    if (kinCorr.count > 0) {
      let adjustX = kinCorr.dx * gain * 0.54;
      let adjustY = kinCorr.dy * gain * 0.54;
      const maxPositionAdjust = Math.max(0.05, 16 * dt);
      const adjustMag = Math.hypot(adjustX, adjustY);
      if (adjustMag > maxPositionAdjust) {
        const s = maxPositionAdjust / adjustMag;
        adjustX *= s;
        adjustY *= s;
      }

      this.kinPose.x += adjustX;
      this.kinPose.y += adjustY;

      const desiredYawAdjust = kinCorr.dtheta * gain * 0.72;
      const maxYawAdjust = Math.max(0.01, yawRateLimit * dt * 0.95);
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

  drawTruthLandmarks(mapper) {
    this.ctx.fillStyle = "rgba(95, 134, 165, 0.48)";
    for (const lm of this.trueLandmarks) {
      this.ctx.beginPath();
      this.ctx.arc(mapper.toX(lm.x), mapper.toY(lm.y), 2.3, 0, Math.PI * 2);
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
    if (this.showTruth && this.showTruth.checked) {
      this.drawTruthLandmarks(mapper);
    }
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

    drawInfoPanel(this.ctx, this.canvas, {
      title: "Kinematic vs Raw",
      lines: [
        `visible landmarks: ${this.visible.length}`,
        `truth landmarks: ${this.showTruth && this.showTruth.checked ? "shown" : "hidden"}`,
        `inliers raw/kin: ${this.rawCorrectionInliers}/${this.kinCorrectionInliers}`,
        `pose error raw/kin: ${rawErr.toFixed(2)} / ${kinErr.toFixed(2)}`,
        `step jump raw/kin: ${this.rawJump.toFixed(2)} / ${this.kinJump.toFixed(2)}`,
        `max jump raw/kin: ${this.maxRawJump.toFixed(2)} / ${this.maxKinJump.toFixed(2)}`,
        `map error (kin): ${meanMapErr.toFixed(2)} units`,
        `loop closures: ${this.loopClosures}`,
      ],
      width: 360,
    });
  }
}
