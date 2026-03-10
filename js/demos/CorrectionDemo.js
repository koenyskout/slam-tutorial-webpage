import { THEME } from "../core/constants.js";
import { lerp, makeLandmarks, randn, wrapAngle } from "../core/math.js";
import { clampPose, drawGrid, drawPath, drawRobot, getMapper } from "../core/canvas.js";
import { modelB } from "../core/models.js";

export class CorrectionDemo {
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
    this.running = false;
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
    this.running = false;
    this.playPause.textContent = "Play";

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
      this.ctx.arc(x, y, 3.1, 0, Math.PI * 2);
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
      `Interpretation: landmark measurements pull the estimate back when odometry drifts.`;
  }
}
