const TAU = Math.PI * 2;
const THEME = {
  truePath: "#2f668e",
  truePose: "#2f668e",
  odomPath: "#a17034",
  correctedPath: "#2d8377",
  rawBaseline: "#8d949c",
  landmark: "#5f86a5",
  map: "#2d8377",
  gridMinor: "rgba(125, 145, 162, 0.22)",
  gridMajor: "rgba(104, 126, 145, 0.46)",
  ray: "rgba(161, 112, 52, 0.26)",
  link: "rgba(161, 112, 52, 0.45)",
  truthGap: "rgba(47, 102, 142, 0.42)",
  truthHalo: "rgba(47, 102, 142, 0.14)",
  truthHintPath: "rgba(47, 102, 142, 0.46)",
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function wrapAngle(angle) {
  let a = angle;
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

function randn() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeLandmarks(count, seed) {
  const random = seededRandom(seed);
  const out = [];
  let attempts = 0;

  while (out.length < count && attempts < 5000) {
    attempts += 1;
    const x = 10 + random() * 80;
    const y = 10 + random() * 80;
    let ok = true;

    for (const p of out) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < 8) {
        ok = false;
        break;
      }
    }

    if (ok) {
      out.push({ id: out.length, x, y });
    }
  }

  return out;
}

function getMapper(canvas) {
  const margin = 32;
  const worldSize = 100;
  const scale = Math.min((canvas.width - margin * 2) / worldSize, (canvas.height - margin * 2) / worldSize);
  const ox = (canvas.width - worldSize * scale) / 2;
  const oy = (canvas.height - worldSize * scale) / 2;

  return {
    scale,
    toX: (x) => ox + x * scale,
    toY: (y) => canvas.height - (oy + y * scale),
  };
}

function drawGrid(ctx, canvas, mapper) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = THEME.gridMinor;
  ctx.lineWidth = 1;

  for (let v = 0; v <= 100; v += 10) {
    const x = mapper.toX(v);
    const y = mapper.toY(v);

    ctx.beginPath();
    ctx.moveTo(x, mapper.toY(0));
    ctx.lineTo(x, mapper.toY(100));
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(mapper.toX(0), y);
    ctx.lineTo(mapper.toX(100), y);
    ctx.stroke();
  }

  ctx.strokeStyle = THEME.gridMajor;
  ctx.beginPath();
  ctx.moveTo(mapper.toX(0), mapper.toY(0));
  ctx.lineTo(mapper.toX(100), mapper.toY(0));
  ctx.lineTo(mapper.toX(100), mapper.toY(100));
  ctx.lineTo(mapper.toX(0), mapper.toY(100));
  ctx.closePath();
  ctx.stroke();
}

function drawPath(ctx, mapper, points, color, width, dash = []) {
  if (points.length < 2) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(mapper.toX(points[0].x), mapper.toY(points[0].y));

  for (let i = 1; i < points.length; i += 1) {
    const p = points[i];
    ctx.lineTo(mapper.toX(p.x), mapper.toY(p.y));
  }

  ctx.stroke();
  ctx.setLineDash([]);
}

function drawRobot(ctx, mapper, pose, color, label) {
  const x = mapper.toX(pose.x);
  const y = mapper.toY(pose.y);
  const heading = -pose.theta;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 5.8, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(heading) * 16, y + Math.sin(heading) * 16);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = "12px IBM Plex Mono";
  ctx.fillText(label, x + 8, y - 10);
}

function clampPose(pose) {
  pose.x = clamp(pose.x, 2, 98);
  pose.y = clamp(pose.y, 2, 98);
}

function modelA(t) {
  const x = 50 + 24 * Math.cos(0.72 * t) + 10 * Math.cos(2.2 * t + 0.4);
  const y = 50 + 19 * Math.sin(1.05 * t) + 8 * Math.sin(2.6 * t);
  const dx = -24 * 0.72 * Math.sin(0.72 * t) - 10 * 2.2 * Math.sin(2.2 * t + 0.4);
  const dy = 19 * 1.05 * Math.cos(1.05 * t) + 8 * 2.6 * Math.cos(2.6 * t);
  return { x, y, theta: Math.atan2(dy, dx) };
}

function modelB(t) {
  const x = 50 + 21 * Math.cos(0.78 * t) + 10 * Math.sin(1.4 * t);
  const y = 49 + 20 * Math.sin(0.9 * t) + 6 * Math.sin(2.8 * t + 0.3);
  const dx = -21 * 0.78 * Math.sin(0.78 * t) + 10 * 1.4 * Math.cos(1.4 * t);
  const dy = 20 * 0.9 * Math.cos(0.9 * t) + 6 * 2.8 * Math.cos(2.8 * t + 0.3);
  return { x, y, theta: Math.atan2(dy, dx) };
}

function modelC(t) {
  const x = 50 + 28 * Math.cos(0.55 * t) + 7 * Math.cos(1.9 * t + 0.7);
  const y = 50 + 24 * Math.sin(0.64 * t) + 8 * Math.sin(2.1 * t);
  const dx = -28 * 0.55 * Math.sin(0.55 * t) - 7 * 1.9 * Math.sin(1.9 * t + 0.7);
  const dy = 24 * 0.64 * Math.cos(0.64 * t) + 8 * 2.1 * Math.cos(2.1 * t);
  return { x, y, theta: Math.atan2(dy, dx) };
}

