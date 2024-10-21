import { useRef } from "react";
import { Sphere, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useControls } from "leva";

export default function Earth() {
  const earthRef = useRef(null);
  // Render the Earth

  const textureProps = useTexture({
    normalMap: "/assets/textures/earth-normal-map.jpg",
    map: "/assets/textures/earth.jpg",
  });

  const earthConfig = useControls({
    "earth.enabled": true,
    "earth.scale": [1.5, 1.5, 1.5],
    "earth.position": [0, 0, 0],
    "earth.rotation": [0, 0, 0],
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
        rotation={earthConfig["earth.rotation"]}
        receiveShadow
        castShadow
        visible={earthConfig["earth.enabled"]}
      >
        <meshStandardMaterial
          {...textureProps}
          // color="blue"
        />
      </Sphere>
    </>
  );
}
