// The corroding coin. Hard-surface geometry only: a lathe rim, two relief faces, instanced dust, a tube-stem sprout.
// Rot level uRot (0..1) drives a MeshStandardMaterial patched with onBeforeCompile (keeps PBR lighting, adds the rot).
import * as THREE from '../vendor/three.module.min.js';


const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Draw ring + R on a canvas as a height map, then derive a tangent-space normal map by Sobel. */
function makeRelief(size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  g.strokeStyle = '#fff'; g.lineWidth = size * 0.035; g.lineJoin = 'round';
  g.beginPath(); g.arc(size / 2, size / 2, size * 0.40, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#fff'; g.font = `700 ${size * 0.5}px Georgia, 'Times New Roman', serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('R', size / 2, size * 0.54);
  const src = g.getImageData(0, 0, size, size).data;
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = src[i * 4] / 255;
  // soften the height a touch so edges bevel
  const blur = new Float32Array(h.length);
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    const i = y * size + x;
    blur[i] = (h[i] * 4 + h[i - 1] + h[i + 1] + h[i - size] + h[i + size]) / 8;
  }
  const out = document.createElement('canvas'); out.width = out.height = size;
  const og = out.getContext('2d'); const img = og.createImageData(size, size);
  const k = 5;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = (xx, yy) => blur[clamp(yy, 0, size - 1) * size + clamp(xx, 0, size - 1)];
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    let nx = -dx * k, ny = dy * k, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const j = (y * size + x) * 4;
    img.data[j] = (nx * .5 + .5) * 255; img.data[j + 1] = (ny * .5 + .5) * 255; img.data[j + 2] = (nz * .5 + .5) * 255; img.data[j + 3] = 255;
  }
  og.putImageData(img, 0, 0);
  const normal = new THREE.CanvasTexture(out); normal.anisotropy = 4;
  const height = new THREE.CanvasTexture(c);
  return { normal, height };
}

const NOISE_GLSL = /* glsl */`
float rh(vec3 p){ p = fract(p*0.3183099 + .1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(rh(i),rh(i+vec3(1,0,0)),f.x),mix(rh(i+vec3(0,1,0)),rh(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(rh(i+vec3(0,0,1)),rh(i+vec3(1,0,1)),f.x),mix(rh(i+vec3(0,1,1)),rh(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a = .5, s = 0.; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.03 + 7.1; a *= .5; } return s; }
vec3 h3(vec3 p){ p = vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6))); return fract(sin(p)*43758.5453); }
// voronoi edge distance F2-F1 (small near cell borders = cracks)
float vedge(vec3 p){ vec3 i = floor(p), f = fract(p); float d1 = 8., d2 = 8.;
  for(int z=-1;z<=1;z++) for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec3 g = vec3(float(x),float(y),float(z)); vec3 o = h3(i+g); float d = length(g + o - f);
    if(d < d1){ d2 = d1; d1 = d; } else if(d < d2){ d2 = d; } }
  return d2 - d1; }
`;

function patchMaterial(mat, uniforms) {
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uRot; uniform vec3 uMid; uniform vec3 uGreen; uniform vec3 uPit;\nvarying vec3 vOP;\n${NOISE_GLSL}`)
      .replace('#include <common>', '#include <common>\nfloat sstep2(float a, float b, float x){ float t = clamp((x-a)/(b-a),0.,1.); return t*t*(3.-2.*t); }')
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        float rr = length(vOP.xy);
        float rim = smoothstep(.62, 1.0, rr);
        float nz = fbm(vOP*2.6);
        // dust stage: the surface erodes away (cutout with a dark edge line)
        float erode = sstep2(.5, .9, uRot) * .42 * rim + sstep2(.74, .97, uRot) * 1.1;
        if (nz < erode) discard;
        float edgeBand = 1.0 - smoothstep(.0, .05, nz - erode);
        vec3 bronze = diffuseColor.rgb;
        float tarn = sstep2(.0, .3, uRot);
        vec3 col = mix(bronze, bronze*vec3(.34,.27,.22), tarn);
        col *= .92 + .16*vnoise(vOP*22.0); // fine noise
        float vg = sstep2(.25, .55, uRot);
        float vpatch = fbm(vOP*2.2 + 3.0) + .55*rim + .25*(1.0 - smoothstep(.0,.35,abs(rr-.78)));
        float vm = smoothstep(1.05 - vg*.85, 1.2 - vg*.85, vpatch);
        float vm2 = smoothstep(1.3 - vg*.9, 1.45 - vg*.9, vpatch + .1*vnoise(vOP*9.));
        col = mix(col, uMid, vm*vg);
        col = mix(col, uGreen, vm2*vg*.9);
        float ck = sstep2(.5, .72, uRot);
        float ve = vedge(vOP*2.3);
        float crack = (1.0 - smoothstep(.0, .06, ve)) * ck;
        float pit = smoothstep(.72, .8, fbm(vOP*9.0 + 11.0)) * ck;
        col = mix(col, uPit, clamp(crack*.95 + pit*.85, 0., 1.));
        col = mix(col, uPit, edgeBand * sstep2(.5, .8, uRot));
        diffuseColor.rgb = col;
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + tarn*.3 + vm*vg*.35, 0., 1.);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\nmetalnessFactor *= (1.0 - tarn*.45) * (1.0 - vm*vg*.9);`);
  };
  mat.customProgramCacheKey = () => 'rot-coin';
}