class OdometryDemo {
  constructor() {
    this.canvas = document.getElementById("odometryCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.readout = document.getElementById("odometryReadout");

    this.noise = document.getElementById("odomNoise");
    this.noiseValue = document.getElementById("odomNoiseValue");
    this.speed = document.getElementById("odomSpeed");
    this.speedValue = document.getElementById("odomSpeedValue");
    this.playPause = document.getElementById("odomPlayPause");
    this.resetBtn = document.getElementById("odomReset");

    this.running = true;
    this.reset();
    this.bindEvents();
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
    });

    this.resetBtn.addEventListener("click", () => {
      this.reset();
    });
  }

  reset() {
    this.t = 0;
    this.running = true;
    this.playPause.textContent = "Pause";

    this.truePose = modelA(0);
    this.estPose = { ...this.truePose };

    this.truePath = [{ x: this.truePose.x, y: this.truePose.y }];
    this.estPath = [{ x: this.estPose.x, y: this.estPose.y }];
    this.travel = 0;
    this.drift = 0;
  }

  step(dt) {
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

    this.readout.textContent =
      `Drift: ${this.drift.toFixed(2)} units\n` +
      `Distance traveled: ${this.travel.toFixed(1)} units\n` +
      `Observation: drift grows even when each step error is tiny.`;
  }
}

class CorrectionDemo {
  constructor() {
    this.canvas = document.getElementById("correctionCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.readout = document.getElementById("correctionReadout");

    this.odomNoise = document.getElementById("corrOdomNoise");
    this.odomNoiseValue = document.getElementById("corrOdomNoiseValue");
    this.sensorNoise = document.getElementById("corrSensorNoise");
    this.sensorNoiseValue = document.getElementById("corrSensorNoiseValue");
    this.gain = document.getElementById("corrGain");
    this.gainValue = document.getElementById("corrGainValue");
    this.playPause = document.getElementById("corrPlayPause");
    this.resetBtn = document.getElementById("corrReset");

    this.landmarks = makeLandmarks(16, 42);
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

    const p = modelB(0);
    this.truePose = p;
    this.odomPose = { ...p };
    this.correctedPose = { ...p };

    this.truePath = [{ x: p.x, y: p.y }];
    this.odomPath = [{ x: p.x, y: p.y }];
    this.correctedPath = [{ x: p.x, y: p.y }];
    this.visible = [];
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
    const previousTrue = this.truePose;
    this.truePose = modelB(this.t);

    const deltaS = Math.hypot(this.truePose.x - previousTrue.x, this.truePose.y - previousTrue.y);
    const deltaTheta = wrapAngle(this.truePose.theta - previousTrue.theta);

    const advance = (pose) => {
      pose.theta = wrapAngle(pose.theta + deltaTheta + randn() * odomNoise * 0.045);
      const noisyStep = deltaS + randn() * odomNoise * 0.44;
      pose.x += noisyStep * Math.cos(pose.theta);
      pose.y += noisyStep * Math.sin(pose.theta);
      clampPose(pose);
    };

    advance(this.odomPose);
    advance(this.correctedPose);

    const observations = [];
    for (const lm of this.landmarks) {
      const dx = lm.x - this.truePose.x;
      const dy = lm.y - this.truePose.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 30 || Math.random() < 0.15) continue;

      observations.push({
        id: lm.id,
        x: lm.x,
        y: lm.y,
        range: dist + randn() * sensorNoise * 0.5,
        bearing: wrapAngle(Math.atan2(dy, dx) - this.truePose.theta + randn() * sensorNoise * 0.03),
      });
    }
    this.visible = observations;

    if (observations.length > 0) {
      let xSum = 0;
      let ySum = 0;
      let headingCorrection = 0;

      for (const obs of observations) {
        const beam = this.correctedPose.theta + obs.bearing;
        const candidateX = obs.x - obs.range * Math.cos(beam);
        const candidateY = obs.y - obs.range * Math.sin(beam);
        xSum += candidateX;
        ySum += candidateY;

        const expectedBearing = wrapAngle(
          Math.atan2(obs.y - this.correctedPose.y, obs.x - this.correctedPose.x) - this.correctedPose.theta,
        );
        const innovation = wrapAngle(obs.bearing - expectedBearing);
        headingCorrection += innovation;
      }

      const avgX = xSum / observations.length;
      const avgY = ySum / observations.length;
      this.correctedPose.x = lerp(this.correctedPose.x, avgX, gain * 0.46);
      this.correctedPose.y = lerp(this.correctedPose.y, avgY, gain * 0.46);
      this.correctedPose.theta = wrapAngle(
        this.correctedPose.theta - (headingCorrection / observations.length) * gain * 0.13,
      );
      clampPose(this.correctedPose);
    }

    this.truePath.push({ x: this.truePose.x, y: this.truePose.y });
    this.odomPath.push({ x: this.odomPose.x, y: this.odomPose.y });
    this.correctedPath.push({ x: this.correctedPose.x, y: this.correctedPose.y });

    if (this.truePath.length > 1500) {
      this.truePath.shift();
      this.odomPath.shift();
      this.correctedPath.shift();
    }

    this.draw();
  }

