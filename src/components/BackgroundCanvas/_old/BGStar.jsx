import * as THREE from "three";

export default function BGStar() {
  const randomPosition = Array(3)
    .fill()
    .map(() => THREE.MathUtils.randFloatSpread(70));

  console.log(randomPosition);
  return (
    <mesh position={randomPosition}>
      <sphereGeometry args={[0.05, 24, 24]} />
      <meshStandardMaterial color={Math.random() * 0xffffff} />
    </mesh>
  );
}