export function createScene(canvas, { reduced = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'default' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 50);
  camera.position.set(0, .05, 5.2);

  // environment: a few emissive cards for reflections (no external files)
  const envScene = new THREE.Scene();
  const card = (col, w, h, x, y, z, i) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(i), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); envScene.add(m); };
  card('#ffe2b0', 6, 4, 4, 5, 4, 3); card('#6FC3A3', 5, 6, -6, 1, 2, 1.4); card('#E9E5D2', 8, 2, 0, -4, -5, .8); card('#16281F', 14, 14, 0, 0, -9, .6);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, .04).texture;
  scene.environmentIntensity = .75;

  const key = new THREE.DirectionalLight('#ffd9a0', 2.2); key.position.set(3, 4, 5); scene.add(key);
  const fill = new THREE.DirectionalLight('#6FC3A3', .8); fill.position.set(-4, -1, 3); scene.add(fill);
  scene.add(new THREE.AmbientLight('#8FB5A3', .35));

  const uniforms = { uRot: { value: 0 }, uMid: { value: new THREE.Color('#4FA88A') }, uGreen: { value: new THREE.Color('#6FC3A3') }, uPit: { value: new THREE.Color('#0B1410') } };
  const relief = makeRelief(512);
  const bronze = '#b07a3a';
  const faceMat = new THREE.MeshStandardMaterial({ color: bronze, metalness: .75, roughness: .38, normalMap: relief.normal, normalScale: new THREE.Vector2(1.4, 1.4), side: THREE.DoubleSide });
  const rimMat = new THREE.MeshStandardMaterial({ color: bronze, metalness: .75, roughness: .42, side: THREE.DoubleSide });
  patchMaterial(faceMat, uniforms); patchMaterial(rimMat, uniforms);

  const coin = new THREE.Group();
  // beveled rim: lathe profile (radius, y), flat top/bottom handled by the face discs
  const H = .09, R = 1;
  const prof = [[R - .08, -H], [R - .02, -H], [R + .02, -H + .035], [R + .035, -H + .08], [R + .035, H - .08], [R + .02, H - .035], [R - .02, H], [R - .08, H]].map(p => new THREE.Vector2(p[0], p[1]));
  const rimGeo = new THREE.LatheGeometry(prof, 72); rimGeo.rotateX(Math.PI / 2);
  coin.add(new THREE.Mesh(rimGeo, rimMat));
  const faceGeo = new THREE.CircleGeometry(R - .075, 72);
  const front = new THREE.Mesh(faceGeo, faceMat); front.position.z = H; coin.add(front);
  const back = new THREE.Mesh(faceGeo, faceMat); back.position.z = -H; back.rotation.y = Math.PI; coin.add(back);
  // raised ring and R: thin extruded-looking discs under the normal map are enough; add a real raised ring for silhouette
  const ringGeo = new THREE.TorusGeometry(R * .66, .018, 8, 72);
  for (const s of [1, -1]) { const t = new THREE.Mesh(ringGeo, rimMat); t.position.z = s * (H + .004); t.scale.z = .5; coin.add(t); }
  scene.add(coin);

  // soil plane (a dark disc) + dust
  const soil = new THREE.Mesh(new THREE.CircleGeometry(1.7, 48), new THREE.MeshStandardMaterial({ color: '#16281F', roughness: 1, metalness: 0 }));
  soil.rotation.x = -Math.PI / 2; soil.position.y = -1.18; scene.add(soil);

  const N = reduced ? 0 : 420;
  const dustGeo = new THREE.TetrahedronGeometry(.032, 0);
  const dustMat = new THREE.MeshStandardMaterial({ color: '#4a3a2a', roughness: 1, metalness: 0 });
  const dust = new THREE.InstancedMesh(dustGeo, dustMat, Math.max(N, 1));
  dust.frustumCulled = false; dust.visible = false; scene.add(dust);
  const rnd = (i, k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  const P = Array.from({ length: N }, (_, i) => {
    const a = rnd(i, 1) * Math.PI * 2, r = Math.sqrt(rnd(i, 2)) * .95;
    const pa = rnd(i, 3) * Math.PI * 2, pr = Math.pow(rnd(i, 4), .7) * .62;
    return { sx: Math.cos(a) * r, sy: Math.sin(a) * r, sz: (rnd(i, 5) - .5) * .12,
      ex: Math.cos(pa) * pr, ez: Math.sin(pa) * pr, ey: -1.18 + (1 - pr / .62) * .26 * rnd(i, 6) + .02,
      delay: rnd(i, 7) * .55, spin: rnd(i, 8) * 6, sc: .6 + rnd(i, 9) * 1.1, col: rnd(i, 10) };
  });
  const dummy = new THREE.Object3D(); const cA = new THREE.Color('#5a4630'), cB = new THREE.Color('#2f4a3c'), cc = new THREE.Color();
  for (let i = 0; i < N; i++) dust.setColorAt(i, cc.copy(cA).lerp(cB, P[i].col));

  // sprout
  const sprout = new THREE.Group(); sprout.position.set(0, -1.16, 0);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(.02, .22, 0), new THREE.Vector3(-.015, .45, 0), new THREE.Vector3(.03, .64, 0)]);
  const stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, .022, 6, false), new THREE.MeshStandardMaterial({ color: '#6FC3A3', roughness: .7 }));
  sprout.add(stem);
  const leafGeo = new THREE.SphereGeometry(.16, 14, 8); leafGeo.scale(1, .12, .5); leafGeo.translate(.16, 0, 0);
  const mkLeaf = (col, rz, s) => { const m = new THREE.Mesh(leafGeo, new THREE.MeshStandardMaterial({ color: col, roughness: .6 })); m.position.set(.03, .64, 0); m.rotation.z = rz; m.scale.setScalar(s); sprout.add(m); return m; };
  const leafL = mkLeaf('#E9E5D2', Math.PI - .5, .9), leafR = mkLeaf('#4FA88A', .5, 1.15);
  sprout.visible = false; scene.add(sprout);

  // state
  let rot = 0, target = 0, anim = null, running = true, onScreen = true, w = 0, h = 0, px = 0, py = 0, tpx = 0, tpy = 0, spin = 0;
  const api = {
    get rot() { return rot; },
    setRot(u, snap = false) { target = clamp(u); if (snap || reduced) { rot = target; } },
    /** ease to a new rot level (used by the burn jump) */
    tweenTo(u, ms = 1400) { anim = { from: rot, to: clamp(u), t0: performance.now(), ms }; target = clamp(u); },
    setPaused(p) { running = !p; },
    resize() {
      const r = canvas.getBoundingClientRect(); w = Math.max(1, r.width); h = Math.max(1, r.height);
      renderer.setSize(w, h, false); camera.aspect = w / h;
      camera.position.z = w / h < .85 ? 5.8 : 5.2; camera.updateProjectionMatrix();
    },
    dispose() { renderer.dispose(); }
  };
  api.resize();
  if (!reduced) {
    addEventListener('pointermove', e => { tpx = (e.clientX / innerWidth - .5); tpy = (e.clientY / innerHeight - .5); }, { passive: true });
  }
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => { onScreen = es[0].isIntersecting; }, { threshold: 0 }) : null;
  io?.observe(canvas);
  new ResizeObserver(() => api.resize()).observe(canvas);

  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    if (!running || !onScreen || document.hidden) { clock.getDelta(); return; }
    const dt = Math.min(clock.getDelta(), .05);
    if (anim) { const t = clamp((performance.now() - anim.t0) / anim.ms); const e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; rot = anim.from + (anim.to - anim.from) * e; if (t >= 1) anim = null; }
    else rot += (target - rot) * (1 - Math.exp(-dt * 6));
    uniforms.uRot.value = rot;
    if (!reduced) { spin += dt * .35; px += (tpx - px) * .06; py += (tpy - py) * .06; }
    coin.rotation.y = Math.sin(spin) * .55 + px * .5;
    coin.rotation.x = -.12 + py * .25;
    coin.visible = rot < .975;
    // lift the coin down toward the soil as it breaks down
    coin.position.y = -sstep(.7, .95, rot) * .5;
    // dust
    const d = sstep(.72, .95, rot);
    dust.visible = N > 0 && d > 0 && rot < 2;
    if (dust.visible) {
      for (let i = 0; i < N; i++) {
        const p = P[i]; const t = clamp((d - p.delay * .6) / (1 - p.delay * .6)); const f = t * t;
        const sx = p.sx * Math.cos(coin.rotation.y), sz = p.sx * Math.sin(coin.rotation.y);
        dummy.position.set(sx + (p.ex - sx) * f, (p.sy + coin.position.y) * (1 - f) + p.ey * f, sz + (p.ez - sz) * f);
        dummy.rotation.set(p.spin + t * 5, p.spin * 2 + t * 3, 0);
        const vis = t > 0 ? p.sc : 0; dummy.scale.setScalar(vis); dummy.updateMatrix(); dust.setMatrixAt(i, dummy.matrix);
      }
      dust.instanceMatrix.needsUpdate = true;
    }
    // sprout
    const s = sstep(.95, 1, rot);
    sprout.visible = s > 0.001;
    if (sprout.visible) { sprout.scale.set(s, s, s); stem.scale.y = s; leafL.rotation.z = Math.PI - .5 - (1 - s) * 1.1; leafR.rotation.z = .5 + (1 - s) * 1.1; }
    renderer.render(scene, camera);
  }
  frame();
  return api;
}

