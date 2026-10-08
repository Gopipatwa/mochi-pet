(function (g) {
  'use strict';
  const SANS = '"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';
  const MONO = 'Consolas,"Courier New",monospace';

  /**
   * One theme styles three things: the settings window (ui), the speech bubble (bubble)
   * and the pet itself (pet).
   */
  const THEMES = {
    light: {
      name: 'Light', swatch: ['#ffffff', '#6c5ce7', '#f5a33a'],
      ui: { bg: '#f4f5f9', panel: '#ffffff', panel2: '#eceef5', text: '#1c1f2b', muted: '#6b7185', border: '#dfe2ec', accent: '#6c5ce7', accentText: '#ffffff', radius: '14px', bw: '1px', font: SANS, shadow: '0 8px 30px rgba(30,35,60,.12)' },
      bubble: { bg: '#ffffff', text: '#1c1f2b', border: '#e3e5ee', shadow: '0 6px 22px rgba(20,25,50,.22)', radius: '18px', font: SANS, bw: '1px' },
      pet: { outline: 'auto', outlineW: 0.03, flat: false, glow: 0, hardShadow: false, eye: '#1d1b27', blush: '#ff8fa3', shadow: 0.22, light: 0, sat: 0 },
    },
    dark: {
      name: 'Dark', swatch: ['#14161c', '#8b7bff', '#f5a33a'],
      ui: { bg: '#14161c', panel: '#1c1f28', panel2: '#252936', text: '#e8eaf2', muted: '#8f96ab', border: '#2d3242', accent: '#8b7bff', accentText: '#0d0e14', radius: '14px', bw: '1px', font: SANS, shadow: '0 8px 30px rgba(0,0,0,.45)' },
      bubble: { bg: '#232736', text: '#f1f3fa', border: '#3a4054', shadow: '0 6px 24px rgba(0,0,0,.55)', radius: '18px', font: SANS, bw: '1px' },
      pet: { outline: 'auto', outlineW: 0.03, flat: false, glow: 0, hardShadow: false, eye: '#15131c', blush: '#ff8fa3', shadow: 0.45, light: -0.02, sat: 0 },
    },
    pastel: {
      name: 'Pastel', swatch: ['#fdf3f6', '#f48fb1', '#a8d8ea'],
      ui: { bg: '#fdf3f6', panel: '#fffafc', panel2: '#fbe6ee', text: '#5b4551', muted: '#9a8089', border: '#f2d7e0', accent: '#f48fb1', accentText: '#ffffff', radius: '22px', bw: '1px', font: SANS, shadow: '0 8px 28px rgba(244,143,177,.22)' },
      bubble: { bg: '#fffafc', text: '#5b4551', border: '#f6c9d8', shadow: '0 6px 20px rgba(244,143,177,.35)', radius: '24px', font: SANS, bw: '2px' },
      pet: { outline: '#7b5a5f', outlineW: 0.045, flat: false, glow: 0, hardShadow: false, eye: '#4a3236', blush: '#ff9db0', shadow: 0.16, light: 0.1, sat: -0.1 },
    },
    neon: {
      name: 'Neon', swatch: ['#0a0a16', '#00f0ff', '#ff2bd6'],
      ui: { bg: '#0a0a16', panel: '#12122a', panel2: '#1a1a3a', text: '#e9f2ff', muted: '#7f8bb8', border: '#2b2b66', accent: '#00f0ff', accentText: '#001018', radius: '10px', bw: '1px', font: SANS, shadow: '0 0 24px rgba(0,240,255,.18)' },
      bubble: { bg: '#0f0f26', text: '#d9fbff', border: '#00f0ff', shadow: '0 0 18px rgba(0,240,255,.55)', radius: '12px', font: SANS, bw: '1.5px' },
      pet: { outline: 'glow', outlineW: 0.035, flat: false, glow: 16, hardShadow: false, eye: '#0a0a16', blush: '#ff4fd8', shadow: 0.5, light: 0.04, sat: 0.2 },
    },
    retro: {
      name: 'Retro', swatch: ['#f1e4c3', '#d9482b', '#3b2f1d'],
      ui: { bg: '#f1e4c3', panel: '#fbf1d6', panel2: '#e8d5a5', text: '#3b2f1d', muted: '#7d6a44', border: '#3b2f1d', accent: '#d9482b', accentText: '#fbf1d6', radius: '2px', bw: '2px', font: MONO, shadow: '4px 4px 0 #3b2f1d' },
      bubble: { bg: '#fbf1d6', text: '#3b2f1d', border: '#3b2f1d', shadow: '4px 4px 0 rgba(59,47,29,.85)', radius: '2px', font: MONO, bw: '2px' },
      pet: { outline: '#2b2118', outlineW: 0.06, flat: true, glow: 0, hardShadow: true, eye: '#2b2118', blush: '#e0674f', shadow: 0.9, light: 0, sat: -0.12 },
    },
  };

  const Themes = {
    list: Object.entries(THEMES).map(([id, t]) => ({ id, name: t.name, swatch: t.swatch })).concat([{ id: 'auto', name: 'Auto', swatch: ['#f4f5f9', '#fdf3f6', '#14161c'] }]),

    /** auto = light by day, pastel at dusk, dark at night. */
    resolveId(id, date = new Date()) {
      if (id !== 'auto') return THEMES[id] ? id : 'dark';
      const h = date.getHours();
      if (h >= 6 && h < 18) return 'light';
      if (h >= 18 && h < 21) return 'pastel';
      return 'dark';
    },
    get(id, date) { const rid = Themes.resolveId(id, date); return { id: rid, ...THEMES[rid] }; },

    /** Writes the theme as CSS custom properties onto an element. */
    apply(el, theme) {
      const u = theme.ui; const b = theme.bubble;
      const vars = {
        '--bg': u.bg, '--panel': u.panel, '--panel2': u.panel2, '--text': u.text, '--muted': u.muted, '--border': u.border,
        '--accent': u.accent, '--accent-text': u.accentText, '--radius': u.radius, '--bw': u.bw, '--font': u.font, '--shadow': u.shadow,
        '--bubble-bg': b.bg, '--bubble-text': b.text, '--bubble-border': b.border, '--bubble-shadow': b.shadow,
        '--bubble-radius': b.radius, '--bubble-font': b.font, '--bubble-bw': b.bw,
      };
      for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
      el.dataset.theme = theme.id;
    },
  };
  g.Themes = Themes;
})(typeof window !== 'undefined' ? window : globalThis);
