import { TAU, THEME } from "./constants.js";
import { clamp } from "./math.js";

export function getMapper(canvas) {
  const margin = 32;
  const worldSize = 100;
  const scale = Math.min((canvas.width - margin * 2) / worldSize, (canvas.height - margin * 2) / worldSize);
  const ox = (canvas.width - worldSize * scale) / 2;
  const oy = (canvas.height - worldSize * scale) / 2;

  return {
    scale,
    toX: (x) => ox + x * scale,
    toY: (y) => canvas.height - (oy + y * scale),
    fromX: (px) => (px - ox) / scale,
    fromY: (py) => (canvas.height - py - oy) / scale,
  };
}

export function drawGrid(ctx, canvas, mapper) {
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

export function drawPath(ctx, mapper, points, color, width, dash = []) {
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

export function drawRobot(ctx, mapper, pose, color, label) {
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

export function clampPose(pose) {
  pose.x = clamp(pose.x, 2, 98);
  pose.y = clamp(pose.y, 2, 98);
}
