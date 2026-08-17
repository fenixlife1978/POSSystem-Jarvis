// =====================================================================
// JARVIS ORB — Esfera de partículas 3D (Three.js), estilo Iron Man.
// Reimplementación en Three.js puro del componente ParticleSphere.
// No requiere React ni ES modules (compatible con apertura vía file://).
// Expone API global: window.jarvisOrb
// =====================================================================
(function () {
  const THREE = window.THREE || {};

  const COUNT = 7000;
  const RADIUS = 2.0;

  const canvasHost = "jarvis-orb";
  let renderer, scene, camera, points, geometry;
  let state = "idle";
  let anim = 0;

  function buildPositions() {
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const x = RADIUS * Math.sin(phi) * Math.cos(theta);
      const y = RADIUS * Math.sin(phi) * Math.sin(theta);
      const z = RADIUS * Math.cos(phi);
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    }
    return pos;
  }

  function colorOf(s) {
    switch (s) {
      case "listening": return new THREE.Color("#FFB703");
      case "thinking": return new THREE.Color("#00F5FF");
      case "speaking": return new THREE.Color("#FFD54A");
      default: return new THREE.Color("#0077FF");
    }
  }

  function resize() {
    const host = document.getElementById(canvasHost);
    if (!host || !renderer) return;
    const w = host.clientWidth || 96;
    const h = host.clientHeight || 96;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function init() {
    const host = document.getElementById(canvasHost);
    if (!host) return;
    let rendererOk = true;
    const target = host;
    const FX = renderer; // puede ser undefined si falla

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 5.5);

    try {
      const r = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      target.appendChild(r.domElement);
      renderer = r;
    } catch (e) {
      console.error("jarvis-orb WebGL:", e);
      rendererOk = false;
    }
    if (!rendererOk) { window.jarvisOrb = { setState: () => {}, setVisible: () => {} }; return; }

    const initialPositions = buildPositions();
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(initialPositions.slice(), 3));
    window.__jarvisInitial = initialPositions;

    const material = new THREE.PointsMaterial({
      size: 0.42,
      color: colorOf("idle"),
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    points = new THREE.Points(geometry, material);
    scene.add(points);

    resize();
    window.addEventListener("resize", resize);
    animate();
  }

  function animate() {
    anim = requestAnimationFrame(animate);
    if (!points || !geometry || !renderer || !scene || !camera) return;
    const time = performance.now() / 1000;
    const attr = geometry.attributes.position;
    const initial = window.__jarvisInitial;

    let rotationSpeed = 0.4, waveFrequency = 2.0, waveAmplitude = 0.08, expansion = 1.0;
    if (state === "listening") { rotationSpeed = 1.2; waveFrequency = 6.0; waveAmplitude = 0.25; expansion = 1.25; }
    else if (state === "thinking") { rotationSpeed = 2.5; waveFrequency = 10.0; waveAmplitude = 0.18; expansion = 1.1; }
    else if (state === "speaking") { rotationSpeed = 0.9; waveFrequency = 3.0; waveAmplitude = 0.1; expansion = 1.05; }

    const radius = RADIUS * expansion;

    for (let i = 0; i < COUNT; i++) {
      const ix = i * 3, iy = i * 3 + 1, iz = i * 3 + 2;
      const x = initial[ix], y = initial[iy], z = initial[iz];
      const len = Math.sqrt(x * x + y * y + z * z) || 1;
      const nx = x / len, ny = y / len, nz = z / len;

      let rr = radius, amp = waveAmplitude, freq = waveFrequency;
      if (state === "speaking") {
        // "Ritmo": pulso tipo ecuador — los puntos cerca del ecuador (y~0) vibran
        // con la envolvente de audio; los polos (y alto) quedan más calmados.
        const equator = Math.max(0, 1 - Math.abs(ny));
        const pulse = 0.5 + 0.5 * Math.sin(time * 6.0);
        amp = waveAmplitude * (0.4 + equator * 1.6 * pulse);
        freq = waveFrequency;
        // Oscilación radial de "respiración" del habla.
        rr = radius * (1 + 0.08 * Math.sin(time * 4.0 + equator * Math.PI));
      }

      const distortion = Math.sin(time * freq + y * 2.0) * amp;
      attr.array[ix] = nx * (rr + rr * distortion);
      attr.array[iy] = ny * (rr + rr * distortion);
      attr.array[iz] = nz * (rr + rr * distortion);
    }
    attr.needsUpdate = true;

    points.rotation.y = time * rotationSpeed;
    points.rotation.x = Math.sin(time * 0.3) * 0.2;
    renderer.render(scene, camera);
  }

  function setState(s) {
    state = ["idle", "listening", "thinking", "speaking"].includes(s) ? s : "idle";
    if (points) points.material.color.copy(colorOf(state));
    if (points) points.material.needsUpdate = true;
    // cambio visual de la burbuja contenedora
    const host = document.getElementById(canvasHost);
    if (host) {
      host.classList.toggle("jarvis-listening", state === "listening");
      host.classList.toggle("jarvis-thinking", state === "thinking");
    }
  }

  function setVisible(v) {
    const host = document.getElementById(canvasHost);
    if (host) {
      host.classList.toggle("hidden", !v);
      if (v) resize();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.jarvisOrb = { setState, setVisible, resize };
})();