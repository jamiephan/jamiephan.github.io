import { Sphere, useTexture } from "@react-three/drei";
import { useControls } from "leva";

export default function Moon() {
  // Render the Moon

  const textureProps = useTexture({
    map: "/assets/textures/moon.jpg",
  });

  const moonConfig = useControls({
    "moon.enabled": true,
    "moon.scale": [0.15, 0.15, 0.15],
    "moon.position": [2, 0.8, 2.8],
    "moon.rotation": [0, 0, 0],
  });

  return (
    <Sphere
      args={[1, 32, 32]}
      position={moonConfig["moon.position"]}
      scale={moonConfig["moon.scale"]}
      rotation={moonConfig["moon.rotation"]}
      receiveShadow
      castShadow
      visible={moonConfig["moon.enabled"]}
    >
      <meshStandardMaterial
        {...textureProps}
        // color="White"
      />
    </Sphere>
  );
}
