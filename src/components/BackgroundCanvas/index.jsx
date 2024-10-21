import { useState } from "react";

import { Canvas } from "@react-three/fiber";
import { Leva } from "leva";
import { useKonami } from "react-konami-code";

import Render from "./Render";

function BackgroundCanvas() {
  const [enableLevaMenu, setEnableLevaMenu] = useState(
    window.location.hostname === "localhost"
  );

  useKonami(() => {
    setEnableLevaMenu(!enableLevaMenu);
  });

  return (
    <>
      <Leva
        collapsed
        hideCopyButton
        hideTitleBar
        oneLineLabels
        hidden={!enableLevaMenu}
      />
      <Canvas shadows>
        <Render />
      </Canvas>
    </>
  );
}

export default BackgroundCanvas;
