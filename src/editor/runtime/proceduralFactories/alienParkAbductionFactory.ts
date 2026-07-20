import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

type PersonRig = {
  root: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  leftUpperArm: THREE.Group;
  leftLowerArm: THREE.Group;
  rightUpperArm: THREE.Group;
  rightLowerArm: THREE.Group;
  leftUpperLeg: THREE.Group;
  leftLowerLeg: THREE.Group;
  rightUpperLeg: THREE.Group;
  rightLowerLeg: THREE.Group;
};

export type AlienParkAbductionRuntime = {
  root: THREE.Group;
  visitor: PersonRig;
  abductee: PersonRig;
  ufo: THREE.Group;
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

function createLimb(
  name: string,
  length: number,
  radius: number,
  material: THREE.Material,
  jointMaterial: THREE.Material
) {
  const pivot = new THREE.Group();
  pivot.name = name;
  const body = mesh(new THREE.CapsuleGeometry(radius, Math.max(0.05, length - radius * 2), 6, 12), material);
  body.position.y = -length / 2;
  pivot.add(body);
  const joint = mesh(new THREE.SphereGeometry(radius * 1.06, 14, 10), jointMaterial);
  joint.position.y = -length;
  pivot.add(joint);
  return pivot;
}

function createPerson(
  name: string,
  shirt: THREE.Material,
  trousers: THREE.Material,
  skin: THREE.Material,
  hair: THREE.Material,
  shoes: THREE.Material
): PersonRig {
  const root = new THREE.Group();
  root.name = name;

  const pelvis = mesh(roundedBox(0.58, 0.34, 0.38, 0.12), trousers, `${name}-pelvis`);
  pelvis.position.y = 0.04;
  root.add(pelvis);

  const torso = new THREE.Group();
  torso.name = `${name}-torso`;
  torso.position.y = 0.22;
  root.add(torso);
  const torsoMesh = mesh(roundedBox(0.76, 0.92, 0.42, 0.16), shirt, `${name}-shirt`);
  torsoMesh.position.y = 0.46;
  torso.add(torsoMesh);

  const neck = mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.18, 14), skin, `${name}-neck`);
  neck.position.y = 0.99;
  torso.add(neck);
  const head = new THREE.Group();
  head.name = `${name}-head`;
  head.position.y = 1.2;
  torso.add(head);
  const face = mesh(new THREE.SphereGeometry(0.27, 20, 14), skin, `${name}-face`);
  face.scale.set(0.92, 1.08, 0.94);
  head.add(face);
  const hairCap = mesh(new THREE.SphereGeometry(0.278, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), hair, `${name}-hair`);
  hairCap.position.y = 0.03;
  head.add(hairCap);
  [-0.09, 0.09].forEach((x) => {
    const eye = mesh(new THREE.SphereGeometry(0.025, 10, 8), hair, `${name}-eye`);
    eye.position.set(x, 0.03, 0.25);
    head.add(eye);
  });

  const leftUpperArm = createLimb(`${name}-left-upper-arm`, 0.62, 0.12, shirt, skin);
  const rightUpperArm = createLimb(`${name}-right-upper-arm`, 0.62, 0.12, shirt, skin);
  leftUpperArm.position.set(-0.49, 0.82, 0);
  rightUpperArm.position.set(0.49, 0.82, 0);
  torso.add(leftUpperArm, rightUpperArm);
  const leftLowerArm = createLimb(`${name}-left-lower-arm`, 0.55, 0.1, skin, skin);
  const rightLowerArm = createLimb(`${name}-right-lower-arm`, 0.55, 0.1, skin, skin);
  leftLowerArm.position.y = -0.62;
  rightLowerArm.position.y = -0.62;
  leftUpperArm.add(leftLowerArm);
  rightUpperArm.add(rightLowerArm);

  const leftUpperLeg = createLimb(`${name}-left-upper-leg`, 0.72, 0.15, trousers, trousers);
  const rightUpperLeg = createLimb(`${name}-right-upper-leg`, 0.72, 0.15, trousers, trousers);
  leftUpperLeg.position.set(-0.22, 0, 0);
  rightUpperLeg.position.set(0.22, 0, 0);
  root.add(leftUpperLeg, rightUpperLeg);
  const leftLowerLeg = createLimb(`${name}-left-lower-leg`, 0.72, 0.13, trousers, trousers);
  const rightLowerLeg = createLimb(`${name}-right-lower-leg`, 0.72, 0.13, trousers, trousers);
  leftLowerLeg.position.y = -0.72;
  rightLowerLeg.position.y = -0.72;
  leftUpperLeg.add(leftLowerLeg);
  rightUpperLeg.add(rightLowerLeg);
  [leftLowerLeg, rightLowerLeg].forEach((leg, index) => {
    const shoe = mesh(roundedBox(0.26, 0.16, 0.42, 0.07), shoes, `${name}-shoe-${index}`);
    shoe.position.set(0, -0.78, 0.11);
    leg.add(shoe);
  });

  return {
    root,
    torso,
    head,
    leftUpperArm,
    leftLowerArm,
    rightUpperArm,
    rightLowerArm,
    leftUpperLeg,
    leftLowerLeg,
    rightUpperLeg,
    rightLowerLeg,
  };
}

