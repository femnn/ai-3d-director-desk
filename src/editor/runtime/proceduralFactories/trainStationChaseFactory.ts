import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

type ExplosionFragment = {
  mesh: THREE.Mesh;
  direction: THREE.Vector3;
  spin: THREE.Vector3;
};

export type TrainStationChaseRuntime = {
  root: THREE.Group;
  train: THREE.Group;
  car: THREE.Group;
  setTime: (elapsedSeconds: number, duration?: number) => void;
};

function smoothstep(value: number) {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function segment(time: number, start: number, end: number) {
  return smoothstep((time - start) / Math.max(0.001, end - start));
}

function roundedBox(width: number, height: number, depth: number, radius = 0.08) {
  return new RoundedBoxGeometry(width, height, depth, 4, Math.min(radius, width / 2, height / 2, depth / 2));
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, name?: string) {
  const value = new THREE.Mesh(geometry, material);
  if (name) value.name = name;
  value.castShadow = true;
  value.receiveShadow = true;
  return value;
}

function addBox(
  parent: THREE.Object3D,
  name: string,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
  radius = 0.08
) {
  const value = mesh(roundedBox(...size, radius), material, name);
  value.position.set(...position);
  parent.add(value);
  return value;
}

function createWheel(material: THREE.Material, hubMaterial: THREE.Material) {
  const group = new THREE.Group();
  const tire = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.22, 24), material);
  tire.rotation.x = Math.PI / 2;
  group.add(tire);
  const hub = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.24, 20), hubMaterial);
  hub.rotation.x = Math.PI / 2;
  group.add(hub);
  return group;
}

function createTrainCar(
  name: string,
  bodyMaterial: THREE.Material,
  stripeMaterial: THREE.Material,
  darkMaterial: THREE.Material,
  glassMaterial: THREE.Material,
  wheelMaterial: THREE.Material,
  wheelHubMaterial: THREE.Material,
  locomotive = false
) {
  const group = new THREE.Group();
  group.name = name;
  const length = locomotive ? 4.8 : 5.4;
  addBox(group, `${name}-body`, [length, 1.45, 2.35], [0, 1.28, 0], bodyMaterial, 0.18);
  addBox(group, `${name}-stripe`, [length + 0.03, 0.18, 2.39], [0, 1.3, 0], stripeMaterial, 0.03);
  addBox(group, `${name}-roof`, [length - 0.25, 0.28, 2.18], [0, 2.13, 0], darkMaterial, 0.14);

  if (locomotive) {
    addBox(group, "locomotive-nose", [1.35, 0.95, 2.24], [2.68, 1.06, 0], bodyMaterial, 0.24);
    const windscreen = addBox(group, "locomotive-windscreen", [0.08, 0.62, 1.55], [2.3, 1.62, 0], glassMaterial, 0.03);
    windscreen.rotation.z = -0.12;
    [-0.62, 0.62].forEach((z) => {
      const lamp = mesh(new THREE.SphereGeometry(0.13, 16, 10), stripeMaterial, "locomotive-headlight");
      lamp.position.set(3.31, 1.03, z);
      group.add(lamp);
    });
  } else {
    for (let index = -2; index <= 2; index += 1) {
      [-1.19, 1.19].forEach((z) => {
        const window = addBox(group, `${name}-window-${index}-${z}`, [0.62, 0.55, 0.05], [index * 0.88, 1.64, z], glassMaterial, 0.08);
        window.rotation.y = z < 0 ? 0 : Math.PI;
      });
    }
  }

  const wheels: THREE.Group[] = [];
  [-1.65, 1.65].forEach((x) => {
    [-1.12, 1.12].forEach((z) => {
      const wheel = createWheel(wheelMaterial, wheelHubMaterial);
      wheel.position.set(x, 0.46, z);
      group.add(wheel);
      wheels.push(wheel);
    });
  });
  group.userData.wheels = wheels;
  return group;
}

