export function installPlayOverlay({ canvas, onPlay, getVisible, label = "Play simulation" }) {
  const panel = canvas.parentElement;
  const overlay = document.createElement("div");
  overlay.className = "canvas-play-overlay";
  overlay.classList.add("is-hidden");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "canvas-play-button";
  button.setAttribute("aria-label", label);
  button.innerHTML =
    '<span class="canvas-play-button__icon" aria-hidden="true"></span><span class="canvas-play-button__text">Play</span>';

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onPlay();
  });

  overlay.appendChild(button);
  panel.appendChild(overlay);

  const syncBounds = () => {
    overlay.style.left = `${canvas.offsetLeft}px`;
    overlay.style.top = `${canvas.offsetTop}px`;
    overlay.style.width = `${canvas.offsetWidth}px`;
    overlay.style.height = `${canvas.offsetHeight}px`;
  };

  const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncBounds) : null;
  if (resizeObserver) resizeObserver.observe(canvas);
  window.addEventListener("resize", syncBounds);

  const update = () => {
    const visible = getVisible();
    overlay.classList.toggle("is-hidden", !visible);
    button.tabIndex = visible ? 0 : -1;
  };

  syncBounds();
  update();

  return {
    update,
    destroy() {
      window.removeEventListener("resize", syncBounds);
      if (resizeObserver) resizeObserver.disconnect();
      overlay.remove();
    },
  };
}
