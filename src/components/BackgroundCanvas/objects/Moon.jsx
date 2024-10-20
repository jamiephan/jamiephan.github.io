import { Sphere } from "@react-three/drei";
import { useControls } from "leva";

export default function Moon() {
  // Render the Moon

  const moonConfig = useControls({
    "object.moon.enabled": true,
    "object.moon.position": [2, 0.8, 2.8],
    "object.moon.scale": [0.15, 0.15, 0.15],
  });

  return (
    <>
      <Sphere
        args={[1, 32, 32]}
        position={moonConfig["object.moon.position"]}
        scale={moonConfig["object.moon.scale"]}
        receiveShadow
        castShadow
      >
        <meshStandardMaterial color="White" />
      </Sphere>
    </>
  );
}
