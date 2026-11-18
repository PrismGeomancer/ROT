// ROT effects. Everything here is decoration: spores, cracks, letter decay, odometer.
// Nothing runs under prefers-reduced-motion except the (static) letter split.
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $$ = s => [...document.querySelectorAll(s)];
const rand = (a, b) => a + Math.random() * (b - a);

/* ---- split headings into words and letters (screen readers keep the original text) ---- */
function splitLetters(el) {
  const text = el.textContent;
  el.setAttribute('aria-label', text);
  el.textContent = '';
  let i = 0;
  text.split(/(\s+)/).forEach(part => {
    if (/^\s+$/.test(part) || !part) { el.append(' '); return; }
    const w = document.createElement('span'); w.className = 'wd'; w.setAttribute('aria-hidden', 'true');
    for (const ch of part) {
      const s = document.createElement('span'); s.className = 'ch'; s.textContent = ch;
      s.style.setProperty('--i', i++);
      s.style.setProperty('--r', rand(-9, 9).toFixed(1) + 'deg');
      s.style.setProperty('--r2', rand(-2.2, 2.2).toFixed(2) + 'deg');
      s.style.setProperty('--dy', rand(-2.5, 2.5).toFixed(1) + 'px');
      w.append(s);
    }
    el.append(w);
  });
}
$$('.rw').forEach(splitLetters);

/* ---- embers for Burn ---- */
if (!REDUCED) {
  const burn = document.querySelector('.fx-burn');
  if (burn) for (let k = 0; k < 7; k++) {
    const e = document.createElement('i'); e.className = 'ember'; e.setAttribute('aria-hidden', 'true');
    e.style.left = rand(6, 94).toFixed(0) + '%';
    e.style.setProperty('--dx', rand(-18, 18).toFixed(0) + 'px');
    e.style.animationDelay = (-rand(0, 5)).toFixed(2) + 's';
    e.style.animationDuration = rand(3.4, 5.6).toFixed(2) + 's';
    burn.append(e);
  }
}

/* ---- cracks: a jagged line that draws itself when its section reveals ---- */
function crack(el) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'crack'); svg.setAttribute('viewBox', '0 0 1000 14'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
  let d = 'M0 7', x = 0, y = 7;
  while (x < 1000) { x += rand(14, 46); y = 7 + rand(-5, 5); d += ` L${Math.min(x, 1000).toFixed(0)} ${y.toFixed(1)}`; }
  const main = document.createElementNS(NS, 'path'); main.setAttribute('d', d);
  svg.append(main);
  // a couple of short branches
  for (let b = 0; b < 3; b++) {
    const bx = rand(80, 920), p = document.createElementNS(NS, 'path');
    p.setAttribute('d', `M${bx.toFixed(0)} 7 L${(bx + rand(8, 22)).toFixed(0)} ${rand(11, 14).toFixed(1)} L${(bx + rand(24, 44)).toFixed(0)} ${rand(9, 14).toFixed(1)}`);
    p.setAttribute('class', 'br'); svg.append(p);
  }
  el.prepend(svg);
  svg.querySelectorAll('path').forEach(p => { const len = Math.ceil(p.getTotalLength?.() || 1200); p.style.setProperty('--len', len); });
}
$$('[data-crack]').forEach(crack);

/* ---- odometer on the 01..04 numerals and the "done" state after the reveal ---- */
function odometer(el) {
  const target = el.textContent.trim(); const n = parseInt(target, 10);
  if (REDUCED || !isFinite(n)) return;
  let k = 0; const steps = 8 + n * 3, t0 = performance.now();
  const tick = now => {
    const t = Math.min(1, (now - t0) / 900);
    const v = Math.floor(t * (n + 1) * 1.0);
    el.textContent = t < 1 ? String(Math.min(99, Math.floor(rand(0, 10) + (1 - t) * 60))).padStart(2, '0') : target;
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
$$('.row4').forEach(row => {
  row.addEventListener('revealed', () => {
    const n = row.querySelector('.n'); if (n) odometer(n);
    setTimeout(() => row.classList.add('done'), 2200);
  }, { once: true });
});
if (REDUCED) $$('.row4').forEach(r => r.classList.add('done'));

/* ---- footer sprout grows when the footer scrolls in ---- */
const foot = document.querySelector('footer');
if (foot && 'IntersectionObserver' in window && !REDUCED) {
  new IntersectionObserver((es, io) => { if (es[0].isIntersecting) { foot.classList.add('in'); io.disconnect(); } }, { threshold: .2 }).observe(foot);
} else foot?.classList.add('in');

/* ---- spores: slow drifting specks, plus a few that fall from the cursor ---- */
if (!REDUCED) {
  const cv = document.createElement('canvas'); cv.id = 'fx'; cv.setAttribute('aria-hidden', 'true');
  document.body.prepend(cv);
  const g = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const size = () => { dpr = Math.min(devicePixelRatio || 1, 1.5); W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); };
  size(); addEventListener('resize', size);
  const COLS = ['111,195,163', '79,168,138', '233,229,210'];
  const mk = (init) => ({ x: rand(0, W), y: init ? rand(0, H) : H + 10, r: rand(.6, 2.3), vy: -rand(.08, .32), ph: rand(0, 6.28), amp: rand(.15, .6), sp: rand(.004, .012), a: rand(.05, .2), c: COLS[Math.floor(rand(0, 3))] });
  let spores = Array.from({ length: Math.round(Math.min(46, Math.max(18, innerWidth / 36))) }, () => mk(true));
  const drops = [];
  let lx = 0, ly = 0, lt = 0;
  addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const now = performance.now();
    if (now - lt < 45 || Math.hypot(e.clientX - lx, e.clientY - ly) < 14) return;
    lt = now; lx = e.clientX; ly = e.clientY;
    if (drops.length < 36) drops.push({ x: e.clientX, y: e.clientY, vx: rand(-.25, .25), vy: rand(.1, .4), r: rand(.9, 2.4), life: 0, max: rand(70, 120), c: COLS[Math.floor(rand(0, 2))] });
  }, { passive: true });
  let t = 0, last = 0;
  (function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden || now - last < 24) return; // ~40fps is plenty for specks
    last = now; t++;
    g.clearRect(0, 0, W, H);
    for (const s of spores) {
      s.y += s.vy; s.ph += s.sp; s.x += Math.sin(s.ph) * s.amp;
      if (s.y < -10) Object.assign(s, mk(false));
      g.fillStyle = `rgba(${s.c},${s.a})`; g.beginPath(); g.arc(s.x, s.y, s.r, 0, 6.283); g.fill();
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]; d.life++; d.vy += .012; d.x += d.vx; d.y += d.vy;
      const a = Math.max(0, 1 - d.life / d.max) * .45;
      if (a <= 0) { drops.splice(i, 1); continue; }
      g.fillStyle = `rgba(${d.c},${a})`; g.beginPath(); g.arc(d.x, d.y, d.r, 0, 6.283); g.fill();
    }
  })();
}