function createChaseCar(
  paint: THREE.Material,
  dark: THREE.Material,
  glass: THREE.Material,
  tire: THREE.Material,
  hub: THREE.Material,
  light: THREE.Material
) {
  const group = new THREE.Group();
  group.name = "chase-car";
  addBox(group, "car-chassis", [3.8, 0.58, 1.78], [0, 0.6, 0], paint, 0.2);
  const nose = addBox(group, "car-nose", [1.2, 0.34, 1.72], [2.03, 0.67, 0], paint, 0.22);
  nose.rotation.z = -0.08;
  addBox(group, "car-cabin", [1.65, 0.7, 1.46], [-0.25, 1.08, 0], glass, 0.2);
  addBox(group, "car-roof", [1.32, 0.12, 1.4], [-0.3, 1.48, 0], dark, 0.08);
  addBox(group, "car-splitter", [0.58, 0.12, 1.9], [2.37, 0.33, 0], dark, 0.04);
  [-0.56, 0.56].forEach((z) => {
    const lamp = mesh(new THREE.SphereGeometry(0.11, 14, 10), light);
    lamp.position.set(2.55, 0.75, z);
    group.add(lamp);
  });
  const wheels: THREE.Group[] = [];
  [-1.2, 1.25].forEach((x) => {
    [-0.9, 0.9].forEach((z) => {
      const wheel = createWheel(tire, hub);
      wheel.scale.setScalar(0.78);
      wheel.position.set(x, 0.42, z);
      group.add(wheel);
      wheels.push(wheel);
    });
  });
  group.userData.wheels = wheels;
  return group;
}

