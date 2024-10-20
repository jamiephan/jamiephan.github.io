import { Sphere, useTexture } from "@react-three/drei";
import { useControls } from "leva";

export default function Moon() {
  // Render the Moon

  const textureProps = useTexture({
    map: "/assets/textures/moon.jpg",
  });

  const moonConfig = useControls({
    "moon.enabled": true,
    "moon.position": [2, 0.8, 2.8],
    "moon.scale": [0.15, 0.15, 0.15],
  });

  return (
    <>
      <Sphere
        args={[1, 32, 32]}
        position={moonConfig["moon.position"]}
        scale={moonConfig["moon.scale"]}
        receiveShadow
        castShadow
      >
        <meshStandardMaterial
          {...textureProps}
          // color="White"
        />
      </Sphere>
    </>
  );
}
