import { useRef } from "react";
import { Sphere } from "@react-three/drei";
import { useFrame, useLoader } from "@react-three/fiber";
import { useControls } from "leva";
import { TextureLoader } from "three";

export default function Earth() {
  const earthRef = useRef(null);
  // Render the Earth
  const [texture, normalMap] = useLoader(TextureLoader, [
    "/assets/textures/earth.jpg",
    "/assets/textures/earth-normal-map.jpg",
  ]);

  const earthConfig = useControls({
    "earth.enabled": true,
    "earth.position": [0, 0, 0],
    "earth.scale": [1.5, 1.5, 1.5],
    "earth.rotate.speed.x": 0,
    "earth.rotate.speed.y": -0.001,
  });

  useFrame(() => {
    earthRef.current.rotation.x += earthConfig["earth.rotate.speed.x"];
    earthRef.current.rotation.y += earthConfig["earth.rotate.speed.y"];
  });

  return (
    <>
      <Sphere
        ref={earthRef}
        args={[1, 64, 64]}
        position={earthConfig["earth.position"]}
        scale={earthConfig["earth.scale"]}
        rotation={[0, 0, 0]}
        receiveShadow
        castShadow
      >
        <meshStandardMaterial
          // color="blue"
          normalMap={normalMap}
          map={texture}
        />
      </Sphere>
    </>
  );
}
