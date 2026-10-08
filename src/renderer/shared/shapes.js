(function (g) {
  'use strict';
  const { Color } = g;
  const TAU = Math.PI * 2;

  /*
   * Body shapes. A shape is a set of closed outlines (point lists) in body units: x within +-1,
   * y within +-0.92, centre = origin. Keeping outlines as points lets the character ripple them every
   * frame (jelly / liquid wobble). Each shape also says where the face sits and how accessories fit:
   *   face   {dy, s}  shift/scale of eyes, mouth and cheeks
   *   slots  {head, face, ears, neck} each {dy, s}  - transform applied to accessories of that slot
   *   arm    [x, y] | null   shoulders;  feetX  foot spacing (null = no feet);  float  = bobs in the air
   *   shine  [x, y]   highlight position;  hit = superellipse exponent used for hover/click testing
   *   jelly  how much more it wobbles than normal;  alpha  body opacity (slime is see-through)
   *   back / front / inside   optional extra parts drawn behind / in front of / inside the body
   */

  const mix2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  function superellipse(n, rx = 1, ry = 0.92, steps = 120) {
    const out = [];
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * TAU; const c = Math.cos(a); const s = Math.sin(a);
      out.push([rx * Math.sign(c) * Math.abs(c) ** (2 / n), ry * Math.sign(s) * Math.abs(s) ** (2 / n)]);
    }
    return out;
  }

  function circle(cx, cy, r, n = 40) { return Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * TAU) * r, cy + Math.sin((i / n) * TAU) * r]); }

  /** Scale a point list so its bounding box becomes [-1,1] x [-0.92,0.92]. */
  function fit(pts) {
    const xs = pts.map((q) => q[0]); const ys = pts.map((q) => q[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return pts.map(([x, y]) => [((x - x0) / (x1 - x0)) * 2 - 1, ((y - y0) / (y1 - y0)) * 1.84 - 0.92]);
  }

  /** Round the corners of a polygon: `cut` = how far along each edge the rounding starts. */
  function roundCorners(pts, cut, seg = 10) {
    const out = []; const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[(i + n - 1) % n]; const b = pts[i]; const c = pts[(i + 1) % n];
      const la = Math.hypot(a[0] - b[0], a[1] - b[1]); const lc = Math.hypot(c[0] - b[0], c[1] - b[1]);
      const p0 = mix2(b, a, Math.min(0.5, cut / la)); const p2 = mix2(b, c, Math.min(0.5, cut / lc));
      for (let k = 0; k <= seg; k++) { const t = k / seg; const m = 1 - t; out.push([m * m * p0[0] + 2 * m * t * b[0] + t * t * p2[0], m * m * p0[1] + 2 * m * t * b[1] + t * t * p2[1]]); }
    }
    return out;
  }

  /** Insert points on long edges so wobble bends them smoothly instead of kinking. */
  function densify(pts, maxSeg = 0.06) {
    const out = []; const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i]; const b = pts[(i + 1) % n]; out.push(a);
      const k = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxSeg);
      for (let j = 1; j <= k; j++) out.push(mix2(a, b, j / (k + 1)));
    }
    return out;
  }

  /** Minimal pen that flattens curves into points. */
  class Pen {
    constructor() { this.pts = []; this.cur = [0, 0]; }
    move(x, y) { this.pts.push([x, y]); this.cur = [x, y]; return this; }
    line(x, y) { return this.move(x, y); }
    bez(x1, y1, x2, y2, x, y, n = 14) {
      const [x0, y0] = this.cur;
      for (let i = 1; i <= n; i++) { const t = i / n; const m = 1 - t; this.pts.push([m ** 3 * x0 + 3 * m * m * t * x1 + 3 * m * t * t * x2 + t ** 3 * x, m ** 3 * y0 + 3 * m * m * t * y1 + 3 * m * t * t * y2 + t ** 3 * y]); }
      this.cur = [x, y]; return this;
    }
    quad(cx, cy, x, y, n = 10) {
      const [x0, y0] = this.cur;
      for (let i = 1; i <= n; i++) { const t = i / n; const m = 1 - t; this.pts.push([m * m * x0 + 2 * m * t * cx + t * t * x, m * m * y0 + 2 * m * t * cy + t * t * y]); }
      this.cur = [x, y]; return this;
    }
  }

  const heartPts = fit(Array.from({ length: 140 }, (_, i) => {
    const t = (i / 140) * TAU;
    return [16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))];
  }));

  const starPts = fit(Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? 0.52 : 1; const a = -Math.PI / 2 + (i * Math.PI) / 5; return [Math.cos(a) * r, Math.sin(a) * r];
  }));

  const cloudContours = () => [
    ...[[-0.55, 0.12, 0.4], [-0.25, -0.3, 0.5], [0.25, -0.38, 0.56], [0.62, 0.05, 0.4], [-0.66, 0.62, 0.3], [0.66, 0.62, 0.3]].map(([x, y, r]) => circle(x, y, r)),
    [[-0.66, 0.1], [0.66, 0.1], [0.66, 0.92], [-0.66, 0.92]],
  ];

  const ghostPts = () => {
    const p = new Pen().move(-0.92, 0.72).line(-0.92, -0.05).bez(-0.92, -0.64, -0.5, -0.92, 0, -0.92).bez(0.5, -0.92, 0.92, -0.64, 0.92, -0.05).line(0.92, 0.72);
    const w = 1.84 / 3;
    for (let k = 0; k < 3; k++) { const x0 = 0.92 - k * w; p.quad(x0 - w / 2, 1.12, x0 - w, 0.72); }
    p.pts.pop(); return p.pts;
  };

  const dropPts = () => new Pen().move(0, -0.92).bez(0.22, -0.5, 0.95, 0.04, 0.95, 0.4).bez(0.95, 0.72, 0.52, 0.92, 0, 0.92).bez(-0.52, 0.92, -0.95, 0.72, -0.95, 0.4).bez(-0.95, 0.04, -0.22, -0.5, 0, -0.92).pts;

  /** A wide, melting dome with a slightly wavy base. */
  const slimePts = () => {
    const p = new Pen().move(-1, 0.78)
      .bez(-1.02, 0.1, -0.7, -0.92, 0, -0.92).bez(0.7, -0.92, 1.02, 0.1, 1, 0.78)
      .bez(1.0, 0.9, 0.82, 0.93, 0.62, 0.9).quad(0.3, 0.97, 0, 0.9).quad(-0.3, 0.83, -0.62, 0.92).bez(-0.82, 0.93, -1.0, 0.9, -1, 0.78);
    p.pts.pop(); return p.pts;
  };

  const pink = (c, a = 0.6) => Color.rgba(Color.mix(c, '#ff8fa8', 0.7), a);
  const poly = (pts) => { const p = new Path2D(); pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); return p; };

  /** Paints a back/front part with the same "outline first, fill on top" look as the body. */
  function part(ctx, path, fill, outline, lw) {
    ctx.lineJoin = 'round'; ctx.strokeStyle = outline; ctx.lineWidth = lw * 1.7; ctx.stroke(path); ctx.fillStyle = fill; ctx.fill(path);
  }

  const S0 = { dy: 0, s: 1 };
  const base = { face: S0, slots: { head: S0, face: S0, ears: S0, neck: S0 }, arm: [0.93, 0.2], feetX: 0.4, float: false, shine: [-0.4, -0.58], hit: 3, topExtra: 0, jelly: 1, alpha: 1 };
  const def = (o) => {
    const { contour, contours, ...rest } = o;
    return { ...base, ...rest, slots: { ...base.slots, ...(o.slots || {}) }, contours: (contours || [contour]).map((c) => densify(c)) };
  };

  const SHAPES = {
    blob: def({ name: 'Mochi', contour: superellipse(2.65) }),
    circle: def({ name: 'Circle', contour: superellipse(2, 0.97, 0.92), hit: 2 }),
    square: def({ name: 'Square', contour: superellipse(6, 0.98, 0.92), hit: 5, arm: [0.99, 0.2], jelly: 1.2 }),
    heart: def({
      name: 'Heart', contour: heartPts, face: { dy: 0.1, s: 0.9 }, arm: [0.9, 0.0], feetX: 0.3, shine: [-0.52, -0.5], hit: 2.2,
      slots: { head: { dy: 0.3, s: 0.8 }, face: { dy: 0.1, s: 0.9 }, ears: { dy: -0.28, s: 0.95 }, neck: { dy: -0.2, s: 0.7 } },
    }),
    triangle: def({
      name: 'Triangle', contour: roundCorners([[0, -0.99], [1.02, 0.98], [-1.02, 0.98]], 0.5), face: { dy: 0.32, s: 0.8 }, arm: [0.6, 0.5], feetX: 0.55, shine: [-0.22, -0.1], hit: 1.7,
      slots: { head: { dy: 0.62, s: 0.58 }, face: { dy: 0.32, s: 0.8 }, ears: { dy: 0.38, s: 0.55 }, neck: { dy: -0.02, s: 0.78 } },
    }),
    star: def({
      name: 'Star', contour: roundCorners(starPts, 0.17), face: { dy: 0.08, s: 0.72 }, arm: [0.8, 0.12], feetX: 0.36, shine: [-0.22, -0.32], hit: 2,
      slots: { head: { dy: 0.4, s: 0.6 }, face: { dy: 0.08, s: 0.72 }, ears: { dy: 0.1, s: 0.7 }, neck: { dy: -0.12, s: 0.7 } },
    }),
    cloud: def({
      name: 'Cloud', contours: cloudContours(), face: { dy: 0.08, s: 0.92 }, arm: [0.98, 0.3], shine: [-0.35, -0.5], hit: 2.6, jelly: 1.3,
      slots: { head: { dy: 0.3, s: 0.85 }, face: { dy: 0.08, s: 0.92 }, ears: { dy: 0.02, s: 0.96 } },
    }),
    drop: def({
      name: 'Droplet', contour: dropPts(), face: { dy: 0.24, s: 0.85 }, arm: [0.82, 0.38], shine: [-0.34, 0.0], hit: 2, jelly: 1.5, alpha: 0.95,
      slots: { head: { dy: 0.56, s: 0.55 }, face: { dy: 0.24, s: 0.85 }, ears: { dy: 0.3, s: 0.75 }, neck: { dy: -0.05, s: 0.85 } },
    }),
    ghost: def({
      name: 'Ghost', contour: ghostPts(), face: { dy: -0.12, s: 0.95 }, arm: [0.96, 0.28], feetX: null, float: true, shine: [-0.4, -0.55], hit: 2.6, jelly: 1.4,
      slots: { head: { dy: 0.06, s: 0.95 }, face: { dy: -0.12, s: 0.95 }, ears: { dy: -0.1, s: 0.96 }, neck: { dy: -0.1, s: 1 } },
    }),
    slime: def({
      name: 'Slime', contour: slimePts(), face: { dy: 0.1, s: 0.95 }, arm: null, feetX: null, shine: [-0.45, -0.52], hit: 2.6, jelly: 2.2, alpha: 0.86,
      slots: { head: { dy: 0.1, s: 0.9 }, face: { dy: 0.1, s: 0.95 }, ears: { dy: 0.1, s: 1 }, neck: { dy: 0.02, s: 1 } },
      back(ctx, color, outline, lw, t) { // the puddle it is melting into
        const w = 1.25 + Math.sin(t * 1.6) * 0.03;
        ctx.beginPath(); ctx.ellipse(0, 0.97, w, 0.17, 0, 0, TAU); ctx.fillStyle = Color.rgba(Color.darken(color, 0.04), 0.55); ctx.fill();
        ctx.strokeStyle = Color.rgba(outline, 0.5); ctx.lineWidth = lw; ctx.stroke();
      },
      front(ctx, color, outline, lw, t) { // drips running down the front
        for (const [x, ph, len] of [[-0.48, 0, 0.2], [0.18, 2.1, 0.28], [0.64, 4.0, 0.16]]) {
          const l = len * (0.6 + 0.4 * Math.sin(t * 0.9 + ph)); const y0 = 0.84 + Math.sin(x * 3) * 0.04;
          const d = new Path2D(); d.moveTo(x - 0.07, y0); d.quadraticCurveTo(x - 0.07, y0 + l, x, y0 + l + 0.05); d.quadraticCurveTo(x + 0.07, y0 + l, x + 0.07, y0); d.closePath();
          ctx.fillStyle = Color.rgba(color, 0.8); ctx.fill(d); ctx.strokeStyle = Color.rgba(outline, 0.6); ctx.lineWidth = lw; ctx.stroke(d);
        }
      },
      inside(ctx, color, t) { // glints and bubbles drifting up through the goo
        ctx.fillStyle = Color.rgba(Color.darken(color, 0.12), 0.35); ctx.beginPath(); ctx.ellipse(0.25, 0.5, 0.34, 0.2, 0.2, 0, TAU); ctx.fill();
        for (const [x, ph, r] of [[-0.55, 0, 0.09], [0.5, 1.7, 0.07], [-0.1, 3.3, 0.055]]) {
          const f = ((t * 0.12 + ph) % 3) / 3; const y = 0.75 - f * 1.5;
          ctx.beginPath(); ctx.arc(x + Math.sin(t + ph) * 0.04, y, r, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 0.02; ctx.stroke();
          ctx.beginPath(); ctx.arc(x - r * 0.3 + Math.sin(t + ph) * 0.04, y - r * 0.3, r * 0.25, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fill();
        }
      },
    }),
    cat: def({
      name: 'Kitty', contour: superellipse(2.3, 1, 0.9), topExtra: 0.35, noHair: true,
      back(ctx, color, outline, lw, t) {
        for (const s of [-1, 1]) {
          const tw = Math.sin(t * 1.3 + s) * 0.02;
          part(ctx, poly([[0.9 * s, -0.4], [(0.84 + tw) * s, -1.3], [0.22 * s, -0.84]]), color, outline, lw);
          ctx.fillStyle = pink(color); ctx.fill(poly([[0.78 * s, -0.55], [(0.76 + tw) * s, -1.08], [0.42 * s, -0.8]]));
        }
      },
      front(ctx, color, outline) { // whiskers
        ctx.strokeStyle = Color.rgba(outline, 0.55); ctx.lineWidth = 0.02; ctx.lineCap = 'round';
        for (const s of [-1, 1]) for (const dy of [-0.04, 0.05]) { ctx.beginPath(); ctx.moveTo(s * 0.72, 0.3 + dy); ctx.lineTo(s * 1.12, 0.26 + dy * 3); ctx.stroke(); }
      },
      slots: { head: { dy: 0.02, s: 0.9 } },
    }),
    bear: def({
      name: 'Bear', contour: superellipse(2.2, 1, 0.9), topExtra: 0.2, noHair: true,
      back(ctx, color, outline, lw) {
        for (const s of [-1, 1]) {
          const e = new Path2D(); e.arc(s * 0.7, -0.74, 0.32, 0, TAU); part(ctx, e, color, outline, lw);
          const i = new Path2D(); i.arc(s * 0.7, -0.74, 0.17, 0, TAU); ctx.fillStyle = pink(color, 0.55); ctx.fill(i);
        }
      },
      front(ctx, color) { const m = new Path2D(); m.ellipse(0, 0.28, 0.3, 0.22, 0, 0, TAU); ctx.fillStyle = Color.rgba(Color.lighten(color, 0.28), 0.8); ctx.fill(m); },
      slots: { head: { dy: 0.04, s: 0.8 } },
    }),
    bunny: def({
      name: 'Bunny', contour: superellipse(2.4, 0.96, 0.9), topExtra: 0.95, noHair: true,
      back(ctx, color, outline, lw, t) {
        for (const s of [-1, 1]) {
          ctx.save(); ctx.translate(s * 0.42, -0.74); ctx.rotate(s * 0.13 + Math.sin(t * 1.2 + s) * 0.04);
          const e = new Path2D(); e.ellipse(0, -0.55, 0.2, 0.62, 0, 0, TAU); part(ctx, e, color, outline, lw);
          const i = new Path2D(); i.ellipse(0, -0.55, 0.1, 0.47, 0, 0, TAU); ctx.fillStyle = pink(color); ctx.fill(i);
          ctx.restore();
        }
      },
      slots: { head: { dy: 0.04, s: 0.75 } },
    }),
  };

  const ORDER = ['blob', 'slime', 'circle', 'heart', 'triangle', 'star', 'square', 'cloud', 'drop', 'ghost', 'cat', 'bear', 'bunny'];

  /** One-click characters: shape + gender style + colour, with a funny name. */
  const PRESETS = [
    { id: 'slimey', name: 'Slimey', shape: 'slime', style: 'neutral', color: '#6ee06e' },
    { id: 'goo', name: 'Bubblegoo', shape: 'slime', style: 'female', color: '#f472b6' },
    { id: 'blorp', name: 'Blorp', shape: 'slime', style: 'male', color: '#38bdf8' },
    { id: 'lovebug', name: 'Lovebug', shape: 'heart', style: 'female', color: '#f472b6' },
    { id: 'sir', name: 'Sir Pointy', shape: 'triangle', style: 'male', color: '#3b82f6' },
    { id: 'ghosty', name: 'Ghosty', shape: 'ghost', style: 'neutral', color: '#cbd5e1' },
    { id: 'cloudy', name: 'Cloudy', shape: 'cloud', style: 'female', color: '#93c5fd' },
    { id: 'starry', name: 'Starry', shape: 'star', style: 'male', color: '#fbbf24' },
    { id: 'kitty', name: 'Kitty', shape: 'cat', style: 'female', color: '#f5a33a' },
    { id: 'bearly', name: 'Bearly Awake', shape: 'bear', style: 'male', color: '#b4885a' },
    { id: 'bun', name: 'Bun Bun', shape: 'bunny', style: 'female', color: '#fbcfe8' },
    { id: 'blocky', name: 'Blocky', shape: 'square', style: 'male', color: '#4ade80' },
    { id: 'drip', name: 'Drippy', shape: 'drop', style: 'neutral', color: '#38bdf8' },
    { id: 'orb', name: 'Orb', shape: 'circle', style: 'neutral', color: '#a78bfa' },
    { id: 'mochi', name: 'Classic Mochi', shape: 'blob', style: 'neutral', color: '#f5a33a' },
  ];

  g.Shapes = {
    list: ORDER.map((id) => ({ id, name: SHAPES[id].name })),
    get: (id) => SHAPES[id] || SHAPES.blob,
    PRESETS,
    STYLES: [{ id: 'neutral', name: 'Neutral' }, { id: 'male', name: 'Male' }, { id: 'female', name: 'Female' }],
  };
})(typeof window !== 'undefined' ? window : globalThis);
