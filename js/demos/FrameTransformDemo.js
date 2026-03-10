import { TAU, THEME } from "../core/constants.js";
import { clamp } from "../core/math.js";
import { drawGrid, drawRobot, getMapper } from "../core/canvas.js";

export class FrameTransformDemo {
  constructor() {
    this.canvas = document.getElementById("framesCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.readout = document.getElementById("framesReadout");
    this.resetBtn = document.getElementById("frameReset");
    this.dragMode = null;

    this.bindEvents();
    this.reset();
  }

  bindEvents() {
    this.resetBtn.addEventListener("click", () => this.reset());

    const pointerDown = (event) => {
      const mapper = getMapper(this.canvas);
      const { x, y } = this.eventToWorld(event, mapper);
      const transformed = this.toWorld(this.localPoint.x, this.localPoint.y);
      const headingHandle = {
        x: this.robot.x + 11 * Math.cos(this.robot.theta),
        y: this.robot.y + 11 * Math.sin(this.robot.theta),
      };

      if (Math.hypot(x - this.robot.x, y - this.robot.y) < 3.5) this.dragMode = "robot";
      else if (Math.hypot(x - transformed.x, y - transformed.y) < 3.5) this.dragMode = "point";
      else if (Math.hypot(x - headingHandle.x, y - headingHandle.y) < 3.5) this.dragMode = "heading";
      else this.dragMode = null;
    };

    const pointerMove = (event) => {
      if (!this.dragMode) return;
      const mapper = getMapper(this.canvas);
      const { x, y } = this.eventToWorld(event, mapper);

      if (this.dragMode === "robot") {
        this.robot.x = clamp(x, 2, 98);
        this.robot.y = clamp(y, 2, 98);
      } else if (this.dragMode === "heading") {
        this.robot.theta = Math.atan2(y - this.robot.y, x - this.robot.x);
      } else if (this.dragMode === "point") {
        const dx = x - this.robot.x;
        const dy = y - this.robot.y;
        const c = Math.cos(this.robot.theta);
        const s = Math.sin(this.robot.theta);
        this.localPoint.x = clamp(dx * c + dy * s, -28, 28);
        this.localPoint.y = clamp(-dx * s + dy * c, -28, 28);
      }
    };

    const pointerUp = () => {
      this.dragMode = null;
    };

    this.canvas.addEventListener("mousedown", pointerDown);
    window.addEventListener("mousemove", pointerMove);
    window.addEventListener("mouseup", pointerUp);
  }

  reset() {
    this.robot = { x: 45, y: 40, theta: 0.8 };
    this.localPoint = { x: 12, y: 7 };
    this.draw();
  }

  eventToWorld(event, mapper) {
    const rect = this.canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * this.canvas.width;
    const py = ((event.clientY - rect.top) / rect.height) * this.canvas.height;
    return { x: mapper.fromX(px), y: mapper.fromY(py) };
  }

  toWorld(lx, ly) {
    const { x, y, theta } = this.robot;
    return {
      x: x + lx * Math.cos(theta) - ly * Math.sin(theta),
      y: y + lx * Math.sin(theta) + ly * Math.cos(theta),
    };
  }

  step() {
    this.draw();
  }

  draw() {
    const mapper = getMapper(this.canvas);
    drawGrid(this.ctx, this.canvas, mapper);

    const rx = this.robot.x;
    const ry = this.robot.y;
    const theta = this.robot.theta;
    const lx = this.localPoint.x;
    const ly = this.localPoint.y;
    const transformed = this.toWorld(lx, ly);
    const wx = transformed.x;
    const wy = transformed.y;

    const originX = mapper.toX(this.robot.x);
    const originY = mapper.toY(this.robot.y);
    const ux = Math.cos(this.robot.theta);
    const uy = Math.sin(this.robot.theta);
    const vx = -Math.sin(this.robot.theta);
    const vy = Math.cos(this.robot.theta);

    this.ctx.strokeStyle = "#4d7394";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(originX, originY);
    this.ctx.lineTo(mapper.toX(rx + ux * 10), mapper.toY(ry + uy * 10));
    this.ctx.stroke();

    this.ctx.strokeStyle = "#7f9b59";
    this.ctx.beginPath();
    this.ctx.moveTo(originX, originY);
    this.ctx.lineTo(mapper.toX(rx + vx * 10), mapper.toY(ry + vy * 10));
    this.ctx.stroke();

    this.ctx.strokeStyle = "rgba(161,112,52,0.7)";
    this.ctx.setLineDash([6, 5]);
    this.ctx.beginPath();
    this.ctx.moveTo(originX, originY);
    this.ctx.lineTo(mapper.toX(wx), mapper.toY(wy));
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    this.ctx.fillStyle = "#a17034";
    this.ctx.beginPath();
    this.ctx.arc(mapper.toX(wx), mapper.toY(wy), 5.5, 0, TAU);
    this.ctx.fill();
    this.ctx.font = "12px IBM Plex Mono";
    this.ctx.fillText("transformed point", mapper.toX(wx) + 7, mapper.toY(wy) - 8);

    const headingHandle = {
      x: this.robot.x + 11 * Math.cos(this.robot.theta),
      y: this.robot.y + 11 * Math.sin(this.robot.theta),
    };

    this.ctx.fillStyle = "#2f668e";
    this.ctx.beginPath();
    this.ctx.arc(mapper.toX(headingHandle.x), mapper.toY(headingHandle.y), 4.4, 0, TAU);
    this.ctx.fill();

    drawRobot(this.ctx, mapper, this.robot, THEME.truePath, "robot frame");

    this.readout.textContent =
      `Robot pose: (${rx.toFixed(1)}, ${ry.toFixed(1)}, ${theta.toFixed(2)} rad)\n` +
      `Local point: (${lx.toFixed(1)}, ${ly.toFixed(1)})\n` +
      `World point: (${wx.toFixed(2)}, ${wy.toFixed(2)})\n` +
      `Drag robot, heading-handle, or transformed point to edit directly.`;
  }
}
