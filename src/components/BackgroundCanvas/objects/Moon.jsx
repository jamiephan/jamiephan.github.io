import { Sphere } from "@react-three/drei";
import { useLoader } from "@react-three/fiber";
import { useControls } from "leva";
import { TextureLoader } from "three";

export default function Moon() {
  // Render the Moon

  const [texture] = useLoader(TextureLoader, [
    "/assets/textures/moon.jpg",
    // "/assets/textures/earth-normal-map.jpg",
  ]);

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
          // color="White"
          map={texture}
        />
      </Sphere>
    </>
  );
}