export function createTrainStationChase(): TrainStationChaseRuntime {
  const root = new THREE.Group();
  root.name = "train-station-car-chase-root";

  const concrete = new THREE.MeshStandardMaterial({ color: 0x777d82, roughness: 0.9, metalness: 0.04 });
  const concreteEdge = new THREE.MeshStandardMaterial({ color: 0xe1c755, roughness: 0.68, metalness: 0.08 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a5057, roughness: 0.42, metalness: 0.78 });
  const sleeper = new THREE.MeshStandardMaterial({ color: 0x3d3028, roughness: 0.9, metalness: 0.04 });
  const stationGreen = new THREE.MeshStandardMaterial({ color: 0x245149, roughness: 0.46, metalness: 0.45 });
  const stationDark = new THREE.MeshStandardMaterial({ color: 0x162629, roughness: 0.5, metalness: 0.5 });
  const signMaterial = new THREE.MeshStandardMaterial({ color: 0xf2eee1, roughness: 0.65 });
  const trainBody = new THREE.MeshPhysicalMaterial({ color: 0x245d73, metalness: 0.62, roughness: 0.27, clearcoat: 0.42 });
  const trainStripe = new THREE.MeshStandardMaterial({ color: 0xf0b43c, emissive: 0x4c2c08, emissiveIntensity: 0.45, roughness: 0.34, metalness: 0.42 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x12181c, roughness: 0.38, metalness: 0.7 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x183d51, roughness: 0.08, metalness: 0.18, transparent: true, opacity: 0.83, clearcoat: 0.9 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x090b0d, roughness: 0.86 });
  const hub = new THREE.MeshStandardMaterial({ color: 0xa2a8ad, roughness: 0.25, metalness: 0.85 });
  const carPaint = new THREE.MeshPhysicalMaterial({ color: 0xc52d34, roughness: 0.2, metalness: 0.64, clearcoat: 0.78, clearcoatRoughness: 0.14 });
  const headlight = new THREE.MeshStandardMaterial({ color: 0xe8fbff, emissive: 0xb9f6ff, emissiveIntensity: 2.4 });
  const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x262b2f, roughness: 0.94 });

  const station = new THREE.Group();
  station.name = "station";
  root.add(station);
  addBox(station, "near-platform", [24, 0.45, 2.4], [-1, 0.2, 3.25], concrete, 0.06);
  addBox(station, "far-platform", [24, 0.45, 2.4], [-1, 0.2, -3.25], concrete, 0.06);
  addBox(station, "near-safety-line", [24, 0.06, 0.2], [-1, 0.46, 2.12], concreteEdge, 0.02);
  addBox(station, "far-safety-line", [24, 0.06, 0.2], [-1, 0.46, -2.12], concreteEdge, 0.02);
  addBox(station, "near-road", [32, 0.08, 3.2], [1, 0.02, 5.95], roadMaterial, 0.02);
  addBox(station, "far-road", [32, 0.08, 3.2], [1, 0.02, -5.95], roadMaterial, 0.02);

  [-0.86, 0.86].forEach((z) => {
    addBox(station, `rail-${z}`, [34, 0.13, 0.1], [1, 0.16, z], steel, 0.025);
  });
  for (let index = -16; index <= 16; index += 1) {
    addBox(station, `sleeper-${index}`, [0.14, 0.08, 2.3], [index, 0.07, 0], sleeper, 0.02);
  }

  [-8, -3, 2, 7].forEach((x) => {
    [-3.9, 3.9].forEach((z) => {
      addBox(station, `canopy-column-${x}-${z}`, [0.16, 3.1, 0.16], [x, 1.75, z], stationDark, 0.03);
    });
  });
  addBox(station, "far-canopy", [20, 0.22, 2.6], [-1, 3.32, -3.9], stationGreen, 0.1);
  addBox(station, "near-canopy", [20, 0.22, 2.6], [-1, 3.32, 3.9], stationGreen, 0.1);
  addBox(station, "station-sign", [3.2, 0.72, 0.12], [-4.5, 2.35, -2.02], signMaterial, 0.06);
  const signStripe = addBox(station, "station-sign-stripe", [2.6, 0.16, 0.04], [-4.5, 2.35, -1.94], stationGreen, 0.02);
  signStripe.rotation.x = 0;

  const train = new THREE.Group();
  train.name = "express-train";
  root.add(train);
  const trainCars = [
    createTrainCar("locomotive", trainBody, trainStripe, dark, glass, tire, hub, true),
    createTrainCar("passenger-car-1", trainBody, trainStripe, dark, glass, tire, hub),
    createTrainCar("passenger-car-2", trainBody, trainStripe, dark, glass, tire, hub),
    createTrainCar("passenger-car-3", trainBody, trainStripe, dark, glass, tire, hub),
  ];
  trainCars.forEach((carriage, index) => {
    carriage.position.x = -index * 5.8;
    train.add(carriage);
  });

  const car = createChaseCar(carPaint, dark, glass, tire, hub, headlight);
  root.add(car);

  const explosionRoot = new THREE.Group();
  explosionRoot.name = "car-explosion";
  root.add(explosionRoot);
  const fireMaterials = [
    new THREE.MeshStandardMaterial({ color: 0xffe56e, emissive: 0xffc12f, emissiveIntensity: 3, transparent: true }),
    new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff3d00, emissiveIntensity: 2.5, transparent: true }),
    new THREE.MeshStandardMaterial({ color: 0xc72d18, emissive: 0x6d1008, emissiveIntensity: 1.4, transparent: true }),
  ];
  const fireballs = fireMaterials.map((material, index) => {
    const fireball = mesh(new THREE.IcosahedronGeometry(0.55 + index * 0.18, 2), material, `explosion-fire-${index}`);
    fireball.position.set((index - 1) * 0.35, 0.7 + index * 0.25, index % 2 ? 0.3 : -0.25);
    explosionRoot.add(fireball);
    return fireball;
  });
  const smokeMaterial = new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.96, transparent: true, opacity: 0.72 });
  const smokePuffs = Array.from({ length: 8 }, (_, index) => {
    const puff = mesh(new THREE.IcosahedronGeometry(0.42 + (index % 3) * 0.12, 1), smokeMaterial, `explosion-smoke-${index}`);
    puff.position.set(Math.sin(index * 2.1) * 0.55, 0.8 + index * 0.18, Math.cos(index * 1.7) * 0.48);
    explosionRoot.add(puff);
    return puff;
  });
  const fragmentMaterial = new THREE.MeshPhysicalMaterial({ color: 0xb7242d, roughness: 0.28, metalness: 0.72, clearcoat: 0.45 });
  const fragments: ExplosionFragment[] = Array.from({ length: 18 }, (_, index) => {
    const angle = (index / 18) * Math.PI * 2;
    const upward = 0.55 + ((index * 7) % 9) / 10;
    const fragment = mesh(roundedBox(0.18 + (index % 3) * 0.09, 0.12 + (index % 2) * 0.12, 0.25 + (index % 4) * 0.08, 0.025), fragmentMaterial, `car-fragment-${index}`);
    explosionRoot.add(fragment);
    return {
      mesh: fragment,
      direction: new THREE.Vector3(Math.cos(angle) * (0.7 + (index % 4) * 0.14), upward, Math.sin(angle) * (0.7 + ((index + 2) % 4) * 0.14)),
      spin: new THREE.Vector3(1.4 + (index % 3), 1.8 + ((index + 1) % 4), 1.2 + ((index + 2) % 5)),
    };
  });

  const explosionPosition = new THREE.Vector3(11.2, 0.05, -5.75);
  explosionRoot.position.copy(explosionPosition);

  function setTime(elapsedSeconds: number, duration = 15) {
    const safeDuration = Math.max(0.001, duration);
    const timeline = ((elapsedSeconds % safeDuration) + safeDuration) % safeDuration;
    const time = (timeline / safeDuration) * 15;

    const trainProgress = smoothstep(time / 15);
    train.position.set(THREE.MathUtils.lerp(-5.5, 18, trainProgress), 0, 0);
    trainCars.forEach((carriage, carriageIndex) => {
      const wheels = carriage.userData.wheels as THREE.Group[];
      wheels.forEach((wheel) => {
        wheel.rotation.z = -time * (3.8 + carriageIndex * 0.08);
      });
    });

    let carX = -10.5;
    let carY = 0.05;
    let carZ = 5.75;
    let carPitch = 0;
    let carRoll = 0;
    let carYaw = 0;
    if (time >= 2 && time < 7) {
      const chase = segment(time, 2, 7);
      carX = THREE.MathUtils.lerp(-10.5, 4.2, chase);
      carRoll = Math.sin(chase * Math.PI * 5) * 0.025;
    } else if (time >= 7 && time < 10.2) {
      const jump = (time - 7) / 3.2;
      const easedJump = smoothstep(jump);
      carX = THREE.MathUtils.lerp(4.2, 10.2, easedJump);
      carZ = THREE.MathUtils.lerp(5.75, -5.75, easedJump);
      carY = 0.05 + Math.sin(jump * Math.PI) * 5.2;
      carPitch = Math.sin(jump * Math.PI * 2) * 0.12;
      carRoll = Math.sin(jump * Math.PI) * -0.34;
      carYaw = THREE.MathUtils.lerp(0, -0.18, easedJump);
    } else if (time >= 10.2) {
      const landing = segment(time, 10.2, 11.1);
      carX = THREE.MathUtils.lerp(10.2, explosionPosition.x, landing);
      carY = 0.05 + Math.sin((1 - landing) * Math.PI) * 0.24;
      carZ = -5.75;
      carPitch = (1 - landing) * -0.08;
      carYaw = -0.18;
    }
    car.position.set(carX, carY, carZ);
    car.rotation.set(carPitch, carYaw, carRoll);
    const carWheels = car.userData.wheels as THREE.Group[];
    carWheels.forEach((wheel) => {
      wheel.rotation.z = -time * 7.4;
    });

    const explosion = THREE.MathUtils.clamp((time - 11.1) / 2.9, 0, 1);
    car.visible = explosion <= 0.015;
    explosionRoot.visible = explosion > 0;
    fireballs.forEach((fireball, index) => {
      const pulse = 1 + Math.sin(explosion * Math.PI * (2.5 + index)) * 0.13;
      const scale = Math.max(0.001, Math.sin(Math.min(1, explosion * 1.35) * Math.PI) * (2.4 + index * 0.55) * pulse);
      fireball.scale.setScalar(scale);
      fireball.rotation.set(explosion * (1.3 + index), explosion * (1.8 + index), explosion * 0.8);
      (fireball.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 1 - explosion * 0.94);
    });
    smokePuffs.forEach((puff, index) => {
      const delayed = THREE.MathUtils.clamp(explosion * 1.4 - index * 0.035, 0, 1);
      puff.position.y = 0.8 + index * 0.18 + delayed * (2.4 + index * 0.14);
      puff.position.x = Math.sin(index * 2.1) * (0.55 + delayed * 1.3);
      puff.position.z = Math.cos(index * 1.7) * (0.48 + delayed * 1.05);
      puff.scale.setScalar(Math.max(0.001, delayed * (1.2 + index * 0.12)));
    });
    smokeMaterial.opacity = Math.max(0, 0.78 - explosion * 0.38);
    fragments.forEach((fragment, index) => {
      const p = THREE.MathUtils.clamp(explosion * 1.2 - (index % 4) * 0.018, 0, 1);
      fragment.mesh.position.set(
        fragment.direction.x * p * 5.8,
        0.7 + fragment.direction.y * p * 5.4 - p * p * 3.5,
        fragment.direction.z * p * 5.8
      );
      fragment.mesh.rotation.set(fragment.spin.x * p, fragment.spin.y * p, fragment.spin.z * p);
      fragment.mesh.scale.setScalar(p > 0 ? 1 : 0.001);
    });
  }

  setTime(0);
  root.userData.sculptRuntime = {
    factoryId: "train-station-car-chase",
    nodes: { station, train, car, explosion: explosionRoot },
    duration: 15,
  };
  return { root, train, car, setTime };
}
