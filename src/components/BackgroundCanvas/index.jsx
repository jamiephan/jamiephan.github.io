import { Canvas } from "@react-three/fiber";

import Render from "./Render";
import { Leva } from "leva";

function BackgroundCanvas() {
  return (
    <>
      <Leva hideCopyButton hideTitleBar oneLineLabels />
      <Canvas>
        <Render />
      </Canvas>
    </>
  );
}

export default BackgroundCanvas;
