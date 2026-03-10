import { FrameTransformDemo } from "./demos/FrameTransformDemo.js";
import { LinkedSlamExampleDemo } from "./demos/LinkedSlamExampleDemo.js";
import { OdometryDemo } from "./demos/OdometryDemo.js";
import { BayesianUpdateDemo } from "./demos/BayesianUpdateDemo.js";
import { CovarianceDemo } from "./demos/CovarianceDemo.js";
import { CorrectionDemo } from "./demos/CorrectionDemo.js";
import { DataAssociationDemo } from "./demos/DataAssociationDemo.js";
import { SlamDemo } from "./demos/SlamDemo.js";
import { PoseGraphDemo } from "./demos/PoseGraphDemo.js";
import { OccupancyGridDemo } from "./demos/OccupancyGridDemo.js";
import { KinematicSlamDemo } from "./demos/KinematicSlamDemo.js";

function buildDemos() {
  const registry = [
    { canvasId: "framesCanvas", ctor: FrameTransformDemo },
    { canvasId: "linkedExampleCanvas", ctor: LinkedSlamExampleDemo },
    { canvasId: "odometryCanvas", ctor: OdometryDemo },
    { canvasId: "bayesCanvas", ctor: BayesianUpdateDemo },
    { canvasId: "covarianceCanvas", ctor: CovarianceDemo },
    { canvasId: "correctionCanvas", ctor: CorrectionDemo },
    { canvasId: "associationCanvas", ctor: DataAssociationDemo },
    { canvasId: "slamCanvas", ctor: SlamDemo },
    { canvasId: "poseGraphCanvas", ctor: PoseGraphDemo },
    { canvasId: "occupancyCanvas", ctor: OccupancyGridDemo },
    { canvasId: "kinematicCanvas", ctor: KinematicSlamDemo },
  ];

  const demos = [];
  for (const entry of registry) {
    if (!document.getElementById(entry.canvasId)) continue;
    demos.push(new entry.ctor());
  }
  return demos;
}

function animateDemos(demos) {
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

window.addEventListener("DOMContentLoaded", () => {
  const demos = buildDemos();
  animateDemos(demos);
});