function setSeatedPose(person: PersonRig) {
  person.leftUpperLeg.rotation.set(-Math.PI / 2, 0, 0);
  person.rightUpperLeg.rotation.set(-Math.PI / 2, 0, 0);
  person.leftLowerLeg.rotation.set(Math.PI / 2, 0, 0);
  person.rightLowerLeg.rotation.set(Math.PI / 2, 0, 0);
  person.leftUpperArm.rotation.set(0.18, 0, 0.08);
  person.rightUpperArm.rotation.set(0.18, 0, -0.08);
  person.leftLowerArm.rotation.set(-0.55, 0, 0);
  person.rightLowerArm.rotation.set(-0.55, 0, 0);
}

function setStandingBlend(person: PersonRig, progress: number) {
  const seatedUpper = -Math.PI / 2;
  const seatedLower = Math.PI / 2;
  person.leftUpperLeg.rotation.x = THREE.MathUtils.lerp(seatedUpper, 0.06, progress);
  person.rightUpperLeg.rotation.x = THREE.MathUtils.lerp(seatedUpper, -0.04, progress);
  person.leftLowerLeg.rotation.x = THREE.MathUtils.lerp(seatedLower, -0.08, progress);
  person.rightLowerLeg.rotation.x = THREE.MathUtils.lerp(seatedLower, 0.06, progress);
}

function createTree(
  x: number,
  z: number,
  scale: number,
  trunkMaterial: THREE.Material,
  leafMaterials: THREE.Material[]
) {
  const tree = new THREE.Group();
  tree.name = `park-tree-${x}-${z}`;
  const trunk = mesh(new THREE.CylinderGeometry(0.22 * scale, 0.32 * scale, 2.5 * scale, 12), trunkMaterial);
  trunk.position.y = 1.25 * scale;
  tree.add(trunk);
  for (let index = 0; index < 5; index += 1) {
    const crown = mesh(new THREE.IcosahedronGeometry((0.72 + (index % 2) * 0.16) * scale, 2), leafMaterials[index % leafMaterials.length]);
    const angle = (index / 5) * Math.PI * 2;
    crown.position.set(Math.cos(angle) * 0.46 * scale, (2.65 + (index % 3) * 0.34) * scale, Math.sin(angle) * 0.42 * scale);
    tree.add(crown);
  }
  tree.position.set(x, 0, z);
  return tree;
}

