// =====================================================================
// JARVIS ORB — Esfera de partículas 3D estilo Iron Man (Three.js).
// Visual tomado EXACTO de "jarvis-sphere-clean.html" (3 capas de
// partículas + red sináptica + núcleo + sistema de color y animación).
// No se modifica el render de la esfera; solo se encapsula para que el
// POS lo controle: clic abre el panel, arrastrar mueve la esfera y los
// estados (listening/thinking/speaking/idle) cambian el color.
// NO se añaden gestos globales (rotar al arrastrar / doble clic / zoom).
// Expone API global: window.jarvisOrb { setState, setVisible, resize }
// =====================================================================
(function () {
  const THREE = window.THREE || {};

  const canvasHost = "jarvis-orb";
  let renderer, scene, camera;
  let jarvisGroup;

  // === COLOR SYSTEM (paleta dorado/naranja estilo Iron Man) ===
  const colors = {
    default: new THREE.Color(0xffd700),
    processing: new THREE.Color(0xffaa00),
    scanning: new THREE.Color(0xff4400),
    innerCore: new THREE.Color(0xffd700),
    midLayer: new THREE.Color(0xffaa00),
    outerLayer: new THREE.Color(0xff4400)
  };

  let currentColor = colors.default.clone();
  let targetColor = colors.default.clone();
  let baseScale = 1;

  // === PARTICLE SPHERE FACTORY ===
  // count: número de partículas
  // radius: radio base de la esfera
  // size: tamaño de cada partícula en pixels
  // jitter: dispersión radial máxima (las partículas se desvían ±jitter/2)
  function createParticleSphere(count, radius, size, jitter) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const originalPositions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = radius + (Math.random() - 0.5) * jitter;

      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      originalPositions[i * 3] = x;
      originalPositions[i * 3 + 1] = y;
      originalPositions[i * 3 + 2] = z;

      velocities[i * 3] = (Math.random() - 0.5) * 0.01;
      velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.01;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.01;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xffd700,
      size: size,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const points = new THREE.Points(geometry, material);
    points.userData = {
      originalPositions: originalPositions,
      velocities: velocities,
      radius: radius
    };
    return points;
  }

  function buildScene() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(75, 1, 0.1, 2000);
    camera.position.z = 240;

    jarvisGroup = new THREE.Group();
    scene.add(jarvisGroup);

    // === SPHERE LAYERS ===
    const innerSphere = createParticleSphere(3500, 50, 1.4, 8);
    const midSphere = createParticleSphere(5000, 85, 1.2, 12);
    const outerSphere = createParticleSphere(6500, 115, 1.0, 15);

    jarvisGroup.add(innerSphere);
    jarvisGroup.add(midSphere);
    jarvisGroup.add(outerSphere);

    // Guardamos referencias para la animación.
    jarvisGroup.userData.spheres = [innerSphere, midSphere, outerSphere];

    // === SYNAPTIC NETWORK (idéntico al archivo limpio) ===
    const nodeCount = 120;
    const nodeGeometry = new THREE.BufferGeometry();
    const nodePositions = new Float32Array(nodeCount * 3);
    const nodeRadius = 80;

    for (let i = 0; i < nodeCount; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);

      const x = nodeRadius * Math.sin(phi) * Math.cos(theta);
      const y = nodeRadius * Math.sin(phi) * Math.sin(theta);
      const z = nodeRadius * Math.cos(phi);

      nodePositions[i * 3] = x;
      nodePositions[i * 3 + 1] = y;
      nodePositions[i * 3 + 2] = z;
    }

    nodeGeometry.setAttribute("position", new THREE.BufferAttribute(nodePositions, 3));

    const linePositions = [];
    const maxDistance = 45;

    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        const dx = nodePositions[i * 3] - nodePositions[j * 3];
        const dy = nodePositions[i * 3 + 1] - nodePositions[j * 3 + 1];
        const dz = nodePositions[i * 3 + 2] - nodePositions[j * 3 + 2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < maxDistance) {
          linePositions.push(
            nodePositions[i * 3], nodePositions[i * 3 + 1], nodePositions[i * 3 + 2],
            nodePositions[j * 3], nodePositions[j * 3 + 1], nodePositions[j * 3 + 2]
          );
        }
      }
    }

    const linesGeometry = new THREE.BufferGeometry();
    linesGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));

    const linesMaterial = new THREE.LineBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending
    });

    const synapticNetwork = new THREE.LineSegments(linesGeometry, linesMaterial);
    jarvisGroup.add(synapticNetwork);
    jarvisGroup.userData.synapticNetwork = synapticNetwork;
    jarvisGroup.userData.linesMaterial = linesMaterial;

    // === INNER CORE (idéntico al archivo limpio) ===
    const coreGeometry = new THREE.IcosahedronGeometry(15, 2);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd700,
      wireframe: true,
      transparent: true,
      opacity: 0.2
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    jarvisGroup.add(core);
    jarvisGroup.userData.core = core;
    jarvisGroup.userData.coreMaterial = coreMaterial;
  }

  function triggerColorChange(color) { targetColor = color; }

  function setState(s) {
    const mode = ["idle", "listening", "thinking", "speaking"].includes(s) ? s : "idle";
    if (mode === "listening") triggerColorChange(colors.processing);
    else if (mode === "thinking") triggerColorChange(colors.scanning);
    else if (mode === "speaking") triggerColorChange(colors.processing);
    else triggerColorChange(colors.default);
    const host = document.getElementById(canvasHost);
    if (host) {
      host.classList.toggle("jarvis-listening", mode === "listening");
      host.classList.toggle("jarvis-thinking", mode === "thinking");
    }
  }

  function setVisible(v) {
    const host = document.getElementById(canvasHost);
    if (host) {
      host.classList.toggle("hidden", !v);
      if (v) resize();
    }
  }

  function resize() {
    const host = document.getElementById(canvasHost);
    if (!host || !renderer) return;
    const w = host.clientWidth || 96;
    const h = host.clientHeight || 96;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Ajuste para que la esfera (radio exterior ~115) llene el orbe.
    const s = (Math.min(w, h)) / 240;
    baseScale = s;
    jarvisGroup.scale.setScalar(baseScale);
    camera.position.z = 240 * s;
    camera.updateProjectionMatrix();
  }

  function updateParticleSphere(sphere, time, speed) {
    const positions = sphere.geometry.getAttribute("position");
    const original = sphere.userData.originalPositions;
    const velocities = sphere.userData.velocities;
    const count = positions.count;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      const wave = Math.sin(time * speed * 100 + i * 0.01);
      const wave2 = Math.cos(time * speed * 80 + i * 0.015);
      const wave3 = Math.sin(time * speed * 120 + i * 0.008);
      const expand = Math.sin(time * 2 + i * 0.005) * 0.3;

      positions.array[i3] = original[i3] + wave * 0.5 + velocities[i3] * time * 20 + expand;
      positions.array[i3 + 1] = original[i3 + 1] + wave2 * 0.5 + velocities[i3 + 1] * time * 20 + expand;
      positions.array[i3 + 2] = original[i3 + 2] + wave3 * 0.5 + velocities[i3 + 2] * time * 20 + expand;
    }
    positions.needsUpdate = true;
  }

  // === ANIMATION LOOP (idéntico al archivo limpio, sin gestos de mouse) ===
  function animate() {
    requestAnimationFrame(animate);

    const time = (performance.now() / 1000);

    // Transición suave de color.
    currentColor.lerp(targetColor, 0.03);

    const [innerSphere, midSphere, outerSphere] = jarvisGroup.userData.spheres;
    const synapticNetwork = jarvisGroup.userData.synapticNetwork;
    const linesMaterial = jarvisGroup.userData.linesMaterial;
    const core = jarvisGroup.userData.core;
    const coreMaterial = jarvisGroup.userData.coreMaterial;

    // Aplicar colores.
    innerSphere.material.color.copy(currentColor);
    midSphere.material.color.lerp(currentColor, 0.5);
    outerSphere.material.color.lerp(colors.outerLayer, 0.3);
    linesMaterial.color.copy(currentColor);
    coreMaterial.color.copy(currentColor);

    // Movimiento orgánico de las partículas.
    updateParticleSphere(innerSphere, time, 0.02);
    updateParticleSphere(midSphere, time, 0.015);
    updateParticleSphere(outerSphere, time, 0.01);

    // Rotaciones por capa.
    innerSphere.rotation.y += 0.008;
    innerSphere.rotation.x += 0.003;

    midSphere.rotation.y -= 0.004;
    midSphere.rotation.z += 0.002;

    outerSphere.rotation.y += 0.002;
    outerSphere.rotation.x -= 0.003;

    synapticNetwork.rotation.y += 0.005;
    synapticNetwork.rotation.x += 0.002;

    core.rotation.x += 0.004;
    core.rotation.y += 0.006;

    // Efecto de pulso (expansión/contracción constante).
    const pulseFactor = Math.sin(time * 3) * 0.14 + 1;
    innerSphere.scale.set(pulseFactor, pulseFactor, pulseFactor);

    const midPulse = Math.cos(time * 2.5) * 0.10 + 1;
    midSphere.scale.set(midPulse, midPulse, midPulse);

    const pulseOuter = Math.cos(time * 2) * 0.09 + 1;
    outerSphere.scale.set(pulseOuter, pulseOuter, pulseOuter);

    // Respiración global de la esfera (expande y contrae de forma constante).
    const breath = Math.sin(time * 1.2) * 0.06 + 1;
    jarvisGroup.scale.setScalar(baseScale * breath);

    renderer.render(scene, camera);
  }

  function showFallback() {
    const host = document.getElementById(canvasHost);
    if (!host) return;
    // Limpia cualquier canvas residual y añade el div fallback
    const existing = host.querySelector('.jarvis-orb-fallback');
    if (existing) return;
    const fb = document.createElement('div');
    fb.className = 'jarvis-orb-fallback';
    host.appendChild(fb);
  }

  function init() {
    const host = document.getElementById(canvasHost);
    if (!host) return;

    let rendererOk = true;
    // Habilitar explícitamente el context attributes para Electron
    const ctxOpts = { antialias: true, alpha: true, powerPreference: 'high-performance' };
    try {
      const r = new THREE.WebGLRenderer(ctxOpts);
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      host.appendChild(r.domElement);
      renderer = r;
    } catch (e) {
      console.error("jarvis-orb WebGL:", e);
      rendererOk = false;
    }
    if (!rendererOk) {
      showFallback();
      window.jarvisOrb = { setState: () => {}, setVisible: () => {}, resize: () => {} };
      return;
    }

    if (typeof THREE.Scene !== "function") {
      showFallback();
      window.jarvisOrb = { setState: () => {}, setVisible: () => {}, resize: () => {} };
      return;
    }

    buildScene();
    resize();
    window.addEventListener("resize", resize);
    animate();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.jarvisOrb = { setState, setVisible, resize };
})();