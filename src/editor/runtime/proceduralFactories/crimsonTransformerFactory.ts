import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

type V3 = [number, number, number];
type Pose = { p: V3; r?: V3; s?: V3 };
type Part = {
  group: THREE.Group;
  carPosition: THREE.Vector3;
  robotPosition: THREE.Vector3;
  carQuaternion: THREE.Quaternion;
  robotQuaternion: THREE.Quaternion;
  carScale: THREE.Vector3;
  robotScale: THREE.Vector3;
};

export type CrimsonTransformerRuntime = {
  root: THREE.Group;
  wheelSpinners: THREE.Group[];
  setMorph: (progress: number) => void;
};

function quaternion(rotation: V3 = [0, 0, 0]) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
}

function roundedBox(width: number, height: number, depth: number, radius = 0.06, segments = 3) {
  return new RoundedBoxGeometry(
    width,
    height,
    depth,
    segments,
    Math.min(radius, width / 2, height / 2, depth / 2)
  );
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material) {
  const value = new THREE.Mesh(geometry, material);
  value.castShadow = true;
  value.receiveShadow = true;
  return value;
}

function panel(
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
  edge: THREE.Material
) {
  const group = new THREE.Group();
  group.add(mesh(roundedBox(width, height, depth, 0.07, 4), material));
  const seam = mesh(roundedBox(width * 0.86, height + 0.012, depth + 0.018, 0.035, 3), edge);
  seam.scale.set(1.02, 0.18, 1.02);
  group.add(seam);
  return group;
}

function createWheel(tire: THREE.Material, rim: THREE.Material, gold: THREE.Material) {
  const spinner = new THREE.Group();
  const tireMesh = mesh(new THREE.TorusGeometry(0.43, 0.15, 12, 36), tire);
  tireMesh.rotation.y = Math.PI / 2;
  spinner.add(tireMesh);
  const barrel = mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.18, 32), rim);
  barrel.rotation.z = Math.PI / 2;
  spinner.add(barrel);
  for (let index = 0; index < 5; index += 1) {
    const spoke = mesh(roundedBox(0.06, 0.07, 0.48, 0.018, 2), rim);
    spoke.rotation.x = (index * Math.PI * 2) / 5;
    spinner.add(spoke);
  }
  const hub = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.205, 20), gold);
  hub.rotation.z = Math.PI / 2;
  spinner.add(hub);
  return spinner;
}

function robotSegment(
  length: number,
  width: number,
  depth: number,
  black: THREE.Material,
  red: THREE.Material,
  gold: THREE.Material
) {
  const group = new THREE.Group();
  group.add(mesh(roundedBox(width, length, depth, 0.07, 3), black));
  const armor = mesh(roundedBox(width * 1.16, length * 0.55, depth * 1.13, 0.06, 3), red);
  armor.position.y = length * 0.1;
  group.add(armor);
  const joint = mesh(new THREE.CylinderGeometry(width * 0.26, width * 0.26, depth * 1.18, 16), gold);
  joint.rotation.x = Math.PI / 2;
  joint.position.y = -length * 0.48;
  group.add(joint);
  return group;
}

