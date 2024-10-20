import { OrbitControls, Stars } from "@react-three/drei";
// import { BoxHelper } from "three";
import { Leva, useControls } from "leva";

function Render() {
  const config = useControls(
    {
      // Star Config
      "star.count": 1500,
      "star.radius": 100,
      "star.depth": 50,
      "star.fade": true,

      // Debug Config
      "debug.enabled": true,
      "debug.orbitControls": true,
      "debug.axesHelper": true,
      "debug.polarGridHelper": false,
      "debug.gridHelper": false,
      "debug.arrowHelper": true,
    },
    {
      hidden: true,
    },
    {
      hidden: true,
    }
  );

  return (
    <>
      <pointLight position={[10, 10, 10]} />
      <Stars
        radius={config["star.radius"]}
        depth={config["star.depth"]}
        count={config["star.count"]}
        fade={config["star.fade"]}
      />
      <ambientLight intensity={1} />
      {/* Debug */}
      {config["debug.enabled"] && (
        <>
          {config["debug.orbitControls"] && <OrbitControls />}
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
