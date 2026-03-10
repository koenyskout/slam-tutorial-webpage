import { TAU, THEME } from "../core/constants.js";
import { clamp, lerp, logistic, randn } from "../core/math.js";

export class OccupancyGridDemo {
  constructor() {
    this.canvas = document.getElementById("occupancyCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.readout = document.getElementById("occupancyReadout");

    this.beams = document.getElementById("occBeams");
    this.beamsValue = document.getElementById("occBeamsValue");
    this.sensorNoise = document.getElementById("occSensorNoise");
    this.sensorNoiseValue = document.getElementById("occSensorNoiseValue");
    this.maxRange = document.getElementById("occRange");
    this.maxRangeValue = document.getElementById("occRangeValue");
    this.playPause = document.getElementById("occPlayPause");
    this.resetBtn = document.getElementById("occReset");

    this.gridW = 28;
    this.gridH = 20;
    this.truth = this.createTruthGrid();
    this.running = false;
    this.bindEvents();
    this.reset();
  }

  bindEvents() {
    this.beams.addEventListener("input", () => {
      this.beamsValue.textContent = `${Number(this.beams.value)}`;
    });
    this.sensorNoise.addEventListener("input", () => {
      this.sensorNoiseValue.textContent = Number(this.sensorNoise.value).toFixed(2);
    });
    this.maxRange.addEventListener("input", () => {
      this.maxRangeValue.textContent = Number(this.maxRange.value).toFixed(1);
    });
    this.playPause.addEventListener("click", () => {
      if (this.explorationComplete) return;
      this.running = !this.running;
      this.playPause.textContent = this.running ? "Pause" : "Play";
    });
    this.resetBtn.addEventListener("click", () => this.reset());
  }

  createTruthGrid() {
    const map = Array.from({ length: this.gridH }, () => Array(this.gridW).fill(false));
    const addRect = (x0, y0, x1, y1) => {
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          if (x >= 0 && x < this.gridW && y >= 0 && y < this.gridH) map[y][x] = true;
        }
      }
    };

    addRect(0, 0, this.gridW - 1, 0);
    addRect(0, this.gridH - 1, this.gridW - 1, this.gridH - 1);
    addRect(0, 0, 0, this.gridH - 1);
    addRect(this.gridW - 1, 0, this.gridW - 1, this.gridH - 1);

    addRect(8, 3, 8, 15);
    addRect(19, 4, 19, 16);
    addRect(12, 13, 15, 15);
    addRect(4, 5, 6, 7);
    addRect(22, 10, 24, 12);

    map[9][8] = false;
    map[10][8] = false;
    map[7][19] = false;
    map[8][19] = false;

