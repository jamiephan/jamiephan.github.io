import { Box, useTexture } from "@react-three/drei";
import { BackSide } from "three";

export default function Skybox() {
  const SIZE = 1000;

  const textures = useTexture([
    "/assets/textures/skybox/px.jpg",
    "/assets/textures/skybox/nx.jpg",
    "/assets/textures/skybox/py.jpg",
    "/assets/textures/skybox/ny.jpg",
    "/assets/textures/skybox/pz.jpg",
    "/assets/textures/skybox/nz.jpg",
  ]);
  return (
    <Box args={Array(3).fill(SIZE)} material={textures}>
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
