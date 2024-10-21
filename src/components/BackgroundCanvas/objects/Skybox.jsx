import { Box, useTexture } from "@react-three/drei";
import { useControls } from "leva";
import { BackSide } from "three";

export default function Skybox() {
  const skyboxConfig = useControls({
    "skybox.enabled": true,
    "skybox.scale": [1, 1, 1],
    "skybox.position": [0, 0, 0],
    "skybox.rotation": [-1, -1, -1],
  });

  const textures = useTexture([
    "/assets/textures/skybox/px.jpg",
    "/assets/textures/skybox/nx.jpg",
    "/assets/textures/skybox/py.jpg",
    "/assets/textures/skybox/ny.jpg",
    "/assets/textures/skybox/pz.jpg",
    "/assets/textures/skybox/nz.jpg",
  ]);

  return (
    <Box
      args={[1000, 1000, 1000]}
      scale={skyboxConfig["skybox.scale"]}
      position={skyboxConfig["skybox.position"]}
      rotation={skyboxConfig["skybox.rotation"]}
      visible={skyboxConfig["skybox.enabled"]}
    >
      {textures.map((t, i) => (
        <meshBasicMaterial
          key={i}
          attach={"material-" + i}
          map={t}
          side={BackSide}
        />
      ))}
    </Box>
  );
}