export function createCrimsonTransformer(paintColor = "#9f2930"): CrimsonTransformerRuntime {
  const root = new THREE.Group();
  root.name = "crimson-transformer-root";
  const parts: Part[] = [];
  const wheelSpinners: THREE.Group[] = [];
  const red = new THREE.MeshPhysicalMaterial({
    color: paintColor,
    metalness: 0.68,
    roughness: 0.26,
    clearcoat: 0.55,
    clearcoatRoughness: 0.22,
  });
  const redBright = new THREE.MeshPhysicalMaterial({
    color: paintColor,
    metalness: 0.62,
    roughness: 0.2,
    clearcoat: 0.72,
    clearcoatRoughness: 0.16,
  });
  redBright.color.offsetHSL(0, 0.08, 0.08);
  const black = new THREE.MeshStandardMaterial({ color: 0x11161b, metalness: 0.72, roughness: 0.36 });
  const blackSoft = new THREE.MeshStandardMaterial({ color: 0x22282e, metalness: 0.48, roughness: 0.46 });
  const gold = new THREE.MeshStandardMaterial({ color: 0x9d733d, metalness: 0.82, roughness: 0.28 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0b1720,
    metalness: 0.2,
    roughness: 0.08,
    transmission: 0.18,
    transparent: true,
    opacity: 0.88,
    clearcoat: 1,
  });
  const tire = new THREE.MeshStandardMaterial({ color: 0x090b0d, roughness: 0.76, metalness: 0.08 });
  const cyan = new THREE.MeshStandardMaterial({
    color: 0x8debf4,
    emissive: 0x24a9bd,
    emissiveIntensity: 2.1,
    roughness: 0.2,
  });

  function add(name: string, visual: THREE.Object3D, car: Pose, robot: Pose) {
    const group = new THREE.Group();
    group.name = name;
    group.add(visual);
    root.add(group);
    parts.push({
      group,
      carPosition: new THREE.Vector3(...car.p),
      robotPosition: new THREE.Vector3(...robot.p),
      carQuaternion: quaternion(car.r),
      robotQuaternion: quaternion(robot.r),
      carScale: new THREE.Vector3(...(car.s ?? [1, 1, 1])),
      robotScale: new THREE.Vector3(...(robot.s ?? [1, 1, 1])),
    });
    return group;
  }

  const folded: Pose = { p: [0, 0.62, 0.2], r: [0, 0, 0], s: [0.001, 0.001, 0.001] };

  add("central-chassis", panel(1.75, 0.32, 4.25, blackSoft, black), { p: [0, 0.48, 0.05] }, { p: [0, 3.25, 0.48], r: [Math.PI / 2, 0, 0], s: [0.7, 0.7, 0.7] });
  add("hood-left", panel(0.91, 0.18, 1.95, redBright, black), { p: [-0.48, 0.91, -1.42], r: [-0.045, 0, 0] }, { p: [-0.39, 3.76, -0.43], r: [Math.PI / 2, -0.08, -0.08], s: [0.74, 0.74, 0.74] });
  add("hood-right", panel(0.91, 0.18, 1.95, redBright, black), { p: [0.48, 0.91, -1.42], r: [-0.045, 0, 0] }, { p: [0.39, 3.76, -0.43], r: [Math.PI / 2, 0.08, 0.08], s: [0.74, 0.74, 0.74] });
  add("front-splitter", panel(2.25, 0.16, 0.58, black, red), { p: [0, 0.28, -2.42] }, { p: [0, 2.75, 0.18], r: [Math.PI / 2, 0, 0], s: [0.66, 0.66, 0.66] });
  add("door-left", panel(0.15, 0.76, 1.68, redBright, black), { p: [-1.08, 0.92, 0.12], r: [0, 0, -0.05] }, { p: [-1.82, 4.22, 0.04], r: [0, -0.1, -0.2], s: [1.08, 1.08, 1.08] });
  add("door-right", panel(0.15, 0.76, 1.68, redBright, black), { p: [1.08, 0.92, 0.12], r: [0, 0, 0.05] }, { p: [1.82, 4.22, 0.04], r: [0, 0.1, 0.2], s: [1.08, 1.08, 1.08] });
  add("rear-quarter-left", panel(0.54, 0.64, 1.58, red, black), { p: [-0.88, 0.8, 1.48], r: [0, 0, -0.08] }, { p: [-0.62, 2.62, 0.04], r: [0, 0, -0.05], s: [0.9, 0.9, 0.9] });
  add("rear-quarter-right", panel(0.54, 0.64, 1.58, red, black), { p: [0.88, 0.8, 1.48], r: [0, 0, 0.08] }, { p: [0.62, 2.62, 0.04], r: [0, 0, 0.05], s: [0.9, 0.9, 0.9] });

  const canopy = new THREE.Group();
  const glassTop = mesh(roundedBox(1.55, 0.48, 1.55, 0.16, 6), glass);
  glassTop.rotation.x = -0.08;
  canopy.add(glassTop);
  const roof = mesh(roundedBox(1.68, 0.12, 1.26, 0.08, 4), red);
  roof.position.set(0, 0.24, 0.12);
  canopy.add(roof);
  add("canopy-backpack", canopy, { p: [0, 1.24, 0.05] }, { p: [0, 3.9, 0.66], r: [Math.PI / 2, 0, 0], s: [0.8, 0.8, 0.8] });
  add("rear-deck", panel(1.88, 0.2, 1.28, red, black), { p: [0, 1, 1.66], r: [0.04, 0, 0] }, { p: [0, 3.45, 0.65], r: [Math.PI / 2, 0, 0], s: [0.78, 0.78, 0.78] });

  const wheelData: Array<[string, V3, V3]> = [
    ["front-left-wheel", [-1.17, 0.52, -1.64], [-1.35, 4.45, 0.42]],
    ["front-right-wheel", [1.17, 0.52, -1.64], [1.35, 4.45, 0.42]],
    ["rear-left-wheel", [-1.17, 0.52, 1.62], [-0.82, 1.42, 0.02]],
    ["rear-right-wheel", [1.17, 0.52, 1.62], [0.82, 1.42, 0.02]],
  ];
  wheelData.forEach(([name, carPosition, robotPosition], index) => {
    const spinner = createWheel(tire, black, gold);
    wheelSpinners.push(spinner);
    add(name, spinner, { p: carPosition }, { p: robotPosition, r: [0, index % 2 ? -0.16 : 0.16, 0], s: [0.92, 0.92, 0.92] });
  });

  const headlights = new THREE.Group();
  [-0.53, 0.53].forEach((x) => {
    const lamp = mesh(roundedBox(0.64, 0.09, 0.08, 0.03, 3), cyan);
    lamp.position.x = x;
    headlights.add(lamp);
  });
  add("headlight-bar", headlights, { p: [0, 0.72, -2.46] }, { p: [0, 3.9, -0.63], s: [0.9, 0.9, 0.9] });

  const torso = new THREE.Group();
  torso.add(mesh(roundedBox(1.12, 1.35, 0.7, 0.12, 4), black));
  const reactor = mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.09, 24), cyan);
  reactor.rotation.x = Math.PI / 2;
  reactor.position.set(0, -0.18, -0.39);
  torso.add(reactor);
  add("robot-torso", torso, folded, { p: [0, 3.55, 0] });

  const head = new THREE.Group();
  head.add(mesh(roundedBox(0.58, 0.52, 0.52, 0.1, 4), red));
  const face = mesh(roundedBox(0.43, 0.22, 0.08, 0.035, 3), black);
  face.position.set(0, -0.03, -0.29);
  head.add(face);
  const visor = mesh(roundedBox(0.38, 0.06, 0.035, 0.018, 2), cyan);
  visor.position.set(0, 0.08, -0.34);
  head.add(visor);
  const crest = mesh(new THREE.ConeGeometry(0.09, 0.34, 4), redBright);
  crest.position.y = 0.38;
  head.add(crest);
  add("robot-head", head, folded, { p: [0, 4.92, 0] });

  const pelvis = new THREE.Group();
  pelvis.add(mesh(roundedBox(1.18, 0.58, 0.65, 0.09, 4), black));
  const pelvisArmor = mesh(roundedBox(0.72, 0.42, 0.72, 0.07, 3), red);
  pelvisArmor.position.z = -0.16;
  pelvis.add(pelvisArmor);
  add("robot-pelvis", pelvis, folded, { p: [0, 2.66, 0] });

  [-1, 1].forEach((sign) => {
    add(`upper-arm-${sign}`, robotSegment(0.88, 0.38, 0.42, black, red, gold), folded, { p: [sign * 1.18, 3.58, 0], r: [0, 0, sign * 0.12] });
    add(`forearm-${sign}`, robotSegment(0.82, 0.42, 0.46, black, redBright, gold), folded, { p: [sign * 1.28, 2.75, 0], r: [0, 0, sign * 0.05] });
    const hand = new THREE.Group();
    hand.add(mesh(roundedBox(0.34, 0.3, 0.38, 0.07, 3), black));
    for (let index = 0; index < 3; index += 1) {
      const finger = mesh(roundedBox(0.07, 0.28, 0.07, 0.025, 2), blackSoft);
      finger.position.set((index - 1) * 0.09, -0.25, -0.06);
      hand.add(finger);
    }
    add(`hand-${sign}`, hand, folded, { p: [sign * 1.31, 2.15, -0.02], r: [0, 0, sign * 0.03] });
    add(`thigh-${sign}`, robotSegment(0.95, 0.5, 0.58, black, red, gold), folded, { p: [sign * 0.57, 2.05, 0], r: [0, 0, sign * 0.03] });
    add(`shin-${sign}`, robotSegment(1.05, 0.54, 0.62, black, redBright, gold), folded, { p: [sign * 0.65, 1.05, 0], r: [0, 0, sign * 0.02] });
    const foot = new THREE.Group();
    foot.add(mesh(roundedBox(0.64, 0.35, 1, 0.08, 4), black));
    const toe = mesh(roundedBox(0.7, 0.24, 0.48, 0.07, 3), red);
    toe.position.set(0, 0.08, -0.42);
    foot.add(toe);
    add(`foot-${sign}`, foot, folded, { p: [sign * 0.66, 0.28, -0.18] });
  });

  [[-1.05, 3.98, 0], [1.05, 3.98, 0], [-0.55, 2.55, 0], [0.55, 2.55, 0]].forEach((position, index) => {
    const joint = mesh(new THREE.SphereGeometry(0.13, 18, 12), gold);
    add(`joint-${index}`, joint, folded, { p: position as V3 });
  });

  function setMorph(progress: number) {
    const value = THREE.MathUtils.clamp(progress, 0, 1);
    parts.forEach((part) => {
      part.group.position.lerpVectors(part.carPosition, part.robotPosition, value);
      part.group.quaternion.slerpQuaternions(part.carQuaternion, part.robotQuaternion, value);
      part.group.scale.lerpVectors(part.carScale, part.robotScale, value);
    });
  }

  setMorph(0);
  root.userData.sculptRuntime = {
    factoryId: "crimson-transformer",
    nodes: Object.fromEntries(parts.map((part) => [part.group.name, part.group])),
    wheelSpinners,
    modes: ["vehicle", "robot"],
  };
  return { root, wheelSpinners, setMorph };
}
