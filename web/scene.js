import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * Procedural, deliberately unscaled NPO engineering study.
 * Every solid belongs to a semantic part; no downloaded models or textures.
 */
export function createScene(container, { onSelect, onEnter, onHover } = {}) {
  const state = {
    selectedId: null, viewId: 'npo', config: { rate: 3.2, laneRate: 200, lanes: 16, laser: 'external' },
    quantities: {}, nodes: {}, explode: 0.18,
  };
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f3f5f7');
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 250);
  camera.position.set(11, 9, 12);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'npo-three-canvas';
  Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });
  container.appendChild(renderer.domElement);
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const overlay = document.createElement('div');
  overlay.className = 'scene-label-layer';
  Object.assign(overlay.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none' });
  container.appendChild(overlay);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const studio = new RoomEnvironment();
  const environmentTarget = pmrem.fromScene(studio, 0.05);
  scene.environment = environmentTarget.texture;
  studio.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xe9f5ff, 0xaeb3bb, 2.2));
  const key = new THREE.DirectionalLight(0xfff9ee, 4.2);
  key.position.set(-6, 14, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 0.1, far: 50 });
  key.shadow.normalBias = 0.035;
  key.shadow.bias = -0.0001;
  key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xb5d8ff, 1.7);
  fill.position.set(8, 7, -7);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 1.3);
  rim.position.set(3, 4, 10);
  scene.add(rim);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.ShadowMaterial({ color: 0x778899, opacity: 0.16 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.045;
  floor.receiveShadow = true;
  scene.add(floor);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minPolarAngle = Math.PI * 0.05;
  controls.minDistance = 1.4;
  controls.maxDistance = 70;
  controls.target.set(0, 0.6, 0);
  controls.update();

  const palette = {
    silver: material('#b8c4ce', 0.88, 0.27), darkSilver: material('#718494', 0.82, 0.33),
    paleMetal: material('#d9e0e5', 0.74, 0.24), gold: material('#c9983c', 0.86, 0.26),
    copper: material('#b57745', 0.78, 0.28), dark: material('#152633', 0.5, 0.42),
    pcb: material('#235965', 0.52, 0.55), pcbDark: material('#153d4b', 0.43, 0.55),
    silicon: material('#263852', 0.72, 0.22), blue: material('#3389bd', 0.65, 0.3),
    cyan: material('#41bfce', 0.35, 0.25), purple: material('#805898', 0.62, 0.25),
    ceramic: material('#e2ddd1', 0.08, 0.65), polymer: material('#e9eeef', 0.12, 0.43),
    maroon: material('#94576b', 0.45, 0.28), grey: material('#b9c1c9', 0.1, 0.7),
    glass: new THREE.MeshPhysicalMaterial({ color: '#b6e9ed', metalness: 0.04, roughness: 0.14, transparent: true, opacity: 0.43, transmission: 0.24, thickness: 0.4, ior: 1.48, depthWrite: false }),
    film: new THREE.MeshPhysicalMaterial({ color: '#7955a4', metalness: 0.16, roughness: 0.2, transparent: true, opacity: 0.77, transmission: 0.06, side: THREE.DoubleSide }),
    resin: new THREE.MeshPhysicalMaterial({ color: '#cfaf69', roughness: 0.15, transparent: true, opacity: 0.55, transmission: 0.15, depthWrite: false }),
  };
  function material(color, metalness = 0.2, roughness = 0.4) {
    return new THREE.MeshStandardMaterial({ color, metalness, roughness });
  }
  let currentRoot = null;
  let roots = [];
  let labels = [];
  let disposed = false;
  let raf = 0;
  let hoveredId = null;
  let cameraTween = null;
  let explodeCurrent = Number(state.explode);
  let pointerDown = null;
  const activePointers = new Set();
  let controlsActive = false;
  let lastTime = performance.now();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const projected = new THREE.Vector3();
  const scratchBox = new THREE.Box3();
  const scratchSize = new THREE.Vector3();
  const scratchCenter = new THREE.Vector3();

  function q(id, fallback = 1, max = 64) {
    const candidate = state.quantities?.[id];
    const n = Number(typeof candidate === 'object' ? candidate?.quantity : candidate);
    return Number.isFinite(n) && n >= 0 ? Math.min(max, Math.round(n)) : fallback;
  }
  function lanes() { return Math.max(1, Math.min(64, Number(state.config?.lanes) || 16)); }
  function signalFibers() { return q('fiber', 2 * lanes(), 128); }
  function group(id, parent, position = [0, 0, 0]) {
    const g = new THREE.Group();
    if (id) g.userData.id = id;
    g.position.set(...position);
    parent?.add(g);
    return g;
  }
  function part(geometry, mat, parent, position = [0, 0, 0], id = null) {
    const m = new THREE.Mesh(geometry, mat.clone());
    m.position.set(...position);
    m.castShadow = true;
    m.receiveShadow = true;
    if (id) m.userData.id = id;
    m.material.userData.baseOpacity = m.material.opacity;
    m.material.userData.baseTransparent = m.material.transparent;
    if (m.material.emissive) m.material.userData.baseEmissive = m.material.emissive.clone();
    parent.add(m);
    return m;
  }
  function box(parent, size, pos, mat, id, bevel = 0) {
    // Fine edge lines create CAD-readable solids without faking precise dimensions.
    const m = part(new THREE.BoxGeometry(...size), mat, parent, pos, id);
    if (bevel) edges(m, '#66818d', 0.18);
    return m;
  }
  function cylinder(parent, radius, length, pos, mat, id, axis = 'y', segments = 48, open = false, thetaLength = Math.PI * 2) {
    const m = part(new THREE.CylinderGeometry(radius, radius, length, segments, 1, open, 0, thetaLength), mat, parent, pos, id);
    if (axis === 'x') m.rotation.z = Math.PI / 2;
    if (axis === 'z') m.rotation.x = Math.PI / 2;
    return m;
  }
  function sphere(parent, radius, pos, mat, id, scale) {
    const m = part(new THREE.SphereGeometry(radius, 24, 16), mat, parent, pos, id);
    if (scale) m.scale.set(...scale);
    return m;
  }
  function torus(parent, radius, tubeRadius, pos, mat, id, axis = 'x') {
    const m = part(new THREE.TorusGeometry(radius, tubeRadius, 10, 56), mat, parent, pos, id);
    if (axis === 'x') m.rotation.y = Math.PI / 2;
    if (axis === 'y') m.rotation.x = Math.PI / 2;
    return m;
  }
  function tube(parent, points, radius, mat, id, segments = 40) {
    const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    return part(new THREE.TubeGeometry(path, segments, radius, 7, false), mat, parent, [0, 0, 0], id);
  }
  function straight(parent, a, b, radius, mat, id) { return tube(parent, [a, b], radius, mat, id, 1); }
  function edges(mesh, color = '#304d61', opacity = 0.35) {
    const line = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
    line.userData.decorative = true;
    line.material.userData.baseOpacity = opacity;
    line.material.userData.baseTransparent = true;
    mesh.add(line);
    return line;
  }
  function movable(g, delta) {
    g.userData.basePosition = g.position.clone();
    g.userData.explodeOffset = new THREE.Vector3(...delta);
    return g;
  }
  function screw(parent, x, z, y = 0.15, r = 0.064) {
    const m = cylinder(parent, r, 0.038, [x, y, z], palette.darkSilver, null, 'y', 20);
    box(m, [r * 1.05, 0.006, r * 0.18], [0, 0.021, 0], palette.dark);
    return m;
  }
  function label(parent, text, pos, id, priority = 2, muted = false) {
    const anchor = new THREE.Object3D();
    anchor.position.set(...pos);
    parent.add(anchor);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `scene-label${muted ? ' scene-label-muted' : ''}`;
    el.textContent = text;
    el.dataset.component = id || '';
    Object.assign(el.style, {
      position: 'absolute', transform: 'translate(-50%, -100%)', whiteSpace: 'nowrap',
      padding: '5px 8px', color: muted ? '#778692' : '#2e4c61', font: '500 10px/1.3 Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
      letterSpacing: '0.03em', background: muted ? 'rgba(247,249,250,.69)' : 'rgba(255,255,255,.88)',
      border: `1px solid ${muted ? 'rgba(156,168,181,.22)' : 'rgba(117,144,162,.28)'}`,
      borderRadius: '4px', boxShadow: '0 2px 8px rgba(49,74,94,.04)',
      pointerEvents: id ? 'auto' : 'none', cursor: id ? 'pointer' : 'default',
      transition: 'color .16s, background .16s',
    });
    if (id) {
      el.addEventListener('click', e => { e.stopPropagation(); activatePart(id); });
      el.addEventListener('mouseenter', e => changeHover(id, e));
      el.addEventListener('mouseleave', () => changeHover(null));
    }
    overlay.appendChild(el);
    labels.push({ anchor, el, id, priority, root: buildingRoot, width: 0, height: 0 });
    return anchor;
  }
  let buildingRoot = null;

  function board(parent, id = 'pcb', size = [7.8, 0.18, 5], pos = [0, 0.1, 0]) {
    const g = group(id, parent, pos);
    box(g, size, [0, 0, 0], palette.pcbDark, null, 1);
    box(g, [size[0] - 0.03, 0.018, size[2] - 0.03], [0, size[1] / 2 + 0.003, 0], palette.pcb);
    for (let i = 0; i < 6; i++) {
      const z = -size[2] * 0.35 + i * size[2] * 0.13;
      const a = -size[0] * 0.4;
      tube(g, [[a, size[1] / 2 + 0.016, z], [a + 0.5, size[1] / 2 + 0.016, z], [a + 0.85, size[1] / 2 + 0.016, z + 0.25], [size[0] * 0.38, size[1] / 2 + 0.016, z + 0.25]], 0.009, i % 2 ? palette.gold : palette.cyan, null, 20);
    }
    for (const x of [-size[0] / 2 + 0.21, size[0] / 2 - 0.21]) {
      for (const z of [-size[2] / 2 + 0.21, size[2] / 2 - 0.21]) {
        cylinder(g, 0.115, 0.009, [x, size[1] / 2 + 0.013, z], palette.gold);
        cylinder(g, 0.058, 0.015, [x, size[1] / 2 + 0.019, z], palette.dark);
      }
    }
    for (let i = 0; i < 15; i++) {
      const x = -size[0] / 2 + 0.45 + i * (size[0] - 0.9) / 14;
      box(g, [0.12, 0.025, 0.28], [x, size[1] / 2 + 0.012, size[2] / 2 - 0.2], palette.gold);
    }
    return g;
  }

  function chip(parent, id, pos, size = [0.64, 0.12, 0.42], channelCount = 4) {
    const g = group(id, parent, pos);
    box(g, size, [0, 0, 0], palette.dark, null, 1);
    box(g, [size[0] * 0.76, 0.012, size[2] * 0.76], [0, size[1] / 2 + 0.008, 0], palette.silicon);
    const visiblePins = Math.min(channelCount, 8);
    for (let i = 0; i < visiblePins; i++) {
      const x = -size[0] * 0.34 + i * size[0] * 0.68 / Math.max(visiblePins - 1, 1);
      for (const s of [-1, 1]) box(g, [0.045, 0.025, 0.13], [x, -size[1] / 2 + 0.015, s * size[2] * 0.55], palette.gold);
    }
    cylinder(g, 0.018, 0.003, [-size[0] * 0.32, size[1] / 2 + 0.021, -size[2] * 0.24], palette.polymer, null, 'y', 12);
    return g;
  }

  function wavePath(parent, id, a, b, z, width = 0.018) {
    return tube(parent, [[a, 0.01, z], [a + (b - a) * 0.23, 0.01, z], [a + (b - a) * 0.4, 0.01, z + 0.045], [b, 0.01, z + 0.045]], width, palette.gold, id, 26);
  }
  function pic(parent, pos = [0, 0, 0], detailed = false, channelCount = null) {
    const g = group('pic', parent, pos);
    const base = group(null, g);
    box(base, [3.9, 0.115, 2.0], [0, 0, 0], palette.silicon, null, 1);
    box(base, [3.76, 0.008, 1.87], [0, 0.061, 0], palette.darkSilver);
    const count = channelCount ?? Math.min(lanes(), Number(state.config.picChannels) || 8);
    const optical = movable(group(null, g, [0, 0.071, 0]), [0, detailed ? 0.34 : 0.05, 0]);
    for (let i = 0; i < count; i++) {
      const z = -0.82 + i * 1.64 / Math.max(count - 1, 1);
      wavePath(optical, 'waveguide', -1.8, 1.8, z, detailed ? 0.012 : 0.009);
      box(optical, [0.48, 0.018, 0.035], [-0.76, 0.029, z], palette.cyan, 'modulator');
      box(optical, [0.21, 0.038, 0.045], [0.76, 0.03, z + 0.045], palette.maroon, 'photodiode');
      box(optical, [0.22, 0.008, 0.032], [1.65, 0.023, z + 0.045], palette.gold, 'coupler');
      if (i % 2 === 0) {
        box(optical, [0.22, 0.014, 0.032], [0.16, 0.026, z + 0.03], palette.blue, 'phase');
        tube(optical, [[-1.64, 0.025, z], [-1.45, 0.025, z], [-1.29, 0.025, z - 0.035]], 0.01, palette.gold, 'splitter', 18);
      }
      if (detailed && i % 4 === 0) {
        torus(optical, 0.07, 0.009, [-0.15, 0.025, z], palette.gold, 'modulator', 'y');
      }
    }
    for (let i = 0; i < 20; i++) {
      const x = -1.75 + i * 3.5 / 19;
      for (const z of [-0.955, 0.955]) box(g, [0.085, 0.016, 0.058], [x, 0.069, z], palette.gold, 'pic');
    }
    if (detailed) {
      label(g, `单颗PIC · ${count}路结构示意`, [-1.2, 0.72, -1], 'pic', 0);
      label(optical, '调制器', [-0.8, 0.35, 0.65], 'modulator', 1);
      label(optical, '光电探测器', [0.77, 0.3, -0.75], 'photodiode', 1);
      label(optical, '片上波导', [0, 0.18, 0.4], 'waveguide', 2);
      label(optical, '光耦合结构', [1.7, 0.24, 0.7], 'coupler', 2);
    }
    return g;
  }

  function vRail(parent, length, width, height, z, y) {
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, 0);
    shape.lineTo(0, height);
    shape.lineTo(width / 2, 0);
    shape.closePath();
    const geom = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
    geom.rotateY(Math.PI / 2);
    geom.translate(-length / 2, y, z);
    return part(geom, palette.silver, parent, [0, 0, 0], 'vgroove');
  }
  function fau(parent, pos = [0, 0, 0], detailed = false, pm = false) {
    const id = pm ? 'pm_fau' : 'fau';
    const fiberId = pm ? 'pm_fiber' : 'fiber';
    const g = group(id, parent, pos);
    const count = pm ? q('pm_fiber', Math.ceil(lanes() / (state.config.cwFanout || 4)), 64) : signalFibers();
    const groups = pm ? Math.max(1, q('pm_fau', count, 64)) : Math.max(1, q('fau', 2 * Math.ceil(lanes() / (state.config.fauCapacity || 8)), 32));
    const breadth = detailed ? 4.8 : 1.95;
    const length = detailed ? 2.5 : 0.92;
    const gap = Math.min(detailed ? 0.1 : 0.035, breadth / (groups * 5));
    const segmentWidth = (breadth - gap * (groups - 1)) / groups;
    const fiberY = detailed ? 0.32 : 0.17;
    let fiberIndex = 0;
    for (let index = 0; index < groups; index++) {
      const inGroup = Math.floor(count / groups) + (index < count % groups ? 1 : 0);
      const zCenter = -breadth / 2 + segmentWidth / 2 + index * (segmentWidth + gap);
      const segment = group(id, g, [0, 0, zCenter]);
      const base = movable(group(pm ? id : 'vgroove', segment), [0, detailed ? -0.05 : 0, 0]);
      box(base, [length, detailed ? 0.26 : 0.12, segmentWidth], [0, 0.08, 0], palette.silver, null, 1);
      const pitch = segmentWidth * 0.88 / Math.max(inGroup, 1);
      const radius = Math.min(detailed ? 0.042 : 0.019, pitch * 0.27);
      for (let i = 0; i <= inGroup; i++) {
        const rail = vRail(base, length * 0.95, pitch * 0.8, detailed ? 0.13 : 0.05, -segmentWidth * 0.44 + i * pitch, detailed ? 0.22 : 0.13);
        if (pm) rail.userData.id = id;
      }
      const fibers = movable(group(fiberId, segment), [0, detailed ? 0.25 : 0.025, 0]);
      for (let i = 0; i < inGroup; i++) {
        const z = -segmentWidth * 0.44 + pitch / 2 + i * pitch;
        const tip = detailed ? -length / 2 - 1.1 : -length / 2 - 0.14;
        const end = detailed ? length / 2 + 1.6 : length / 2 + 0.68;
        const tx = fiberIndex < count / 2;
        const jacket = pm ? palette.gold : tx ? palette.glass : palette.glass;
        tube(fibers, [[tip, fiberY, z], [0, fiberY, z], [length / 2 + 0.38, fiberY, z], [end, fiberY + (detailed ? 0.1 : 0.04), z]], radius, jacket, fiberId, 24);
        straight(fibers, [tip, fiberY, z], [length / 2 + 0.2, fiberY, z], radius * 0.22, pm || tx ? palette.gold : palette.cyan, fiberId);
        cylinder(fibers, radius * 0.92, 0.009, [tip, fiberY, z], pm || tx ? palette.gold : palette.cyan, fiberId, 'x', 12);
        if (detailed && !pm && state.config.fauLens !== false && q('lens', 1) > 0) sphere(fibers, radius * 1.12, [tip - 0.18, fiberY, z], palette.glass, 'lens', [0.55, 1, 1]);
        fiberIndex++;
      }
      const lid = movable(group(pm ? id : 'cover_plate', segment, [0, detailed ? 0.64 : 0.24, 0]), [0, detailed ? 0.76 : 0.17, 0]);
      box(lid, [length * 0.96, detailed ? 0.2 : 0.075, segmentWidth * 0.95], [0, 0, 0], palette.glass, null, 1);
      for (const x of [-length * 0.35, length * 0.35]) box(segment, [0.08, 0.028, segmentWidth * 0.94], [x, fiberY + 0.07, 0], palette.resin, pm ? id : 'adhesive');
    }
    if (detailed) {
      label(g, pm ? `保偏供光FAU · ${count}路` : `FAU × ${groups} · Tx/Rx分组示意`, [0, 1.45, -breadth / 2], id, 0);
      label(g, pm ? `${count}根保偏供光纤` : `${lanes()}Tx＋${lanes()}Rx · ${count}根信号纤`, [length / 2 + 1.15, 0.86, 0], fiberId, 0);
      if (!pm) {
        label(g, 'V槽基板', [-0.55, 0.42, breadth / 2], 'vgroove', 1);
        label(g, '玻璃盖板', [0.25, 1.15, breadth / 2 - 0.1], 'cover_plate', 1);
        label(g, '光学胶', [-length * 0.35, 0.66, breadth / 2 - 0.5], 'adhesive', 2);
      }
    }
    return g;
  }

  function frame(parent, width, depth, y, id = 'housing') {
    const g = group(id, parent, [0, y, 0]);
    for (const z of [-depth / 2, depth / 2]) box(g, [width, 0.19, 0.16], [0, 0, z], palette.silver);
    for (const x of [-width / 2, width / 2]) box(g, [0.16, 0.19, depth], [x, 0, 0], palette.silver);
    for (const x of [-width / 2 + 0.15, width / 2 - 0.15]) {
      for (const z of [-depth / 2 + 0.13, depth / 2 - 0.13]) screw(g, x, z, 0.12);
    }
    return g;
  }
  function interposer(parent, pos = [0, 0, 0], w = 5.3, d = 3.1) {
    const g = group('interposer', parent, pos);
    box(g, [w, 0.12, d], [0, 0, 0], palette.ceramic, null, 1);
    box(g, [w - 0.08, 0.021, d - 0.08], [0, 0.065, 0], palette.pcb);
    box(g, [w - 0.03, 0.014, d - 0.03], [0, -0.059, 0], palette.copper);
    for (let ix = 0; ix < 14; ix++) {
      for (const z of [-d / 2 + 0.1, d / 2 - 0.1]) cylinder(g, 0.022, 0.13, [-w / 2 + 0.2 + ix * (w - 0.4) / 13, 0, z], palette.gold, null, 'y', 10);
    }
    return g;
  }
  function heatsink(parent, pos = [0, 0, 0], dims = [4.6, 1.05, 2.7], id = 'heatsink') {
    const g = group(id, parent, pos);
    box(g, [dims[0], 0.16, dims[2]], [0, 0, 0], palette.paleMetal, null, 1);
    const n = 17;
    for (let i = 0; i < n; i++) box(g, [0.065, dims[1], dims[2] - 0.06], [-dims[0] / 2 + 0.12 + i * (dims[0] - 0.24) / (n - 1), dims[1] / 2 + 0.07, 0], palette.silver);
    for (const x of [-dims[0] / 2 + 0.15, dims[0] / 2 - 0.15]) {
      for (const z of [-dims[2] / 2 + 0.15, dims[2] / 2 - 0.15]) screw(g, x, z, 0.1);
    }
    return g;
  }

  function engine(parent, pos = [0, 0, 0], detailed = false) {
    const g = group('engine', parent, pos);
    const base = movable(group('substrate', g, [0, 0.16, 0]), [0, detailed ? -0.03 : 0, 0]);
    if (state.config.interposer === true && q('interposer', 1) > 0) interposer(base);
    else {
      box(base, [5.3, 0.12, 3.1], [0, 0, 0], palette.ceramic, 'substrate', 1);
      box(base, [5.22, 0.021, 3.02], [0, 0.068, 0], palette.pcb, 'substrate');
    }
    const die = group('pic', g, [-0.28, 0.35, 0]);
    const picCount = Math.max(1, q('pic', Math.ceil(lanes() / (state.config.picChannels || 8)), 16));
    const cols = Math.ceil(Math.sqrt(picCount)), rows = Math.ceil(picCount / cols);
    for (let i = 0; i < picCount; i++) {
      const x = ((i % cols) - (cols - 1) / 2) * 3.93 / cols;
      const z = (Math.floor(i / cols) - (rows - 1) / 2) * 1.91 / rows;
      const channels = Math.max(1, Math.min(state.config.picChannels || 8, lanes() - i * (state.config.picChannels || 8)));
      const tile = pic(die, [x, 0, z], false, channels);
      tile.scale.set(0.94 / cols, 1, 0.91 / rows);
    }
    movable(die, [0, detailed ? 0.54 : 0.12, 0]);
    const driverCount = q('driver', Math.ceil(lanes() / (state.config.driverChannels || 4)), 16);
    const tiaCount = q('tia', Math.ceil(lanes() / (state.config.tiaChannels || 4)), 16);
    const driverRow = movable(group(null, g, [0, 0.39, 0]), [0, detailed ? 0.75 : 0.08, -detailed * 0.22]);
    const tiaRow = movable(group(null, g, [0, 0.39, 0]), [0, detailed ? 0.75 : 0.08, detailed * 0.22]);
    for (let i = 0; i < driverCount; i++) {
      const x = -2.13 + (i + 0.5) * 4.1 / Math.max(driverCount, 1);
      const width = Math.min(0.6, 3.3 / Math.max(driverCount, 1));
      chip(driverRow, 'driver', [x, 0, -1.26], [width, 0.14, 0.36], state.config.driverChannels || 4);
      for (let b = 0; b < 3; b++) tube(driverRow, [[x + (b - 1) * 0.055, -0.025, -1.04], [x + (b - 1) * 0.055, 0.12, -0.98], [x + (b - 1) * 0.055, -0.025, -0.87]], 0.007, palette.gold, 'driver', 14);
    }
    for (let i = 0; i < tiaCount; i++) {
      const x = -2.13 + (i + 0.5) * 4.1 / Math.max(tiaCount, 1);
      chip(tiaRow, 'tia', [x, 0, 1.26], [Math.min(0.6, 3.3 / Math.max(tiaCount, 1)), 0.14, 0.36], state.config.tiaChannels || 4);
      for (let b = 0; b < 3; b++) tube(tiaRow, [[x + (b - 1) * 0.055, -0.025, 1.05], [x + (b - 1) * 0.055, 0.12, 0.99], [x + (b - 1) * 0.055, -0.025, 0.87]], 0.007, palette.gold, 'tia', 14);
    }
    const array = fau(g, [2.25, 0.29, 0]);
    movable(array, [detailed ? 0.8 : 0.15, detailed ? 0.36 : 0.03, 0]);
    frame(g, 5.5, 3.3, 0.25);
    if (detailed) {
      const thermal = movable(group('thermal', g, [-0.15, 1.9, -0.25]), [0, 1.15, 0]);
      const sink = heatsink(thermal, [0, 0, 0], [4.3, 0.63, 2.15]);
      sink.traverse(o => { if (o.isMesh) { o.material.transparent = true; o.material.opacity = 0.34; o.material.depthWrite = false; o.material.userData.baseOpacity = 0.34; o.material.userData.baseTransparent = true; } });
      label(die, `硅光PIC × ${picCount}`, [-0.85, 0.35, 0], 'pic', 0);
      label(driverRow, `Driver × ${driverCount}`, [-1.2, 0.35, -1.28], 'driver', 1);
      label(tiaRow, `TIA × ${tiaCount}`, [-1.1, 0.26, 1.27], 'tia', 1);
      label(array, 'Fiber Array', [0.1, 0.54, 0.7], 'fau', 0);
      label(base, '封装基板', [-2.7, 0.3, 1.3], 'substrate', 2);
      label(thermal, '散热结构 · 示意', [0.8, 0.83, -0.4], 'thermal', 2);
    }
    return g;
  }

  function filter(parent, id, x, r = 0.6, angle = 0) {
    const g = group(id, parent, [x, 0, 0]);
    cylinder(g, r, 0.07, [0, 0, 0], palette.glass, null, 'x');
    torus(g, r + 0.015, 0.034, [0, 0, 0], palette.paleMetal);
    const pattern = group(null, g);
    pattern.rotation.x = angle;
    for (let i = -6; i <= 6; i++) {
      const y = i * r / 7;
      const halfZ = Math.sqrt(Math.max(0, r * r * 0.92 - y * y));
      straight(pattern, [0.04, y, -halfZ], [0.04, y, halfZ], 0.009, palette.cyan);
    }
    return g;
  }
  function ringMagnet(parent, pos = [0, 0, 0], radius = 0.69, width = 0.36) {
    const g = group('magnet', parent, pos);
    const shape = new THREE.Shape();
    shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, radius * 0.69, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const geom = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.018, bevelThickness: 0.018, curveSegments: 48 });
    geom.rotateY(Math.PI / 2);
    geom.translate(-width / 2, 0, 0);
    part(geom, palette.darkSilver, g);
    torus(g, radius * 0.98, 0.018, [-width / 2 - 0.015, 0, 0], palette.blue);
    return g;
  }
  function faraday(parent, pos = [0, 0, 0], detailed = false) {
    const g = group('faraday', parent, pos);
    const side = detailed ? 2.5 : 0.72;
    const thickness = detailed ? 0.1 : 0.036;
    const crystal = group('garnet', g);
    box(crystal, [thickness, side, side], [0, 0, 0], palette.film, null, 1);
    for (const s of [-1, 1]) {
      const coating = movable(group('coating', g, [s * (thickness / 2 + 0.006), 0, 0]), [s * (detailed ? 0.65 : 0.045), 0, 0]);
      const mat = palette.glass.clone();
      mat.color.set(s > 0 ? '#7f99ce' : '#c69ccb');
      mat.opacity = detailed ? 0.32 : 0.2;
      box(coating, [0.007, side * 0.995, side * 0.995], [0, 0, 0], mat);
      mat.dispose();
    }
    if (detailed) {
      label(crystal, '磁光晶体薄片', [0, side / 2 + 0.26, -0.1], 'garnet', 0);
      label(g, '光学镀膜 · 表面工艺', [0.65, 0.3, side / 2 + 0.12], 'coating', 0);
      label(g, '薄方片为外形示意 · 非尺寸复原', [0, -side / 2 - 0.2, 0.1], null, 3, true);
    }
    return g;
  }

  function isolator(parent, pos = [0, 0, 0], detailed = false) {
    const g = group('isolator', parent, pos);
    const scale = detailed ? 1 : 0.42;
    g.scale.setScalar(scale);
    const p = movable(filter(g, 'polarizer', -0.79, 0.54, 0), [detailed ? -2.8 : -0.18, 0, 0]);
    const f = faraday(g, [0, 0, 0], false);
    const a = movable(filter(g, 'analyzer', 0.79, 0.54, Math.PI / 4), [detailed ? 2.8 : 0.18, 0, 0]);
    const magnet = movable(ringMagnet(g, [0, 0, 0], 0.77, 0.43), [0, detailed ? 2.65 : 0.16, 0]);
    const housing = movable(group('isolator_housing', g, [0, 0, 0]), [0, detailed ? -0.34 : 0, detailed ? -3.5 : -0.15]);
    const shell = cylinder(housing, 0.86, 2.22, [0, 0, 0], palette.silver, null, 'x', 56, true, Math.PI * 1.22);
    shell.rotation.x = Math.PI * 0.6;
    for (const x of [-1.11, 1.11]) {
      // Open partial end rings keep the central optical path readable.
      const ring = torus(housing, 0.86, 0.045, [x, 0, 0], palette.paleMetal);
      ring.material.transparent = true;
      ring.material.opacity = 0.55;
      ring.material.userData.baseOpacity = 0.55;
      ring.material.userData.baseTransparent = true;
    }
    const collimator = movable(group('collimator', g, [-1.75, 0, 0]), [detailed ? -3 : -0.2, 0, 0]);
    sphere(collimator, 0.45, [0, 0, 0], palette.glass, null, [0.43, 1, 1]);
    torus(collimator, 0.46, 0.035, [0, 0, 0], palette.gold);
    if (detailed) {
      const optical = material('#dfa642', 0.4, 0.2);
      optical.transparent = true;
      optical.opacity = 0.6;
      const beam = straight(g, [-5.2, 0, 0], [5.2, 0, 0], 0.015, optical, null);
      beam.userData.excludeFromFit = true;
      optical.dispose();
      label(p, '起偏器', [0, 0.85, 0], 'polarizer', 1);
      label(f, '法拉第旋片', [0, 0.9, 0.5], 'faraday', 0);
      label(a, '检偏器', [0, 0.85, 0], 'analyzer', 1);
      label(magnet, '永磁环', [0, 0.95, 0], 'magnet', 1);
      label(collimator, '准直透镜', [-0.1, 0.68, 0], 'collimator', 2);
      label(housing, '金属壳体 · 剖开示意', [0, -0.62, -0.58], 'isolator_housing', 2);
      if (Number(state.config.rotators) > 1) label(g, `单级结构示意 · 用量按${state.config.rotators}片/只测算`, [0, -0.62, 0.9], null, 3, true);
    }
    return g;
  }

  function laserDie(parent, pos = [0, 0, 0], detailed = false) {
    const g = group('laser_die', parent, pos);
    const s = detailed ? 1 : 0.55;
    g.scale.setScalar(s);
    box(g, [0.98, 0.12, 0.44], [0, 0, 0], palette.maroon, null, 1);
    box(g, [0.88, 0.015, 0.32], [0, 0.068, 0], palette.gold);
    box(g, [0.92, 0.019, 0.065], [0, 0.08, 0], palette.silicon);
    box(g, [0.012, 0.085, 0.16], [0.497, 0.004, 0], palette.cyan);
    for (const z of [-0.13, 0.13]) tube(g, [[-0.18, 0.083, z], [-0.36, 0.25, z * 1.7], [-0.65, 0.08, z * 2.1]], 0.011, palette.gold, 'laser_die', 18);
    return g;
  }
  function tec(parent, pos = [0, 0, 0], size = [1.3, 0.25, 1]) {
    const g = group('tec', parent, pos);
    for (const y of [-size[1] / 2, size[1] / 2]) box(g, [size[0], 0.05, size[2]], [0, y, 0], palette.ceramic);
    for (let ix = 0; ix < 5; ix++) for (let iz = 0; iz < 3; iz++) box(g, [size[0] / 10, size[1] - 0.02, size[2] / 6], [-size[0] * 0.37 + ix * size[0] * 0.185, 0, -size[2] / 3 + iz * size[2] / 3], (ix + iz) % 2 ? palette.silver : palette.darkSilver);
    return g;
  }
  function cw(parent, pos = [0, 0, 0], detailed = false) {
    const g = group('cw', parent, pos);
    const cooler = movable(tec(g, [0, 0.13, 0], [1.6, 0.22, 1.2]), [0, detailed ? -0.06 : 0, 0]);
    const submount = movable(group('laser_submount', g, [0, 0.39, 0]), [0, detailed ? 0.25 : 0.025, 0]);
    box(submount, [1.44, 0.15, 1.04], [0, 0, 0], palette.gold, null, 1);
    box(submount, [1.05, 0.02, 0.72], [0, 0.083, 0], palette.ceramic);
    const die = movable(laserDie(g, [0, 0.6, 0], true), [0, detailed ? 0.56 : 0.055, 0]);
    const pd = movable(chip(g, 'monitor_pd', [-0.88, 0.61, 0], [0.2, 0.13, 0.24], 2), [-detailed * 0.28, detailed ? 0.34 : 0.01, 0]);
    const cap = movable(group('cw', g, [0.4, 0.62, 0]), [0, detailed ? 1.28 : 0.15, -detailed * 0.45]);
    const shell = cylinder(cap, 0.76, 1.55, [0, 0, 0], palette.silver, null, 'x', 56, true, Math.PI * 1.13);
    shell.rotation.x = Math.PI * 0.43;
    torus(cap, 0.73, 0.065, [0.8, 0, 0], palette.paleMetal);
    sphere(cap, 0.41, [0.81, 0, 0], palette.glass, 'cw', [0.32, 1, 1]);
    for (const z of [-0.43, 0.43]) {
      cylinder(g, 0.055, 0.7, [-1.12, 0.2, z], palette.gold, 'cw', 'x', 20);
      cylinder(g, 0.105, 0.045, [-0.82, 0.2, z], palette.ceramic, 'cw', 'x', 24);
    }
    if (detailed) {
      label(die, 'CW激光芯片', [0.1, 0.35, 0], 'laser_die', 0);
      label(submount, '激光器热沉 / Submount', [0.25, 0.23, 0.68], 'laser_submount', 1);
      label(cooler, 'TEC', [-0.5, 0.1, 0.6], 'tec', 1);
      label(cap, '金属封装 · 剖开示意', [0, 0.98, -0.1], 'cw', 2);
      label(pd, '监控PD', [-0.22, 0.29, 0], 'monitor_pd', 2);
    }
    return g;
  }

  function els(parent, pos = [0, 0, 0], detailed = false) {
    const g = group('els', parent, pos);
    box(g, [4.25, 0.16, 2.6], [0, 0.08, 0], palette.paleMetal, 'els', 1);
    frame(g, 4.1, 2.5, 0.26, 'els');
    board(g, 'els', [3.8, 0.065, 2.16], [0, 0.24, 0]);
    const laser = movable(cw(g, [-0.96, 0.28, -0.2], false), [0, detailed ? 0.75 : 0.09, 0]);
    laser.scale.setScalar(0.75);
    const iso = movable(isolator(g, [0.7, 0.79, -0.2], false), [0, detailed ? 0.82 : 0.05, 0]);
    const drive = movable(chip(g, 'laser_driver', [-0.82, 0.41, 0.76], [1.1, 0.15, 0.5], 6), [0, detailed ? 0.5 : 0.04, 0.2]);
    chip(g, 'monitor_pd', [0.64, 0.41, 0.72], [0.38, 0.09, 0.35], 3);
    chip(g, 'tec_controller', [0.05, 0.41, 0.72], [0.45, 0.1, 0.36], 4);
    const supplyArray = fau(g, [1.58, 0.48, 0.61], false, true);
    supplyArray.scale.setScalar(0.29);
    sphere(g, 0.17, [1.33, 0.79, -0.2], palette.glass, 'els_optics', [0.35, 1, 1]);
    const output = group('pm_fiber', g);
    tube(output, [[1.35, 0.79, -0.2], [1.65, 0.79, -0.2], [2.26, 0.65, 0], [2.4, 0.45, 0.7]], 0.048, palette.gold, 'pm_fiber');
    cylinder(g, 0.14, 0.4, [2.1, 0.61, -0.13], palette.silver, 'connector', 'x');
    if (detailed) {
      const lid = movable(group('els', g, [0, 2, -0.5]), [0, 0.85, -0.45]);
      box(lid, [4.26, 0.09, 2.63], [0, 0, 0], palette.paleMetal, null, 1);
      for (let i = 0; i < 10; i++) box(lid, [0.07, 0.13, 1.75], [-1.65 + i * 0.36, 0.11, 0], palette.silver);
      label(laser, 'CW激光器', [-0.3, 1.05, 0], 'cw', 0);
      label(iso, '光隔离器', [0.4, 1.18, 0], 'isolator', 0);
      label(drive, '激光驱动', [0, 0.32, 0.4], 'laser_driver', 1);
      label(output, '保偏光纤', [2.5, 0.94, 0.55], 'pm_fiber', 1);
      label(lid, 'ELS外壳 · 单路光源展开示意', [1.1, 0.3, -0.7], 'els', 2);
      label(supplyArray, '保偏供光FAU', [0, 0.95, 0], 'pm_fau', 2);
    }
    return g;
  }

  function connector(parent, pos = [0, 0, 0], detailed = false) {
    const g = group('connector', parent, pos);
    const n = signalFibers(), width = detailed ? 3.9 : 1.8;
    box(g, [1.04, 0.67, width], [0, 0.37, 0], palette.darkSilver, null, 1);
    box(g, [0.06, 0.5, width - 0.12], [0.55, 0.39, 0], palette.ceramic);
    const rows = Math.max(2, Math.ceil(n / 32)), columns = Math.ceil(n / rows);
    for (let i = 0; i < n; i++) {
      const z = -width * 0.41 + (i % columns) * width * 0.82 / Math.max(columns - 1, 1);
      const y = 0.39 + (Math.floor(i / columns) - (rows - 1) / 2) * (rows > 2 ? 0.1 : 0.17);
      cylinder(g, detailed ? 0.035 : 0.017, 0.05, [0.59, y, z], palette.dark, 'fiber', 'x', 16);
      cylinder(g, detailed ? 0.02 : 0.012, 0.056, [0.6, y, z], palette.glass, 'fiber', 'x', 14);
      tube(g, [[-0.6, y, z], [-1.1, y, z], [-1.9, y - 0.12, z * 0.85]], detailed ? 0.026 : 0.015, palette.glass, 'fiber', 20);
    }
    for (const z of [-width / 2 + 0.13, width / 2 - 0.13]) cylinder(g, 0.055, 0.16, [0.61, 0.4, z], palette.silver, 'connector', 'x');
    box(g, [0.38, 0.11, width * 0.65], [0, 0.755, 0], palette.paleMetal);
    if (detailed) label(g, '多通道光纤连接器 · 结构示意', [0.1, 1.12, 0], 'connector', 0);
    return g;
  }

  function dashedBoundary(parent, center, width, depth, color = '#6f97b3', id) {
    const points = [
      [-width / 2, 0.04, -depth / 2], [width / 2, 0.04, -depth / 2],
      [width / 2, 0.04, depth / 2], [-width / 2, 0.04, depth / 2], [-width / 2, 0.04, -depth / 2],
    ].map(p => new THREE.Vector3(p[0] + center[0], p[1] + center[1], p[2] + center[2]));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color, dashSize: 0.17, gapSize: 0.12, transparent: true, opacity: 0.6 }));
    line.computeLineDistances();
    line.userData.decorative = true;
    line.material.userData.baseOpacity = 0.6;
    line.material.userData.baseTransparent = true;
    parent.add(line);
    return line;
  }
  function control(parent, pos = [0, 0, 0], detailed = false) {
    const g = group('control', parent, pos);
    if (detailed) board(g, 'pcb', [4.7, 0.15, 3.2]);
    chip(g, 'mcu', detailed ? [-0.65, 0.36, 0] : [0, 0, 0], detailed ? [1.4, 0.2, 1.25] : [0.48, 0.11, 0.5], 8);
    chip(g, 'pmic', detailed ? [1.15, 0.34, 0.35] : [0.72, 0, 0], detailed ? [0.72, 0.15, 0.7] : [0.37, 0.09, 0.42], 4);
    if (detailed) {
      for (let i = 0; i < 6; i++) box(g, [0.23, 0.11, 0.12], [-1.65 + i * 0.52, 0.28, 1.18], palette.ceramic);
      label(g, '控制MCU', [-0.65, 0.83, -0.2], 'mcu', 0);
      label(g, '电源管理', [1.15, 0.68, 0.35], 'pmic', 0);
    }
    return g;
  }

  function overall(root) {
    const isBoard = state.config.laser === 'board';
    const boardWidth = isBoard ? 11.25 : 8.5;
    const centerX = isBoard ? 0 : -1.9;
    const npo = group('substrate', root, [centerX, 0, 0]);
    board(npo, 'pcb', [boardWidth, 0.17, 5.1], [0, 0.16, 0]);
    const eng = engine(root, [-2.15, 0.35, -0.15]);
    const ctrl = control(root, [-4.78, 0.46, 1.6]);
    const connectorPos = isBoard ? [3.65, 0.29, 1.23] : [2.02, 0.29, 0.02];
    const conn = connector(root, connectorPos);
    const count = signalFibers();
    for (let i = 0; i < count; i++) {
      const z = -0.9 + i * 1.8 / Math.max(count - 1, 1);
      tube(root, [[0.94, 0.83, z - 0.15], [1.35, 0.83, z - 0.08], [connectorPos[0] - 1.02, 0.82, z + connectorPos[2]], [connectorPos[0] - 0.53, 0.68, z + connectorPos[2]]], Math.min(0.022, 0.39 / count), palette.cyan, 'fiber', 28);
    }
    const laserPos = isBoard ? [3.48, 0.32, -1.33] : [4.1, 0.07, 4.35];
    const source = els(root, laserPos);
    source.scale.setScalar(isBoard ? 0.65 : 0.88);
    source.rotation.y = isBoard ? 0 : -Math.PI * 0.02;
    const laserFiber = group('pm_fiber', root);
    const fiberStart = isBoard ? [4.97, 0.83, -1.05] : [5.96, 0.72, 4.25];
    const path = isBoard
      ? [fiberStart, [5.4, 1.04, 0.7], [4.5, 1.16, 2.36], [0, 1.05, 2.1], [-1.15, 0.77, 0.8]]
      : [fiberStart, [6.65, 0.78, 3.0], [5.46, 0.87, 1.82], [0.6, 1.11, 2.2], [-1.15, 0.77, 0.8]];
    tube(laserFiber, path, 0.043, palette.gold, 'pm_fiber', 96);
    tube(laserFiber, path.map(([x, y, z]) => [x, y + 0.055, z + 0.075]), 0.027, palette.polymer, 'pm_fiber', 96);
    dashedBoundary(root, [centerX, 0, 0], boardWidth + 0.52, 5.64);
    label(root, isBoard ? 'NPO组件边界 · 板载光源' : 'NPO组件边界', [centerX - boardWidth / 2 + 1.3, 0.2, 2.91], 'substrate', 0);
    label(eng, 'NPO光引擎', [-0.4, 1.15, -0.8], 'engine', 0);
    label(source, isBoard ? 'ELS · 板载光源' : 'ELS · 外置激光源', [0.4, 1.65, 0.5], 'els', 0);
    label(laserFiber, '保偏光纤', isBoard ? [2.9, 1.17, 2.25] : [3.85, 1.25, 2], 'pm_fiber', 2);
    label(conn, `${lanes()}Tx＋${lanes()}Rx光纤接口`, [0.15, 1.03, 0.5], 'connector', 1);
    label(ctrl, '控制 / 电源', [0.45, 0.42, 0.5], 'control', 2);
    const cooling = movable(heatsink(root, [-2.15, 0.72, -2.03], [3.95, 0.37, 0.64], 'thermal'), [0, 0.28, -0.22]);
    cooling.traverse(o => { if (o.isMesh) o.userData.id = 'heatsink'; });
    label(cooling, '散热结构 · 移开示意', [-0.3, 0.76, -0.1], 'thermal', 2);

    // An external ASIC is contextual only. It has no semantic id and is excluded from raycasts and BOM.
    const asic = group(null, root, [4.5, 0.22, -4.5]);
    asic.userData.nonInteractive = true;
    box(asic, [2.5, 0.17, 2.5], [0, 0.09, 0], palette.grey);
    box(asic, [2.09, 0.32, 2.09], [0, 0.33, 0], palette.paleMetal);
    for (let i = 0; i < 11; i++) box(asic, [0.07, 0.32, 1.94], [-0.91 + i * 0.182, 0.64, 0], palette.grey);
    dashedBoundary(asic, [0, -0.12, 0], 2.9, 2.9, '#aeb8c1');
    label(asic, 'ASIC · 外部参照', [0, 1.27, 0], null, 0, true);
    const electrical = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1.2, 0.35, -1.8), new THREE.Vector3(0.2, 0.2, -3.1), new THREE.Vector3(3.3, 0.2, -3.65),
    ]), new THREE.LineDashedMaterial({ color: '#9aaab7', dashSize: 0.15, gapSize: 0.12, transparent: true, opacity: 0.42 }));
    electrical.computeLineDistances();
    electrical.userData.decorative = true;
    electrical.material.userData.baseOpacity = 0.42;
    electrical.material.userData.baseTransparent = true;
    root.add(electrical);
  }

  function substrateView(root) {
    const g = group('substrate', root);
    board(g, 'pcb', [5.5, 0.26, 3.6], [0, 0.17, 0]);
    const showInterposer = state.config.interposer === true && q('interposer', 1) > 0;
    const ip = showInterposer ? movable(interposer(g, [0, 0.94, 0], 4.6, 2.85), [0, 0.7, 0]) : null;
    const top = movable(group('substrate', g, [0, 1.28, 0]), [0, 1.2, 0]);
    box(top, [4.3, 0.09, 2.6], [0, 0, 0], palette.ceramic, null, 1);
    const solder = movable(group('solder', g, [0, 0.94, 0]), [0, 0.55, 0]);
    for (let x = -1.85; x < 1.9; x += 0.24) for (let z = -1.06; z < 1.1; z += 0.24) sphere(solder, 0.042, [x, -0.14, z], palette.silver, 'solder');
    for (let i = 0; i < 6; i++) {
      const layer = movable(group('pcb', g, [0, 0.39 + i * 0.056, 0]), [0, i * 0.08, 0]);
      box(layer, [5.3, 0.021, 3.4], [0, 0, 0], i % 2 ? palette.copper : palette.ceramic);
    }
    label(top, '封装基板', [-0.8, 0.3, 0.9], 'substrate', 0);
    if (ip) label(ip, '中介层 / Interposer', [1.7, 0.26, -0.8], 'interposer', 1);
    label(solder, '焊料与键合', [1.7, 0.26, 0.75], 'solder', 2);
    label(g, 'PCB叠层 · 结构示意', [-2, 0.85, 1.6], 'pcb', 1);
  }
  function thermalView(root) {
    const g = group('thermal', root);
    const housing = frame(g, 4.9, 3.35, 0.23, 'housing');
    box(housing, [4.78, 0.09, 3.2], [0, -0.1, 0], palette.paleMetal);
    const tim = movable(group('tim', g, [0, 0.81, 0]), [0, 0.4, 0]);
    box(tim, [4.1, 0.09, 2.54], [0, 0, 0], palette.grey, null, 1);
    const sink = movable(heatsink(g, [0, 1.24, 0], [4.55, 1.2, 3]), [0, 0.88, 0]);
    label(sink, '散热鳍片', [-0.4, 1.67, 0.4], 'heatsink', 0);
    label(tim, '导热界面材料', [2.1, 0.22, 0.7], 'tim', 1);
    label(housing, '机械壳体', [-1.8, 0.26, 1.5], 'housing', 1);
  }

  function eicView(root) {
    const g = group('eic', root, [0, 0.38, 0]);
    box(g, [5.4, 0.15, 3.2], [0, 0, 0], palette.ceramic, 'eic', 1);
    for (const [id, z] of [['driver', -0.8], ['tia', 0.8]]) {
      const count = q(id, Math.ceil(lanes() / 4), 16);
      const cols = Math.min(count, 8), rows = Math.ceil(count / cols);
      for (let i = 0; i < count; i++) {
        const x = ((i % cols) - (cols - 1) / 2) * 4.6 / cols;
        const chipZ = z + (Math.floor(i / cols) - (rows - 1) / 2) * 0.55;
        const unit = chip(g, id, [x, 0.24, chipZ], [Math.min(0.92, 3.8 / cols), 0.16, 0.46], state.config[id === 'driver' ? 'driverChannels' : 'tiaChannels'] || 4);
        movable(unit, [0, id === 'driver' ? 0.6 : 0.32, 0]);
      }
      label(g, `${id === 'driver' ? 'Tx · Driver' : 'Rx · TIA'} × ${count}`, [0, 0.98, z + (id === 'driver' ? -0.25 : 0.25)], id, 0);
    }
  }
  function otherView(root) {
    const g = group('other', root);
    const sink = heatsink(g, [-1.9, 0.56, -0.8], [3.5, 1, 2.45]);
    box(g, [3.2, 0.09, 2.15], [-1.9, 0.26, -0.8], palette.grey, 'tim');
    const shell = frame(g, 3.8, 2.75, 0.12);
    shell.position.x = -1.9;
    shell.position.z = -0.8;
    const ctrl = control(g, [2.32, 0.11, -0.5], true);
    ctrl.scale.setScalar(0.59);
    const conn = connector(g, [0.8, 0.16, 2.2], true);
    conn.scale.setScalar(0.64);
    label(sink, '热管理与机械结构', [0, 1.46, 0], 'thermal', 0);
    label(conn, '光电连接器', [0.8, 1.5, 0], 'connector', 1);
  }
  function opticsView(root) {
    const g = group('els_optics', root, [0, 1.18, 0]);
    for (const [x, radius] of [[-1.55, 0.69], [1.4, 0.95]]) {
      const lens = movable(group('els_optics', g, [x, 0, 0]), [x * 0.38, 0, 0]);
      sphere(lens, radius, [0, 0, 0], palette.glass, 'els_optics', [0.38, 1, 1]);
      torus(lens, radius + 0.02, 0.048, [0, 0, 0], palette.silver, 'els_optics');
      box(lens, [0.42, 0.13, 1.5], [0, -radius - 0.1, 0], palette.paleMetal, 'els_optics');
    }
    const filterGroup = group('els_optics', g);
    cylinder(filterGroup, 0.77, 0.07, [0, 0, 0], palette.film, 'els_optics', 'x');
    torus(filterGroup, 0.79, 0.05, [0, 0, 0], palette.gold, 'els_optics');
    straight(g, [-3.1, 0, 0], [3.1, 0, 0], 0.018, palette.gold, 'els_optics');
    label(g, '整形与滤光 · 组合示意', [0, 1.36, 0], 'els_optics', 0);
  }

  function leafView(root, id) {
    const g = group(id, root, [0, 0.85, 0]);
    switch (id) {
      case 'driver': case 'tia': case 'laser_driver': case 'mcu': case 'pmic': case 'tec_controller':
        chip(g, id, [0, 0, 0], [2.8, 0.34, 2.2], 8);
        for (let i = 0; i < 12; i++) {
          const x = -1.2 + i * 2.4 / 11;
          for (const s of [-1, 1]) box(g, [0.1, 0.08, 0.45], [x, -0.14, s * 1.19], palette.gold, id);
        }
        break;
      case 'photodiode': case 'monitor_pd':
        box(g, [2.5, 0.2, 1.7], [0, -0.1, 0], palette.ceramic);
        box(g, [1.1, 0.12, 0.8], [0, 0.08, 0], palette.maroon);
        box(g, [0.78, 0.025, 0.57], [0, 0.16, 0], palette.silicon);
        for (const z of [-0.35, 0.35]) tube(g, [[-0.32, 0.19, z], [-0.75, 0.5, z * 1.2], [-1, 0.05, z]], 0.018, palette.gold);
        break;
      case 'modulator': case 'waveguide': case 'coupler': case 'splitter': case 'phase': {
        box(g, [4.7, 0.18, 2.5], [0, 0, 0], palette.silicon, null, 1);
        const y = 0.12;
        if (id === 'splitter') {
          tube(g, [[-2.1, y, 0], [-0.6, y, 0], [0.5, y, -0.7], [2.1, y, -0.7]], 0.035, palette.gold, id);
          tube(g, [[-0.7, y, 0], [0.1, y, 0.15], [0.65, y, 0.7], [2.1, y, 0.7]], 0.035, palette.gold, id);
        } else if (id === 'coupler') {
          for (let i = 0; i < 11; i++) box(g, [0.048, 0.019, 0.4 + i * 0.085], [-0.78 + i * 0.16, y, 0], palette.gold, id);
          straight(g, [-2.1, y, 0], [-0.82, y, 0], 0.035, palette.gold, id);
          sphere(g, 0.36, [1.75, 0.34, 0], palette.glass, 'coupler', [0.42, 1, 1]);
        } else {
          for (const s of [-1, 1]) tube(g, [[-2.1, y, 0], [-1.2, y, 0], [-0.75, y, 0.48 * s], [0.9, y, 0.48 * s], [1.45, y, 0], [2.1, y, 0]], 0.027, palette.gold, id);
          if (id !== 'waveguide') for (const z of [-0.48, 0.48]) {
            box(g, [1.55, 0.035, 0.18], [0.08, y + 0.021, z], palette.cyan, id);
            box(g, [1.48, 0.048, 0.13], [0.08, y + 0.031, z + 0.18], palette.gold, id);
          }
        }
        break;
      }
      case 'laser_die': laserDie(g, [0, 0, 0], true).scale.setScalar(2.5); break;
      case 'laser_submount':
        box(g, [3.2, 0.42, 2.3], [0, 0, 0], palette.gold, null, 1);
        box(g, [2.45, 0.13, 1.7], [0, 0.27, 0], palette.ceramic, null, 1);
        box(g, [1.92, 0.025, 1.2], [0, 0.351, 0], palette.gold);
        break;
      case 'tec': tec(g, [0, 0, 0], [3.2, 0.72, 2.5]); break;
      case 'polarizer': case 'analyzer': filter(g, id, 0, 1.2, id === 'analyzer' ? Math.PI / 4 : 0); break;
      case 'magnet': ringMagnet(g, [0, 0, 0], 1.25, 0.66); break;
      case 'garnet':
        cylinder(g, 1.3, 0.22, [0, 0, 0], palette.film, id, 'x', 72);
        torus(g, 1.3, 0.014, [0.12, 0, 0], palette.purple, id);
        for (let iy = -2; iy <= 2; iy++) for (let iz = -2; iz <= 2; iz++) {
          const y = iy * 0.34, z = iz * 0.34;
          sphere(g, 0.037, [0.14, y, z], (iy + iz) % 2 ? palette.purple : palette.cyan, id);
          if (iy < 2) straight(g, [0.14, y, z], [0.14, y + 0.34, z], 0.007, palette.purple, id);
          if (iz < 2) straight(g, [0.14, y, z], [0.14, y, z + 0.34], 0.007, palette.purple, id);
        }
        label(g, '晶格为材料结构示意', [0, -1.4, 0], null, 2, true);
        break;
      case 'coating':
        cylinder(g, 1.3, 0.035, [0, 0, 0], palette.glass, id, 'x', 72);
        for (let i = 0; i < 5; i++) {
          const coat = movable(group(id, g, [-0.16 + i * 0.08, 0, 0]), [(i - 2) * 0.26, 0, 0]);
          cylinder(coat, 1.3, 0.012, [0, 0, 0], i % 2 ? palette.glass : palette.film, id, 'x', 64);
        }
        break;
      case 'collimator': case 'lens':
        sphere(g, 1.18, [0, 0, 0], palette.glass, id, [0.43, 1, 1]);
        torus(g, 1.2, 0.07, [0, 0, 0], palette.silver, id);
        break;
      case 'isolator_housing': {
        const shell = cylinder(g, 1.1, 3.1, [0, 0, 0], palette.silver, id, 'x', 72, true, Math.PI * 1.6);
        shell.rotation.x = Math.PI * 0.56;
        for (const x of [-1.54, 1.54]) torus(g, 1.1, 0.065, [x, 0, 0], palette.paleMetal, id);
        break;
      }
      case 'fiber': case 'pm_fiber': {
        const cables = id === 'fiber' ? signalFibers() : q('pm_fiber', Math.ceil(lanes() / (state.config.cwFanout || 4)), 64);
        const pitch = Math.min(0.3, 3.4 / Math.max(cables, 1));
        const radius = Math.min(id === 'pm_fiber' ? 0.11 : 0.045, pitch * 0.28);
        for (let i = 0; i < cables; i++) {
          const z = (i - (cables - 1) / 2) * pitch;
          tube(g, [[-2.5, 0.05, z], [-1, 0, z], [0.7, 0.12, z + 0.12], [2.4, 0.55, z + 0.35]], radius, id === 'pm_fiber' ? palette.gold : palette.glass, id, 48);
          cylinder(g, radius * 0.86, 0.018, [-2.51, 0.05, z], palette.glass, id, 'x', 18);
          cylinder(g, radius * 0.27, 0.022, [-2.525, 0.05, z], palette.cyan, id, 'x', 16);
          if (id === 'pm_fiber') for (const offset of [-radius * 0.53, radius * 0.53]) cylinder(g, radius * 0.13, 0.025, [-2.53, 0.05 + offset, z], palette.purple, id, 'x', 12);
        }
        break;
      }
      case 'vgroove': {
        const n = lanes();
        box(g, [3.8, 0.22, 3.5], [0, 0, 0], palette.silver, id, 1);
        for (let i = 0; i <= n; i++) vRail(g, 3.76, 3.25 / n * 0.9, 0.22, -1.625 + i * 3.25 / n, 0.11);
        break;
      }
      case 'adhesive':
        box(g, [3.1, 0.18, 2.4], [0, -0.12, 0], palette.glass);
        for (const x of [-1, 1]) {
          box(g, [0.23, 0.065, 2.2], [x, 0.01, 0], palette.resin, id);
          sphere(g, 0.2, [x, 0.035, 1.03], palette.resin, id, [1, 0.4, 1]);
        }
        break;
      case 'cover_plate':
        box(g, [3.55, 0.22, 2.32], [0, 0, 0], palette.glass, id, 1);
        for (const x of [-1.55, 1.55]) box(g, [0.16, 0.012, 2.05], [x, -0.12, 0], palette.resin, id);
        break;
      case 'inp_substrate':
        box(g, [3.3, 0.18, 2.3], [0, 0, 0], palette.silicon, id, 1);
        box(g, [3.24, 0.009, 2.24], [0, 0.099, 0], palette.purple, id);
        for (let i = 0; i < 7; i++) straight(g, [-1.4, 0.11, -0.87 + i * 0.29], [1.4, 0.11, -0.87 + i * 0.29], 0.007, palette.blue, id);
        break;
      case 'ferrule': {
        box(g, [1.55, 0.8, 3.75], [0, 0, 0], palette.ceramic, id, 1);
        const count = signalFibers(), rows = Math.max(2, Math.ceil(count / 32)), columns = Math.ceil(count / rows);
        for (let i = 0; i < count; i++) {
          const y = (Math.floor(i / columns) - (rows - 1) / 2) * 0.17;
          const z = -1.55 + (i % columns) * 3.1 / Math.max(columns - 1, 1);
          cylinder(g, 0.039, 0.016, [0.784, y, z], palette.dark, id, 'x', 16);
          cylinder(g, 0.023, 0.02, [0.794, y, z], palette.glass, id, 'x', 14);
        }
        for (const z of [-1.7, 1.7]) cylinder(g, 0.078, 0.021, [0.786, 0, z], palette.darkSilver, id, 'x', 20);
        break;
      }
      case 'solder': {
        box(g, [3.8, 0.12, 2.7], [0, -0.3, 0], palette.ceramic, 'solder', 1);
        for (let x = -1.6; x < 1.7; x += 0.32) for (let z = -1.04; z < 1.1; z += 0.32) sphere(g, 0.074, [x, -0.13, z], palette.silver, id);
        const die = movable(group(id, g, [0, 0.35, 0]), [0, 0.9, 0]);
        box(die, [3.28, 0.16, 2.24], [0, 0, 0], palette.silicon, id, 1);
        for (let i = 0; i < 8; i++) {
          const x = -1.4 + i * 0.4;
          tube(g, [[x, 0.46, 1.05], [x, 0.8, 1.45], [x, -0.18, 1.45]], 0.014, palette.gold, id, 18);
        }
        break;
      }
      case 'pcb': board(g, id, [5.1, 0.3, 3.3], [0, 0, 0]); break;
      case 'interposer': interposer(g, [0, 0, 0], 4.2, 3); break;
      case 'heatsink': heatsink(g, [0, 0, 0], [4.2, 1.4, 2.8]); break;
      case 'tim': box(g, [3.9, 0.12, 2.8], [0, 0, 0], palette.grey, id, 1); break;
      case 'housing': frame(g, 4.8, 3.4, 0, id); box(g, [4.77, 0.12, 3.3], [0, -0.16, 0], palette.paleMetal, id); break;
      default: box(g, [2.5, 0.22, 1.8], [0, 0, 0], palette.silver, id, 1); break;
    }
    const node = state.nodes?.[id];
    label(g, `${node?.name || id}${q(id, 1) === 0 ? ' · 未配置，结构示意' : ''}`, [0, 1.7, 0], id, 0);
  }

  function buildScene() {
    const root = new THREE.Group();
    root.userData.viewId = state.viewId;
    root.userData.opacity = currentRoot ? 0 : 1;
    buildingRoot = root;
    const v = state.viewId;
    if (v === 'npo') overall(root);
    else if (v === 'engine') engine(root, [0, 0.25, 0], true);
    else if (v === 'eic') eicView(root);
    else if (v === 'pic') pic(root, [0, 0.62, 0], true);
    else if (v === 'els') els(root, [0, 0.1, 0], true);
    else if (v === 'cw') cw(root, [0, 0.4, 0], true);
    else if (v === 'isolator') isolator(root, [0, 1.25, 0], true);
    else if (v === 'faraday') faraday(root, [0, 1.45, 0], true);
    else if (v === 'fau') fau(root, [0, 0.28, 0], true);
    else if (v === 'pm_fau') fau(root, [0, 0.28, 0], true, true);
    else if (v === 'els_optics') opticsView(root);
    else if (v === 'substrate') substrateView(root);
    else if (v === 'control') control(root, [0, 0.12, 0], true);
    else if (v === 'thermal') thermalView(root);
    else if (v === 'other') otherView(root);
    else if (v === 'connector') connector(root, [0.6, 0.15, 0], true);
    else leafView(root, v);
    buildingRoot = null;
    updateExplode(root, explodeCurrent);
    scene.add(root);
    const now = performance.now();
    if (currentRoot) {
      for (const entry of roots) { entry.from = entry.opacity; entry.to = 0; entry.start = now; }
      roots.push({ root, from: 0, to: 1, opacity: 0, start: now });
    } else roots.push({ root, from: 1, to: 1, opacity: 1, start: now });
    currentRoot = root;
    refreshHighlights();
    frameObject(root, !cameraTween && roots.length === 1);
    setRootOpacity(root, root.userData.opacity);
  }
  function updateExplode(root, amount) {
    root.traverse(o => {
      if (o.userData.explodeOffset) o.position.copy(o.userData.basePosition).addScaledVector(o.userData.explodeOffset, amount);
    });
    root.updateMatrixWorld(true);
  }
  function frameObject(root, immediate = false) {
    // Fit real mesh bounds in camera space, with room for the stage heading and toolbar.
    // A width-only fit cuts off the near ELS when the board is viewed obliquely.
    updateExplode(root, normalizedExplode(state.explode));
    const points = [];
    const bounds = new THREE.Box3();
    root.traverse(o => {
      if (!o.isMesh || o.userData.excludeFromFit) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const local = o.geometry.boundingBox;
      for (const x of [local.min.x, local.max.x]) for (const y of [local.min.y, local.max.y]) for (const z of [local.min.z, local.max.z]) {
        const point = new THREE.Vector3(x, y, z).applyMatrix4(o.matrixWorld);
        points.push(point);
        bounds.expandByPoint(point);
      }
    });
    updateExplode(root, explodeCurrent);
    if (!points.length) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const direction = state.viewId === 'faraday' || ['garnet', 'coating', 'polarizer', 'analyzer', 'magnet', 'lens', 'collimator'].includes(state.viewId)
      ? new THREE.Vector3(1.25, 0.52, 0.82).normalize()
      : state.viewId === 'isolator' ? new THREE.Vector3(0.68, 0.63, 1.34).normalize()
        : new THREE.Vector3(0.87, 0.86, 1.08).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const tanX = tanY * camera.aspect;
    let distance = 2.2;
    for (const point of points) {
      const relative = point.clone().sub(center);
      const x = relative.dot(right), y = relative.dot(up), depth = relative.dot(direction);
      const verticalLimit = y >= 0 ? 0.66 : 0.79;
      distance = Math.max(distance, depth + Math.abs(x) / (tanX * 0.9), depth + Math.abs(y) / (tanY * verticalLimit));
    }
    distance *= 1.035;
    const target = center.clone();
    if (state.viewId === 'npo') {
      // The external source is close to the camera: center its visible silhouette higher.
      target.addScaledVector(up, -distance * tanY * 0.18);
      let closer = distance * 0.84;
      for (const point of points) {
        const relative = point.clone().sub(target);
        const x = relative.dot(right), y = relative.dot(up), depth = relative.dot(direction);
        closer = Math.max(closer, depth + Math.abs(x) / (tanX * 0.9), depth + Math.abs(y) / (tanY * (y >= 0 ? 0.66 : 0.79)));
      }
      distance = closer * 1.015;
    }
    const position = target.clone().addScaledVector(direction, distance);
    controls.minDistance = Math.max(0.65, distance * 0.18);
    controls.maxDistance = Math.max(12, distance * 3.5);
    if (immediate) {
      camera.position.copy(position);
      controls.target.copy(target);
      cameraTween = null;
      controls.update();
    } else {
      cameraTween = { start: performance.now(), fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: position, toTarget: target, duration: 800 };
    }
  }

  function setRootOpacity(root, opacity) {
    root.userData.opacity = opacity;
    root.traverse(o => {
      if (!o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.userData.baseOpacity === undefined) m.userData.baseOpacity = m.opacity;
        if (m.userData.baseTransparent === undefined) m.userData.baseTransparent = m.transparent;
        const desiredTransparent = m.userData.baseTransparent || opacity < 0.999;
        if (m.transparent !== desiredTransparent) { m.transparent = desiredTransparent; m.needsUpdate = true; }
        m.opacity = m.userData.baseOpacity * opacity;
      }
      if (o.isMesh) o.castShadow = opacity > 0.55;
    });
  }
  function semanticId(object) {
    let target = object;
    let id = null;
    while (target && target !== currentRoot.parent) {
      if (target.userData.nonInteractive || target.userData.decorative) return null;
      if (!id && target.userData.id) id = target.userData.id;
      target = target.parent;
    }
    return id;
  }
  function hasAncestorId(object, id) {
    if (!id) return false;
    const semantic = semanticId(object);
    if (semantic && state.nodes?.[semantic]) {
      let node = state.nodes[semantic];
      const visited = new Set();
      while (node && !visited.has(node.id)) {
        if (node.id === id) return true;
        visited.add(node.id);
        node = state.nodes[node.parent];
      }
      return false;
    }
    let target = object;
    while (target) {
      if (target.userData.nonInteractive) return false;
      if (target.userData.id === id) return true;
      target = target.parent;
    }
    return false;
  }
  function refreshHighlights() {
    currentRoot?.traverse(o => {
      if (!o.isMesh || !o.material.emissive) return;
      const base = o.material.userData.baseEmissive || new THREE.Color(0);
      o.material.emissive.copy(base);
      if (hasAncestorId(o, state.selectedId)) {
        o.material.emissive.lerp(new THREE.Color('#167ea7'), 0.3);
        o.material.emissiveIntensity = 0.72;
      } else if (hasAncestorId(o, hoveredId)) {
        o.material.emissive.lerp(new THREE.Color('#36b8d0'), 0.25);
        o.material.emissiveIntensity = 0.75;
      } else o.material.emissiveIntensity = 1;
    });
    for (const l of labels) {
      l.el.dataset.selected = String(l.id === state.selectedId);
      l.el.style.color = l.id && l.id === state.selectedId ? '#087d9d' : '';
      if (l.id === state.selectedId) l.el.style.background = 'rgba(230,249,252,.96)';
      else l.el.style.background = 'rgba(255,255,255,.88)';
    }
  }
  function changeHover(id, event) {
    if (hoveredId === id) { if (event) onHover?.(id, event); return; }
    hoveredId = id;
    renderer.domElement.style.cursor = id ? 'pointer' : controlsActive ? 'grabbing' : 'grab';
    refreshHighlights();
    onHover?.(id, event);
  }
  function pick(event) {
    if (!currentRoot) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(currentRoot, true);
    for (const hit of hits) {
      if (!hit.object.isMesh || hit.object.material?.opacity < 0.1) continue;
      const id = semanticId(hit.object);
      if (id) return id;
    }
    return null;
  }
  function activatePart(id) {
    if (!id || disposed) return;
    // Navigation is owned by the caller. Avoid repeating its enter action for this view,
    // so a second click does not reset the user's camera or explosion setting.
    if (id === state.viewId) {
      if (state.selectedId !== id) onSelect?.(id);
      return;
    }
    changeHover(null);
    if (onEnter) onEnter(id);
    else onSelect?.(id);
  }
  function pointerStart(event) {
    activePointers.add(event.pointerId);
    if (activePointers.size > 1) {
      if (pointerDown) pointerDown.dragged = true;
      cameraTween = null;
      return;
    }
    if (event.button !== 0 || event.isPrimary === false) return;
    pointerDown = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, id: pick(event), dragged: false };
  }
  function pointerEnd(event) {
    activePointers.delete(event.pointerId);
    if (!pointerDown || pointerDown.pointerId !== event.pointerId) return;
    const press = pointerDown;
    pointerDown = null;
    if (event.button !== 0 || press.dragged || activePointers.size > 0) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) >= 5) return;
    const id = pick(event);
    if (id && id === press.id) activatePart(id);
  }
  function pointerMove(event) {
    if (pointerDown && pointerDown.pointerId === event.pointerId) {
      if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) >= 5) pointerDown.dragged = true;
      if (pointerDown.dragged) { cameraTween = null; changeHover(null); return; }
    }
    if (activePointers.size > 1) return;
    changeHover(pick(event), event);
  }
  function pointerCancel(event) {
    activePointers.delete(event.pointerId);
    if (pointerDown?.pointerId === event.pointerId) pointerDown = null;
    changeHover(null);
  }
  function pointerLeave() { changeHover(null); if (pointerDown) pointerDown.dragged = true; }
  function cancelGesture() { activePointers.clear(); pointerDown = null; }
  function wheelStart() { cameraTween = null; }
  function controlStart() { controlsActive = true; if (!pointerDown) cameraTween = null; renderer.domElement.style.cursor = 'grabbing'; }
  function controlEnd() { controlsActive = false; renderer.domElement.style.cursor = hoveredId ? 'pointer' : 'grab'; }
  controls.addEventListener('start', controlStart);
  controls.addEventListener('end', controlEnd);
  renderer.domElement.addEventListener('pointerdown', pointerStart, true);
  renderer.domElement.addEventListener('pointerup', pointerEnd);
  renderer.domElement.addEventListener('pointermove', pointerMove);
  renderer.domElement.addEventListener('pointerleave', pointerLeave);
  renderer.domElement.addEventListener('pointercancel', pointerCancel);
  renderer.domElement.addEventListener('wheel', wheelStart, { passive: true });
  window.addEventListener('blur', cancelGesture);

  function updateLabels() {
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    const occupied = [];
    const sorted = [...labels].sort((a, b) => a.priority - b.priority);
    for (const l of sorted) {
      if (l.root !== currentRoot || l.root.userData.opacity < 0.5) { l.el.style.display = 'none'; continue; }
      l.anchor.getWorldPosition(projected);
      projected.project(camera);
      const x = (projected.x + 1) * w / 2, y = (-projected.y + 1) * h / 2;
      if (projected.z < -1 || projected.z > 1 || x < 18 || x > w - 18 || y < 28 || y > h - 16) { l.el.style.display = 'none'; continue; }
      l.el.style.display = 'block';
      l.width = l.el.offsetWidth || l.el.textContent.length * 9 + 20;
      l.height = l.el.offsetHeight || 24;
      const r = { x: x - l.width / 2 - 3, y: y - l.height - 3, width: l.width + 6, height: l.height + 6 };
      const collision = occupied.some(a => r.x < a.x + a.width && r.x + r.width > a.x && r.y < a.y + a.height && r.y + r.height > a.y);
      if (collision && l.id !== state.selectedId) { l.el.style.display = 'none'; continue; }
      occupied.push(r);
      l.el.style.left = `${Math.round(x)}px`;
      l.el.style.top = `${Math.round(y)}px`;
      l.el.style.opacity = String(l.root.userData.opacity);
    }
  }
  function disposeRoot(root) {
    scene.remove(root);
    const geometrySet = new Set(), materialSet = new Set();
    root.traverse(o => {
      if (o.geometry) geometrySet.add(o.geometry);
      if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materialSet.add(m);
    });
    for (const g of geometrySet) g.dispose();
    for (const m of materialSet) m.dispose();
    labels = labels.filter(l => { if (l.root === root) { l.el.remove(); return false; } return true; });
  }
  function resize() {
    if (disposed) return;
    const w = container.clientWidth, h = container.clientHeight;
    if (w < 10 || h < 10) return;
    const aspectChanged = Math.abs(camera.aspect - w / h) > 0.01;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    if (currentRoot && aspectChanged) frameObject(currentRoot, false);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  function animate(now) {
    if (disposed) return;
    raf = requestAnimationFrame(animate);
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    const targetExplode = normalizedExplode(state.explode);
    if (Math.abs(explodeCurrent - targetExplode) > 0.0005) {
      explodeCurrent = THREE.MathUtils.lerp(explodeCurrent, targetExplode, 1 - Math.exp(-dt * 7));
      if (currentRoot) updateExplode(currentRoot, explodeCurrent);
    }
    if (cameraTween) {
      const t = Math.min(1, (now - cameraTween.start) / cameraTween.duration);
      const e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      camera.position.lerpVectors(cameraTween.fromPos, cameraTween.toPos, e);
      controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, e);
      if (t >= 1) cameraTween = null;
    }
    for (const entry of roots) {
      const t = Math.min(1, (now - entry.start) / 800);
      const e = t * t * (3 - 2 * t);
      entry.opacity = THREE.MathUtils.lerp(entry.from, entry.to, e);
      if (t < 1 || Math.abs(entry.root.userData.opacity - entry.to) > 0.001) setRootOpacity(entry.root, entry.opacity);
    }
    const expired = roots.filter(e => e.to === 0 && now - e.start >= 800);
    if (expired.length) {
      for (const e of expired) disposeRoot(e.root);
      roots = roots.filter(e => !expired.includes(e));
    }
    controls.update();
    renderer.render(scene, camera);
    updateLabels();
  }
  function normalizedExplode(value) {
    if (value === true) return 1;
    if (value === false) return 0;
    return THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
  }
  buildScene();
  raf = requestAnimationFrame(animate);

  return {
    setState(next = {}) {
      if (disposed) return;
      const before = `${state.viewId}|${JSON.stringify(state.config)}|${JSON.stringify(state.quantities)}`;
      if (next.config) state.config = { ...state.config, ...next.config };
      if (next.quantities) state.quantities = next.quantities;
      if (next.nodes) state.nodes = next.nodes;
      if (next.viewId) state.viewId = next.viewId;
      if ('selectedId' in next) state.selectedId = next.selectedId;
      if ('explode' in next) state.explode = normalizedExplode(next.explode);
      const after = `${state.viewId}|${JSON.stringify(state.config)}|${JSON.stringify(state.quantities)}`;
      if (before !== after) { hoveredId = null; buildScene(); }
      else refreshHighlights();
    },
    reset() { if (!disposed && currentRoot) frameObject(currentRoot, false); },
    zoom(delta) {
      if (disposed) return;
      cameraTween = null;
      const offset = camera.position.clone().sub(controls.target);
      const value = Number(delta) || 0;
      const scale = Math.exp(value * 0.14);
      offset.setLength(THREE.MathUtils.clamp(offset.length() * scale, controls.minDistance, controls.maxDistance));
      camera.position.copy(controls.target).add(offset);
      controls.update();
    },
    setExplode(value) { state.explode = normalizedExplode(value); },
    capture() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', pointerStart, true);
      renderer.domElement.removeEventListener('pointerup', pointerEnd);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerleave', pointerLeave);
      renderer.domElement.removeEventListener('pointercancel', pointerCancel);
      renderer.domElement.removeEventListener('wheel', wheelStart);
      window.removeEventListener('blur', cancelGesture);
      for (const entry of roots) disposeRoot(entry.root);
      roots = [];
      floor.geometry.dispose();
      floor.material.dispose();
      Object.values(palette).forEach(m => m.dispose());
      environmentTarget.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      overlay.remove();
    },
  };
}
