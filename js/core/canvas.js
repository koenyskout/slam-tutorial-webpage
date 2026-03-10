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

export function drawInfoPanel(
  ctx,
  canvas,
  {
    title = "",
    lines = [],
    x = null,
    y = 20,
    width = 270,
    padding = 8,
    lineHeight = 14,
    anchor = "top-right",
    background = "rgba(251,253,255,0.94)",
    border = "rgba(116,136,151,0.55)",
    titleColor = "#2b3f50",
    textColor = "#2b3f50",
  } = {},
) {
  const margin = 12;
  const maxWidth = Math.max(180, canvas.width - margin * 2);
  const panelWidth = Math.min(Math.max(180, width), maxWidth);
  const innerWidth = Math.max(40, panelWidth - padding * 2);

  ctx.font = "11px IBM Plex Mono";

  const fitWord = (word, maxLineWidth) => {
    if (ctx.measureText(word).width <= maxLineWidth) return [word];
    const chunks = [];
    let chunk = "";
    for (const ch of word) {
      const candidate = chunk + ch;
      if (ctx.measureText(candidate).width <= maxLineWidth) {
        chunk = candidate;
      } else if (chunk.length > 0) {
        chunks.push(chunk);
        chunk = ch;
      }
    }
    if (chunk.length > 0) chunks.push(chunk);
    return chunks.length > 0 ? chunks : ["…"];
  };

  const wrapText = (text, maxLineWidth) => {
    const words = String(text).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [""];
    const wrapped = [];
    let line = "";
    for (const word of words) {
      const parts = fitWord(word, maxLineWidth);
      for (const part of parts) {
        const candidate = line ? `${line} ${part}` : part;
        if (ctx.measureText(candidate).width <= maxLineWidth) {
          line = candidate;
        } else {
          if (line) wrapped.push(line);
          line = part;
        }
      }
    }
    if (line) wrapped.push(line);
    return wrapped.length > 0 ? wrapped : [""];
  };

  const wrappedLines = [];
  for (const line of lines) {
    if (typeof line === "string") {
      for (const text of wrapText(line, innerWidth)) wrappedLines.push({ text, color: textColor });
    } else {
      const color = line.color || textColor;
      for (const text of wrapText(line.text || "", innerWidth)) wrappedLines.push({ text, color });
    }
  }

  const titleRows = title ? 1 : 0;
  const separatorRows = title && wrappedLines.length > 0 ? 0.35 : 0;
  const availableRows = Math.max(
    1,
    Math.floor((canvas.height - margin * 2 - padding * 2 - (titleRows + separatorRows) * lineHeight) / lineHeight),
  );

  if (wrappedLines.length > availableRows) {
    wrappedLines.length = availableRows;
    const last = wrappedLines[wrappedLines.length - 1];
    const ellipsis = " …";
    let clipped = last.text;
    while (clipped.length > 1 && ctx.measureText(clipped + ellipsis).width > innerWidth) {
      clipped = clipped.slice(0, -1);
    }
    last.text = `${clipped}${ellipsis}`;
  }

  const height = padding * 2 + (titleRows + separatorRows + wrappedLines.length) * lineHeight;
  let boxX = x;
  if (boxX == null) {
    boxX = anchor === "top-left" ? margin : canvas.width - panelWidth - margin;
  }
  boxX = Math.max(margin, Math.min(boxX, canvas.width - panelWidth - margin));
  const boxY = Math.max(margin, Math.min(y, canvas.height - height - margin));

  ctx.fillStyle = background;
  ctx.fillRect(boxX, boxY, panelWidth, height);
  ctx.strokeStyle = border;
  ctx.strokeRect(boxX, boxY, panelWidth, height);

  let rowY = boxY + padding + 11;
  if (title) {
    ctx.fillStyle = titleColor;
    ctx.fillText(title, boxX + padding, rowY);
    rowY += lineHeight * (1 + separatorRows);
  }

  for (const line of wrappedLines) {
    ctx.fillStyle = line.color || textColor;
    ctx.fillText(line.text || "", boxX + padding, rowY);
    rowY += lineHeight;
  }
}
