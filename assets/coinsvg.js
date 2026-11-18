// Static SVG coin for reduced motion or no WebGL (no three.js needed). stage 0..4
export function coinSvg(stage = 0) {
  const crack = stage >= 2 ? `<path d="M100 188 L96 150 L108 126 L98 100 L110 78" stroke="#0B1410" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` : '';
  const patch = stage >= 1 ? `<circle cx="58" cy="62" r="${stage >= 2 ? 26 : 14}" fill="#4FA88A" opacity=".55"/><circle cx="148" cy="130" r="${stage >= 2 ? 22 : 10}" fill="#6FC3A3" opacity=".5"/>` : '';
  const body = stage >= 3 ? '#2a2620' : stage >= 1 ? '#6a4b2a' : '#b07a3a';
  const coin = stage >= 4 ? '' : stage === 3
    ? `<ellipse cx="100" cy="176" rx="62" ry="12" fill="#3a2f22"/><ellipse cx="100" cy="170" rx="40" ry="8" fill="#5a4630"/>`
    : `<circle cx="100" cy="100" r="86" fill="${body}" stroke="#2A5E4D" stroke-width="6"/><circle cx="100" cy="100" r="64" fill="none" stroke="#0B1410" stroke-opacity=".35" stroke-width="5"/>${patch}<text x="100" y="128" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="92" fill="#0B1410" fill-opacity=".4">R</text>${crack}`;
  const sprout = stage >= 4 ? `<ellipse cx="100" cy="176" rx="62" ry="12" fill="#3a2f22"/><path d="M100 174 C100 150 100 130 100 112" stroke="#6FC3A3" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M100 128 C78 128 64 112 62 96 C84 96 100 106 100 128Z" fill="#E9E5D2"/><path d="M100 120 C116 120 136 106 140 84 C120 84 100 94 100 120Z" fill="#4FA88A"/>` : '';
  return coin + sprout;
}
