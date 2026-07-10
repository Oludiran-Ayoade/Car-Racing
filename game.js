import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

let loadingProgress = 0;
function setStatus(msg) {
    console.log(msg);
    const lt = document.getElementById('loading-text');
    if (lt) lt.textContent = msg;
}

function clearStatus() {
    let el = document.getElementById('error-box');
    if (el) el.style.display = 'none';
}

// --- Configuration ---
const TRACK_SCALE = 1.0;
const ROAD_WIDTH = 32;
const ROAD_HALF_WIDTH = ROAD_WIDTH / 2;
const TOTAL_LAPS = 3;

const MAX_SPEED = 120;
const ACCELERATION = 65;
const REVERSE_SPEED = 30;
const REVERSE_ACCEL = 35;
const FRICTION = 28;
const BRAKE_FORCE = 90;
const TURN_SPEED = 2.6;
const DRIFT_FACTOR = 0.6;
const OFF_ROAD_FRICTION = 15;
const OFF_ROAD_MAX_SPEED = 70;
const BOOST_SPEED = 160;
const BOOST_DURATION = 1.2;

// --- Car configurations ---
const CAR_CONFIGS = [
    { name: 'Speedster', path: 'cargame/cars/car1', speed: 130, accel: 70, handling: 2.8, weight: 0.8, scale: 1.0, color: 0xff3366 },
    { name: 'Roadster',  path: 'cargame/cars/car2', speed: 115, accel: 60, handling: 3.0, weight: 0.9, scale: 1.0, color: 0x3366ff },
    { name: 'Bulldog',   path: 'cargame/cars/car3', speed: 100, accel: 55, handling: 2.2, weight: 1.2, scale: 1.0, color: 0x33cc33 },
    { name: 'Falcon',    path: 'cargame/cars/car4', speed: 140, accel: 75, handling: 2.5, weight: 0.7, scale: 1.0, color: 0xffcc00 },
    { name: 'Viper',     path: 'cargame/cars/car5', speed: 125, accel: 65, handling: 2.7, weight: 0.85, scale: 1.0, color: 0xcc33ff },
];
let selectedCarIndex = 0;
let playerKart = null;
let carModels = [null, null, null, null, null];
let treeModel = null;
const treeColliders = [];
let assetsLoaded = false;
let selectedCarColor = 0xff3366;
let screenShake = 0;
let driftBoostTimer = 0;
let driftAccumulator = 0;
let playerItem = null; // 'boost', 'shield', 'oil'
let itemBoxCooldown = 0;
let ghostData = [];
let isRecordingGhost = false;
let isPlayingGhost = false;
let ghostKart = null;
let ghostIndex = 0;
let bestLapTime = null;
let lastLapTime = null;
let topSpeed = 0;
let aiKarts = [];
let particleSystems = [];
let engineSound = null;
let soundEnabled = true;
let audioCtx = null;