export function createAlienParkAbduction(): AlienParkAbductionRuntime {
  const root = new THREE.Group();
  root.name = "alien-park-abduction-root";

  const grass = new THREE.MeshStandardMaterial({ color: 0x4e7b43, roughness: 0.96 });
  const path = new THREE.MeshStandardMaterial({ color: 0xb5afa3, roughness: 0.92 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x8b4f2d, roughness: 0.68, metalness: 0.05 });
  const benchMetal = new THREE.MeshStandardMaterial({ color: 0x273239, roughness: 0.38, metalness: 0.72 });
  const trunk = new THREE.MeshStandardMaterial({ color: 0x63452f, roughness: 0.9 });
  const leaves = [
    new THREE.MeshStandardMaterial({ color: 0x356c3d, roughness: 0.86 }),
    new THREE.MeshStandardMaterial({ color: 0x4d8746, roughness: 0.84 }),
    new THREE.MeshStandardMaterial({ color: 0x6d954d, roughness: 0.82 }),
  ];
  const stone = new THREE.MeshStandardMaterial({ color: 0x8d9797, roughness: 0.92 });
  const water = new THREE.MeshPhysicalMaterial({ color: 0x4f9db2, roughness: 0.16, metalness: 0.08, transparent: true, opacity: 0.78, clearcoat: 0.8 });
  const skinA = new THREE.MeshStandardMaterial({ color: 0xd59a73, roughness: 0.76 });
  const skinB = new THREE.MeshStandardMaterial({ color: 0xb97858, roughness: 0.76 });
  const hairA = new THREE.MeshStandardMaterial({ color: 0x2c201b, roughness: 0.9 });
  const hairB = new THREE.MeshStandardMaterial({ color: 0x392a22, roughness: 0.9 });
  const blueShirt = new THREE.MeshStandardMaterial({ color: 0x2f6faa, roughness: 0.58 });
  const coralShirt = new THREE.MeshStandardMaterial({ color: 0xd34c54, roughness: 0.56 });
  const darkTrousers = new THREE.MeshStandardMaterial({ color: 0x26384b, roughness: 0.7 });
  const tanTrousers = new THREE.MeshStandardMaterial({ color: 0x8b745c, roughness: 0.72 });
  const shoeMaterial = new THREE.MeshStandardMaterial({ color: 0x171b20, roughness: 0.72 });

  addBox(root, "park-ground", [28, 0.16, 22], [0, -0.1, 0], grass, 0.04);
  addBox(root, "park-path", [18, 0.07, 4.2], [0, 0.02, 1.6], path, 0.05);
  const pond = mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.08, 48), water, "park-pond");
  pond.position.set(7.2, 0.02, -5.2);
  root.add(pond);
  for (let index = 0; index < 14; index += 1) {
    const angle = (index / 14) * Math.PI * 2;
    const rock = mesh(new THREE.DodecahedronGeometry(0.26 + (index % 3) * 0.08, 0), stone, `pond-rock-${index}`);
    rock.position.set(7.2 + Math.cos(angle) * 3.45, 0.16, -5.2 + Math.sin(angle) * 3.45);
    rock.scale.y = 0.65;
    root.add(rock);
  }
  [[-8, -5, 1.15], [-5.5, -6.8, 0.95], [-3.8, 7.2, 1.08], [9, -0.5, 1.2], [-10, 5.5, 1.05]].forEach(([x, z, scale]) => {
    root.add(createTree(x, z, scale, trunk, leaves));
  });

  const bench = new THREE.Group();
  bench.name = "park-bench";
  bench.position.set(0, 0, 0.2);
  root.add(bench);
  [-0.38, 0, 0.38].forEach((z, index) => {
    addBox(bench, `bench-seat-${index}`, [4.6, 0.16, 0.3], [0, 0.82, z], wood, 0.05);
  });
  [1.18, 1.58, 1.98].forEach((y, index) => {
    const slat = addBox(bench, `bench-back-${index}`, [4.6, 0.18, 0.26], [0, y, -0.56], wood, 0.05);
    slat.rotation.x = -0.06;
  });
  [-1.85, 1.85].forEach((x) => {
    addBox(bench, `bench-leg-${x}`, [0.16, 0.84, 0.16], [x, 0.4, 0], benchMetal, 0.04);
    addBox(bench, `bench-frame-${x}`, [0.18, 1.48, 0.18], [x, 1.25, -0.48], benchMetal, 0.04);
  });

  const lampPole = mesh(new THREE.CylinderGeometry(0.08, 0.12, 4.5, 14), benchMetal, "park-lamp-pole");
  lampPole.position.set(-5.8, 2.25, 2.2);
  root.add(lampPole);
  const lampLightMaterial = new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffd86a, emissiveIntensity: 2.4 });
  const lamp = mesh(new THREE.SphereGeometry(0.3, 18, 12), lampLightMaterial, "park-lamp");
  lamp.position.set(-5.8, 4.45, 2.2);
  root.add(lamp);

  const visitor = createPerson("visitor-blue", blueShirt, darkTrousers, skinA, hairA, shoeMaterial);
  const abductee = createPerson("abductee-coral", coralShirt, tanTrousers, skinB, hairB, shoeMaterial);
  visitor.root.position.set(-0.9, 1.06, 0.2);
  abductee.root.position.set(0.9, 1.06, 0.2);
  setSeatedPose(visitor);
  setSeatedPose(abductee);
  root.add(visitor.root, abductee.root);

  const ufo = new THREE.Group();
  ufo.name = "alien-ufo";
  root.add(ufo);
  const ufoMetal = new THREE.MeshPhysicalMaterial({ color: 0x677781, roughness: 0.22, metalness: 0.86, clearcoat: 0.48 });
  const ufoDark = new THREE.MeshStandardMaterial({ color: 0x172329, roughness: 0.28, metalness: 0.78 });
  const ufoGlow = new THREE.MeshStandardMaterial({ color: 0x8fffe8, emissive: 0x39e8c6, emissiveIntensity: 3.2 });
  const domeMaterial = new THREE.MeshPhysicalMaterial({ color: 0x80c8d5, roughness: 0.06, metalness: 0.08, transparent: true, opacity: 0.65, transmission: 0.22, clearcoat: 1 });
  const saucer = mesh(new THREE.CylinderGeometry(2.25, 2.9, 0.5, 48), ufoMetal, "ufo-saucer");
  ufo.add(saucer);
  const lowerRing = mesh(new THREE.TorusGeometry(2.25, 0.16, 12, 48), ufoDark, "ufo-lower-ring");
  lowerRing.rotation.x = Math.PI / 2;
  lowerRing.position.y = -0.18;
  ufo.add(lowerRing);
  const glowRing = mesh(new THREE.TorusGeometry(1.72, 0.1, 10, 48), ufoGlow, "ufo-glow-ring");
  glowRing.rotation.x = Math.PI / 2;
  glowRing.position.y = -0.32;
  ufo.add(glowRing);
  const dome = mesh(new THREE.SphereGeometry(1.25, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2), domeMaterial, "ufo-dome");
  dome.position.y = 0.25;
  ufo.add(dome);
  const ufoLights: THREE.Mesh[] = [];
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    const light = mesh(new THREE.SphereGeometry(0.11, 12, 8), ufoGlow, `ufo-light-${index}`);
    light.position.set(Math.cos(angle) * 2.3, -0.28, Math.sin(angle) * 2.3);
    ufo.add(light);
    ufoLights.push(light);
  }
  const beamMaterial = new THREE.MeshBasicMaterial({ color: 0x8ffff0, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const beam = mesh(new THREE.ConeGeometry(1.55, 6, 40, 1, true), beamMaterial, "ufo-abduction-beam");
  beam.position.y = -3.15;
  ufo.add(beam);
  const beamCoreMaterial = new THREE.MeshBasicMaterial({ color: 0xc4fff5, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending });
  const beamCore = mesh(new THREE.CylinderGeometry(0.34, 0.78, 5.8, 28, 1, true), beamCoreMaterial, "ufo-beam-core");
  beamCore.position.y = -3.05;
  ufo.add(beamCore);

  function setTime(elapsedSeconds: number, duration = 15) {
    const safeDuration = Math.max(0.001, duration);
    const timeline = ((elapsedSeconds % safeDuration) + safeDuration) % safeDuration;
    const time = (timeline / safeDuration) * 15;
    const chat = Math.min(time, 7);

    visitor.root.visible = true;
    abductee.root.visible = true;
    visitor.root.position.set(-0.9, 1.06, 0.2);
    abductee.root.position.set(0.9, 1.06, 0.2);
    visitor.root.rotation.set(0, 0, 0);
    abductee.root.rotation.set(0, 0, 0);
    visitor.torso.rotation.set(0, 0, Math.sin(chat * 1.2) * 0.025);
    abductee.torso.rotation.set(0, 0, -Math.sin(chat * 1.15) * 0.028);
    visitor.head.rotation.set(0, -0.22 + Math.sin(chat * 1.6) * 0.08, 0);
    abductee.head.rotation.set(0, 0.24 + Math.sin(chat * 1.45 + 1) * 0.07, 0);
    setSeatedPose(visitor);
    setSeatedPose(abductee);

    visitor.rightUpperArm.rotation.x = 0.25 + Math.sin(chat * 2.2) * 0.42;
    visitor.rightUpperArm.rotation.z = -0.32 + Math.sin(chat * 1.1) * 0.16;
    visitor.rightLowerArm.rotation.x = -0.9 + Math.sin(chat * 2.2 + 0.7) * 0.3;
    visitor.leftUpperArm.rotation.x = 0.18 + Math.sin(chat * 1.5) * 0.12;
    abductee.leftUpperArm.rotation.x = 0.3 + Math.sin(chat * 2 + 1.1) * 0.38;
    abductee.leftUpperArm.rotation.z = 0.34 + Math.sin(chat * 1.2) * 0.15;
    abductee.leftLowerArm.rotation.x = -0.88 + Math.sin(chat * 2 + 1.8) * 0.28;

    const ufoArrival = segment(time, 5.4, 8.2);
    const ufoExit = segment(time, 12.1, 15);
    ufo.visible = time >= 5.15;
    ufo.position.set(
      THREE.MathUtils.lerp(-10, 0.9, ufoArrival),
      THREE.MathUtils.lerp(7.8, 6.1, ufoArrival),
      THREE.MathUtils.lerp(-7.5, 0.15, ufoArrival)
    );
    if (time >= 12.1) {
      ufo.position.set(
        THREE.MathUtils.lerp(0.9, 12.5, ufoExit),
        THREE.MathUtils.lerp(6.1, 10.5, ufoExit),
        THREE.MathUtils.lerp(0.15, -7.5, ufoExit)
      );
    }
    ufo.rotation.set(Math.sin(time * 1.2) * 0.035, time * 0.32, Math.cos(time) * 0.035);
    glowRing.rotation.z = time * 1.9;
    ufoLights.forEach((light, index) => {
      light.scale.setScalar(0.72 + Math.sin(time * 5 + index * 0.8) * 0.28);
    });

    const beamOn = segment(time, 7.7, 8.35) * (1 - segment(time, 12.05, 12.6));
    beam.visible = beamOn > 0.01;
    beamCore.visible = beam.visible;
    beamMaterial.opacity = 0.08 + beamOn * (0.18 + Math.sin(time * 7) * 0.04);
    beamCoreMaterial.opacity = 0.06 + beamOn * 0.16;
    beam.scale.set(0.8 + Math.sin(time * 4) * 0.04, 1, 0.8 + Math.sin(time * 4) * 0.04);

    const lift = segment(time, 8.15, 11.8);
    if (lift > 0) {
      abductee.root.position.set(
        THREE.MathUtils.lerp(0.9, ufo.position.x, lift),
        THREE.MathUtils.lerp(1.06, ufo.position.y - 1.55, lift),
        THREE.MathUtils.lerp(0.2, ufo.position.z, lift)
      );
      abductee.root.rotation.set(Math.sin(time * 2.5) * 0.16 * lift, Math.sin(time * 1.3) * 0.3 * lift, Math.cos(time * 2.1) * 0.22 * lift);
      abductee.leftUpperArm.rotation.set(0.45 + Math.sin(time * 3) * 0.7, 0, 0.45 + Math.sin(time * 2.2) * 0.25);
      abductee.rightUpperArm.rotation.set(-0.25 + Math.sin(time * 2.7 + 1) * 0.72, 0, -0.42 + Math.cos(time * 2.1) * 0.26);
      abductee.leftLowerArm.rotation.x = -0.45 + Math.sin(time * 3.6) * 0.5;
      abductee.rightLowerArm.rotation.x = -0.5 + Math.cos(time * 3.4) * 0.48;
      abductee.leftUpperLeg.rotation.x = -0.25 + Math.sin(time * 2.5) * 0.42;
      abductee.rightUpperLeg.rotation.x = 0.15 + Math.cos(time * 2.7) * 0.46;
      abductee.leftLowerLeg.rotation.x = 0.35 + Math.sin(time * 3.1) * 0.4;
      abductee.rightLowerLeg.rotation.x = 0.4 + Math.cos(time * 3.3) * 0.38;
    }
    if (time >= 12.1) {
      abductee.root.position.set(ufo.position.x, ufo.position.y - 1.45, ufo.position.z);
      abductee.root.scale.setScalar(Math.max(0.001, 1 - ufoExit * 1.25));
      abductee.root.visible = ufoExit < 0.8;
    } else {
      abductee.root.scale.setScalar(1);
    }

    const visitorStand = segment(time, 8.25, 9.35);
    setStandingBlend(visitor, visitorStand);
    visitor.root.position.set(
      THREE.MathUtils.lerp(-0.9, -1.9, visitorStand),
      THREE.MathUtils.lerp(1.06, 1.52, visitorStand),
      THREE.MathUtils.lerp(0.2, 0.75, visitorStand)
    );
    visitor.root.rotation.y = THREE.MathUtils.lerp(0, -0.12, visitorStand);
    visitor.torso.rotation.x = THREE.MathUtils.lerp(0, -0.12, visitorStand);
    visitor.head.rotation.set(THREE.MathUtils.lerp(0, -0.72, visitorStand), THREE.MathUtils.lerp(-0.22, -0.42, visitorStand), 0.12 * visitorStand);
    visitor.leftUpperArm.rotation.set(THREE.MathUtils.lerp(0.18, 2.25, visitorStand), 0, THREE.MathUtils.lerp(0.08, 0.5, visitorStand));
    visitor.rightUpperArm.rotation.set(THREE.MathUtils.lerp(0.25, 2.45, visitorStand), 0, THREE.MathUtils.lerp(-0.32, -0.55, visitorStand));
    visitor.leftLowerArm.rotation.x = THREE.MathUtils.lerp(-0.55, -0.28, visitorStand);
    visitor.rightLowerArm.rotation.x = THREE.MathUtils.lerp(-0.9, -0.35, visitorStand);
  }

  setTime(0);
  root.userData.sculptRuntime = {
    factoryId: "alien-park-abduction",
    nodes: { bench, visitor: visitor.root, abductee: abductee.root, ufo, beam },
    duration: 15,
  };
  return { root, visitor, abductee, ufo, setTime };
}
