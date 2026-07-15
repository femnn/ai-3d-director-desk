export function StudioSceneLights() {
  return (
    <>
      <ambientLight intensity={0.9} />
      <hemisphereLight color="#f5f8ff" groundColor="#28303a" intensity={1.35} />
      <directionalLight color="#fff0d8" intensity={2.15} position={[7, 10, 8]} />
      <directionalLight color="#b9d7ff" intensity={1.05} position={[-8, 5, 5]} />
      <directionalLight color="#d7e7ff" intensity={1.2} position={[2, 6, -9]} />
    </>
  );
}
