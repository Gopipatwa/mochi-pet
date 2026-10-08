(function (g) {
  'use strict';

  /** Seasons and holidays: each brings outfit pieces, ambient particles and a body palette colour. */
  const INFO = {
    winter: { name: 'Winter', items: ['beanie'], particle: 'snow', color: '#8ec5ff' },
    spring: { name: 'Spring', items: ['flowerCrown'], particle: 'petal', color: '#f9a8d4' },
    summer: { name: 'Summer', items: ['sunglasses', 'strawHat'], particle: 'sparkle', color: '#fbbf24' },
    autumn: { name: 'Autumn', items: ['leaf'], particle: 'leaf', color: '#ea7a2c' },
    halloween: { name: 'Halloween', items: ['witchHat'], particle: 'bat', color: '#fb923c' },
    christmas: { name: 'Christmas', items: ['santaHat'], particle: 'snow', color: '#ef4444' },
    newyear: { name: 'New Year', items: ['partyHat'], particle: 'confetti', color: '#a855f7' },
    valentine: { name: 'Valentine', items: ['hearts'], particle: 'heart', color: '#fb7185' },
    easter: { name: 'Easter', items: ['bunnyEars'], particle: 'petal', color: '#fbcfe8' },
  };

  const HEAD = new Set(['hat', 'crown', 'antenna', 'santaHat', 'beanie', 'flowerCrown', 'bunnyEars', 'strawHat', 'leaf', 'witchHat', 'partyHat', 'hearts']);
  const FACE = new Set(['glasses', 'sunglasses']);
  const SLOT = (id) => (HEAD.has(id) ? 'head' : FACE.has(id) ? 'face' : id === 'headphones' ? 'ears' : 'neck');

  function easter(year) { // Meeus/Jones/Butcher
    const a = year % 19; const b = Math.floor(year / 100); const c = year % 100;
    const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
    const gg = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - gg + 15) % 30;
    const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }

  const Seasons = {
    INFO,
    SLOT,

    /** Which season/holiday applies right now. `mode` may force one. */
    current(mode = 'auto', hemisphere = 'north', date = new Date()) {
      if (mode === 'off') return null;
      if (mode !== 'auto') return INFO[mode] ? mode : null;
      const m = date.getMonth() + 1; const d = date.getDate();
      const md = m * 100 + d;
      if (md >= 1215 && md <= 1226) return 'christmas';
      if (md >= 1230 || md <= 102) return 'newyear';
      if (md >= 207 && md <= 214) return 'valentine';
      if (md >= 1024 && md <= 1031) return 'halloween';
      const es = easter(date.getFullYear()).getTime();
      if (Math.abs(date.getTime() - es) <= 3.5 * 86400000) return 'easter';
      const idx = { 12: 0, 1: 0, 2: 0, 3: 1, 4: 1, 5: 1, 6: 2, 7: 2, 8: 2, 9: 3, 10: 3, 11: 3 }[m];
      const north = ['winter', 'spring', 'summer', 'autumn'];
      return north[hemisphere === 'south' ? (idx + 2) % 4 : idx];
    },

    /**
     * The final outfit: the user's own accessories first, then seasonal pieces for any slot still free.
     * @returns {Array<{id:string,color:string}>}
     */
    outfit(settings, date = new Date()) {
      const out = [];
      const used = new Set();
      for (const [id, a] of Object.entries(settings.accessories)) {
        if (a.enabled) { out.push({ id, color: a.color }); used.add(SLOT(id)); }
      }
      const season = Seasons.current(settings.seasonal.mode, settings.seasonal.hemisphere, date);
      if (season) {
        for (const id of INFO[season].items) {
          const a = settings.seasonal.items[id];
          if (a && a.enabled && !used.has(SLOT(id))) { out.push({ id, color: a.color }); used.add(SLOT(id)); }
        }
      }
      return out;
    },
  };
  g.Seasons = Seasons;
})(typeof window !== 'undefined' ? window : globalThis);
