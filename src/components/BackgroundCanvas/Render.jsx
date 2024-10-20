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

  const moonEarthGroupRef = useRef(null);

  const config = useControls({
    // Light Config
    "light.ambient.enabled": true,
    "light.ambient.intensity": 0.35,

    "light.spot.enabled": true,
    "light.spot.position": [3, 2, 6],
    "light.spot.angle": 0.15,
    "light.spot.penumbra": 0.6,
    "light.spot.intensity": 1,

    "light.point.enabled": true,
    "light.point.position": [3.5, 1, 5],
    "light.point.intensity": 0.73,

    // Stars Config
    "object.star.enabled": true,
    "object.star.count": 1500,
    "object.star.radius": 100,
    "object.star.depth": 50,
    "object.star.fade": true,

    // Rotational Config
    "rotate.moonSpeed": 0.005,

    // Debug Config
    "debug.enabled": true,
    "debug.orbitControls": true,
    "debug.orbitControlsReset": button(
      () => orbitControlsRef?.current?.reset(),
      {
        disabled: !!orbitControlsRef?.current,
      }
    ),
    "debug.axesHelper": true,
    "debug.polarGridHelper": false,
    "debug.gridHelper": false,
    "debug.arrowHelper": true,
  });

  useFrame(() => {
    moonEarthGroupRef.current.rotation.y += config["rotate.moonSpeed"];
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
      {/* Stars */}
      {config["object.star.enabled"] && (
        <Stars
          radius={config["object.star.radius"]}
          depth={config["object.star.depth"]}
          count={config["object.star.count"]}
          fade={config["object.star.fade"]}
        />
      )}
      {/* Earth & Moon */}
      <group ref={moonEarthGroupRef}>
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
