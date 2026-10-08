(function (g) {
  'use strict';
  const TAU = Math.PI * 2;
  const { lighten, darken, rgba } = g.Color;

  /*
   * Every accessory is drawn in "body units": origin = centre of the body, 1 unit = body half-width,
   * the top of the head is y = -0.92. They are drawn inside the body's squash/lean transform, so
   * hats squish with the pet. `m` = { t, lookX, lookY }.
   */

  function paint(ctx, fill, stroke, lw = 0.035) {
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); }
  }
  function ellipse(ctx, x, y, rx, ry, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); }
  function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }
  function heart(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.9);
    ctx.bezierCurveTo(x - s * 1.6, y - s * 0.2, x - s * 0.7, y - s * 1.2, x, y - s * 0.35);
    ctx.bezierCurveTo(x + s * 0.7, y - s * 1.2, x + s * 1.6, y - s * 0.2, x, y + s * 0.9);
    ctx.closePath();
  }
  function grad(ctx, y0, y1, c0, c1) { const gr = ctx.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, c0); gr.addColorStop(1, c1); return gr; }
  function at(ctx, x, y, rot, fn) { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); fn(); ctx.restore(); }
  function pompom(ctx, x, y, r, c) {
    circle(ctx, x, y, r); paint(ctx, c, darken(c, 0.12), 0.025);
    circle(ctx, x - r * 0.3, y - r * 0.3, r * 0.3); ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fill();
  }

  const A = {};

  // ---- classics ------------------------------------------------------------------------------
  A.hat = { z: 'front', draw(ctx, c) {
    at(ctx, 0.05, -0.88, -0.1, () => {
      ellipse(ctx, 0, 0, 0.58, 0.11); paint(ctx, darken(c, 0.05), darken(c, 0.25));
      ctx.beginPath(); ctx.roundRect(-0.34, -0.55, 0.68, 0.58, 0.07); paint(ctx, grad(ctx, -0.55, 0.05, lighten(c, 0.08), c), darken(c, 0.25));
      ctx.beginPath(); ctx.rect(-0.34, -0.12, 0.68, 0.1); paint(ctx, '#ef4444', null);
      ellipse(ctx, 0, -0.55, 0.34, 0.06); paint(ctx, lighten(c, 0.1), darken(c, 0.25), 0.025);
    });
  } };

  A.crown = { z: 'front', draw(ctx, c, m) {
    at(ctx, 0, -0.9, 0.08, () => {
      ctx.beginPath();
      ctx.moveTo(-0.5, 0.02); ctx.lineTo(-0.52, -0.4); ctx.lineTo(-0.25, -0.2); ctx.lineTo(0, -0.5);
      ctx.lineTo(0.25, -0.2); ctx.lineTo(0.52, -0.4); ctx.lineTo(0.5, 0.02); ctx.closePath();
      paint(ctx, grad(ctx, -0.5, 0.02, lighten(c, 0.12), darken(c, 0.05)), darken(c, 0.3));
      for (const [x, y, col] of [[-0.52, -0.42, '#60a5fa'], [0, -0.52, '#f472b6'], [0.52, -0.42, '#34d399']]) { circle(ctx, x, y, 0.06); paint(ctx, col, '#fff', 0.015); }
      circle(ctx, 0, -0.12, 0.05); paint(ctx, '#ef4444', null);
      const tw = (Math.sin(m.t * 3) + 1) / 2; ctx.fillStyle = `rgba(255,255,255,${0.3 + tw * 0.5})`; circle(ctx, -0.25, -0.1, 0.03); ctx.fill();
    });
  } };

  A.antenna = { z: 'back', draw(ctx, c, m) {
    const sway = Math.sin(m.t * 1.7) * 0.06;
    ctx.beginPath(); ctx.moveTo(0, -0.8); ctx.bezierCurveTo(-0.08 + sway, -1.1, 0.16 + sway, -1.3, 0.1 + sway * 2, -1.52);
    ctx.strokeStyle = darken(c, 0.1); ctx.lineWidth = 0.05; ctx.lineCap = 'round'; ctx.stroke();
    const bx = 0.1 + sway * 2; const by = -1.56;
    const glow = ctx.createRadialGradient(bx, by, 0, bx, by, 0.28);
    glow.addColorStop(0, rgba(c, 0.55 + Math.sin(m.t * 3) * 0.15)); glow.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = glow; circle(ctx, bx, by, 0.28); ctx.fill();
    circle(ctx, bx, by, 0.095); paint(ctx, lighten(c, 0.08), darken(c, 0.2), 0.025);
    circle(ctx, bx - 0.03, by - 0.03, 0.03); ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fill();
  } };

  A.glasses = { z: 'front', draw(ctx, c, m) {
    const ox = m.lookX * 0.2; const oy = m.lookY * 0.1 + m.eyeY;
    ctx.lineWidth = 0.05; ctx.strokeStyle = c;
    for (const s of [-1, 1]) { circle(ctx, s * 0.37 + ox * 0.6, oy, 0.26); ctx.fillStyle = 'rgba(190,225,255,.16)'; ctx.fill(); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(-0.11 + ox * 0.6, oy - 0.02); ctx.quadraticCurveTo(0 + ox * 0.6, oy - 0.1, 0.11 + ox * 0.6, oy - 0.02); ctx.lineCap = 'round'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-0.63 + ox * 0.6, oy); ctx.lineTo(-0.97, oy - 0.03); ctx.moveTo(0.63 + ox * 0.6, oy); ctx.lineTo(0.97, oy - 0.03); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 0.025;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * 0.37 + ox * 0.6, oy, 0.19, Math.PI * 1.15, Math.PI * 1.45); ctx.stroke(); }
  } };

  A.sunglasses = { z: 'front', draw(ctx, c, m) {
    const ox = m.lookX * 0.2 * 0.6; const oy = m.lookY * 0.08 + m.eyeY;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.roundRect(s * 0.37 + ox - 0.27, oy - 0.2, 0.54, 0.4, [0.1, 0.1, 0.22, 0.22]);
      paint(ctx, grad(ctx, oy - 0.2, oy + 0.2, lighten(c, 0.14), c), darken(c, 0.1), 0.03);
      ctx.beginPath(); ctx.moveTo(s * 0.37 + ox - 0.15, oy - 0.1); ctx.lineTo(s * 0.37 + ox - 0.02, oy - 0.1); ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 0.04; ctx.lineCap = 'round'; ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(-0.1 + ox, oy - 0.1); ctx.lineTo(0.1 + ox, oy - 0.1); ctx.strokeStyle = c; ctx.lineWidth = 0.05; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-0.64 + ox, oy - 0.08); ctx.lineTo(-0.97, oy - 0.1); ctx.moveTo(0.64 + ox, oy - 0.08); ctx.lineTo(0.97, oy - 0.1); ctx.stroke();
  } };

  A.bowtie = { z: 'front', draw(ctx, c) {
    at(ctx, 0, 0.66, 0, () => {
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s * 0.3, -0.15); ctx.quadraticCurveTo(s * 0.34, 0, s * 0.3, 0.15); ctx.closePath();
        paint(ctx, grad(ctx, -0.15, 0.15, lighten(c, 0.1), darken(c, 0.05)), darken(c, 0.25), 0.025);
      }
      ctx.beginPath(); ctx.roundRect(-0.07, -0.08, 0.14, 0.16, 0.04); paint(ctx, darken(c, 0.08), darken(c, 0.28), 0.025);
    });
  } };

  A.scarf = { z: 'front', draw(ctx, c) {
    ctx.save();
    ctx.beginPath(); ctx.moveTo(-1.05, 0.42); ctx.quadraticCurveTo(0, 0.95, 1.05, 0.42); ctx.lineWidth = 0.24; ctx.lineCap = 'round';
    ctx.strokeStyle = darken(c, 0.25); ctx.stroke();
    ctx.lineWidth = 0.2; ctx.strokeStyle = c; ctx.stroke();
    ctx.lineWidth = 0.035; ctx.strokeStyle = lighten(c, 0.22);
    for (const o of [-0.04, 0.05]) { ctx.beginPath(); ctx.moveTo(-1.0, 0.42 + o); ctx.quadraticCurveTo(0, 0.95 + o, 1.0, 0.42 + o); ctx.stroke(); }
    ctx.restore();
    at(ctx, 0.5, 0.72, -0.2, () => {
      ctx.beginPath(); ctx.roundRect(-0.1, 0, 0.2, 0.42, 0.05); paint(ctx, c, darken(c, 0.25), 0.025);
      ctx.fillStyle = lighten(c, 0.22); ctx.fillRect(-0.1, 0.14, 0.2, 0.035); ctx.fillRect(-0.1, 0.24, 0.2, 0.035);
    });
  } };

  A.headphones = { z: 'front', draw(ctx, c) {
    ctx.beginPath(); ctx.arc(0, -0.05, 1.02, Math.PI * 1.04, Math.PI * 1.96);
    ctx.strokeStyle = darken(c, 0.25); ctx.lineWidth = 0.15; ctx.lineCap = 'round'; ctx.stroke();
    ctx.strokeStyle = c; ctx.lineWidth = 0.1; ctx.stroke();
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.roundRect(s * 1.0 - 0.13, -0.28, 0.26, 0.56, 0.12);
      paint(ctx, grad(ctx, -0.28, 0.28, lighten(c, 0.1), darken(c, 0.1)), darken(c, 0.3), 0.03);
      ctx.beginPath(); ctx.roundRect(s * 1.0 - 0.07 - s * 0.06, -0.18, 0.14, 0.36, 0.07); ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fill();
    }
  } };

  // ---- seasonal -------------------------------------------------------------------------------
  A.santaHat = { z: 'front', draw(ctx, c, m) {
    const wob = Math.sin(m.t * 2) * 0.03;
    at(ctx, 0, -0.84, -0.12, () => {
      ctx.beginPath(); ctx.moveTo(-0.62, 0); ctx.bezierCurveTo(-0.55, -0.6, -0.1, -0.85, 0.3 + wob, -0.82);
      ctx.bezierCurveTo(0.55, -0.7, 0.62, -0.4, 0.62, 0); ctx.closePath();
      paint(ctx, grad(ctx, -0.85, 0, lighten(c, 0.06), darken(c, 0.06)), darken(c, 0.25));
      ctx.beginPath(); ctx.roundRect(-0.7, -0.1, 1.4, 0.2, 0.1); paint(ctx, '#fffaf0', '#e5dccb', 0.025);
      pompom(ctx, 0.52 + wob * 2, -0.78, 0.12, '#fffaf0');
    });
  } };

  A.beanie = { z: 'front', draw(ctx, c) {
    at(ctx, 0, -0.78, 0.05, () => {
      ctx.beginPath(); ctx.moveTo(-0.74, 0); ctx.bezierCurveTo(-0.74, -0.62, 0.74, -0.62, 0.74, 0); ctx.closePath();
      paint(ctx, grad(ctx, -0.55, 0, lighten(c, 0.08), darken(c, 0.04)), darken(c, 0.25));
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 0.05;
      for (let x = -0.5; x <= 0.5; x += 0.25) { ctx.beginPath(); ctx.moveTo(x, -0.6); ctx.lineTo(x * 1.25, 0); ctx.stroke(); }
      ctx.restore();
      ctx.beginPath(); ctx.roundRect(-0.78, -0.02, 1.56, 0.2, 0.1); paint(ctx, lighten(c, 0.12), darken(c, 0.25), 0.03);
      pompom(ctx, 0, -0.55, 0.12, '#ffffff');
    });
  } };

  A.flowerCrown = { z: 'front', draw(ctx, c, m) {
    const pts = [[-0.74, -0.62], [-0.4, -0.84], [0, -0.93], [0.4, -0.84], [0.74, -0.62]];
    ctx.fillStyle = '#4ade80';
    for (const [x, y] of pts) { ellipse(ctx, x + (x < 0 ? 0.13 : -0.13), y + 0.05, 0.1, 0.045, x < 0 ? -0.5 : 0.5); ctx.fill(); }
    const cols = [c, '#ffffff', '#fde68a', '#ffffff', c];
    pts.forEach(([x, y], i) => {
      const r = i === 2 ? 0.115 : 0.095;
      for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU + m.t * 0.1; circle(ctx, x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.72); paint(ctx, cols[i], darken(cols[i], 0.12), 0.015); }
      circle(ctx, x, y, r * 0.55); paint(ctx, '#f59e0b', '#d97706', 0.015);
    });
  } };

  A.bunnyEars = { z: 'back', draw(ctx, c, m) {
    for (const s of [-1, 1]) {
      const bend = Math.sin(m.t * 1.3 + s) * 0.05 + s * 0.14;
      at(ctx, s * 0.4, -0.78, bend, () => {
        ellipse(ctx, 0, -0.5, 0.17, 0.52); paint(ctx, grad(ctx, -1, 0, lighten(c, 0.05), c), darken(c, 0.25));
        ellipse(ctx, 0, -0.5, 0.09, 0.4); ctx.fillStyle = 'rgba(255,150,175,.7)'; ctx.fill();
      });
    }
  } };

  A.strawHat = { z: 'front', draw(ctx, c) {
    at(ctx, 0, -0.86, -0.08, () => {
      ellipse(ctx, 0, 0, 0.95, 0.17); paint(ctx, grad(ctx, -0.17, 0.17, lighten(c, 0.08), darken(c, 0.06)), darken(c, 0.28));
      ctx.beginPath(); ctx.moveTo(-0.5, 0); ctx.bezierCurveTo(-0.5, -0.5, 0.5, -0.5, 0.5, 0); ctx.closePath(); paint(ctx, grad(ctx, -0.45, 0, lighten(c, 0.1), c), darken(c, 0.28));
      ctx.beginPath(); ctx.moveTo(-0.5, -0.02); ctx.quadraticCurveTo(0, 0.1, 0.5, -0.02); ctx.lineWidth = 0.13; ctx.strokeStyle = '#ef4444'; ctx.stroke();
      ctx.strokeStyle = 'rgba(120,80,20,.25)'; ctx.lineWidth = 0.02;
      for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(i * 0.14, -0.1); ctx.lineTo(i * 0.2, 0.15); ctx.stroke(); }
    });
  } };

  A.leaf = { z: 'front', draw(ctx, c, m) {
    at(ctx, 0.28, -0.92, 0.6 + Math.sin(m.t * 1.4) * 0.05, () => {
      ctx.beginPath(); ctx.moveTo(0, 0.1); ctx.bezierCurveTo(-0.28, -0.1, -0.2, -0.42, 0, -0.55); ctx.bezierCurveTo(0.2, -0.42, 0.28, -0.1, 0, 0.1);
      paint(ctx, grad(ctx, -0.55, 0.1, lighten(c, 0.08), darken(c, 0.08)), darken(c, 0.3), 0.025);
      ctx.beginPath(); ctx.moveTo(0, 0.12); ctx.lineTo(0, -0.45); ctx.moveTo(0, -0.1); ctx.lineTo(-0.1, -0.2); ctx.moveTo(0, -0.22); ctx.lineTo(0.1, -0.32);
      ctx.strokeStyle = darken(c, 0.25); ctx.lineWidth = 0.02; ctx.stroke();
    });
  } };

  A.witchHat = { z: 'front', draw(ctx, c, m) {
    const flop = Math.sin(m.t * 1.6) * 0.03;
    at(ctx, 0, -0.84, -0.1, () => {
      ellipse(ctx, 0, 0, 0.84, 0.15); paint(ctx, darken(c, 0.04), darken(c, 0.3));
      ctx.beginPath(); ctx.moveTo(-0.46, 0); ctx.bezierCurveTo(-0.34, -0.6, -0.06, -1.0, 0.28 + flop, -1.12);
      ctx.bezierCurveTo(0.22, -0.8, 0.4, -0.4, 0.46, 0); ctx.closePath();
      paint(ctx, grad(ctx, -1.1, 0, lighten(c, 0.08), c), darken(c, 0.3));
      ctx.beginPath(); ctx.moveTo(-0.45, -0.08); ctx.quadraticCurveTo(0, 0.06, 0.45, -0.08); ctx.lineTo(0.43, -0.2); ctx.quadraticCurveTo(0, -0.08, -0.43, -0.2); ctx.closePath(); paint(ctx, '#f97316', darken('#f97316', 0.2), 0.02);
      ctx.beginPath(); ctx.roundRect(-0.06, -0.18, 0.12, 0.12, 0.02); paint(ctx, '#fde047', '#ca8a04', 0.02);
    });
  } };

  A.partyHat = { z: 'front', draw(ctx, c, m) {
    at(ctx, 0.05, -0.85, 0.16, () => {
      ctx.beginPath(); ctx.moveTo(-0.36, 0.02); ctx.lineTo(0.02, -0.82); ctx.lineTo(0.36, 0.02); ctx.closePath();
      paint(ctx, grad(ctx, -0.8, 0, lighten(c, 0.1), darken(c, 0.04)), darken(c, 0.3));
      ctx.save(); ctx.clip();
      const dots = ['#fde047', '#ffffff', '#60a5fa', '#34d399'];
      for (let i = 0; i < 8; i++) { circle(ctx, ((i * 37) % 60) / 100 - 0.28, -0.12 - (i % 4) * 0.17, 0.035); ctx.fillStyle = dots[i % 4]; ctx.fill(); }
      ctx.restore();
      pompom(ctx, 0.02, -0.84 + Math.sin(m.t * 6) * 0.01, 0.1, '#fde047');
    });
  } };

  A.hearts = { z: 'front', draw(ctx, c, m) {
    const hs = [[-0.4, -1.22, 0.1, 0], [0.02, -1.5, 0.14, 1.3], [0.45, -1.2, 0.09, 2.6]];
    for (const [x, y, s, ph] of hs) {
      const by = y + Math.sin(m.t * 2 + ph) * 0.06;
      heart(ctx, x, by, s * 1.2); paint(ctx, c, darken(c, 0.15), 0.02);
      heart(ctx, x - s * 0.3, by - s * 0.35, s * 0.3); ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fill();
    }
  } };

  /** How far each piece rises above the body centre (body units) - used to park the speech bubble above it. */
  A.TOP = { hat: 1.45, crown: 1.45, antenna: 1.75, santaHat: 1.75, beanie: 1.45, flowerCrown: 1.1, bunnyEars: 1.9, strawHat: 1.3, leaf: 1.45, witchHat: 2.05, partyHat: 1.7, hearts: 1.7 };

  g.Accessories = A;
  g.Accessories.heartPath = heart;
})(typeof window !== 'undefined' ? window : globalThis);
