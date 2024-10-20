import { Sphere } from "@react-three/drei";
import { useControls } from "leva";

export default function Earth() {
  // Render the Earth

  const earthConfig = useControls({
    "object.earth.enabled": true,
    "object.earth.position": [0, 0, 0],
    "object.earth.scale": [1.5, 1.5, 1.5],
  });

  return (
    <>
      <Sphere
        args={[1, 64, 64]}
        position={earthConfig["object.earth.position"]}
        scale={earthConfig["object.earth.scale"]}
        receiveShadow
        castShadow
      >
        <meshStandardMaterial color="blue" />
      </Sphere>
    </>
  );
}
