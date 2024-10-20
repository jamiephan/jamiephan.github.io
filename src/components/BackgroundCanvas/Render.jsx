import { useRef } from "react";
import { OrbitControls, PerspectiveCamera, Stars } from "@react-three/drei";
// import { BoxHelper } from "three";
import { button, useControls } from "leva";
import Earth from "./objects/Earth";
import Moon from "./objects/Moon";
import { useFrame } from "@react-three/fiber";

function Render() {
  const pointLightRef = useRef(null);
  const orbitControlsRef = useRef(null);

  const groupRef = useRef(null);

  const config = useControls({
    // Light Config
    "light.ambient.enabled": true,
    "light.ambient.intensity": 0.6,

    "light.spot.enabled": true,
    "light.spot.position": [1, 0, 6],
    "light.spot.angle": 0.3,
    "light.spot.penumbra": 1,
    "light.spot.intensity": 2.5,

    "light.point.enabled": true,
    "light.point.position": [3.5, 1, 5],
    "light.point.intensity": 0.9,

    // Stars Config
    "star.enabled": true,
    "star.count": 2500,
    "star.radius": 40,
    "star.depth": 50,
    "star.fade": true,

    // Group Config
    "group.rotate.speed.x": -0.0003,
    "group.rotate.speed.y": 0.0003,

    // Debug Config
    "debug.enabled": true,
    "debug.orbitControls": true,
    "debug.orbitControlsReset": button(() =>
      orbitControlsRef?.current?.reset()
    ),
    "debug.axesHelper": true,
    "debug.polarGridHelper": false,
    "debug.gridHelper": false,
    "debug.arrowHelper": true,
  });

  useFrame(() => {
    groupRef.current.rotation.x += config["group.rotate.speed.x"];
    groupRef.current.rotation.y += config["group.rotate.speed.y"];
  });

  return (
    <>
      <PerspectiveCamera />
      {/* Lights */}
      {config["light.ambient.enabled"] && (
        <ambientLight intensity={config["light.ambient.intensity"]} />
      )}
      {config["light.spot.enabled"] && (
        <spotLight
          position={config["light.spot.position"]}
          angle={config["light.spot.angle"]}
          penumbra={config["light.spot.penumbra"]}
          decay={0}
          intensity={config["light.spot.intensity"]}
        />
      )}
      {config["light.point.enabled"] && (
        <pointLight
          position={config["light.point.position"]}
          decay={0}
          intensity={config["light.point.intensity"]}
          ref={pointLightRef}
          castShadow
        />
      )}
      {/* Earth & Moon */}
      <group ref={groupRef}>
        {/* Stars */}
        {config["star.enabled"] && (
          <Stars
            radius={config["star.radius"]}
            depth={config["star.depth"]}
            count={config["star.count"]}
            fade={config["star.fade"]}
          />
        )}
        <Earth />
        <Moon />
      </group>

      {/* Debug */}
      {config["debug.enabled"] && (
        <>
          {pointLightRef.current && (
            <pointLightHelper args={[pointLightRef.current, 5]} />
          )}
          {config["debug.orbitControls"] && (
            <OrbitControls ref={orbitControlsRef} />
          )}
          {config["debug.axesHelper"] && <axesHelper />}
          {config["debug.polarGridHelper"] && <polarGridHelper />}
          {config["debug.gridHelper"] && <gridHelper />}
          {config["debug.arrowHelper"] && <arrowHelper setColor={"0x0000ff"} />}
        </>
      )}
    </>
  );
}

export default Render;
