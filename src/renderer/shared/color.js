(function (g) {
  'use strict';
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, gr, b) {
    return `#${[r, gr, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
  }
  function rgbToHsl(r, gr, b) {
    r /= 255; gr /= 255; b /= 255;
    const max = Math.max(r, gr, b); const min = Math.min(r, gr, b);
    const l = (max + min) / 2; let h = 0; let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (gr - b) / d + (gr < b ? 6 : 0);
      else if (max === gr) h = (b - r) / d + 2;
      else h = (r - gr) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }

  const Color = {
    hexToRgb, rgbToHex, rgbToHsl, hslToRgb,
    hsl: (h, s, l) => rgbToHex(...hslToRgb(h, s, l)),
    mix(a, b, t) {
      const A = hexToRgb(a); const B = hexToRgb(b);
      return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
    },
    /** Adjust lightness / saturation by deltas (-1..1). */
    adjust(hex, dl = 0, ds = 0) {
      const [h, s, l] = rgbToHsl(...hexToRgb(hex));
      return rgbToHex(...hslToRgb(h, clamp(s + ds, 0, 1), clamp(l + dl, 0, 1)));
    },
    lighten(hex, d) { return Color.adjust(hex, d); },
    darken(hex, d) { return Color.adjust(hex, -d); },
    rgba(hex, a) { const [r, gr, b] = hexToRgb(hex); return `rgba(${r},${gr},${b},${a})`; },
    /** Mix through a list of [position, hex] keyframes (positions ascending). */
    ramp(stops, x) {
      if (x <= stops[0][0]) return stops[0][1];
      for (let i = 1; i < stops.length; i++) {
        if (x <= stops[i][0]) {
          const [x0, c0] = stops[i - 1]; const [x1, c1] = stops[i];
          return Color.mix(c0, c1, (x - x0) / (x1 - x0));
        }
      }
      return stops[stops.length - 1][1];
    },
  };
  g.Color = Color;
})(typeof window !== 'undefined' ? window : globalThis);