// --- Scene setup ---
setStatus('Initializing renderer...');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Gradient sky with sun and soft clouds
const skyGeo = new THREE.SphereGeometry(400, 32, 16);
const skyMat = new THREE.ShaderMaterial({
    uniforms: {
        topColor: { value: new THREE.Color(0x1188ee) },
        bottomColor: { value: new THREE.Color(0xc8e6ff) },
        sunColor: { value: new THREE.Color(0xfffee0) },
        sunPosition: { value: new THREE.Vector3(0.6, 0.25, -0.75) },
        offset: { value: 28 },
        exponent: { value: 0.5 }
    },
    vertexShader: 'varying vec3 vWorldPosition; void main() { vec4 worldPosition = modelMatrix * vec4(position, 1.0); vWorldPosition = worldPosition.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
        uniform vec3 topColor; uniform vec3 bottomColor; uniform vec3 sunColor;
        uniform vec3 sunPosition; uniform float offset; uniform float exponent;
        varying vec3 vWorldPosition;
        float noise(vec3 p) { return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
        void main() {
            vec3 dir = normalize(vWorldPosition + offset);
            float h = dir.y;
            vec3 sky = mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0));
            // sun disk
            float sunDot = max(dot(dir, normalize(sunPosition)), 0.0);
            float sun = pow(sunDot, 220.0) * 0.25;
            sky += sunColor * sun;
            // very subtle clouds near horizon
            float n = noise(dir * 40.0) * 0.5 + noise(dir * 80.0) * 0.25;
            float cloud = smoothstep(0.35, 0.65, n) * smoothstep(0.15, 0.45, h) * smoothstep(0.0, 0.25, 1.0 - h);
            sky = mix(sky, vec3(1.0), cloud * 0.05);
            gl_FragColor = vec4(sky, 1.0);
        }`,
    side: THREE.BackSide
});
skyMat.fog = false;
const sky = new THREE.Mesh(skyGeo, skyMat);
scene.add(sky);
// No global fog so the far distance keeps real colors

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);

// --- Lights ---
const hemiLight = new THREE.HemisphereLight(0xeef6ff, 0xb0c0a0, 0.75);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xfff5e0, 1.5);
dirLight.position.set(80, 120, 60);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(1024, 1024);
dirLight.shadow.camera.left = -160;
dirLight.shadow.camera.right = 160;
dirLight.shadow.camera.top = 160;
dirLight.shadow.camera.bottom = -160;
dirLight.shadow.camera.near = 10;
dirLight.shadow.camera.far = 400;
scene.add(dirLight);

// Post-processing: bloom for bright highlights
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.18, 0.4, 0.8);
composer.addPass(bloomPass);

// --- Ground ---
function createGrassTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#4a8a4a';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 80000; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const g = Math.floor(50 + Math.random() * 90);
        ctx.fillStyle = `rgba(${g},${g + 25},${g},0.12)`;
        ctx.fillRect(x, y, 2, 2);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(40, 40);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

const groundGeo = new THREE.PlaneGeometry(1000, 1000);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x559955, map: createGrassTexture(), roughness: 1, metalness: 0 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.05;
ground.receiveShadow = true;
scene.add(ground);

// Distant mountain/hill ring for a real horizon
function addHorizonMountains() {
    const mountainMat = new THREE.MeshStandardMaterial({
        color: 0x3a5c3a,
        roughness: 0.95,
        flatShading: true
    });
    const radius = 420;
    const count = 64;
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const nextAngle = ((i + 1) / count) * Math.PI * 2;
        const r = radius + Math.random() * 60;
        const h = 25 + Math.random() * 55;
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        const nx = Math.cos(nextAngle) * r;
        const nz = Math.sin(nextAngle) * r;
        // Create a ridge segment between this point and the next
        const midX = (x + nx) / 2;
        const midZ = (z + nz) / 2;
        const len = Math.sqrt((nx - x) ** 2 + (nz - z) ** 2) + 10;
        const ridge = new THREE.Mesh(new THREE.ConeGeometry(len * 0.8, h, 4), mountainMat);
        ridge.position.set(midX, h / 2 - 5, midZ);
        ridge.rotation.y = -angle;
        ridge.rotation.z = Math.PI / 12;
        ridge.castShadow = true;
        ridge.receiveShadow = true;
        scene.add(ridge);
    }
}
addHorizonMountains();

// --- Track generation ---
setStatus('Building track...');
const trackPoints = [
    new THREE.Vector3(0, 0, 60),
    new THREE.Vector3(40, 0, 50),
    new THREE.Vector3(70, 0, 20),
    new THREE.Vector3(90, 0, -30),
    new THREE.Vector3(70, 0, -80),
    new THREE.Vector3(30, 0, -100),
    new THREE.Vector3(-30, 0, -90),
    new THREE.Vector3(-70, 0, -60),
    new THREE.Vector3(-90, 0, -20),
    new THREE.Vector3(-80, 0, 30),
    new THREE.Vector3(-50, 0, 60),
    new THREE.Vector3(-20, 0, 70),
].map(p => p.multiplyScalar(TRACK_SCALE));

const curve = new THREE.CatmullRomCurve3(trackPoints, true);
curve.tension = 0.4;

const TRACK_SEGMENTS = 320;
const curvePoints = curve.getSpacedPoints(TRACK_SEGMENTS);
const frames = curve.computeFrenetFrames(TRACK_SEGMENTS, true);

// Build road mesh
const roadGeo = new THREE.BufferGeometry();
const roadVertices = [];
const roadUvs = [];
const roadIndices = [];
const up = new THREE.Vector3(0, 1, 0);

for (let i = 0; i <= TRACK_SEGMENTS; i++) {
    const idx = i % TRACK_SEGMENTS;
    const p = curvePoints[idx];
    const tangent = frames.tangents[idx].clone().normalize();
    const binormal = tangent.clone().cross(up).normalize();

    const left = p.clone().add(binormal.clone().multiplyScalar(ROAD_HALF_WIDTH));
    const right = p.clone().sub(binormal.clone().multiplyScalar(ROAD_HALF_WIDTH));

    roadVertices.push(left.x, left.y + 0.02, left.z);
    roadVertices.push(right.x, right.y + 0.02, right.z);

    const u = i / TRACK_SEGMENTS;
    roadUvs.push(0, u);
    roadUvs.push(1, u);
}

for (let i = 0; i < TRACK_SEGMENTS; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = i * 2 + 2;
    const d = i * 2 + 3;
    roadIndices.push(a, b, c);
    roadIndices.push(b, d, c);
}

roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadVertices, 3));
roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
roadGeo.setIndex(roadIndices);
roadGeo.computeVertexNormals();

function createAsphaltTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#161616';
    ctx.fillRect(0, 0, 1024, 1024);
    // noise
    for (let i = 0; i < 120000; i++) {
        const x = Math.random() * 1024;
        const y = Math.random() * 1024;
        const g = Math.floor(20 + Math.random() * 45);
        ctx.fillStyle = `rgba(${g},${g},${g},0.14)`;
        ctx.fillRect(x, y, 2, 2);
    }
    // dashed lane markings (two lines per road width)
    ctx.fillStyle = '#eeeeee';
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 2;
    const laneX1 = 1024 * 0.25;
    const laneX2 = 1024 * 0.75;
    const dashH = 60;
    const gapH = 60;
    const lineW = 8;
    for (let y = -dashH; y < 1024 + dashH; y += dashH + gapH) {
        ctx.fillRect(laneX1 - lineW / 2, y, lineW, dashH);
        ctx.fillRect(laneX2 - lineW / 2, y, lineW, dashH);
    }
    ctx.shadowBlur = 0;
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 1);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
}

const asphaltMap = createAsphaltTexture();
const roadMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    map: asphaltMap,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.3
});
const road = new THREE.Mesh(roadGeo, roadMat);
road.receiveShadow = true;
scene.add(road);

// Track borders / curbs
const curbGeo = new THREE.BufferGeometry();
const curbVertices = [];
const curbIndices = [];
for (let i = 0; i <= TRACK_SEGMENTS; i++) {
    const idx = i % TRACK_SEGMENTS;
    const p = curvePoints[idx];
    const tangent = frames.tangents[idx].clone().normalize();
    const binormal = tangent.clone().cross(up).normalize();

    const leftOuter = p.clone().add(binormal.clone().multiplyScalar(ROAD_HALF_WIDTH + 1.2));
    const leftInner = p.clone().add(binormal.clone().multiplyScalar(ROAD_HALF_WIDTH));
    const rightOuter = p.clone().sub(binormal.clone().multiplyScalar(ROAD_HALF_WIDTH + 1.2));
    const rightInner = p.clone().sub(binormal.clone().multiplyScalar(ROAD_HALF_WIDTH));

    const base = i * 4;
    curbVertices.push(leftOuter.x, leftOuter.y + 0.25, leftOuter.z);
    curbVertices.push(leftInner.x, leftInner.y + 0.25, leftInner.z);
    curbVertices.push(rightOuter.x, rightOuter.y + 0.25, rightOuter.z);
    curbVertices.push(rightInner.x, rightInner.y + 0.25, rightInner.z);

    if (i < TRACK_SEGMENTS) {
        curbIndices.push(base, base + 1, base + 4, base + 1, base + 5, base + 4);
        curbIndices.push(base + 2, base + 6, base + 3, base + 3, base + 6, base + 7);
    }
}
curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(curbVertices, 3));
curbGeo.setIndex(curbIndices);
curbGeo.computeVertexNormals();
const curbMat = new THREE.MeshStandardMaterial({ color: 0xff3333, roughness: 0.75, metalness: 0.05 });
const curb = new THREE.Mesh(curbGeo, curbMat);
curb.receiveShadow = true;
scene.add(curb);

// Checkpoints for lap counting
const CHECKPOINT_COUNT = 16;
const checkpoints = [];
for (let i = 0; i < CHECKPOINT_COUNT; i++) {
    const t = i / CHECKPOINT_COUNT;
    const p = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).clone().normalize();
    const normal = tangent.clone().cross(up).normalize();
    checkpoints.push({ center: p, normal: normal, index: i });
}

// Start/finish line marker — checkered pattern
const startPoint = checkpoints[0].center.clone();
const startNormal = checkpoints[0].normal.clone();
const startTangent = curve.getTangentAt(0).clone().normalize();

// Create checkered texture for finish line
const checkerCanvas = document.createElement('canvas');
checkerCanvas.width = 64;
checkerCanvas.height = 64;
const cctx = checkerCanvas.getContext('2d');
const sqSize = 8;
for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
        cctx.fillStyle = (row + col) % 2 === 0 ? '#ffffff' : '#000000';
        cctx.fillRect(col * sqSize, row * sqSize, sqSize, sqSize);
    }
}
const checkerTexture = new THREE.CanvasTexture(checkerCanvas);
checkerTexture.wrapS = THREE.RepeatWrapping;
checkerTexture.wrapT = THREE.RepeatWrapping;
checkerTexture.repeat.set(4, 1);

const finishLineGeo = new THREE.PlaneGeometry(ROAD_WIDTH + 2, 4);
const finishLineMat = new THREE.MeshStandardMaterial({
    map: checkerTexture,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
    roughness: 0.7
});
const finishLine = new THREE.Mesh(finishLineGeo, finishLineMat);
finishLine.position.copy(startPoint);
finishLine.position.y = 0.03;
finishLine.lookAt(startPoint.clone().add(startNormal));
finishLine.rotateX(-Math.PI / 2);
scene.add(finishLine);

// Grandstand bleachers near start/finish
function addGrandstands() {
    const standMat = new THREE.MeshStandardMaterial({ color: 0x888899, roughness: 0.8 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.7 });
    const seatColors = [0x3366cc, 0xcc3333, 0x33aa33, 0xcccc33];
    for (const side of [-1, 1]) {
        const base = startPoint.clone().add(startNormal.clone().multiplyScalar(side * (ROAD_HALF_WIDTH + 4)));
        const standGroup = new THREE.Group();
        // Tiered seating
        for (let row = 0; row < 5; row++) {
            const seatMat = new THREE.MeshStandardMaterial({ color: seatColors[row % seatColors.length], roughness: 0.85 });
            const seatGeo = new THREE.BoxGeometry(16, 0.6, 1.2);
            const seat = new THREE.Mesh(seatGeo, seatMat);
            seat.position.set(0, 0.3 + row * 0.7, side * (row * 0.8));
            seat.castShadow = true;
            standGroup.add(seat);
        }
        // Roof
        const roofGeo = new THREE.BoxGeometry(17, 0.3, 6);
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.set(0, 4.5, side * 2.5);
        roof.castShadow = true;
        standGroup.add(roof);
        // Support pillars
        for (let px = -7; px <= 7; px += 7) {
            const pillarGeo = new THREE.CylinderGeometry(0.2, 0.2, 4.5, 6);
            const pillar = new THREE.Mesh(pillarGeo, standMat);
            pillar.position.set(px, 2.25, side * 2);
            pillar.castShadow = true;
            standGroup.add(pillar);
        }
        standGroup.position.set(base.x, 0, base.z);
        standGroup.rotation.y = Math.atan2(startTangent.x, startTangent.z);
        scene.add(standGroup);
    }
}
addGrandstands();

// --- Audio system ---
function initAudio() {
    if (audioCtx) return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        // Engine sound: oscillator with pitch based on speed
        engineSound = audioCtx.createOscillator();
        engineSound.type = 'sawtooth';
        engineSound.frequency.value = 80;
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0;
        engineSound.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        engineSound.start();
        engineSound._gain = gainNode;
    } catch(e) { console.warn('Audio init failed:', e); }
}

function playSound(type) {
    if (!audioCtx || !soundEnabled) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    if (type === 'boost') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.3);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc.start(now); osc.stop(now + 0.4);
    } else if (type === 'crash') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.2);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now); osc.stop(now + 0.3);
    } else if (type === 'item') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.15);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now); osc.stop(now + 0.2);
    } else if (type === 'lap') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523, now);
        osc.frequency.setValueAtTime(659, now + 0.1);
        osc.frequency.setValueAtTime(784, now + 0.2);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc.start(now); osc.stop(now + 0.4);
    }
}

let squealSound = null;
function updateEngineSound(speed) {
    if (!engineSound || !audioCtx || !soundEnabled) return;
    const throttle = keys.up ? 1 : 0;
    const freq = 60 + Math.abs(speed) * 2.2 + throttle * 20;
    // Engine audible when throttle or coasting at speed; idle silent
    const vol = (gameState === GAME_STATE.PLAYING && (keys.up || Math.abs(speed) > 10)) ? (0.04 + throttle * 0.03) : 0;
    engineSound.frequency.value += (freq - engineSound.frequency.value) * 0.1;
    engineSound._gain.gain.value += (vol - engineSound._gain.gain.value) * 0.1;

    // Tire squeal during hard drift/brake slides
    const sliding = keys.brake && Math.abs(speed) > 30 && (keys.left || keys.right);
    if (sliding) {
        if (!squealSound) {
            squealSound = audioCtx.createOscillator();
            squealSound.type = 'sawtooth';
            const g = audioCtx.createGain();
            g.gain.value = 0;
            squealSound.connect(g);
            g.connect(audioCtx.destination);
            squealSound.start();
            squealSound._gain = g;
        }
        squealSound.frequency.value = 400 + Math.abs(speed) * 4;
        squealSound._gain.gain.value = 0.06;
    } else if (squealSound) {
        squealSound._gain.gain.value *= 0.9;
        if (squealSound._gain.gain.value < 0.001) {
            squealSound.stop();
            squealSound = null;
        }
    }
}

// --- Asset loading ---
const objLoader = new OBJLoader();
const textureLoader = new THREE.TextureLoader();

function loadOBJWithTexture(path) {
    return new Promise((resolve, reject) => {
        const tex = new THREE.TextureLoader();
        tex.load(path + '/texture_diffuse.png', (texture) => {
            texture.flipY = false;
            const mat = new THREE.MeshStandardMaterial({
                map: texture,
                roughness: 0.6,
                metalness: 0.3,
            });
            objLoader.load(path + '/base.obj', (obj) => {
                obj.traverse(child => {
                    if (child.isMesh) {
                        child.material = mat;
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });
                resolve(obj);
            }, undefined, reject);
        }, undefined, reject);
    });
}

// Normalize model to fit within a target size
function normalizeModel(obj, targetSize) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = targetSize / maxDim;
    obj.scale.setScalar(scale);
    // Re-center on ground
    const newBox = new THREE.Box3().setFromObject(obj);
    const center = newBox.getCenter(new THREE.Vector3());
    obj.position.x = -center.x;
    obj.position.y = -newBox.min.y;
    obj.position.z = -center.z;
    return obj;
}

// Load tree model
setStatus('Loading tree model...');
const treeLoadPromise = loadOBJWithTexture('cargame/tree').then(obj => {
    treeModel = normalizeModel(obj, 4.5);
}).catch(err => {
    console.error('Tree load error:', err);
    setStatus('Tree load failed: ' + err.message);
});

// Load all car models
setStatus('Loading car models...');
const carLoadPromises = CAR_CONFIGS.map((cfg, i) => {
    return loadOBJWithTexture(cfg.path).then(obj => {
        carModels[i] = normalizeModel(obj, 3.5);
        setStatus(`Loaded car ${i + 1}/${CAR_CONFIGS.length}...`);
    }).catch(err => {
        console.error(`Car ${i} load error:`, err);
    });
});

// --- Scenery: trees, rocks, fences and billboards ---
function addScenery() {
    const rockGeo = new THREE.DodecahedronGeometry(1.2);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.9 });

    for (let i = 0; i < 90; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 28 + Math.random() * 140;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        const point = new THREE.Vector3(x, 0, z);
        let nearRoad = false;
        for (const cp of curvePoints) {
            if (cp.distanceTo(point) < ROAD_HALF_WIDTH + 6) {
                nearRoad = true;
                break;
            }
        }
        if (nearRoad) continue;

        if (Math.random() > 0.3 && treeModel) {
            const tree = treeModel.clone();
            tree.position.set(x, 0, z);
            const scale = 0.7 + Math.random() * 0.6;
            tree.scale.multiplyScalar(scale);
            tree.rotation.y = Math.random() * Math.PI * 2;
            scene.add(tree);
            treeColliders.push({ x: x, z: z, radius: 1.5 * scale });
        } else {
            const rock = new THREE.Mesh(rockGeo, rockMat);
            rock.position.set(x, 0.6, z);
            rock.scale.setScalar(0.7 + Math.random() * 0.8);
            rock.rotation.set(Math.random(), Math.random(), Math.random());
            rock.castShadow = true;
            scene.add(rock);
        }
    }
}

function addTracksideDetails() {
    const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.4, 8);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.6 });
    const railGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 8);
    const railMat = new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: 0.5 });
    const fenceCount = Math.floor(curve.getLength() / 4);
    for (let i = 0; i < fenceCount; i++) {
        const t = i / fenceCount;
        const p = curve.getPointAt(t);
        const tangent = curve.getTangentAt(t).clone().normalize();
        const normal = tangent.clone().cross(up).normalize();
        const side = i % 2 === 0 ? 1 : -1;
        const offset = ROAD_HALF_WIDTH + 2.4;
        const pos = p.clone().add(normal.clone().multiplyScalar(side * offset));
        pos.y += 0.05;

        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(pos.x, 0.7, pos.z);
        post.castShadow = true;
        scene.add(post);

        const rail = new THREE.Mesh(railGeo, railMat);
        rail.position.set(pos.x, 1.25, pos.z);
        rail.scale.z = 0.2;
        rail.rotation.y = Math.atan2(tangent.x, tangent.z);
        scene.add(rail);
    }
}

const trackBarriers = [];
function addTrackBarriers() {
    // Smooth continuous tube walls that follow the road edges
    const sampleCount = 300;
    const wallOffset = ROAD_HALF_WIDTH + 0.5;
    const leftPoints = [];
    const rightPoints = [];

    for (let i = 0; i <= sampleCount; i++) {
        const t = i / sampleCount;
        const p = curve.getPointAt(t);
        const tangent = curve.getTangentAt(t).clone().normalize();
        const normal = tangent.clone().cross(up).normalize();
        leftPoints.push(p.clone().add(normal.clone().multiplyScalar(wallOffset)));
        rightPoints.push(p.clone().add(normal.clone().multiplyScalar(-wallOffset)));
    }

    const leftCurve = new THREE.CatmullRomCurve3(leftPoints, true);
    const rightCurve = new THREE.CatmullRomCurve3(rightPoints, true);
    const wallTex = createAsphaltTexture(); // reuse noisy dark texture
    wallTex.repeat.set(20, 1);
    const wallMat = new THREE.MeshStandardMaterial({
        color: 0xaa3333,
        map: wallTex,
        roughness: 0.9,
        metalness: 0.0
    });
    const wallGeo = new THREE.TubeGeometry(leftCurve, sampleCount, 0.6, 10, true);
    const wallLeft = new THREE.Mesh(wallGeo, wallMat);
    wallLeft.castShadow = true;
    wallLeft.receiveShadow = true;
    scene.add(wallLeft);

    const wallGeoRight = new THREE.TubeGeometry(rightCurve, sampleCount, 0.6, 10, true);
    const wallRight = new THREE.Mesh(wallGeoRight, wallMat);
    wallRight.castShadow = true;
    wallRight.receiveShadow = true;
    scene.add(wallRight);

    // Build collision points from the same curves
    const colliderCount = Math.floor(curve.getLength() / 2.5);
    for (let i = 0; i < colliderCount; i++) {
        const t = i / colliderCount;
        const p = curve.getPointAt(t);
        const tangent = curve.getTangentAt(t).clone().normalize();
        const normal = tangent.clone().cross(up).normalize();
        for (const side of [-1, 1]) {
            const pos = p.clone().add(normal.clone().multiplyScalar(side * wallOffset));
            trackBarriers.push({ x: pos.x, z: pos.z, normal: new THREE.Vector3(side * normal.x, 0, side * normal.z), radius: 0.8 });
        }
    }
}

// Place scenery after tree model loads
treeLoadPromise.then(() => {
    setStatus('Placing scenery...');
    addScenery();
    addTracksideDetails();
    addTrackBarriers();
    setStatus('Scenery ready.');
});

// --- Item boxes (redesigned) ---
const itemBoxes = [];
function createItemBoxMesh() {
    const group = new THREE.Group();
    // Inner glowing core
    const coreGeo = new THREE.OctahedronGeometry(0.6, 0);
    const coreMat = new THREE.MeshStandardMaterial({
        color: 0xff44ff, emissive: 0xff00ff, emissiveIntensity: 0.8,
        roughness: 0.2, metalness: 0.3
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    group.add(core);
    // Outer wireframe shell
    const shellGeo = new THREE.OctahedronGeometry(0.95, 0);
    const shellMat = new THREE.MeshBasicMaterial({
        color: 0xff88ff, wireframe: true, transparent: true, opacity: 0.5
    });
    const shell = new THREE.Mesh(shellGeo, shellMat);
    group.add(shell);
    // Ring around the box
    const ringGeo = new THREE.TorusGeometry(1.1, 0.06, 8, 32);
    const ringMat = new THREE.MeshStandardMaterial({
        color: 0xffccff, emissive: 0xff44ff, emissiveIntensity: 0.5,
        roughness: 0.3, metalness: 0.5
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    group.userData = { core, shell, ring };
    return group;
}
for (let i = 0; i < 4; i++) {
    const t = 0.1 + i * 0.22;
    const p = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).clone().normalize();
    const normal = tangent.clone().cross(up).normalize();
    const offset = (i % 2 === 0 ? 1 : -1) * 3;
    const box = createItemBoxMesh();
    box.position.set(p.x + normal.x * offset, 1.2, p.z + normal.z * offset);
    box.userData.active = true;
    box.userData.respawnTimer = 0;
    box.traverse(c => { if (c.isMesh) c.castShadow = true; });
    scene.add(box);
    itemBoxes.push(box);
}

// --- Particle system for dust/sparks ---
function createParticleBurst(position, color, count = 15, lifetime = 0.6) {
    const particles = [];
    for (let i = 0; i < count; i++) {
        const geo = new THREE.SphereGeometry(0.15, 4, 4);
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 });
        const p = new THREE.Mesh(geo, mat);
        p.position.copy(position);
        p.userData = {
            vx: (Math.random() - 0.5) * 8,
            vy: Math.random() * 5,
            vz: (Math.random() - 0.5) * 8,
            life: lifetime
        };
        scene.add(p);
        particles.push(p);
    }
    particleSystems.push(particles);
}

// Soft smoke puffs (exhaust / tire smoke)
let smokeParticles = [];
function createSmokePuff(position, scale = 0.3, color = 0xaaaaaa, spread = 0.5) {
    const geo = new THREE.SphereGeometry(scale, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false });
    const p = new THREE.Mesh(geo, mat);
    p.position.copy(position);
    p.position.x += (Math.random() - 0.5) * spread;
    p.position.z += (Math.random() - 0.5) * spread;
    p.userData = {
        vx: (Math.random() - 0.5) * 2,
        vy: 0.8 + Math.random() * 0.5,
        vz: (Math.random() - 0.5) * 2,
        grow: 0.8 + Math.random() * 0.5,
        life: 1.0 + Math.random() * 0.5,
        maxLife: 1.0 + Math.random() * 0.5
    };
    scene.add(p);
    smokeParticles.push(p);
}

function updateSmoke(dt) {
    for (let i = smokeParticles.length - 1; i >= 0; i--) {
        const p = smokeParticles[i];
        p.userData.life -= dt;
        if (p.userData.life <= 0) {
            scene.remove(p);
            p.geometry.dispose();
            p.material.dispose();
            smokeParticles.splice(i, 1);
            continue;
        }
        const t = p.userData.life / p.userData.maxLife;
        p.position.x += p.userData.vx * dt;
        p.position.y += p.userData.vy * dt;
        p.position.z += p.userData.vz * dt;
        p.scale.addScalar(p.userData.grow * dt);
        p.material.opacity = 0.35 * t;
    }
}

function updateSkidMarks(dt) {
    for (let i = skidMarks.length - 1; i >= 0; i--) {
        const sm = skidMarks[i];
        sm.life -= dt;
        sm.mesh.material.opacity = Math.max(0, sm.life / 2.0 * 0.7);
        if (sm.life <= 0) {
            scene.remove(sm.mesh);
            skidMarks.splice(i, 1);
        }
    }
}

function updateParticles(dt) {
    for (let pi = particleSystems.length - 1; pi >= 0; pi--) {
        const ps = particleSystems[pi];
        let allDead = true;
        for (const p of ps) {
            if (p.userData.life > 0) {
                allDead = false;
                p.userData.life -= dt;
                p.position.x += p.userData.vx * dt;
                p.position.y += p.userData.vy * dt;
                p.position.z += p.userData.vz * dt;
                p.userData.vy -= 15 * dt;
                p.material.opacity = Math.max(0, p.userData.life / 0.6 * 0.8);
                if (p.userData.life <= 0) {
                    scene.remove(p);
                }
            }
        }
        if (allDead) particleSystems.splice(pi, 1);
    }
}

// --- Boost pads (redesigned) ---
const boostPads = [];
function createBoostPadMesh(p, tangent, normal) {
    const group = new THREE.Group();
    // Base plate
    const baseGeo = new THREE.PlaneGeometry(ROAD_WIDTH - 2, 5);
    const baseMat = new THREE.MeshStandardMaterial({
        color: 0x002244, roughness: 0.4, metalness: 0.6,
        emissive: 0x001133, emissiveIntensity: 0.3
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.rotation.x = -Math.PI / 2;
    group.add(base);
    // Animated chevron arrows
    const chevronCount = 4;
    for (let i = 0; i < chevronCount; i++) {
        const chevGeo = new THREE.PlaneGeometry(ROAD_WIDTH - 4, 0.8);
        const chevCanvas = document.createElement('canvas');
        chevCanvas.width = 256;
        chevCanvas.height = 64;
        const cctx = chevCanvas.getContext('2d');
        cctx.clearRect(0, 0, 256, 64);
        // Draw chevron arrows pointing forward
        cctx.fillStyle = `rgba(0,255,${150 + i * 25},0.9)`;
        cctx.beginPath();
        cctx.moveTo(200, 32);
        cctx.lineTo(160, 8);
        cctx.lineTo(170, 32);
        cctx.lineTo(160, 56);
        cctx.closePath();
        cctx.fill();
        cctx.fillStyle = `rgba(0,255,${100 + i * 30},0.7)`;
        cctx.beginPath();
        cctx.moveTo(130, 32);
        cctx.lineTo(90, 8);
        cctx.lineTo(100, 32);
        cctx.lineTo(90, 56);
        cctx.closePath();
        cctx.fill();
        cctx.fillStyle = `rgba(0,255,${80 + i * 35},0.5)`;
        cctx.beginPath();
        cctx.moveTo(60, 32);
        cctx.lineTo(20, 8);
        cctx.lineTo(30, 32);
        cctx.lineTo(20, 56);
        cctx.closePath();
        cctx.fill();
        const chevTex = new THREE.CanvasTexture(chevCanvas);
        const chevMat = new THREE.MeshBasicMaterial({
            map: chevTex, transparent: true, opacity: 0.9,
            blending: THREE.AdditiveBlending, depthWrite: false
        });
        const chev = new THREE.Mesh(chevGeo, chevMat);
        chev.rotation.x = -Math.PI / 2;
        chev.position.z = -1.5 + i * 1.2;
        chev.position.y = 0.02 + i * 0.01;
        group.add(chev);
    }
    // Edge glow strips
    const edgeGeo = new THREE.BoxGeometry(ROAD_WIDTH - 2, 0.1, 0.2);
    const edgeMat = new THREE.MeshStandardMaterial({
        color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 1.0
    });
    const edgeFront = new THREE.Mesh(edgeGeo, edgeMat);
    edgeFront.position.set(0, 0.05, 2.5);
    group.add(edgeFront);
    const edgeBack = new THREE.Mesh(edgeGeo, edgeMat);
    edgeBack.position.set(0, 0.05, -2.5);
    group.add(edgeBack);
    // Position and orient
    group.position.copy(p);
    group.position.y = 0.06;
    group.lookAt(p.clone().add(normal));
    group.userData = { chevrons: group.children.filter(c => c.material && c.material.map) };
    return group;
}
for (let i = 0; i < 3; i++) {
    const t = 0.2 + i * 0.25;
    const p = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).clone().normalize();
    const normal = tangent.clone().cross(up).normalize();
    const pad = createBoostPadMesh(p, tangent, normal);
    scene.add(pad);
    boostPads.push(pad);
}

// --- Game state ---
const GAME_STATE = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', FINISHED: 'finished' };
let gameState = GAME_STATE.MENU;

const kartState = {
    position: startPoint.clone().sub(startTangent.clone().multiplyScalar(8)),
    velocity: 0,
    heading: Math.atan2(startTangent.x, startTangent.z),
    boostTimer: 0,
    lap: 1,
    checkpointIndex: 0,
    finished: false,
    startTime: performance.now(),
    lapStartTime: performance.now(),
    driftTimer: 0,
    shieldTimer: 0,
    progress: 0 // for position tracking
};

// --- Input ---
const keys = { up: false, down: false, left: false, right: false, brake: false, reset: false };

window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        togglePause();
        return;
    }
    if (gameState !== GAME_STATE.PLAYING) return;

    switch (e.code) {
        case 'ArrowUp':
        case 'KeyW': keys.up = true; break;
        case 'ArrowDown':
        case 'KeyS': keys.down = true; break;
        case 'ArrowLeft':
        case 'KeyA': keys.left = true; break;
        case 'ArrowRight':
        case 'KeyD': keys.right = true; break;
        case 'Space': keys.brake = true; e.preventDefault(); break;
        case 'KeyR': resetKart(); break;
        case 'KeyE': case 'Enter': useItem(); break;
    }
});

window.addEventListener('keyup', (e) => {
    switch (e.code) {
        case 'ArrowUp':
        case 'KeyW': keys.up = false; break;
        case 'ArrowDown':
        case 'KeyS': keys.down = false; break;
        case 'ArrowLeft':
        case 'KeyA': keys.left = false; break;
        case 'ArrowRight':
        case 'KeyD': keys.right = false; break;
        case 'Space': keys.brake = false; break;
    }
});

// --- Helpers ---
let lastTrackIndex = 0;
function getClosestTrackDistance(point) {
    let minDist = Infinity;
    const searchRange = 20;
    const len = curvePoints.length;
    for (let offset = -searchRange; offset <= searchRange; offset++) {
        const idx = ((lastTrackIndex + offset) % len + len) % len;
        const d = curvePoints[idx].distanceTo(point);
        if (d < minDist) {
            minDist = d;
            lastTrackIndex = idx;
        }
    }
    return minDist;
}

function getClosestTrackPoint(point) {
    let minDist = Infinity;
    let closest = curvePoints[0];
    const searchRange = 20;
    const len = curvePoints.length;
    for (let offset = -searchRange; offset <= searchRange; offset++) {
        const idx = ((lastTrackIndex + offset) % len + len) % len;
        const d = curvePoints[idx].distanceTo(point);
        if (d < minDist) {
            minDist = d;
            closest = curvePoints[idx];
            lastTrackIndex = idx;
        }
    }
    return { point: closest, distance: minDist };
}

function clampToRoad(pos) {
    const result = getClosestTrackPoint(pos);
    const dist = result.distance;
    if (dist > ROAD_HALF_WIDTH - 0.8) {
        const dir = new THREE.Vector3().subVectors(pos, result.point).normalize();
        const clamped = result.point.clone().add(dir.multiplyScalar(ROAD_HALF_WIDTH - 0.8));
        return { x: clamped.x, z: clamped.z, hit: true };
    }
    return { x: pos.x, z: pos.z, hit: false };
}

function showMessage(text, duration = 2000) {
    const msgEl = document.getElementById('message');
    msgEl.textContent = text;
    msgEl.classList.remove('hidden');
    setTimeout(() => msgEl.classList.add('hidden'), duration);
}

function resetKart() {
    kartState.position.copy(startPoint.clone().sub(startTangent.clone().multiplyScalar(8)));
    kartState.velocity = 0;
    kartState.heading = Math.atan2(startTangent.x, startTangent.z);
    kartState.boostTimer = 0;
    kartState.checkpointIndex = 0;
    kartState.lap = 1;
    kartState.lapStartTime = performance.now();
    kartState.startTime = performance.now();
    kartState.finished = false;
    kartState.driftTimer = 0;
    kartState.shieldTimer = 0;
    kartState.progress = 0;
    lastLapTime = null;
    topSpeed = 0;
    playerItem = null;
    itemBoxCooldown = 0;
    driftBoostTimer = 0;
    driftAccumulator = 0;
    ghostData = [];
    isRecordingGhost = false;
    isPlayingGhost = false;
    if (playerKart) {
        playerKart.position.copy(kartState.position);
        playerKart.rotation.y = kartState.heading;
    }
    // Reset AI karts
    for (const ai of aiKarts) {
        ai.progress = 0;
        ai.lap = 1;
        ai.finished = false;
    }
    showMessage('GO!', 1200);
}

// Countdown before start
let countdownActive = false;
function startCountdown() {
    const messages = ['3', '2', '1', 'GO!'];
    const colors = ['#ff3333', '#ffcc00', '#33cc33', '#33ccff'];
    let i = 0;
    countdownActive = true;
    const msgEl = document.getElementById('message');
    msgEl.classList.remove('hidden');
    msgEl.style.fontSize = '120px';
    msgEl.style.fontWeight = '900';
    msgEl.style.textShadow = '0 0 30px currentColor';
    msgEl.style.transition = 'transform 0.3s ease, opacity 0.3s ease';

    const interval = setInterval(() => {
        msgEl.textContent = messages[i];
        msgEl.style.color = colors[i];
        msgEl.style.transform = 'scale(1.3)';
        msgEl.style.opacity = '1';
        playSound('lap');
        setTimeout(() => {
            msgEl.style.transform = 'scale(1.0)';
            msgEl.style.opacity = '0.7';
        }, 200);
        i++;
        if (i >= messages.length) {
            clearInterval(interval);
            countdownActive = false;
            kartState.startTime = performance.now();
            kartState.lapStartTime = performance.now();
            setTimeout(() => {
                msgEl.classList.add('hidden');
                msgEl.style.fontSize = '';
                msgEl.style.fontWeight = '';
                msgEl.style.textShadow = '';
                msgEl.style.transform = '';
                msgEl.style.opacity = '';
            }, 800);
        }
    }, 800);
}

// --- Update loop ---
const clock = new THREE.Clock();

// --- Item system ---
function useItem() {
    if (!playerItem) return;
    if (playerItem === 'boost') {
        kartState.boostTimer = BOOST_DURATION;
        playSound('boost');
        showMessage('BOOST!', 1000);
    } else if (playerItem === 'shield') {
        kartState.shieldTimer = 5;
        showMessage('SHIELD!', 1000);
    } else if (playerItem === 'oil') {
        // Drop oil slick behind
        const oilGeo = new THREE.CircleGeometry(2, 16);
        const oilMat = new THREE.MeshStandardMaterial({ color: 0x222222, transparent: true, opacity: 0.8 });
        const oil = new THREE.Mesh(oilGeo, oilMat);
        oil.rotation.x = -Math.PI / 2;
        oil.position.copy(kartState.position);
        oil.position.y = 0.05;
        scene.add(oil);
        setTimeout(() => scene.remove(oil), 8000);
        showMessage('OIL Slick!', 1000);
    }
    playerItem = null;
    document.getElementById('item-indicator').style.display = 'none';
}

function updateKartPhysics(dt) {
    if (dt <= 0) return;
    if (countdownActive) return;

    const cfg = CAR_CONFIGS[selectedCarIndex];
    const carAccel = cfg.accel;
    const carMaxSpeed = cfg.speed;
    const carHandling = cfg.handling;

    // Throttle / brake with weight-transfer feel
    const normalizedSpeed = Math.min(Math.abs(kartState.velocity) / carMaxSpeed, 1.0);
    if (keys.up) {
        const accel = carAccel * (1 - normalizedSpeed * 0.35); // less accel at high speed
        kartState.velocity += accel * dt;
    } else if (keys.down) {
        if (kartState.velocity > 0) {
            kartState.velocity -= BRAKE_FORCE * dt;
        } else {
            kartState.velocity -= REVERSE_ACCEL * dt;
        }
    }

    // Drift boost: accumulate drift while braking at speed
    if (keys.brake && Math.abs(kartState.velocity) > 30 && (keys.left || keys.right)) {
        kartState.driftTimer += dt;
        driftAccumulator += dt;
        // Spawn drift sparks
        if (Math.random() < 0.3) {
            createParticleBurst(kartState.position.clone().add(new THREE.Vector3(0, 0.3, 0)), 0xff6600, 3, 0.3);
        }
    } else {
        // Release drift boost
        if (driftAccumulator > 1.0) {
            driftBoostTimer = Math.min(driftAccumulator * 0.5, 2.0);
            playSound('boost');
            showMessage('DRIFT BOOST!', 800);
        }
        driftAccumulator = 0;
    }
    if (driftBoostTimer > 0) {
        driftBoostTimer -= dt;
        kartState.velocity = Math.min(kartState.velocity + 40 * dt, BOOST_SPEED);
    }

    // Compute displacement now that velocity is finalized for this frame
    const moveDir = new THREE.Vector3(Math.sin(kartState.heading), 0, Math.cos(kartState.heading));
    const displacement = moveDir.multiplyScalar(kartState.velocity * dt);
    const nextPos = kartState.position.clone().add(displacement);

    const distToTrack = getClosestTrackDistance(nextPos);
    const onRoad = distToTrack <= ROAD_HALF_WIDTH;

    // Rolling resistance and off-road drag
    if (!keys.up && !keys.down) {
        const rollFriction = FRICTION + (onRoad ? 0 : OFF_ROAD_FRICTION);
        if (kartState.velocity > 0) {
            kartState.velocity -= rollFriction * dt;
            if (kartState.velocity < 0) kartState.velocity = 0;
        } else if (kartState.velocity < 0) {
            kartState.velocity += rollFriction * dt;
            if (kartState.velocity > 0) kartState.velocity = 0;
        }
    }
    if (!onRoad) {
        kartState.velocity -= OFF_ROAD_FRICTION * dt * Math.sign(kartState.velocity);
        if (Math.abs(kartState.velocity) < 0.5) kartState.velocity = 0;
        // Dust particles off-road
        if (Math.abs(kartState.velocity) > 20 && Math.random() < 0.2) {
            createParticleBurst(kartState.position.clone().add(new THREE.Vector3(0, 0.2, 0)), 0x8B7355, 2, 0.4);
        }
    }

    let speedCap = (kartState.boostTimer > 0 || driftBoostTimer > 0) ? BOOST_SPEED : carMaxSpeed;
    if (!onRoad) speedCap = Math.min(speedCap, OFF_ROAD_MAX_SPEED);
    kartState.velocity = Math.max(-REVERSE_SPEED, Math.min(speedCap, kartState.velocity));

    // Speed-sensitive steering and weight transfer
    if (Math.abs(kartState.velocity) > 0.5) {
        const direction = kartState.velocity > 0 ? 1 : -1;
        const turn = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
        const speedSteerFactor = Math.min(Math.abs(kartState.velocity) / 40, 1.0);
        const driftMultiplier = keys.brake ? DRIFT_FACTOR : 1.0;
        kartState.heading += turn * carHandling * dt * direction * speedSteerFactor * driftMultiplier;
    }

    kartState.position.copy(nextPos);
    kartState.position.y = 0;

    // Hard clamp: car can never leave the road
    const clamp = clampToRoad(kartState.position);
    if (clamp.hit) {
        kartState.position.x = clamp.x;
        kartState.position.z = clamp.z;
        kartState.velocity *= -0.15;
        if (Math.abs(kartState.velocity) < 1) kartState.velocity = 0;
        screenShake = 0.2;
        playSound('crash');
        createParticleBurst(kartState.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 0xff3333, 6, 0.4);
        createSmokePuff(kartState.position.clone().add(new THREE.Vector3(0, 0.3, 0)), 0.5, 0x666666, 1.0);
    }

    // Tree collision
    for (const tc of treeColliders) {
        const dx = kartState.position.x - tc.x;
        const dz = kartState.position.z - tc.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < tc.radius + 1.2) {
            const pushAngle = Math.atan2(dx, dz);
            kartState.position.x = tc.x + Math.sin(pushAngle) * (tc.radius + 1.2);
            kartState.position.z = tc.z + Math.cos(pushAngle) * (tc.radius + 1.2);
            if (kartState.shieldTimer <= 0) {
                kartState.velocity *= -0.15;
                if (Math.abs(kartState.velocity) < 1) kartState.velocity = 0;
                screenShake = 0.3;
                playSound('crash');
                createParticleBurst(kartState.position.clone().add(new THREE.Vector3(0, 1, 0)), 0x228B22, 10, 0.5);
            } else {
                kartState.velocity *= 0.5;
            }
        }
    }

    // Boost pad detection
    for (const pad of boostPads) {
        if (pad.position.distanceTo(kartState.position) < 3.5) {
            if (kartState.boostTimer < BOOST_DURATION) {
                kartState.boostTimer = BOOST_DURATION;
                playSound('boost');
                screenShake = 0.15;
            }
        }
    }
    if (kartState.boostTimer > 0) {
        kartState.boostTimer -= dt;
        if (kartState.boostTimer < 0) kartState.boostTimer = 0;
    }
    if (kartState.shieldTimer > 0) {
        kartState.shieldTimer -= dt;
        if (kartState.shieldTimer < 0) kartState.shieldTimer = 0;
    }

    // Item box pickup
    if (itemBoxCooldown > 0) itemBoxCooldown -= dt;
    for (const box of itemBoxes) {
        if (box.userData.active && box.position.distanceTo(kartState.position) < 2.5) {
            box.userData.active = false;
            box.visible = false;
            box.userData.respawnTimer = 5;
            if (!playerItem && itemBoxCooldown <= 0) {
                const items = ['boost', 'shield', 'oil'];
                playerItem = items[Math.floor(Math.random() * items.length)];
                const itemEl = document.getElementById('item-indicator');
                itemEl.style.display = 'block';
                document.getElementById('item-name').textContent = playerItem.charAt(0).toUpperCase() + playerItem.slice(1);
                playSound('item');
            }
        }
        if (!box.userData.active) {
            box.userData.respawnTimer -= dt;
            if (box.userData.respawnTimer <= 0) {
                box.userData.active = true;
                box.visible = true;
            }
        }
        // Animate item boxes
        if (box.userData.active) {
            const t = performance.now() * 0.001;
            box.position.y = 1.2 + Math.sin(t * 2) * 0.3;
            if (box.userData.core) {
                box.userData.core.rotation.y += dt * 3;
                box.userData.core.rotation.x += dt * 1.5;
            }
            if (box.userData.shell) {
                box.userData.shell.rotation.y -= dt * 2;
                box.userData.shell.rotation.z += dt * 1;
            }
            if (box.userData.ring) {
                box.userData.ring.rotation.z += dt * 4;
            }
        }
    }

    // Update progress for position tracking
    kartState.progress = (kartState.lap - 1) + kartState.checkpointIndex / CHECKPOINT_COUNT;

    // Record ghost data
    if (isRecordingGhost && !kartState.finished) {
        ghostData.push({
            x: kartState.position.x, y: kartState.position.y, z: kartState.position.z,
            h: kartState.heading
        });
    }

    // Update kart mesh with suspension lean
    if (playerKart) {
        playerKart.position.copy(kartState.position);
        const turn = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
        const speedFactor = Math.min(Math.abs(kartState.velocity) / 50, 1.0);
        const targetRoll = -turn * 0.18 * speedFactor; // body rolls more at speed
        const targetPitch = keys.brake ? 0.08 : (keys.up ? -0.04 : 0.01);
        playerKart.rotation.z += (targetRoll - playerKart.rotation.z) * 4 * dt;
        playerKart.rotation.x += (targetPitch - playerKart.rotation.x) * 4 * dt;
        playerKart.rotation.y = kartState.heading;
    }

    // Skid marks + tire smoke when braking/drifting
    if (keys.brake && Math.abs(kartState.velocity) > 25) {
        createSkidMark(kartState.position, kartState.heading, -1);
        createSkidMark(kartState.position, kartState.heading, 1);
        createSmokePuff(kartState.position.clone().add(new THREE.Vector3(0, 0.2, 0)), 0.4, 0x333333, 1.2);
    }

    // Exhaust smoke when accelerating hard
    if (keys.up && kartState.velocity > 20 && Math.random() < 0.3) {
        const back = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), kartState.heading);
        createSmokePuff(kartState.position.clone().add(back.multiplyScalar(1.4)).add(new THREE.Vector3(0, 0.3, 0)), 0.2, 0x888888, 0.3);
    }

    // Engine sound
    updateEngineSound(kartState.velocity);
}

const skidMarks = [];
function createSkidMark(pos, heading, side) {
    const perp = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading)).multiplyScalar(side * 0.9);
    const p = pos.clone().add(perp);
    const smGeo = new THREE.PlaneGeometry(0.4, 0.4);
    const smMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7 });
    const sm = new THREE.Mesh(smGeo, smMat);
    sm.rotation.x = -Math.PI / 2;
    sm.position.set(p.x, 0.02, p.z);
    scene.add(sm);
    skidMarks.push({ mesh: sm, life: 2.0 });
}

function updateCamera(dt) {
    // Dynamic FOV based on speed
    const speedRatio = Math.min(Math.abs(kartState.velocity) / BOOST_SPEED, 1.0);
    const targetFov = 60 + speedRatio * 15;
    camera.fov += (targetFov - camera.fov) * 2 * dt;
    camera.updateProjectionMatrix();

    const behind = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), kartState.heading);
    // Camera lags further back at higher speeds
    const camDistance = 9 + speedRatio * 4;
    const camHeight = 5 + speedRatio * 1.5;
    let targetPos = kartState.position.clone().add(behind.multiplyScalar(camDistance)).add(new THREE.Vector3(0, camHeight, 0));

    // Camera collision: keep camera inside the road
    const camTrackDist = getClosestTrackDistance(targetPos);
    if (camTrackDist > ROAD_HALF_WIDTH - 1) {
        const camResult = getClosestTrackPoint(targetPos);
        const camDir = new THREE.Vector3().subVectors(targetPos, camResult.point).normalize();
        targetPos = camResult.point.clone().add(camDir.multiplyScalar(ROAD_HALF_WIDTH - 1));
        targetPos.y = camHeight;
    }

    camera.position.lerp(targetPos, 4 * dt);

    // G-force look-ahead: camera looks slightly ahead of the kart in the velocity direction
    const ahead = behind.clone().negate().multiplyScalar(3 + speedRatio * 5);
    let lookAt = kartState.position.clone().add(new THREE.Vector3(0, 1.5, 0)).add(ahead);
    // Screen shake
    if (screenShake > 0) {
        screenShake -= dt;
        lookAt.x += (Math.random() - 0.5) * screenShake * 2;
        lookAt.y += (Math.random() - 0.5) * screenShake * 2;
    }
    camera.lookAt(lookAt);
}

function updateLapLogic() {
    if (kartState.finished) return;

    const nextCheckpoint = checkpoints[kartState.checkpointIndex];
    const dist = kartState.position.distanceTo(nextCheckpoint.center);

    if (dist < ROAD_HALF_WIDTH + 2) {
        kartState.checkpointIndex++;
        if (kartState.checkpointIndex >= CHECKPOINT_COUNT) {
            kartState.checkpointIndex = 0;
            kartState.lap++;

            const lapTime = ((performance.now() - kartState.lapStartTime) / 1000).toFixed(2);
            const lapTimeNum = parseFloat(lapTime);
            kartState.lapStartTime = performance.now();

            if (kartState.lap > TOTAL_LAPS) {
                kartState.finished = true;
                const totalTime = ((performance.now() - kartState.startTime) / 1000).toFixed(2);
                playSound('lap');
                // Save to leaderboard
                saveLeaderboard(parseFloat(totalTime));
                // Stop ghost recording
                isRecordingGhost = false;
                // Save ghost data
                try {
                    if (ghostData.length > 10) {
                        localStorage.setItem('wkr_ghost', JSON.stringify(ghostData));
                    }
                } catch(e) {}
                // Show finish screen with stats
                setTimeout(() => {
                    gameState = GAME_STATE.FINISHED;
                    hideAllMenus();
                    document.getElementById('finish-total').textContent = totalTime + 's';
                    document.getElementById('finish-bestlap').textContent = (bestLapTime !== null ? bestLapTime.toFixed(2) : 'N/A') + 's';
                    // Compute final position
                    const allR = [{ progress: kartState.progress, finished: true }];
                    for (const ai of aiKarts) allR.push({ progress: ai.progress, finished: ai.finished });
                    let finalPos = 1;
                    for (const r of allR) {
                        if (r !== allR[0] && r.progress > kartState.progress) finalPos++;
                    }
                    document.getElementById('finish-position').textContent = `${finalPos}/${allR.length}`;
                    document.getElementById('finish-topspeed').textContent = topSpeed + ' km/h';
                    document.getElementById('finish-screen').classList.remove('hidden');
                }, 1500);
            } else {
                showMessage(`Lap ${kartState.lap - 1}: ${lapTime}s`, 1500);
                playSound('lap');
                lastLapTime = lapTimeNum;
                // Lap flash
                const lapFlash = document.getElementById('lap-flash');
                lapFlash.style.background = 'rgba(50,255,50,0.2)';
                setTimeout(() => { lapFlash.style.background = 'rgba(50,255,50,0)'; }, 300);
                // Track best lap for delta
                if (bestLapTime === null || lapTimeNum < bestLapTime) {
                    bestLapTime = lapTimeNum;
                }
            }
        }
    }
}

function updateUI() {
    document.getElementById('lap-display').textContent = `${Math.min(kartState.lap, TOTAL_LAPS)} / ${TOTAL_LAPS}`;
    const currentTime = ((performance.now() - kartState.startTime) / 1000).toFixed(2);
    document.getElementById('time-display').textContent = currentTime;
    const speedKmh = Math.round(Math.abs(kartState.velocity) * 1.5);
    document.getElementById('speed-display').textContent = speedKmh;
    if (speedKmh > topSpeed) topSpeed = speedKmh;

    // Last lap display
    const lastLapPanel = document.getElementById('lastlap-panel');
    const lastLapDisplay = document.getElementById('lastlap-display');
    if (lastLapTime !== null) {
        lastLapPanel.style.display = 'block';
        lastLapDisplay.textContent = lastLapTime.toFixed(2) + 's';
        lastLapDisplay.style.color = (bestLapTime !== null && lastLapTime <= bestLapTime) ? '#33ff33' : '#fff';
    }

    // Delta time (current lap vs best lap)
    if (bestLapTime !== null && !kartState.finished) {
        const currentLapElapsed = (performance.now() - kartState.lapStartTime) / 1000;
        const delta = currentLapElapsed - bestLapTime;
        const deltaEl = document.getElementById('delta-display');
        const deltaPanel = document.getElementById('delta-panel');
        deltaPanel.style.display = 'block';
        deltaEl.textContent = (delta >= 0 ? '+' : '') + delta.toFixed(2);
        deltaEl.style.color = delta < 0 ? '#33ff33' : '#ff3333';
    }

    // Position display
    const allRacers = [{ progress: kartState.progress, finished: kartState.finished }];
    for (const ai of aiKarts) {
        allRacers.push({ progress: ai.progress, finished: ai.finished });
    }
    allRacers.sort((a, b) => b.progress - a.progress);
    const playerPos = allRacers.findIndex(r => r === allRacers[0] && r.progress === kartState.progress) + 1;
    // Simpler: count how many have higher progress
    let pos = 1;
    for (const r of allRacers) {
        if (r !== allRacers[0] && r.progress > kartState.progress) pos++;
    }
    const posEl = document.getElementById('position-display');
    const posPanel = document.getElementById('position-panel');
    if (aiKarts.length > 0) {
        posPanel.style.display = 'block';
        posEl.textContent = `${pos}/${allRacers.length}`;
    }

    // Boost indicator
    const boostPanel = document.getElementById('boost-panel');
    const boostDisplay = document.getElementById('boost-display');
    if (kartState.boostTimer > 0 || driftBoostTimer > 0) {
        boostPanel.style.display = 'block';
        boostDisplay.textContent = 'ACTIVE';
        boostDisplay.style.color = '#33ff33';
    } else if (kartState.shieldTimer > 0) {
        boostPanel.style.display = 'block';
        boostDisplay.textContent = 'SHIELD';
        boostDisplay.style.color = '#33ccff';
    } else {
        boostPanel.style.display = 'none';
    }

    // Speed lines at high velocity
    const slCanvas = document.getElementById('speedlines');
    const slCtx = slCanvas.getContext('2d');
    const speedRatio = Math.min(Math.abs(kartState.velocity) / 140, 1.0);
    if (speedRatio > 0.55) {
        slCanvas.style.display = 'block';
        slCtx.clearRect(0, 0, slCanvas.width, slCanvas.height);
        const numLines = Math.floor(speedRatio * 30);
        slCtx.strokeStyle = `rgba(255,255,255,${(speedRatio - 0.55) * 0.4})`;
        slCtx.lineWidth = 2;
        const cx = slCanvas.width / 2;
        const cy = slCanvas.height / 2;
        for (let i = 0; i < numLines; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 200 + Math.random() * 400;
            const len = 40 + Math.random() * 80 * speedRatio;
            const x1 = cx + Math.cos(angle) * dist;
            const y1 = cy + Math.sin(angle) * dist;
            const x2 = cx + Math.cos(angle) * (dist + len);
            const y2 = cy + Math.sin(angle) * (dist + len);
            slCtx.beginPath();
            slCtx.moveTo(x1, y1);
            slCtx.lineTo(x2, y2);
            slCtx.stroke();
        }
    } else {
        slCanvas.style.display = 'none';
    }

    // Boost glow
    const boostGlow = document.getElementById('boost-glow');
    if (kartState.boostTimer > 0 || driftBoostTimer > 0) {
        boostGlow.style.boxShadow = 'inset 0 0 120px rgba(255,180,0,0.35)';
    } else {
        boostGlow.style.boxShadow = 'inset 0 0 120px rgba(255,180,0,0)';
    }

    // Drift score
    const driftScoreEl = document.getElementById('drift-score');
    const driftScoreVal = document.getElementById('drift-score-value');
    if (driftAccumulator > 0.3 && Math.abs(kartState.velocity) > 25) {
        driftScoreEl.style.display = 'block';
        const score = Math.floor(driftAccumulator * Math.abs(kartState.velocity) * 2);
        driftScoreVal.textContent = score;
    } else {
        driftScoreEl.style.display = 'none';
    }

    // Speedometer
    drawSpeedometer(speedKmh);
}

function drawSpeedometer(speed) {
    const canvas = document.getElementById('speedometer');
    if (canvas.style.display === 'none') canvas.style.display = 'block';
    const ctx = canvas.getContext('2d');
    const cx = 70, cy = 70, r = 55;
    ctx.clearRect(0, 0, 140, 140);
    // Background circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Colored arc zones: green (0-60%), yellow (60-85%), red (85-100%)
    const startAngle = -Math.PI * 0.75;
    const endAngle = startAngle + Math.PI * 1.5;
    const greenEnd = startAngle + Math.PI * 1.5 * 0.6;
    const yellowEnd = startAngle + Math.PI * 1.5 * 0.85;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 3, startAngle, greenEnd);
    ctx.strokeStyle = 'rgba(50,200,50,0.6)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 3, greenEnd, yellowEnd);
    ctx.strokeStyle = 'rgba(220,200,30,0.6)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 3, yellowEnd, endAngle);
    ctx.strokeStyle = 'rgba(220,50,50,0.7)';
    ctx.stroke();
    // Tick marks
    for (let i = 0; i <= 10; i++) {
        const angle = startAngle + (i / 10) * Math.PI * 1.5;
        const x1 = cx + Math.cos(angle) * (r - 8);
        const y1 = cy + Math.sin(angle) * (r - 8);
        const x2 = cx + Math.cos(angle) * (r - 14);
        const y2 = cy + Math.sin(angle) * (r - 14);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = i >= 8 ? 'rgba(255,80,80,0.7)' : 'rgba(255,255,255,0.4)';
        ctx.lineWidth = i >= 8 ? 2 : 1;
        ctx.stroke();
    }
    // Needle
    const maxSpeed = 250;
    const needleAngle = startAngle + Math.min(speed / maxSpeed, 1) * Math.PI * 1.5;
    // Redline glow when near max
    if (speed / maxSpeed > 0.85) {
        ctx.shadowColor = '#ff3333';
        ctx.shadowBlur = 10;
    }
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(needleAngle) * (r - 17), cy + Math.sin(needleAngle) * (r - 17));
    ctx.strokeStyle = speed / maxSpeed > 0.85 ? '#ff3333' : '#ff3366';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ff3366';
    ctx.fill();
    // Speed text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(speed, cx, cy + 28);
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#aaa';
    ctx.fillText('km/h', cx, cy + 40);
}

function drawMinimap() {
    const canvas = document.getElementById('minimap');
    if (canvas.style.display === 'none') canvas.style.display = 'block';
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 160, 160);
    // Find bounds of track
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of curvePoints) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
    }
    const w = maxX - minX, h = maxZ - minZ;
    const scale = Math.min(140 / w, 140 / h);
    const ox = (160 - w * scale) / 2;
    const oz = (160 - h * scale) / 2;
    // Draw track surface and edges
    const halfWidth = ROAD_HALF_WIDTH * scale;
    const centerLine = [];
    const leftEdge = [];
    const rightEdge = [];
    for (let i = 0; i < curvePoints.length; i++) {
        const p = curvePoints[i];
        const x = ox + (p.x - minX) * scale;
        const y = oz + (p.z - minZ) * scale;
        centerLine.push({ x, y });
        // Approximate edge offset by scaling the curve normals
        const tangent = (new THREE.Vector3(curvePoints[(i + 1) % curvePoints.length].x - p.x, 0, curvePoints[(i + 1) % curvePoints.length].z - p.z)).normalize();
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
        leftEdge.push({ x: x + normal.x * halfWidth, y: y + normal.z * halfWidth });
        rightEdge.push({ x: x - normal.x * halfWidth, y: y - normal.z * halfWidth });
    }
    // Fill road surface
    ctx.beginPath();
    for (let i = 0; i < leftEdge.length; i++) {
        if (i === 0) ctx.moveTo(leftEdge[i].x, leftEdge[i].y);
        else ctx.lineTo(leftEdge[i].x, leftEdge[i].y);
    }
    for (let i = rightEdge.length - 1; i >= 0; i--) {
        ctx.lineTo(rightEdge[i].x, rightEdge[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(60,60,60,0.6)';
    ctx.fill();
    // Draw edges
    ctx.beginPath();
    for (let i = 0; i < leftEdge.length; i++) {
        if (i === 0) ctx.moveTo(leftEdge[i].x, leftEdge[i].y);
        else ctx.lineTo(leftEdge[i].x, leftEdge[i].y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,50,50,0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < rightEdge.length; i++) {
        if (i === 0) ctx.moveTo(rightEdge[i].x, rightEdge[i].y);
        else ctx.lineTo(rightEdge[i].x, rightEdge[i].y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,50,50,0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Center line
    ctx.beginPath();
    for (let i = 0; i < centerLine.length; i++) {
        if (i === 0) ctx.moveTo(centerLine[i].x, centerLine[i].y);
        else ctx.lineTo(centerLine[i].x, centerLine[i].y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Draw player progress trail (highlight completed portion of track)
    const playerT = kartState.checkpointIndex / CHECKPOINT_COUNT;
    if (playerT > 0) {
        ctx.beginPath();
        const startIdx = 0;
        const endIdx = Math.floor(playerT * centerLine.length);
        for (let i = startIdx; i <= endIdx && i < centerLine.length; i++) {
            if (i === startIdx) ctx.moveTo(centerLine[i].x, centerLine[i].y);
            else ctx.lineTo(centerLine[i].x, centerLine[i].y);
        }
        ctx.strokeStyle = 'rgba(255,204,0,0.5)';
        ctx.lineWidth = 3;
        ctx.stroke();
    }
    // Draw player
    const px = ox + (kartState.position.x - minX) * scale;
    const py = oz + (kartState.position.z - minZ) * scale;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffcc00';
    ctx.fill();
    // Draw AI karts
    for (const ai of aiKarts) {
        const ax = ox + (ai.mesh.position.x - minX) * scale;
        const ay = oz + (ai.mesh.position.z - minZ) * scale;
        ctx.beginPath();
        ctx.arc(ax, ay, 3, 0, Math.PI * 2);
        ctx.fillStyle = ai.color === 0xff3333 ? '#ff3333' : ai.color === 0x3333ff ? '#3333ff' : '#33ff33';
        ctx.fill();
    }
    // Draw ghost
    if (ghostKart && isPlayingGhost) {
        const gx = ox + (ghostKart.position.x - minX) * scale;
        const gy = oz + (ghostKart.position.z - minZ) * scale;
        ctx.beginPath();
    ctx.arc(gx, gy, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fill();
    }
}

// --- AI opponents ---
function createAIKarts() {
    // Remove old AI karts
    for (const ai of aiKarts) {
        if (ai.mesh) scene.remove(ai.mesh);
        if (ai.label) scene.remove(ai.label);
    }
    aiKarts = [];
    const aiColors = [0xff3333, 0x3333ff, 0x33ff33];
    const aiNames = ['Rival', 'Blaze', 'Storm'];
    const aiCarIndices = [1, 3, 4]; // Use different car models
    for (let i = 0; i < 3; i++) {
        let mesh = null;
        const modelIdx = aiCarIndices[i];
        if (carModels[modelIdx]) {
            mesh = carModels[modelIdx].clone();
        } else {
            const geo = new THREE.BoxGeometry(1.4, 0.6, 2.6);
            mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: aiColors[i] }));
            mesh.castShadow = true;
        }
        const startOffset = startPoint.clone().sub(startTangent.clone().multiplyScalar(8 + (i + 1) * 4));
        mesh.position.copy(startOffset);
        mesh.rotation.y = Math.atan2(startTangent.x, startTangent.z);
        scene.add(mesh);

        // Floating name label
        const labelCanvas = document.createElement('canvas');
        labelCanvas.width = 128;
        labelCanvas.height = 32;
        const lctx = labelCanvas.getContext('2d');
        lctx.fillStyle = 'rgba(0,0,0,0.5)';
        lctx.fillRect(0, 0, 128, 32);
        lctx.font = 'bold 16px sans-serif';
        lctx.textAlign = 'center';
        lctx.fillStyle = '#' + aiColors[i].toString(16).padStart(6, '0');
        lctx.fillText(aiNames[i], 64, 22);
        const labelTex = new THREE.CanvasTexture(labelCanvas);
        const labelMat = new THREE.SpriteMaterial({ map: labelTex, depthTest: false });
        const label = new THREE.Sprite(labelMat);
        label.scale.set(3, 0.75, 1);
        label.position.copy(startOffset);
        label.position.y = 3.5;
        scene.add(label);

        aiKarts.push({
            mesh: mesh,
            label: label,
            progress: 0,
            lap: 1,
            finished: false,
            targetT: 0,
            speed: 80 + Math.random() * 30,
            color: aiColors[i],
            name: aiNames[i],
            offset: (Math.random() - 0.5) * 4
        });
    }
}

function updateAIKarts(dt) {
    if (countdownActive) return;
    // How far ahead the player is on the same scale
    const playerProgress = kartState.progress;

    for (const ai of aiKarts) {
        if (ai.finished) continue;

        // Slow down in tight corners, speed up on straights
        const tangent = curve.getTangentAt(ai.targetT).clone().normalize();
        const curvature = curve.getTangentAt((ai.targetT + 0.01) % 1).sub(tangent).length() * 100;
        const cornerFactor = Math.max(0.55, 1 - curvature * 0.12);
        let targetSpeed = ai.speed * cornerFactor;

        // Rubber banding: AI catches up if far behind, slows if far ahead
        const aiProgress = (ai.lap - 1) + ai.targetT;
        const gap = playerProgress - aiProgress;
        if (gap > 0.3) targetSpeed *= 1.15; // behind player -> speed up
        else if (gap < -0.3) targetSpeed *= 0.92; // ahead -> slow down slightly

        // Move along curve
        ai.targetT += (targetSpeed / 1000) * dt;
        if (ai.targetT >= 1) {
            ai.targetT -= 1;
            ai.lap++;
            if (ai.lap > TOTAL_LAPS) {
                ai.finished = true;
                continue;
            }
        }

        const p = curve.getPointAt(ai.targetT);
        const normal = tangent.clone().cross(up).normalize();
        // Keep varied racing lines
        const targetPos = p.clone().add(normal.multiplyScalar(ai.offset));
        // Smoothly move toward target
        ai.mesh.position.lerp(targetPos, 3 * dt);
        ai.mesh.position.y = 0;
        const heading = Math.atan2(tangent.x, tangent.z);
        ai.mesh.rotation.y = heading;
        if (ai.label) {
            ai.label.position.set(ai.mesh.position.x, 3.5, ai.mesh.position.z);
        }
        ai.progress = aiProgress;
    }
}

// --- Ghost replay ---
function startGhostPlayback() {
    if (ghostData.length < 2) return;
    isPlayingGhost = true;
    ghostIndex = 0;
    // Create ghost kart (semi-transparent)
    const model = carModels[selectedCarIndex];
    if (model) {
        ghostKart = model.clone();
        ghostKart.traverse(child => {
            if (child.isMesh) {
                child.material = child.material.clone();
                child.material.transparent = true;
                child.material.opacity = 0.4;
            }
        });
        scene.add(ghostKart);
    }
}

function updateGhost(dt) {
    if (!isPlayingGhost || !ghostKart || countdownActive) return;
    ghostIndex += 60 * dt; // approx 60fps recording
    if (ghostIndex >= ghostData.length) {
        isPlayingGhost = false;
        scene.remove(ghostKart);
        ghostKart = null;
        return;
    }
    const idx = Math.floor(ghostIndex);
    const g = ghostData[idx];
    ghostKart.position.set(g.x, g.y, g.z);
    ghostKart.rotation.y = g.h;
}

// --- Leaderboard ---
function saveLeaderboard(time) {
    let scores = [];
    try {
        scores = JSON.parse(localStorage.getItem('wkr_leaderboard') || '[]');
    } catch(e) {}
    scores.push({ time: time, car: CAR_CONFIGS[selectedCarIndex].name, date: new Date().toLocaleDateString() });
    scores.sort((a, b) => a.time - b.time);
    scores = scores.slice(0, 10);
    localStorage.setItem('wkr_leaderboard', JSON.stringify(scores));
}

function showLeaderboard() {
    let scores = [];
    try {
        scores = JSON.parse(localStorage.getItem('wkr_leaderboard') || '[]');
    } catch(e) {}
    const listEl = document.getElementById('leaderboard-list');
    if (scores.length === 0) {
        listEl.innerHTML = '<div class="lb-empty">No records yet. Complete a race!</div>';
    } else {
        listEl.innerHTML = scores.map((s, i) =>
            `<div class="lb-entry"><span class="lb-rank">${i + 1}.</span><span>${s.car} — ${s.date}</span><span class="lb-time">${s.time.toFixed(2)}s</span></div>`
        ).join('');
    }
    hideAllMenus();
    show(document.getElementById('leaderboard-panel'));
}

function animate() {
    requestAnimationFrame(animate);
    clearStatus();

    const dt = Math.min(clock.getDelta(), 0.05);
    if (gameState === GAME_STATE.PLAYING) {
        updateKartPhysics(dt);
        updateAIKarts(dt);
        updateGhost(dt);
        updateParticles(dt);
        updateSmoke(dt);
        updateSkidMarks(dt);
        updateCamera(dt);
        updateLapLogic();
        updateUI();
        drawMinimap();
        // Animate boost pad chevrons
        const bt = performance.now() * 0.003;
        for (const pad of boostPads) {
            if (pad.userData.chevrons) {
                pad.userData.chevrons.forEach((c, i) => {
                    c.material.opacity = 0.5 + Math.sin(bt + i * 0.8) * 0.4;
                });
            }
        }
    } else if (gameState === GAME_STATE.MENU || gameState === GAME_STATE.PAUSED) {
        const t = performance.now() * 0.0003;
        const camR = 18;
        camera.position.set(
            kartState.position.x + Math.cos(t) * camR,
            kartState.position.y + 7,
            kartState.position.z + Math.sin(t) * camR
        );
        camera.lookAt(kartState.position.clone().add(new THREE.Vector3(0, 1.5, 0)));
        updateParticles(dt);
    }

    composer.render();

    // Rearview mirror — separate renderer to avoid flicker
    if (gameState === GAME_STATE.PLAYING) {
        const rvCanvas = document.getElementById('rearview');
        rvCanvas.style.display = 'block';
        if (!rvCanvas._renderer) {
            rvCanvas._renderer = new THREE.WebGLRenderer({ canvas: rvCanvas, antialias: false, alpha: true });
            rvCanvas._renderer.setSize(rvCanvas.width, rvCanvas.height, false);
        }
        const rvCam = camera.clone();
        const fwd = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), kartState.heading);
        rvCam.position.copy(kartState.position).add(new THREE.Vector3(0, 4, 0));
        rvCam.lookAt(kartState.position.clone().add(fwd.multiplyScalar(20)).add(new THREE.Vector3(0, 1, 0)));
        rvCam.aspect = rvCanvas.width / rvCanvas.height;
        rvCam.updateProjectionMatrix();
        rvCanvas._renderer.render(scene, rvCam);
    } else {
        document.getElementById('rearview').style.display = 'none';
    }
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

// --- Menu system ---
const mainMenu = document.getElementById('main-menu');
const carSelect = document.getElementById('car-select');
const pauseMenu = document.getElementById('pause-menu');
const settingsPanel = document.getElementById('settings-panel');
const howtoPanel = document.getElementById('howto-panel');
const hud = document.getElementById('hud');
const controlsHelp = document.getElementById('controls-help');
const messageEl = document.getElementById('message');

let previousMenu = null;

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function hideAllMenus() {
    hide(mainMenu);
    hide(carSelect);
    hide(pauseMenu);
    hide(settingsPanel);
    hide(howtoPanel);
    hide(document.getElementById('leaderboard-panel'));
    hide(document.getElementById('finish-screen'));
}

function showMainMenu() {
    gameState = GAME_STATE.MENU;
    hideAllMenus();
    show(mainMenu);
    hide(hud);
    hide(controlsHelp);
    hide(messageEl);
}

function showCarSelect() {
    gameState = GAME_STATE.MENU;
    hideAllMenus();
    show(carSelect);
    hide(hud);
    hide(controlsHelp);
}

function selectCar(index) {
    selectedCarIndex = index;
    // Update UI
    document.querySelectorAll('.car-card').forEach((card, i) => {
        card.classList.toggle('selected', i === index);
    });
    // Show stats
    const statsEl = document.getElementById('car-stats');
    statsEl.style.display = 'block';
    const cfg = CAR_CONFIGS[index];
    document.getElementById('stat-speed').style.width = (cfg.speed / 150 * 100) + '%';
    document.getElementById('stat-handling').style.width = (cfg.handling / 4 * 100) + '%';
    document.getElementById('stat-weight').style.width = (cfg.weight / 1.5 * 100) + '%';
}

function spawnPlayerKart() {
    if (playerKart) {
        scene.remove(playerKart);
    }
    const model = carModels[selectedCarIndex];
    if (model) {
        playerKart = model.clone();
        // Apply selected color as tint
        playerKart.traverse(child => {
            if (child.isMesh && child.material) {
                child.material = child.material.clone();
                child.material.color.setHex(selectedCarColor);
                child.material.needsUpdate = true;
            }
        });
        playerKart.position.copy(kartState.position);
        playerKart.rotation.y = kartState.heading;
        scene.add(playerKart);
    } else {
        const geo = new THREE.BoxGeometry(1.4, 0.6, 2.6);
        const mat = new THREE.MeshStandardMaterial({ color: selectedCarColor });
        playerKart = new THREE.Mesh(geo, mat);
        playerKart.position.copy(kartState.position);
        playerKart.rotation.y = kartState.heading;
        playerKart.castShadow = true;
        scene.add(playerKart);
    }
}

function startGame() {
    initAudio();
    hideAllMenus();
    show(hud);
    show(controlsHelp);
    spawnPlayerKart();
    createAIKarts();
    gameState = GAME_STATE.PLAYING;
    resetKart();
    startCountdown();
    // Start ghost recording
    isRecordingGhost = true;
    ghostData = [];
    // Play ghost from previous race if available
    if (ghostData.length > 0 || localStorage.getItem('wkr_ghost')) {
        try {
            const saved = JSON.parse(localStorage.getItem('wkr_ghost') || '[]');
            if (saved.length > 10) {
                ghostData = saved;
                startGhostPlayback();
            }
        } catch(e) {}
    }
    // Show mobile controls on touch devices
    if ('ontouchstart' in window) {
        document.getElementById('mobile-controls').style.display = 'block';
    }
}

function pauseGame() {
    if (gameState !== GAME_STATE.PLAYING) return;
    gameState = GAME_STATE.PAUSED;
    hideAllMenus();
    show(pauseMenu);
    show(hud);
    show(controlsHelp);
}

function resumeGame() {
    hideAllMenus();
    gameState = GAME_STATE.PLAYING;
    show(hud);
    show(controlsHelp);
}

function togglePause() {
    if (gameState === GAME_STATE.PLAYING) pauseGame();
    else if (gameState === GAME_STATE.PAUSED) resumeGame();
}

function openSettings(fromPause) {
    previousMenu = fromPause ? pauseMenu : mainMenu;
    hideAllMenus();
    show(settingsPanel);
}

function closeSettings() {
    hideAllMenus();
    if (previousMenu) show(previousMenu);
    else showMainMenu();
    previousMenu = null;
}

function openHowTo() {
    hideAllMenus();
    show(howtoPanel);
}

function closeHowTo() {
    hideAllMenus();
    showMainMenu();
}

function applySettings() {
    const quality = document.getElementById('quality-select').value;
    const shadows = document.getElementById('shadows-check').checked;
    soundEnabled = document.getElementById('sound-check').checked;

    renderer.shadowMap.enabled = shadows;
    dirLight.castShadow = shadows;
    hemiLight.castShadow = false;

    if (quality === 'high') {
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    } else if (quality === 'medium') {
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    } else {
        renderer.setPixelRatio(1);
    }

    scene.traverse(obj => {
        if (obj.material) obj.material.needsUpdate = true;
    });
}

// Button events
document.getElementById('btn-start').addEventListener('click', showCarSelect);
document.getElementById('btn-settings').addEventListener('click', () => openSettings(false));
document.getElementById('btn-howto').addEventListener('click', openHowTo);
document.getElementById('btn-leaderboard').addEventListener('click', showLeaderboard);
document.getElementById('btn-resume').addEventListener('click', resumeGame);
document.getElementById('btn-restart').addEventListener('click', startGame);
document.getElementById('btn-pause-settings').addEventListener('click', () => openSettings(true));
document.getElementById('btn-quit').addEventListener('click', showMainMenu);
document.getElementById('btn-finish-restart').addEventListener('click', startGame);
document.getElementById('btn-finish-menu').addEventListener('click', showMainMenu);
document.getElementById('btn-settings-back').addEventListener('click', () => {
    applySettings();
    closeSettings();
});
document.getElementById('btn-howto-back').addEventListener('click', closeHowTo);
document.getElementById('btn-race').addEventListener('click', startGame);
document.getElementById('btn-car-back').addEventListener('click', showMainMenu);
document.getElementById('btn-leaderboard-back').addEventListener('click', showMainMenu);
document.getElementById('btn-clear-leaderboard').addEventListener('click', () => {
    localStorage.removeItem('wkr_leaderboard');
    localStorage.removeItem('wkr_ghost');
    showLeaderboard();
});

// Car selection cards + draw clean preview images
function drawCarPreview(canvas, index, color) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Background with subtle radial gradient
    const grad = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w);
    grad.addColorStop(0, '#252b40');
    grad.addColorStop(1, '#151a28');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const bodyColor = '#' + color.toString(16).padStart(6, '0');
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(1.1, 1.1);

    // Top-down car shape
    const carLength = 70;
    const carWidth = 32;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 0, carWidth / 2 + 3, carLength / 2 + 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wheels
    ctx.fillStyle = '#111';
    const wheelOffsetX = carWidth / 2 + 4;
    const wheelOffsetY = carLength / 2 - 14;
    [
        [-wheelOffsetX, -wheelOffsetY],
        [wheelOffsetX, -wheelOffsetY],
        [-wheelOffsetX, wheelOffsetY],
        [wheelOffsetX, wheelOffsetY]
    ].forEach(([wx, wy]) => {
        ctx.beginPath();
        ctx.roundRect(wx - 4, wy - 8, 8, 16, 3);
        ctx.fill();
    });

    // Body
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.roundRect(-carWidth / 2, -carLength / 2, carWidth, carLength, 10);
    ctx.fill();

    // Windshield / roof
    ctx.fillStyle = 'rgba(20,30,45,0.9)';
    ctx.beginPath();
    ctx.roundRect(-carWidth / 2 + 6, -carLength / 2 + 18, carWidth - 12, 26, 6);
    ctx.fill();

    // Racing stripe
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.roundRect(-3, -carLength / 2 + 5, 6, carLength - 10, 2);
    ctx.fill();

    // Headlights
    ctx.fillStyle = '#ffeb3b';
    ctx.beginPath();
    ctx.roundRect(-carWidth / 2 + 4, -carLength / 2 + 2, 8, 5, 2);
    ctx.roundRect(carWidth / 2 - 12, -carLength / 2 + 2, 8, 5, 2);
    ctx.fill();

    // Taillights
    ctx.fillStyle = '#ff3333';
    ctx.beginPath();
    ctx.roundRect(-carWidth / 2 + 4, carLength / 2 - 7, 8, 5, 2);
    ctx.roundRect(carWidth / 2 - 12, carLength / 2 - 7, 8, 5, 2);
    ctx.fill();

    // Number
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((index + 1).toString(), 0, 0);

    ctx.restore();
}

document.querySelectorAll('.car-card').forEach((card, i) => {
    card.addEventListener('click', () => selectCar(i));
    // Draw preview on canvas
    const canvas = card.querySelector('canvas');
    if (canvas) {
        drawCarPreview(canvas, i, CAR_CONFIGS[i].color);
    }
});

// Color picker
document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
        selectedCarColor = parseInt(swatch.dataset.color);
        // Redraw all car previews with new color
        document.querySelectorAll('.car-card').forEach((card, i) => {
            const canvas = card.querySelector('canvas');
            if (canvas) drawCarPreview(canvas, i, selectedCarColor);
        });
    });
});

// Mobile touch controls
function setupTouch(id, key) {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', e => { e.preventDefault(); keys[key] = true; }, { passive: false });
    el.addEventListener('touchend', e => { e.preventDefault(); keys[key] = false; }, { passive: false });
}
setupTouch('touch-left', 'left');
setupTouch('touch-right', 'right');
setupTouch('touch-gas', 'up');
setupTouch('touch-brake', 'down');

// Auto-select first car by default
document.querySelector('.car-card').classList.add('selected');
selectedCarIndex = 0;

document.getElementById('quality-select').addEventListener('change', applySettings);
document.getElementById('shadows-check').addEventListener('change', applySettings);
document.getElementById('sound-check').addEventListener('change', applySettings);

// --- Loading progress ---
let totalAssets = 1 + CAR_CONFIGS.length;
let loadedAssets = 0;
function updateLoadingProgress() {
    loadedAssets++;
    const pct = Math.round((loadedAssets / totalAssets) * 100);
    const bar = document.getElementById('loading-bar');
    if (bar) bar.style.width = pct + '%';
    if (loadedAssets >= totalAssets) {
        assetsLoaded = true;
        setTimeout(() => {
            const ls = document.getElementById('loading-screen');
            if (ls) ls.style.display = 'none';
        }, 500);
    }
}

treeLoadPromise.then(updateLoadingProgress).catch(updateLoadingProgress);
carLoadPromises.forEach(p => p.then(updateLoadingProgress).catch(updateLoadingProgress));

// Initialize menu state
showMainMenu();

animate();
