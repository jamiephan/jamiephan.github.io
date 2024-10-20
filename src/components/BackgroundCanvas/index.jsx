import { Canvas } from "@react-three/fiber";

import Render from "./Render";
import { Leva } from "leva";

function BackgroundCanvas() {
  return (
    <>
      <Leva collapsed hideCopyButton hideTitleBar oneLineLabels />
      <Canvas shadows>
        <Render />
      </Canvas>
    </>
  );
}

export default BackgroundCanvas;