    return map;
  }

  reset() {
    this.beams.value = "18";
    this.sensorNoise.value = "0.8";
    this.maxRange.value = "9";
    this.beamsValue.textContent = "18";
    this.sensorNoiseValue.textContent = "0.80";
    this.maxRangeValue.textContent = "9.0";

    this.running = false;
    this.playPause.textContent = "Play";
    this.scanCount = 0;
    this.collisionAvoids = 0;
    this.explorationComplete = false;
    this.completionReason = "";

    this.logOdds = Array.from({ length: this.gridH }, () => Array(this.gridW).fill(0));
    this.beamEndpoints = [];
    this.freeThreshold = -0.25;
    this.unknownThreshold = 0.9;
    this.occupiedThreshold = 1.2;

    this.pose = { x: 2.5, y: 2.5, theta: 0 };
    this.currentPath = [];
    this.pathIndex = 0;
    this.exploreMode = "frontier";
    this.frontierCount = 0;
    this.reachableFrontierCount = 0;
    this.frontierCells = [];
    this.boundaryGoals = [
      { x: 2, y: 2 },
      { x: 25, y: 2 },
      { x: 25, y: 17 },
      { x: 2, y: 17 },
    ];
    this.boundaryGoalIndex = 0;
    this.bootstrapMinScans = 26;
    this.bootstrapMinKnownCells = 90;

    // Seed map so frontier detection is meaningful before first planning cycle.
    this.performScan();
  }

  inBounds(cx, cy) {
    return cx >= 0 && cy >= 0 && cx < this.gridW && cy < this.gridH;
  }

  isTruthFree(cx, cy) {
    return this.inBounds(cx, cy) && !this.truth[cy][cx];
  }

  isPoseFree(x, y) {
    const radius = 0.33;
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * TAU;
      const sx = x + Math.cos(a) * radius;
      const sy = y + Math.sin(a) * radius;
      const cx = Math.floor(sx);
      const cy = Math.floor(sy);
      if (!this.isTruthFree(cx, cy)) return false;
    }
    return true;
  }

  segmentCollides(x0, y0, x1, y1) {
    const distance = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(2, Math.ceil(distance / 0.08));
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const x = lerp(x0, x1, t);
      const y = lerp(y0, y1, t);
      if (!this.isPoseFree(x, y)) return true;
    }
    return false;
  }

  markCollisionEvidence(x, y) {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (!this.inBounds(cx, cy)) return;
    const reinforced = this.occupiedThreshold + 0.7;
    this.logOdds[cy][cx] = Math.max(this.logOdds[cy][cx], reinforced);
  }

  castRay(pose, angle, maxRange) {
    const free = [];
    let hit = null;
    let endX = pose.x;
    let endY = pose.y;
    let lastKey = "";

    for (let r = 0.2; r <= maxRange; r += 0.2) {
      const wx = pose.x + r * Math.cos(angle);
      const wy = pose.y + r * Math.sin(angle);
      const cx = Math.floor(wx);
      const cy = Math.floor(wy);
      endX = wx;
      endY = wy;

      if (!this.inBounds(cx, cy)) break;

      const key = `${cx}:${cy}`;
      if (this.truth[cy][cx]) {
        hit = { cx, cy };
        break;
      }

      if (key !== lastKey) {
        free.push({ cx, cy });
        lastKey = key;
      }
    }

    return { free, hit, endX, endY };
  }

  performScan() {
    const noise = Number(this.sensorNoise.value);
    const beamCount = Number(this.beams.value);
    const maxRange = Number(this.maxRange.value);
    const occUpdate = 0.46 / (1 + noise * 0.7);
    const freeUpdate = 0.16 / (1 + noise * 0.6);
    const beams = [];

    for (let i = 0; i < beamCount; i += 1) {
      const rel = -1.2 + (2.4 * i) / Math.max(1, beamCount - 1);
      const angle = this.pose.theta + rel + randn() * noise * 0.01;
      const ray = this.castRay(this.pose, angle, maxRange);
      beams.push(ray);

      for (const c of ray.free) {
        if (!this.inBounds(c.cx, c.cy)) continue;
        this.logOdds[c.cy][c.cx] = clamp(this.logOdds[c.cy][c.cx] - freeUpdate, -3.5, 3.5);
      }

      if (ray.hit && Math.random() > noise * 0.08) {
        this.logOdds[ray.hit.cy][ray.hit.cx] = clamp(this.logOdds[ray.hit.cy][ray.hit.cx] + occUpdate, -3.5, 3.5);
      }
    }

    this.beamEndpoints = beams;
    this.scanCount += 1;
    this.refreshFrontierState();
  }

  isUnknown(cx, cy) {
    return Math.abs(this.logOdds[cy][cx]) < this.unknownThreshold;
  }

  isKnownFree(cx, cy) {
    return this.logOdds[cy][cx] < this.freeThreshold;
  }

  isConfidentOccupied(cx, cy) {
    return this.logOdds[cy][cx] > this.occupiedThreshold;
  }

  isFrontier(cx, cy) {
    if (!this.isKnownFree(cx, cy)) return false;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!this.inBounds(nx, ny)) continue;
      if (this.isUnknown(nx, ny)) return true;
    }
    return false;
  }

  neighbors(cx, cy) {
    const out = [];
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!this.inBounds(nx, ny)) continue;
      if (!this.isConfidentOccupied(nx, ny)) out.push({ x: nx, y: ny });
    }
    return out;
  }

  key(cx, cy) {
    return `${cx}:${cy}`;
  }

  reconstructPath(parent, endKey) {
    const path = [];
    let k = endKey;
    while (k) {
      const [xs, ys] = k.split(":");
      path.push({ x: Number(xs), y: Number(ys) });
      k = parent.get(k) || null;
    }
    path.reverse();
    return path;
  }

  bfsPathToCell(start, goal) {
    const startKey = this.key(start.x, start.y);
    const goalKey = this.key(goal.x, goal.y);
    const queue = [start];
    const parent = new Map();
    parent.set(startKey, "");

    while (queue.length > 0) {
      const cell = queue.shift();
      const cellKey = this.key(cell.x, cell.y);
      if (cellKey === goalKey) return this.reconstructPath(parent, cellKey);

      for (const n of this.neighbors(cell.x, cell.y)) {
        const nk = this.key(n.x, n.y);
        if (parent.has(nk)) continue;
        parent.set(nk, cellKey);
        queue.push(n);
      }
    }

    return null;
  }

  bfsNearestFrontierAnalysis(start) {
    const queue = [start];
    const parent = new Map();
    const startKey = this.key(start.x, start.y);
    parent.set(startKey, "");
    let firstPath = null;
    let reachableFrontiers = 0;

    while (queue.length > 0) {
      const cell = queue.shift();
      const ck = this.key(cell.x, cell.y);
      if (this.isFrontier(cell.x, cell.y)) {
        reachableFrontiers += 1;
        if (!firstPath) {
          const candidatePath = this.reconstructPath(parent, ck);
          if (candidatePath.length > 1) firstPath = candidatePath;
        }
      }

      for (const n of this.neighbors(cell.x, cell.y)) {
        const nk = this.key(n.x, n.y);
        if (parent.has(nk)) continue;
        parent.set(nk, ck);
        queue.push(n);
      }
    }

    return { path: firstPath, reachableFrontiers };
  }

  countFrontiers() {
    const cells = [];
    for (let y = 0; y < this.gridH; y += 1) {
      for (let x = 0; x < this.gridW; x += 1) {
        if (this.isFrontier(x, y)) cells.push({ x, y });
      }
    }
    this.frontierCells = cells;
    return cells.length;
  }

  refreshFrontierState() {
    this.frontierCount = this.countFrontiers();
    const start = { x: Math.floor(this.pose.x), y: Math.floor(this.pose.y) };
    const analysis = this.bfsNearestFrontierAnalysis(start);
    this.reachableFrontierCount = analysis.reachableFrontiers;
    return analysis;
  }

  requestBoundaryPath(start) {
    let attempts = 0;
    while (attempts < this.boundaryGoals.length) {
      const goal = this.boundaryGoals[this.boundaryGoalIndex % this.boundaryGoals.length];
      this.boundaryGoalIndex += 1;
      attempts += 1;
      const path = this.bfsPathToCell(start, goal);
      if (path && path.length > 1) {
        this.exploreMode = "bootstrap";
        this.currentPath = path;
        this.pathIndex = 1;
        return true;
      }
    }
    return false;
  }

  planPath() {
    const start = { x: Math.floor(this.pose.x), y: Math.floor(this.pose.y) };
    const analysis = this.refreshFrontierState();

    const path = analysis.path;
    if (path && path.length > 1) {
      this.exploreMode = "frontier";
      this.currentPath = path;
      this.pathIndex = 1;
      return;
    }

    const stats = this.mapStats();
    const noUsableFrontierPath = !path || path.length <= 1;
    const needBootstrap =
      noUsableFrontierPath &&
      (this.scanCount < this.bootstrapMinScans || stats.known < this.bootstrapMinKnownCells);
    if (needBootstrap && this.requestBoundaryPath(start)) {
      return;
    }

    if (this.frontierCount === 0) {
      this.completionReason = "no frontier remains";
    } else {
      this.completionReason = "remaining frontiers are unreachable";
    }

    this.exploreMode = "complete";
    this.currentPath = [];
    this.pathIndex = 0;
    this.explorationComplete = true;
    this.running = false;
    this.playPause.textContent = "Done";
  }

  advancePose(dt) {
    if (!this.currentPath || this.pathIndex >= this.currentPath.length) {
      this.planPath();
    }

    let moveRemaining = dt * 3.1;
    let guard = 0;
    while (moveRemaining > 1e-5 && this.currentPath && this.pathIndex < this.currentPath.length && guard < 8) {
      guard += 1;
      const cell = this.currentPath[this.pathIndex];
      const tx = cell.x + 0.5;
      const ty = cell.y + 0.5;
      const dx = tx - this.pose.x;
      const dy = ty - this.pose.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.08) {
        this.pathIndex += 1;
        continue;
      }

      const ux = dx / dist;
      const uy = dy / dist;
      const step = Math.min(moveRemaining, dist);
      const nx = this.pose.x + ux * step;
      const ny = this.pose.y + uy * step;

      if (this.segmentCollides(this.pose.x, this.pose.y, nx, ny) || !this.isPoseFree(nx, ny)) {
        this.collisionAvoids += 1;
        this.markCollisionEvidence(nx, ny);
        this.refreshFrontierState();
        this.currentPath = [];
        this.pathIndex = 0;
        break;
      }

      this.pose.x = nx;
      this.pose.y = ny;
      this.pose.theta = Math.atan2(uy, ux);
      moveRemaining -= step;
    }

    if (this.currentPath && this.pathIndex >= this.currentPath.length) {
      this.currentPath = [];
      this.pathIndex = 0;
    }
  }

  step(dt) {
    if (this.running) {
      this.advancePose(dt);
      this.performScan();
    }

    this.draw();
  }

  drawGridPanel(panel, mode) {
    const { x, y, size } = panel;
    const ctx = this.ctx;
    const cell = size;

    for (let cy = 0; cy < this.gridH; cy += 1) {
      for (let cx = 0; cx < this.gridW; cx += 1) {
        const px = x + cx * cell;
        const py = y + (this.gridH - cy - 1) * cell;
        if (mode === "truth") {
          ctx.fillStyle = this.truth[cy][cx] ? "#1f2e3a" : "#f9fcff";
        } else {
          const l = this.logOdds[cy][cx];
          if (l > this.occupiedThreshold) {
            const shade = Math.max(42, Math.round(120 - Math.min(2, l - this.occupiedThreshold) * 35));
            ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
          } else if (l < this.freeThreshold) {
            ctx.fillStyle = "#ffffff";
          } else {
            ctx.fillStyle = "#eef2f5";
          }
        }
        ctx.fillRect(px, py, cell, cell);
      }
    }

    ctx.strokeStyle = "rgba(110,130,145,0.45)";
    ctx.strokeRect(x, y, this.gridW * cell, this.gridH * cell);
  }

  drawRobotOnPanel(panel, color) {
    const ctx = this.ctx;
    const { x, y, size } = panel;
    const px = x + this.pose.x * size;
    const py = y + (this.gridH - this.pose.y) * size;
    const len = 9;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, 4.4, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(this.pose.theta) * len, py - Math.sin(this.pose.theta) * len);
    ctx.stroke();
  }

  drawPlannedPath(panel) {
    if (!this.currentPath || this.currentPath.length < 2) return;
    const { x, y, size } = panel;
    this.ctx.strokeStyle = "rgba(45,131,119,0.75)";
    this.ctx.lineWidth = 1.6;
    this.ctx.beginPath();
    const first = this.currentPath[Math.min(this.pathIndex, this.currentPath.length - 1)];
    this.ctx.moveTo(x + (first.x + 0.5) * size, y + (this.gridH - first.y - 0.5) * size);
    for (let i = this.pathIndex + 1; i < this.currentPath.length; i += 1) {
      const c = this.currentPath[i];
      this.ctx.lineTo(x + (c.x + 0.5) * size, y + (this.gridH - c.y - 0.5) * size);
    }
    this.ctx.stroke();
  }

  drawFrontierMarkers(panel) {
    if (!this.frontierCells || this.frontierCells.length === 0) return;
    const { x, y, size } = panel;
    const stride = this.frontierCells.length > 360 ? Math.ceil(this.frontierCells.length / 360) : 1;
    this.ctx.fillStyle = "rgba(212, 118, 36, 0.82)";
    for (let i = 0; i < this.frontierCells.length; i += stride) {
      const c = this.frontierCells[i];
      const px = x + (c.x + 0.5) * size;
      const py = y + (this.gridH - c.y - 0.5) * size;
      this.ctx.beginPath();
      this.ctx.arc(px, py, Math.max(1.1, size * 0.14), 0, TAU);
      this.ctx.fill();
    }
  }

  mapStats() {
    let known = 0;
    let correct = 0;
    let entropySum = 0;
    for (let cy = 0; cy < this.gridH; cy += 1) {
      for (let cx = 0; cx < this.gridW; cx += 1) {
        const p = logistic(this.logOdds[cy][cx]);
        const entropy = -(p * Math.log2(Math.max(1e-8, p)) + (1 - p) * Math.log2(Math.max(1e-8, 1 - p)));
        entropySum += entropy;
        const l = this.logOdds[cy][cx];
        const isKnown = l < this.freeThreshold || l > this.occupiedThreshold;
        if (isKnown) {
          known += 1;
          const estOcc = l > this.occupiedThreshold;
          if (estOcc === this.truth[cy][cx]) correct += 1;
        }
      }
    }

    return {
      known,
      accuracy: known > 0 ? correct / known : 0,
      meanEntropy: entropySum / (this.gridW * this.gridH),
    };
  }

  draw() {
    const ctx = this.ctx;
    const canvas = this.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fbfdff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const top = 46;
    const sidePad = 30;
    const gap = 28;
    const size = Math.min((canvas.width - sidePad * 2 - gap) / (this.gridW * 2), (canvas.height - 84) / this.gridH);
    const leftPanel = { x: sidePad, y: top, size };
    const rightPanel = { x: sidePad + this.gridW * size + gap, y: top, size };

    this.drawGridPanel(leftPanel, "estimate");
    this.drawGridPanel(rightPanel, "truth");
    this.drawFrontierMarkers(leftPanel);

    ctx.fillStyle = "#2f4353";
    ctx.font = "12px IBM Plex Mono";
    ctx.fillText("Estimated occupancy", leftPanel.x, top - 10);
    ctx.fillText("Hidden ground truth + rays", rightPanel.x, top - 10);

    ctx.strokeStyle = "rgba(161,112,52,0.28)";
    ctx.lineWidth = 1;
    for (const beam of this.beamEndpoints) {
      const sx = rightPanel.x + this.pose.x * size;
      const sy = rightPanel.y + (this.gridH - this.pose.y) * size;
      const ex = rightPanel.x + beam.endX * size;
      const ey = rightPanel.y + (this.gridH - beam.endY) * size;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }

    this.drawPlannedPath(rightPanel);
    this.drawRobotOnPanel(leftPanel, THEME.correctedPath);
    this.drawRobotOnPanel(rightPanel, THEME.odomPath);

    const stats = this.mapStats();
    const pathRemaining = this.currentPath && this.pathIndex < this.currentPath.length
      ? this.currentPath.length - this.pathIndex
      : 0;
    const status = this.explorationComplete
      ? `completed (${this.completionReason})`
      : this.exploreMode;

    this.readout.textContent =
      `Scans integrated: ${this.scanCount}\n` +
      `Exploration mode: ${status}\n` +
      `Frontier cells total/reachable: ${this.frontierCount}/${this.reachableFrontierCount}\n` +
      `Frontier markers: orange dots on estimated map\n` +
      `Planned steps remaining: ${pathRemaining}\n` +
      `Occupied confidence threshold (log-odds): ${this.occupiedThreshold.toFixed(2)}\n` +
      `Confident cells: ${stats.known}/${this.gridW * this.gridH}\n` +
      `Accuracy on confident cells: ${(stats.accuracy * 100).toFixed(1)}%\n` +
      `Mean map entropy: ${stats.meanEntropy.toFixed(3)} bits\n` +
      `Collision-avoiding replans: ${this.collisionAvoids}\n` +
      `Interpretation: as scanning continues, gray uncertainty should shrink and frontiers should disappear.`;
  }
}