  drawLandmarks(mapper) {
    this.ctx.fillStyle = THEME.landmark;
    this.ctx.font = "10px IBM Plex Mono";

    for (const lm of this.landmarks) {
      const x = mapper.toX(lm.x);
      const y = mapper.toY(lm.y);
      this.ctx.beginPath();
      this.ctx.arc(x, y, 3.1, 0, TAU);
      this.ctx.fill();
      this.ctx.fillText(`${lm.id}`, x + 4, y - 4);
    }
  }

  drawVisibleRays(mapper) {
    this.ctx.strokeStyle = THEME.ray;
    this.ctx.lineWidth = 1.2;

    for (const obs of this.visible) {
      this.ctx.beginPath();
      this.ctx.moveTo(mapper.toX(this.truePose.x), mapper.toY(this.truePose.y));
      this.ctx.lineTo(mapper.toX(obs.x), mapper.toY(obs.y));
      this.ctx.stroke();
    }
  }

  draw() {
    const mapper = getMapper(this.canvas);
    drawGrid(this.ctx, this.canvas, mapper);

    this.drawLandmarks(mapper);
    this.drawVisibleRays(mapper);

    drawPath(this.ctx, mapper, this.truePath, THEME.truePath, 2.1);
    drawPath(this.ctx, mapper, this.odomPath, THEME.odomPath, 2.1, [7, 5]);
    drawPath(this.ctx, mapper, this.correctedPath, THEME.correctedPath, 2.4);

    drawRobot(this.ctx, mapper, this.truePose, THEME.truePath, "true");
    drawRobot(this.ctx, mapper, this.odomPose, THEME.odomPath, "odom");
    drawRobot(this.ctx, mapper, this.correctedPose, THEME.correctedPath, "corrected");

    const odomErr = Math.hypot(this.truePose.x - this.odomPose.x, this.truePose.y - this.odomPose.y);
    const correctedErr = Math.hypot(this.truePose.x - this.correctedPose.x, this.truePose.y - this.correctedPose.y);

    this.readout.textContent =
      `Visible landmarks: ${this.visible.length}\n` +
      `Odometry error: ${odomErr.toFixed(2)} units\n` +
      `Corrected error: ${correctedErr.toFixed(2)} units\n` +
      `Observation: landmarks anchor the estimate against drift.`;
  }
}

class SlamDemo {
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

    if (this.t > 45 && observations.length > 2) {
      const backHome = Math.hypot(this.estPose.x - this.startPose.x, this.estPose.y - this.startPose.y);
      if (backHome < 7 && Math.random() < 0.02) {
        this.loopClosures += 1;
      }
    }

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

    if (this.showTruth.checked) {
      this.drawTruthLandmarks(mapper);
      drawPath(this.ctx, mapper, this.truePath, THEME.truthHintPath, 1.8);
    }

    this.drawMap(mapper);
    this.drawVisibleHints(mapper);
    drawPath(this.ctx, mapper, this.estPath, THEME.odomPath, 2.35);
    drawRobot(this.ctx, mapper, this.estPose, THEME.odomPath, "estimate");

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

    const poseErr = Math.hypot(this.truePose.x - this.estPose.x, this.truePose.y - this.estPose.y);
    const mapped = this.map.size;
    const meanMapErr = this.mapError();

    this.readout.textContent =
      `Mapped landmarks: ${mapped}/${this.trueLandmarks.length}\n` +
      `Pose error (true vs estimate): ${poseErr.toFixed(2)} units\n` +
      `Mean landmark error: ${meanMapErr.toFixed(2)} units\n` +
      `Loop closures detected: ${this.loopClosures}`;
  }
}

class KinematicSlamDemo {
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

    if (this.t > 45 && observations.length > 2) {
      const backHome = Math.hypot(this.kinPose.x - this.startPose.x, this.kinPose.y - this.startPose.y);
      if (backHome < 7 && Math.random() < 0.02) {
        this.loopClosures += 1;
      }
    }

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
      this.ctx.arc(x, y, radius, 0, TAU);
      this.ctx.stroke();

      this.ctx.fillStyle = `rgba(45,131,119,${0.36 + intensity * 0.5})`;
      this.ctx.beginPath();
      this.ctx.arc(x, y, 2.7, 0, TAU);
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
    this.ctx.arc(mapper.toX(this.truePose.x), mapper.toY(this.truePose.y), 11, 0, TAU);
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

function init() {
  const demos = [new OdometryDemo(), new CorrectionDemo(), new SlamDemo(), new KinematicSlamDemo()];
  let last = performance.now();

  const animate = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    for (const demo of demos) {
      demo.step(dt);
    }

    requestAnimationFrame(animate);
  };

  requestAnimationFrame(animate);
}

window.addEventListener("DOMContentLoaded", init);
