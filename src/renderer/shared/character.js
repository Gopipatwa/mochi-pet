(function (g) {
  'use strict';
  const { Color, Accessories, Seasons, Shapes } = g;
  const TAU = Math.PI * 2;
  const FOOT_PAD = 18; // must match src-tauri/src/movement.rs
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);

  /** Damped spring, integrated in small fixed sub-steps so it stays stable at any frame rate. */
  class Spring {
    constructor(x = 0, k = 170, d = 13) { this.x = x; this.v = 0; this.t = x; this.k = k; this.d = d; }
    step(dt) {
      const n = Math.max(1, Math.ceil(dt / 0.006)); const h = dt / n;
      for (let i = 0; i < n; i++) { this.v += ((this.t - this.x) * this.k - this.v * this.d) * h; this.x += this.v * h; }
    }
    kick(v) { this.v += v; }
    snap(x) { this.x = x; this.t = x; this.v = 0; }
  }


  const MOOD = { calm: '#5bc8b0', happy: '#f5a33a', excited: '#f472b6', sleepy: '#7b8cde', dizzy: '#9bd44a', alert: '#ef6a5a' };
  const TIME_STOPS = [[0, '#4a56b8'], [5, '#8a6cf0'], [7.5, '#f7a65a'], [11, '#4fc3a8'], [15, '#3b82f6'], [18, '#f97316'], [20.5, '#a855c7'], [24, '#4a56b8']];

  class Mochi {
    constructor() {
      this.cfg = { size: 130, look: { colorMode: 'fixed', fixedColor: '#f5a33a', customColor: '#7b61ff', rainbowSeconds: 60, cheeks: true, shadow: true, smoothness: 0.5, jelly: 0.8, shape: 'blob', style: 'neutral' }, theme: g.Themes.get('light'), outfit: [], season: null, particles: true };
      this.t = 0;
      this.sq = new Spring(0, 170, 13);
      this.hopY = new Spring(0, 240, 15);
      this.lean = new Spring(0, 200, 16);
      this.lookX = new Spring(0, 110, 15);
      this.lookY = new Spring(0, 110, 15);
      this.eyeScale = new Spring(1, 200, 16);
      this.walkAmt = new Spring(0, 70, 13);
      this.dragAmt = new Spring(0, 140, 16);
      this.sleepAmt = new Spring(0, 36, 9);
      this.happy = new Spring(0, 120, 14);
      this.blush = new Spring(0.5, 80, 12);
      this.mouth = new Spring(0, 220, 18);
      this.armL = new Spring(0.7, 220, 13);
      this.armR = new Spring(0.7, 220, 13);
      // liquid body: standing ripples of the outline (modes 2..5) plus a sideways slosh
      this.modes = [new Spring(0, 380, 6), new Spring(0, 520, 6), new Spring(0, 700, 6), new Spring(0, 900, 6)];
      this.modePh = [0.3, 1.1, 2.0, 0.7];
      this.slosh = new Spring(0, 95, 5);
      this.pupX = new Spring(0, 60, 3.4); this.pupY = new Spring(0, 60, 3.4); // googly eyes: pupils slosh about
      this.peekAmt = new Spring(0, 90, 13); this.peek = false; this.feetLine = 0; // ducking behind a window edge
      this.tongueT = 0;
      this.lastStep = 0; this.jelly = 0.8;

      this.phase = 0; this.bobH = 0; this.bobY = 0;
      this.cursor = { x: 0, y: 0 }; this.vel = { x: 0, y: 0 };
      this.hover = false; this.walking = false; this.dragging = false; this.sleeping = false; this.alert = false;
      this.dizzyT = 0; this.happyT = 0; this.surpriseT = 0; this.armWaveT = 0; this.alertT = 0;
      this.blinkT = 1; this.nextBlink = rand(1.5, 4); this.doubleBlink = false;
      this.cursorMovedAt = 0; this.gaze = { x: 0, y: 0 }; this.nextGaze = 0;
      this.clicks = []; this.pokes = [];
      this.mood = 'calm';
      this.rgb = Color.hexToRgb('#f5a33a');
      this.parts = []; this.nextZ = 0; this.nextAmbient = 0;
      this.hit = { x: 0, y: 0, rx: 60, ry: 60 };
      this.size = { w: 340, h: 340 };
    }

    configure(cfg) {
      const first = !this._configured;
      this.cfg = { ...this.cfg, ...cfg };
      this._configured = true;
      const sm = this.cfg.look.smoothness; // 0 = tight, 1 = very jelly
      this.sq.d = lerp(18, 8.5, sm); this.hopY.d = lerp(20, 11, sm);
      this.armL.d = this.armR.d = lerp(16, 9, sm);
      const J = this.jelly = clamp(this.cfg.look.jelly == null ? 0.8 : this.cfg.look.jelly, 0, 1);
      this.sq.d *= 1 - 0.3 * J;
      this.modes.forEach((m, i) => { m.d = lerp(14, 3.2, J) * Math.sqrt((i + 2) / 2); });
      this.slosh.d = lerp(11, 3.4, J);
      const target = this.targetColor();
      if (first) this.rgb = Color.hexToRgb(target);
    }

    // ---- events -------------------------------------------------------------------------------
    setFrame(f) {
      if (Math.abs(f.cx - this.cursor.x) > 1 || Math.abs(f.cy - this.cursor.y) > 1) this.cursorMovedAt = this.t;
      this.cursor.x = f.cx; this.cursor.y = f.cy;
      this.vel.x = f.vx; this.vel.y = f.vy;
      this.walking = f.walking;
      if (f.dragging !== this.dragging) { this.dragging = f.dragging; if (f.dragging) this.grab(); else this.drop(); }
    }
    setHover(h) { if (h && !this.hover && !this.sleeping) this.blush.kick(2); this.hover = h; }
    grab() { this.sq.kick(3); this.armWaveT = 0; this.surpriseT = 0.5; this.kickModes(1); }
    drop() { this.sq.kick(-2); this.kickModes(1.3); }
    land(impact) { this.sq.kick(-clamp(impact / 420, 1.5, 7)); this.hopY.kick(clamp(-impact / 25, -140, -30)); this.kickModes(clamp(impact / 800, 0.8, 2.4)); }
    /** Excite the outline ripples; how much depends on the jelly setting and how liquid the shape is. */
    kickModes(power = 1) {
      const A = this.jelly * Shapes.get(this.cfg.look.shape).jelly;
      this.modes.forEach((m, i) => m.kick((Math.random() < 0.5 ? -1 : 1) * (1.6 - i * 0.3) * power * A));
    }
    setSleeping(s) {
      if (s === this.sleeping) return;
      this.sleeping = s;
      if (!s) { this.surpriseT = 0.9; this.sq.kick(3.5); this.hopY.kick(-170); this.happyT = 0.9; }
    }
    setAlert(a) { this.alert = a; this.alertT = 0; }
    setPeek(p) { this.peek = !!p; }
    /** Cheeky: tongue out with a wink. */
    tongue(seconds = 1.8) { if (this.sleeping) return; this.tongueT = seconds; this.sq.kick(-1.6); this.hopY.kick(-70); this.kickModes(0.8); }
    /** The buddy laughs along. */
    giggle() { if (this.sleeping) return; this.happyT = 1.3; this.armWaveT = 0.8; this.sq.kick(-2.4); this.hopY.kick(-110); this.kickModes(1); }

    click() {
      const now = this.t;
      if (this.sleeping) return;
      this.clicks = this.clicks.filter((c) => now - c < 1.0); this.clicks.push(now);
      this.pokes = this.pokes.filter((c) => now - c < 6); this.pokes.push(now);
      if (this.clicks.length >= 3) { this.clicks = []; this.dizzy(); return; }
      this.sq.kick(-4.2); this.hopY.kick(-100); this.kickModes(1.4);
      this.happyT = 1.1; this.armWaveT = 0.7;
      this.blush.kick(2);
      if (Math.random() < 0.6) this.emit('heart', this.hit.x + rand(-20, 20), this.hit.y - this.cfg.size * 0.45, { vy: -50, vx: rand(-14, 14), life: 1.4, size: rand(7, 10) });
    }
    dizzy() { this.dizzyT = 2.8; this.sq.kick(-2.2); this.hopY.kick(-80); this.kickModes(2); }

    // ---- simulation -----------------------------------------------------------------------------
    update(dt) {
      dt = Math.min(dt, 0.05);
      this.t += dt;
      const t = this.t; const { size, look } = this.cfg; const R = size / 2;
      const sleepy = this.sleepAmt.x;
      const speed = Math.hypot(this.vel.x, this.vel.y);
      this.dizzyT = Math.max(0, this.dizzyT - dt); this.happyT = Math.max(0, this.happyT - dt);
      this.surpriseT = Math.max(0, this.surpriseT - dt); this.armWaveT = Math.max(0, this.armWaveT - dt);
      this.tongueT = Math.max(0, this.tongueT - dt);

      // mood
      this.pokes = this.pokes.filter((c) => t - c < 6);
      this.mood = this.sleeping ? 'sleepy' : this.dizzyT > 0 ? 'dizzy' : this.alert ? 'alert' : this.pokes.length >= 4 ? 'excited' : (this.happyT > 0 || this.hover) ? 'happy' : 'calm';

      // gaze
      let tx = 0; let ty = 0;
      if (!this.sleeping && this.dizzyT <= 0) {
        if (t - this.cursorMovedAt > 6) {
          if (t > this.nextGaze) { this.gaze = { x: rand(-0.7, 0.7), y: rand(-0.35, 0.4) }; this.nextGaze = t + rand(1.6, 4); }
          tx = this.gaze.x; ty = this.gaze.y;
        } else {
          const dx = this.cursor.x - this.hit.x; const dy = this.cursor.y - this.hit.y;
          const dist = Math.hypot(dx, dy) || 1; const mag = clamp(dist / (R * 2.4), 0, 1);
          tx = (dx / dist) * mag; ty = (dy / dist) * mag;
        }
        if (this.dragging) { tx = clamp(this.vel.x / 500, -1, 1); ty = -0.5; }
      }
      this.lookX.t = tx; this.lookY.t = ty;

      // walking cadence: one hop per stride
      this.walkAmt.t = this.walking && !this.dragging ? 1 : 0;
      this.walkAmt.step(dt);
      if (this.walkAmt.x > 0.02) this.phase += (speed / (R * 0.9)) * dt;
      const ph = this.phase % 1;
      this.bobH = Math.abs(Math.sin(Math.PI * ph));
      this.bobY = -this.bobH * R * 0.17 * this.walkAmt.x * clamp(0.45 + speed / 140, 0.45, 1);
      if (Shapes.get(look.shape).float) this.bobY += -R * 0.1 + Math.sin(t * 2.1) * R * 0.045;

      this.dragAmt.t = this.dragging ? 1 : 0; this.dragAmt.step(dt);

      // liquid body: slosh lags behind movement, ripples settle (and re-start on every hop landing)
      const A = this.jelly * Shapes.get(look.shape).jelly;
      this.slosh.t = clamp(this.vel.x / lerp(900, 480, this.dragAmt.x), -1, 1) * 0.2 * A;
      this.slosh.step(dt);
      const step = Math.floor(this.phase);
      if (step !== this.lastStep) { this.lastStep = step; if (this.walkAmt.x > 0.4) this.kickModes(0.6); }
      this.modes[1].t = Math.sin(t * 1.7) * 0.012 * A; this.modes[2].t = Math.sin(t * 2.3 + 1) * 0.008 * A;
      for (const m of this.modes) m.step(dt);
      this.sleepAmt.t = this.sleeping ? 1 : 0; this.sleepAmt.step(dt);

      // squash & stretch target
      let sqT = Math.sin(t * lerp(TAU / 3.4, TAU / 5.8, sleepy)) * lerp(0.016, 0.03, sleepy) - 0.09 * sleepy;
      if (this.hover && !this.sleeping) sqT += 0.035;
      sqT += this.walkAmt.x * (0.07 * this.bobH - 0.085 * (1 - this.bobH) ** 3);
      sqT += 0.13 * this.dragAmt.x;
      if (this.dizzyT > 0) sqT += Math.sin(t * 9) * 0.03;
      this.sq.t = sqT; this.sq.step(dt);

      // lean / pendulum
      const d = this.dragAmt.x;
      this.lean.k = lerp(210, 80, d); this.lean.d = lerp(17, 4.2, d);
      let leanT = clamp(this.vel.x / 280, -1, 1) * 0.15 * this.walkAmt.x + clamp(this.vel.x * 0.0011, -0.7, 0.7) * d;
      if (this.dizzyT > 0) leanT += Math.sin(t * 5.5) * 0.22 * Math.min(1, this.dizzyT);
      if (this.sleeping) leanT += Math.sin(t * 0.8) * 0.02;
      this.lean.t = leanT; this.lean.step(dt);

      // alert: periodic hop + wave
      if (this.alert && !this.sleeping) {
        this.alertT += dt;
        if (this.alertT > 2.3) { this.alertT = 0; this.hopY.kick(-250); this.sq.kick(-3); this.armWaveT = 0.9; }
      }

      // arms
      const sw = Math.sin(this.phase * TAU) * 0.55 * this.walkAmt.x;
      let aL = 0.75 + sw; let aR = 0.75 - sw;
      if (this.armWaveT > 0) { aR = -0.95 + Math.sin(t * 14) * 0.4; }
      if (this.happyT > 0.4) { aL = -0.8 + Math.sin(t * 11) * 0.3; }
      aL = lerp(aL, -1.15, d); aR = lerp(aR, -1.15, d);
      if (this.sleeping) { aL = aR = 1.0; }
      this.armL.t = aL; this.armR.t = aR; this.armL.step(dt); this.armR.step(dt);

      // face springs
      this.peekAmt.t = this.peek && !this.sleeping && !this.dragging ? 1 : 0; this.peekAmt.step(dt);
      this.pupX.t = this.lookX.x * 0.07 - this.slosh.x * 0.3; this.pupY.t = 0.045 + this.lookY.x * 0.05 + clamp(this.hopY.v * 0.0004, -0.07, 0.07);
      this.pupX.step(dt); this.pupY.step(dt);
      this.eyeScale.t = this.surpriseT > 0 ? 1.3 : (this.hover && !this.sleeping) || this.peekAmt.x > 0.5 ? 1.14 : 1;
      this.eyeScale.step(dt);
      this.happy.t = this.happyT > 0 ? 1 : 0; this.happy.step(dt);
      this.blush.t = 0.5 + (this.hover ? 0.4 : 0) + this.happy.x * 0.5 + sleepy * 0.2; this.blush.step(dt);
      this.mouth.t = this.surpriseT > 0 ? 1 : this.happy.x > 0.5 ? 0.8 : this.hover ? 0.35 : 0; this.mouth.step(dt);
      this.lookX.step(dt); this.lookY.step(dt); this.hopY.step(dt);

      // blinking
      if (!this.sleeping) {
        this.nextBlink -= dt;
        if (this.nextBlink <= 0 && this.blinkT >= 1) {
          this.blinkT = 0;
          if (this.doubleBlink) { this.doubleBlink = false; this.nextBlink = rand(2.4, 5.5); } else if (Math.random() < 0.18) { this.doubleBlink = true; this.nextBlink = 0.22; } else this.nextBlink = rand(2.4, 5.5);
        }
        if (this.blinkT < 1) this.blinkT = Math.min(1, this.blinkT + dt / (look.eyes === 'sleepy' ? 0.34 : 0.17));
      }

      // colour
      const k = 1 - Math.exp(-dt * (look.colorMode === 'rainbow' ? 20 : 3.2));
      const target = Color.hexToRgb(this.targetColor());
      for (let i = 0; i < 3; i++) this.rgb[i] += (target[i] - this.rgb[i]) * k;

      this.updateParticles(dt);
    }

    targetColor() {
      const L = this.cfg.look; const pet = this.cfg.theme.pet; let hex;
      switch (L.colorMode) {
        case 'picker': hex = L.customColor; break;
        case 'rainbow': hex = Color.hsl(((g.performance.now() / 1000 / L.rainbowSeconds) * 360) % 360, 0.72, 0.62); break;
        case 'mood': hex = MOOD[this.mood]; break;
        case 'time': { const d = new Date(); hex = Color.ramp(TIME_STOPS, d.getHours() + d.getMinutes() / 60); break; }
        case 'season': hex = this.cfg.season ? Seasons.INFO[this.cfg.season].color : L.fixedColor; break;
        default: hex = L.fixedColor;
      }
      return pet.light || pet.sat ? Color.adjust(hex, pet.light, pet.sat) : hex;
    }

    // ---- particles --------------------------------------------------------------------------------
    emit(type, x, y, o = {}) {
      if (this.parts.length > 60) return;
      this.parts.push({ type, x, y, vx: o.vx || 0, vy: o.vy || 0, life: 0, max: o.life || 2, size: o.size || 6, rot: rand(0, TAU), vr: rand(-2, 2), color: o.color || '#fff', sway: rand(0, TAU), grav: o.grav || 0 });
    }
    updateParticles(dt) {
      const { w, h } = this.size; const R = this.cfg.size / 2; const sc = R / 65;
      if (this.sleeping && this.t > this.nextZ) {
        this.nextZ = this.t + 1.5;
        this.emit('z', this.hit.x + R * 0.55, this.hit.y - R * 0.7, { vx: 14, vy: -22, life: 2.6, size: 13 * Math.max(0.8, sc) });
      }
      if (this.cfg.particles && this.cfg.season && this.t > this.nextAmbient) {
        const kind = Seasons.INFO[this.cfg.season].particle;
        this.nextAmbient = this.t + (kind === 'sparkle' ? 0.55 : kind === 'bat' ? 3.5 : 0.8);
        const colors = { leaf: ['#ea580c', '#f59e0b', '#b45309', '#dc2626'], confetti: ['#f472b6', '#60a5fa', '#fde047', '#34d399', '#a78bfa'], petal: ['#f9a8d4', '#fbcfe8', '#fff'], heart: ['#fb7185', '#f43f5e', '#fda4af'] }[kind];
        const col = colors ? colors[Math.floor(Math.random() * colors.length)] : '#fff';
        if (kind === 'sparkle') this.emit('sparkle', this.hit.x + rand(-R * 1.3, R * 1.3), this.hit.y + rand(-R * 1.5, R * 0.5), { life: 1.4, size: rand(4, 7) * sc, color: '#fde68a' });
        else if (kind === 'bat') this.emit('bat', -20, rand(h * 0.08, h * 0.35), { vx: rand(70, 110), vy: rand(-8, 8), life: w / 80, size: 9 * Math.max(1, sc) });
        else if (kind === 'heart') this.emit('heart', this.hit.x + rand(-R * 1.4, R * 1.4), this.hit.y + R * 0.6, { vy: -rand(18, 32) * sc, vx: rand(-6, 6), life: 3, size: rand(5, 8) * sc, color: col });
        else this.emit(kind, rand(0, w), -8, { vy: rand(22, 48) * Math.max(0.8, sc), life: (h + 20) / 30, size: rand(3, kind === 'snow' ? 5 : 7) * Math.max(0.8, sc), color: col });
      }
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const p = this.parts[i];
        p.life += dt; p.sway += dt * 2; p.rot += p.vr * dt;
        p.x += (p.vx + (['snow', 'petal', 'leaf', 'confetti'].includes(p.type) ? Math.sin(p.sway) * 14 : 0)) * dt; p.y += p.vy * dt; p.vy += p.grav * dt;
        if (p.life > p.max || p.y > h + 20 || p.x > w + 30) this.parts.splice(i, 1);
      }
    }
    drawParticle(ctx, p) {
      const f = p.life / p.max; const a = clamp(Math.min(f * 6, (1 - f) * 3), 0, 1);
      ctx.save(); ctx.globalAlpha = a * (p.type === 'snow' ? 0.85 : 1); ctx.translate(p.x, p.y); ctx.rotate(p.type === 'z' || p.type === 'heart' ? Math.sin(p.sway) * 0.2 : p.rot);
      const s = p.size;
      switch (p.type) {
        case 'z': ctx.font = `700 ${s * (0.8 + f * 0.7)}px "Segoe UI",sans-serif`; ctx.fillStyle = this.cfg.theme.pet.eye === '#15131c' ? '#cdd3ff' : '#6d6fb3'; ctx.textAlign = 'center'; ctx.fillText('z', 0, 0); break;
        case 'heart': ctx.scale(s, s); Accessories.heartPath(ctx, 0, 0, 1); ctx.fillStyle = p.color === '#fff' ? '#fb7185' : p.color; ctx.fill(); break;
        case 'snow': ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.fillStyle = '#ffffff'; ctx.shadowColor = 'rgba(120,170,255,.8)'; ctx.shadowBlur = 5; ctx.fill(); break;
        case 'petal': ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.55, 0, 0, TAU); ctx.fillStyle = p.color; ctx.fill(); break;
        case 'leaf': ctx.beginPath(); ctx.moveTo(0, -s); ctx.quadraticCurveTo(s, -s * 0.2, 0, s); ctx.quadraticCurveTo(-s, -s * 0.2, 0, -s); ctx.fillStyle = p.color; ctx.fill(); break;
        case 'confetti': ctx.scale(1, Math.sin(p.sway * 2)); ctx.fillStyle = p.color; ctx.fillRect(-s, -s * 0.5, s * 2, s); break;
        case 'sparkle': { const tw = Math.sin(f * Math.PI); ctx.scale(tw, tw); ctx.beginPath(); for (let i = 0; i < 8; i++) { const r = i % 2 ? s * 0.28 : s; ctx.lineTo(Math.cos((i / 8) * TAU) * r, Math.sin((i / 8) * TAU) * r); } ctx.closePath(); ctx.fillStyle = p.color; ctx.fill(); break; }
        case 'bat': { const fl = Math.sin(p.life * 14) * 0.6; ctx.rotate(0); ctx.fillStyle = '#3b1d5e'; for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(sgn * s * 0.9, -s * (0.9 + fl), sgn * s * 1.8, -s * 0.2 * (1 + fl)); ctx.quadraticCurveTo(sgn * s * 1.2, s * 0.1, sgn * s * 0.9, s * 0.45); ctx.quadraticCurveTo(sgn * s * 0.5, s * 0.1, 0, s * 0.35); ctx.fill(); } ctx.beginPath(); ctx.arc(0, 0, s * 0.38, 0, TAU); ctx.fill(); break; }
        default:
      }
      ctx.restore();
    }

    // ---- drawing ----------------------------------------------------------------------------------
    draw(ctx, W, H) {
      this.size = { w: W, h: H };
      const R = this.cfg.size / 2; const pet = this.cfg.theme.pet;
      const cx = W / 2; const feet = H - FOOT_PAD;
      const sy = clamp(1 + this.sq.x, 0.66, 1.5); const sx = clamp(1 - this.sq.x * 0.72, 0.76, 1.32);
      const hop = this.hopY.x + this.bobY;
      const color = Color.rgbToHex(...this.rgb);
      const outline = pet.outline === 'auto' ? Color.adjust(color, -0.3, 0.05) : pet.outline === 'glow' ? Color.lighten(color, 0.2) : pet.outline;
      const mouthOpen = clamp(this.mouth.x, 0, 1);
      const shape = Shapes.get(this.cfg.look.shape); const style = this.cfg.look.style;
      const body = this.bodyPath(shape);
      const peeking = this.peekAmt.x > 0.01; const peekDrop = this.peekAmt.x * R * 0.78;
      this.feetLine = feet;
      const hasHead = this.cfg.outfit.some((o) => Seasons.SLOT(o.id) === 'head');

      ctx.clearRect(0, 0, W, H);

      // ambient particles sit behind the pet
      for (const p of this.parts) if (p.type !== 'z' && p.type !== 'heart') this.drawParticle(ctx, p);

      // alert ring
      if (this.alert && !this.sleeping && !peeking) {
        const f = (this.t % 1.5) / 1.5;
        ctx.beginPath(); ctx.ellipse(cx, feet - R * 0.9, R * (1.1 + f * 0.7), R * (1.0 + f * 0.6), 0, 0, TAU);
        ctx.strokeStyle = Color.rgba(color, 0.5 * (1 - f)); ctx.lineWidth = 3; ctx.stroke();
      }

      // ground shadow
      if (this.cfg.look.shadow && !peeking) {
        const lift = clamp(-hop / (R * 0.8), 0, 1) * (1 - this.dragAmt.x * 0.5);
        const a = pet.shadow * (1 - lift * 0.6) * (1 - this.dragAmt.x);
        const rx = R * 0.85 * sx * (1 - lift * 0.25);
        if (a > 0.01) {
          ctx.save(); ctx.translate(cx, feet + 4); ctx.scale(1, 0.17);
          if (pet.hardShadow) { ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fillStyle = `rgba(43,33,24,${0.28 * (1 - lift)})`; ctx.fill(); } else {
            const sh = pet.glow ? color : '#000'; const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
            gr.addColorStop(0, Color.rgba(sh, a)); gr.addColorStop(1, Color.rgba(sh, 0));
            ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill();
          }
          ctx.restore();
        }
      }

      // peeking over an edge: everything below the feet line is hidden behind the window
      if (peeking) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, feet + 1); ctx.clip(); }

      // --- body frame: origin at the contact point, then unit = R, centred on the body ---
      ctx.save();
      ctx.translate(cx, feet + hop + peekDrop);
      const pivot = lerp(0.35, 1.8, this.dragAmt.x) * R;
      ctx.translate(0, -pivot); ctx.rotate(this.lean.x); ctx.translate(0, pivot);
      ctx.scale(sx, sy); ctx.scale(R, R); ctx.translate(0, -1.04);
      if (Math.abs(this.slosh.x) > 0.001) { ctx.translate(0, 1); ctx.transform(1, 0, this.slosh.x, 1, 0, 0); ctx.translate(0, -1); } // top lags, feet stay put
      const lw = pet.outlineW;
      const m = { t: this.t, lookX: this.lookX.x, lookY: this.lookY.x, eyeY: 0.04 };

      // shape extras behind the body (cat/bear/bunny ears), then back accessories
      if (shape.back) { ctx.save(); shape.back(ctx, color, outline, lw, this.t); ctx.restore(); }
      this.drawOutfit(ctx, shape, m, 'back');

      // feet
      const walkLift = this.walkAmt.x * 0.1; const dangle = this.dragAmt.x;
      for (const s of shape.feetX == null ? [] : [-1, 1]) {
        const lift = walkLift * Math.max(0, Math.sin(this.phase * TAU) * -s) - dangle * (0.08 + Math.sin(this.t * 7 + s) * 0.05);
        ctx.beginPath(); ctx.ellipse(s * shape.feetX, 0.93 - lift, 0.2, 0.125, 0, 0, TAU);
        ctx.fillStyle = Color.darken(color, 0.05); ctx.fill(); ctx.strokeStyle = outline; ctx.lineWidth = lw; ctx.stroke();
      }

      // body: outline first, fill on top, so overlapping sub-shapes never show inner lines
      ctx.lineJoin = 'round'; ctx.strokeStyle = outline; ctx.lineWidth = lw * 1.7; ctx.stroke(body);
      ctx.save();
      if (pet.glow) { ctx.shadowColor = color; ctx.shadowBlur = pet.glow; }
      if (pet.flat) ctx.fillStyle = color;
      else { const gr = ctx.createLinearGradient(0, -0.92, 0, 0.92); gr.addColorStop(0, Color.lighten(color, 0.1)); gr.addColorStop(0.55, color); gr.addColorStop(1, Color.darken(color, 0.1)); ctx.fillStyle = gr; }
      ctx.globalAlpha = shape.alpha; ctx.fill(body);
      ctx.restore();
      ctx.save(); ctx.clip(body);
      if (shape.inside) shape.inside(ctx, color, this.t);
      if (!pet.flat) {
        ctx.beginPath(); ctx.ellipse(shape.shine[0], shape.shine[1], 0.32, 0.14, -0.5, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fill();
        ctx.beginPath(); ctx.ellipse(0, 1.05, 1.15, 0.45, 0, 0, TAU); ctx.fillStyle = 'rgba(0,0,0,.07)'; ctx.fill();
      } else { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(-0.62, -0.62, 0.22, 0.1); ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(-1, 0.62, 2, 0.4); }
      ctx.restore();

      if (shape.front) { ctx.save(); shape.front(ctx, color, outline, lw, this.t); ctx.restore(); }

      // face (eyes, mouth, cheeks) fitted to the shape
      ctx.save(); ctx.translate(0, shape.face.dy); ctx.scale(shape.face.s, shape.face.s);
      if (this.cfg.look.cheeks) {
        const bl = clamp(this.blush.x, 0, 1.4) * (style === 'female' ? 1.3 : 1);
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * 0.63, 0.26, style === 'female' ? 0.16 : 0.14, 0.09, 0, 0, TAU); ctx.fillStyle = Color.rgba(pet.blush, 0.33 * bl); ctx.fill(); }
      }
      this.drawFace(ctx, pet, mouthOpen, style, color);
      ctx.restore();

      // hair tuft / bow, only when no hat or crown is being worn
      if (!hasHead && !shape.noHair && style !== 'neutral') { const sl = shape.slots.head; ctx.save(); ctx.translate(0, sl.dy); ctx.scale(sl.s, sl.s); this.drawStyleHead(ctx, style, color, outline); ctx.restore(); }

      // arms (in front, like hugging the body)
      for (const [s, sp] of shape.arm && this.peekAmt.x < 0.3 ? [[-1, this.armL], [1, this.armR]] : []) {
        ctx.save(); ctx.translate(s * shape.arm[0], shape.arm[1]); ctx.rotate(s * sp.x);
        ctx.beginPath(); ctx.ellipse(s * 0.1, 0, 0.19, 0.105, 0, 0, TAU);
        ctx.fillStyle = Color.darken(color, 0.03); ctx.fill(); ctx.strokeStyle = outline; ctx.lineWidth = lw; ctx.stroke(); ctx.restore();
      }

      // front accessories
      this.drawOutfit(ctx, shape, m, 'front');

      // dizzy stars / surprise mark
      if (this.dizzyT > 0) {
        for (let i = 0; i < 3; i++) {
          const a = this.t * 4.2 + (i * TAU) / 3;
          ctx.save(); ctx.translate(Math.cos(a) * 0.72, -1.1 + Math.sin(a) * 0.18); ctx.rotate(a);
          ctx.beginPath(); for (let k = 0; k < 10; k++) { const r = k % 2 ? 0.05 : 0.12; ctx.lineTo(Math.cos((k / 10) * TAU) * r, Math.sin((k / 10) * TAU) * r); }
          ctx.closePath(); ctx.fillStyle = '#fde047'; ctx.fill(); ctx.strokeStyle = '#ca8a04'; ctx.lineWidth = 0.02; ctx.stroke(); ctx.restore();
        }
      }
      if (this.surpriseT > 0.15 && !this.dragging) {
        ctx.beginPath(); ctx.roundRect(-0.05, -1.5, 0.1, 0.26, 0.05); ctx.fillStyle = '#ef4444'; ctx.fill();
        ctx.beginPath(); ctx.arc(0, -1.1, 0.06, 0, TAU); ctx.fill();
      }
      ctx.restore();
      if (peeking) { ctx.restore(); this.drawHands(ctx, cx, feet, R, color, outline, lw); }

      for (const p of this.parts) if (p.type === 'z' || p.type === 'heart') this.drawParticle(ctx, p);

      const bodyCy = feet + hop + peekDrop - R * 1.0 * sy;
      this.hit = { x: cx, y: bodyCy, rx: R * sx + 8, ry: R * 0.95 * sy + 8, p: shape.hit };
    }

    /** Two little hands holding the window edge while he peeks over it. */
    drawHands(ctx, cx, feet, R, color, outline, lw) {
      const a = this.peekAmt.x; const wig = Math.sin(this.t * 3) * 0.02 * R;
      for (const s of [-1, 1]) {
        ctx.save(); ctx.translate(cx + s * R * 0.62, feet - R * 0.02 * a + wig * s); ctx.rotate(s * 0.25);
        ctx.beginPath(); ctx.ellipse(0, 0, R * 0.2, R * 0.115, 0, 0, TAU);
        ctx.fillStyle = Color.darken(color, 0.03); ctx.fill(); ctx.strokeStyle = outline; ctx.lineWidth = lw * R; ctx.stroke(); ctx.restore();
      }
    }

    /** The body outline for this frame: the shape's points pushed in/out by the ripple modes. */
    bodyPath(shape) {
      const p = new Path2D(); const modes = this.modes; const ph = this.modePh;
      for (const c of shape.contours) {
        for (let i = 0; i < c.length; i++) {
          const th = Math.atan2(c[i][1] / 0.92, c[i][0]); let k = 1;
          for (let m = 0; m < 4; m++) k += modes[m].x * Math.cos((m + 2) * th + ph[m]);
          if (i) p.lineTo(c[i][0] * k, c[i][1] * k); else p.moveTo(c[i][0] * k, c[i][1] * k);
        }
        p.closePath();
      }
      return p;
    }

    /** Accessories are fitted to the body shape per slot (head/face/ears/neck). */
    drawOutfit(ctx, shape, m, z) {
      for (const o of this.cfg.outfit) {
        const a = Accessories[o.id]; if (!a || a.z !== z) continue;
        const sl = shape.slots[Seasons.SLOT(o.id)] || { dy: 0, s: 1 };
        ctx.save(); ctx.translate(0, sl.dy); ctx.scale(sl.s, sl.s); a.draw(ctx, o.color, m); ctx.restore();
      }
    }

    /** Male: spiky hair tuft. Female: hair bow. Drawn in head-slot space (top of head = y -0.92). */
    drawStyleHead(ctx, style, color, outline) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (style === 'male') {
        const hair = Color.darken(color, 0.28);
        for (const [x, a, h] of [[-0.2, -0.5, 0.3], [0.02, 0, 0.38], [0.24, 0.5, 0.3]]) {
          ctx.save(); ctx.translate(x, -0.86); ctx.rotate(a);
          ctx.beginPath(); ctx.moveTo(-0.07, 0.02); ctx.quadraticCurveTo(-0.05, -h * 0.7, 0.03, -h); ctx.quadraticCurveTo(0.09, -h * 0.55, 0.07, 0.02); ctx.closePath();
          ctx.fillStyle = hair; ctx.fill(); ctx.strokeStyle = outline; ctx.lineWidth = 0.025; ctx.stroke(); ctx.restore();
        }
      } else {
        const hue = Color.rgbToHsl(...Color.hexToRgb(color))[0];
        const bow = hue > 320 || hue < 25 ? '#8b5cf6' : '#ec4899';
        ctx.save(); ctx.translate(0.52, -0.8); ctx.rotate(0.45);
        for (const s of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(s * 0.2, -0.3, s * 0.36, -0.1); ctx.quadraticCurveTo(s * 0.4, 0.12, 0, 0); ctx.closePath();
          ctx.fillStyle = bow; ctx.fill(); ctx.strokeStyle = Color.darken(bow, 0.2); ctx.lineWidth = 0.025; ctx.stroke();
          ctx.beginPath(); ctx.arc(s * 0.24, -0.04, 0.025, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fill();
        }
        ctx.beginPath(); ctx.arc(0, 0, 0.07, 0, TAU); ctx.fillStyle = Color.lighten(bow, 0.08); ctx.fill(); ctx.strokeStyle = Color.darken(bow, 0.2); ctx.lineWidth = 0.025; ctx.stroke();
        ctx.restore();
      }
    }

    /** Eyes when he is happy: arcs, stars or hearts. */
    drawHappyEye(ctx, kind, eye) {
      const t = this.t;
      if (kind === 'stars') {
        const pulse = 1 + 0.14 * Math.sin(t * 8); ctx.rotate(Math.sin(t * 2) * 0.12); ctx.scale(pulse, pulse);
        ctx.beginPath(); for (let k = 0; k < 10; k++) { const r = k % 2 ? 0.065 : 0.15; const an = -Math.PI / 2 + (k * Math.PI) / 5; ctx.lineTo(Math.cos(an) * r, Math.sin(an) * r + 0.01); }
        ctx.closePath(); ctx.fillStyle = '#fde047'; ctx.fill(); ctx.strokeStyle = '#d97706'; ctx.lineWidth = 0.025; ctx.lineJoin = 'round'; ctx.stroke();
        ctx.beginPath(); ctx.arc(-0.03, -0.04, 0.02, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill();
      } else if (kind === 'hearts') {
        const beat = 1 + 0.16 * Math.max(0, Math.sin(t * 7)) ** 2;
        ctx.scale(beat, beat); Accessories.heartPath(ctx, 0, 0.0, 0.1);
        ctx.fillStyle = '#fb4f7a'; ctx.fill(); ctx.strokeStyle = '#be123c'; ctx.lineWidth = 0.022; ctx.lineJoin = 'round'; ctx.stroke();
        ctx.beginPath(); ctx.arc(-0.045, -0.05, 0.02, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(0, 0.06, 0.11, Math.PI * 1.1, Math.PI * 1.9); ctx.strokeStyle = eye; ctx.lineWidth = 0.05; ctx.stroke();
      }
    }

    /** One open eye in the chosen base style (classic, sparkly, sleepy, googly). */
    drawEye(ctx, kind, s, factor, open, es, pet, color, style) {
      const eye = pet.eye; const t = this.t; const lx = this.lookX.x;
      let rx = 0.1 * factor * es; let ry = 0.158 * es * Math.max(0.07, open);
      if (kind === 'sparkly') { rx *= 1.13; ry *= 1.13; }
      if (kind === 'sleepy') ry *= 0.85;
      ctx.rotate(s * 0.1);

      if (kind === 'googly') {
        const sr = 0.135 * es; const so = Math.max(0.07, open);
        ctx.beginPath(); ctx.ellipse(0, 0, sr, sr * 1.1 * so, 0, 0, TAU); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = eye; ctx.lineWidth = 0.03; ctx.stroke();
        const pr = 0.062 * es; const lim = sr - pr - 0.01;
        const px = clamp(this.pupX.x * (s === 1 ? 1 : 0.85), -lim, lim); const py = clamp(this.pupY.x, -lim, lim) * so;
        ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fillStyle = eye; ctx.fill();
        ctx.beginPath(); ctx.arc(px - pr * 0.3, py - pr * 0.3, pr * 0.28, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill();
      } else {
        ctx.beginPath();
        if (pet.flat) ctx.roundRect(-rx, -ry, rx * 2, ry * 2, 0.03); else ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
        if (kind === 'sparkly') { const gr = ctx.createLinearGradient(0, -ry, 0, ry); gr.addColorStop(0, eye); gr.addColorStop(0.55, eye); gr.addColorStop(1, Color.mix(eye, color, 0.55)); ctx.fillStyle = gr; } else ctx.fillStyle = eye;
        ctx.fill();
      }

      if (style === 'female') {
        ctx.rotate(-s * 0.1); ctx.strokeStyle = eye; ctx.lineWidth = 0.032; ctx.lineCap = 'round';
        for (const [dx, dy, ex, ey2] of [[0.07, -0.06, 0.19, -0.12], [0.09, -0.01, 0.22, -0.02], [0.08, 0.05, 0.2, 0.09]]) { ctx.beginPath(); ctx.moveTo(s * dx, dy * open - 0.02); ctx.lineTo(s * ex, ey2 * Math.max(0.4, open) - 0.02); ctx.stroke(); }
        ctx.rotate(s * 0.1);
      }

      if (kind === 'classic' && open > 0.35) {
        ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.beginPath(); ctx.arc(-rx * 0.28 + lx * 0.02, -ry * 0.38, 0.04 * es, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.arc(rx * 0.35, ry * 0.4, 0.017 * es, 0, TAU); ctx.fill();
      } else if (kind === 'sparkly' && open > 0.3) {
        ctx.fillStyle = 'rgba(255,255,255,.97)'; ctx.beginPath(); ctx.arc(-rx * 0.3 + lx * 0.02, -ry * 0.35, 0.055 * es, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(rx * 0.4, ry * 0.45, 0.026 * es, 0, TAU); ctx.fill();
        const tw = 0.55 + 0.45 * Math.sin(t * 4 + s * 1.7); const g = 0.075 * tw * es; // twinkling glint
        ctx.save(); ctx.translate(rx * 0.5, -ry * 0.1); ctx.beginPath();
        for (let k = 0; k < 8; k++) { const r = k % 2 ? g * 0.3 : g; const an = (k * Math.PI) / 4; ctx.lineTo(Math.cos(an) * r, Math.sin(an) * r); }
        ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fill(); ctx.restore();
      } else if (kind === 'sleepy') {
        // heavy eyelid: body-coloured cap over the top of the eye
        ctx.save(); ctx.beginPath(); ctx.ellipse(0, 0, rx + 0.004, ry + 0.004, 0, 0, TAU); ctx.clip();
        ctx.fillStyle = color; ctx.fillRect(-rx - 0.02, -ry - 0.02, rx * 2 + 0.04, ry * 1.0 + 0.02);
        ctx.restore();
        ctx.beginPath(); ctx.moveTo(-rx, -ry * 0.02); ctx.lineTo(rx, -ry * 0.02); ctx.strokeStyle = eye; ctx.lineWidth = 0.03; ctx.lineCap = 'round'; ctx.stroke();
        if (open > 0.35) { ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(-rx * 0.25, ry * 0.35, 0.028 * es, 0, TAU); ctx.fill(); }
      }
    }

    drawFace(ctx, pet, mouthOpen, style = 'neutral', color = '#f5a33a') {
      const eye = pet.eye; const sleepy = this.sleepAmt.x;
      const open = (1 - Math.sin(Math.PI * Math.min(this.blinkT, 1)) * (this.blinkT < 1 ? 1 : 0)) * (1 - sleepy);
      const lx = this.lookX.x; const ly = this.lookY.x; const es = this.eyeScale.x;
      const closed = sleepy > 0.55; const happyEyes = this.happy.x > 0.55 && this.dizzyT <= 0 && !closed;
      const kind = this.cfg.look.eyes || 'classic'; const happyKind = this.cfg.look.happyEyes || 'arcs';
      const wink = this.tongueT > 0;
      const ey = 0.04;

      for (const s of [-1, 1]) {
        const factor = 1 - 0.22 * lx * -s;
        const x = s * 0.36 + lx * 0.17; const y = ey + ly * 0.1;
        ctx.save(); ctx.translate(x, y); ctx.lineCap = 'round';
        if (this.dizzyT > 0) {
          ctx.rotate(this.t * 7 * s); ctx.beginPath();
          for (let a = 0; a < 5.5 * Math.PI; a += 0.25) { const r = (a / (5.5 * Math.PI)) * 0.14; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
          ctx.strokeStyle = eye; ctx.lineWidth = 0.034; ctx.stroke();
        } else if (closed) {
          ctx.beginPath(); ctx.arc(0, -0.04, 0.1, Math.PI * 0.12, Math.PI * 0.88); ctx.strokeStyle = eye; ctx.lineWidth = 0.045; ctx.stroke();
        } else if (wink && s === 1) {
          ctx.beginPath(); ctx.arc(0, 0.06, 0.1, Math.PI * 1.1, Math.PI * 1.9); ctx.strokeStyle = eye; ctx.lineWidth = 0.05; ctx.stroke();
        } else if (happyEyes) {
          this.drawHappyEye(ctx, happyKind, eye);
        } else {
          this.drawEye(ctx, kind, s, factor, open, es, pet, color, style);
        }
        ctx.restore();
      }

      // eyebrows (male): lift when surprised or happy, tilt when dizzy, relax when asleep
      if (style === 'male') {
        const lift = (this.surpriseT > 0 ? 0.07 : 0) + this.happy.x * 0.03 + (this.hover ? 0.02 : 0) - sleepy * 0.05;
        ctx.strokeStyle = eye; ctx.lineWidth = 0.065; ctx.lineCap = 'round';
        for (const s of [-1, 1]) {
          const x = s * 0.36 + lx * 0.17; const y = ey + ly * 0.1 - 0.27 - lift; const tilt = this.dizzyT > 0 ? s * 0.5 : s * 0.16;
          ctx.save(); ctx.translate(x, y); ctx.rotate(tilt);
          ctx.beginPath(); ctx.moveTo(-0.11, 0); ctx.lineTo(0.11, 0); ctx.stroke(); ctx.restore();
        }
      }

      // mouth
      const mx = lx * 0.1; const my = 0.3 + ly * 0.04;
      ctx.save(); ctx.translate(mx, my); ctx.strokeStyle = eye; ctx.fillStyle = eye; ctx.lineWidth = 0.034; ctx.lineCap = 'round';
      if (closed) {
        const br = 0.04 + (Math.sin(this.t * 1.3) + 1) * 0.035;
        ctx.beginPath(); ctx.moveTo(-0.04, 0); ctx.lineTo(0.04, 0); ctx.stroke();
        ctx.beginPath(); ctx.arc(0.1, 0.0, br, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 0.014; ctx.stroke();
      } else if (this.dizzyT > 0) {
        ctx.beginPath(); ctx.moveTo(-0.1, 0); for (let i = 0; i <= 8; i++) ctx.lineTo(-0.1 + i * 0.025, Math.sin(i * 1.6 + this.t * 10) * 0.025); ctx.stroke();
      } else if (this.tongueT > 0) {
        ctx.beginPath(); ctx.moveTo(-0.1, -0.01); ctx.quadraticCurveTo(0, 0.1, 0.1, -0.01); ctx.closePath(); ctx.fill();
        const out = Math.min(1, this.tongueT * 5) * (0.9 + 0.1 * Math.sin(this.t * 16));
        ctx.beginPath(); ctx.roundRect(-0.04, 0.02, 0.08, 0.04 + 0.1 * out, 0.04); ctx.fillStyle = '#ff6b8a'; ctx.fill();
        ctx.beginPath(); ctx.moveTo(0, 0.04); ctx.lineTo(0, 0.04 + 0.08 * out); ctx.strokeStyle = 'rgba(190,24,93,.55)'; ctx.lineWidth = 0.014; ctx.stroke();
      } else if (mouthOpen > 0.12) {
        const o = mouthOpen;
        ctx.beginPath(); ctx.ellipse(0, 0.02, 0.055 + 0.03 * o, 0.02 + 0.075 * o, 0, 0, TAU); ctx.fill();
        ctx.save(); ctx.clip(); ctx.beginPath(); ctx.ellipse(0, 0.07 + 0.03 * o, 0.04, 0.035 * o, 0, 0, TAU); ctx.fillStyle = pet.blush; ctx.fill(); ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(-0.05, 0, 0.05, 0.05, Math.PI - 0.05); ctx.stroke();
        ctx.beginPath(); ctx.arc(0.05, 0, 0.05, 0.05, Math.PI - 0.05); ctx.stroke();
      }
      ctx.restore();
    }

    hitTest(x, y) {
      const { x: cx, y: cy, rx, ry, p = 3 } = this.hit;
      if (this.peekAmt.x > 0.3 && y > this.feetLine) return false; // that part is behind the window
      return Math.abs((x - cx) / rx) ** p + Math.abs((y - cy) / ry) ** p <= 1;
    }

    /** Render one settled frame onto a small canvas (shape pickers, presets). */
    static snapshot(canvas, cfg, opts = {}) {
      const m = new Mochi(); const d = window.devicePixelRatio || 1; const r = canvas.getBoundingClientRect();
      const W = r.width || 90; const H = r.height || 90;
      canvas.width = Math.round(W * d); canvas.height = Math.round(H * d);
      m.configure(cfg); m.blinkT = 1; m.nextBlink = 99; m.cursor = { x: W / 2 + 6, y: H / 2 }; m.hit = { x: W / 2, y: H / 2, rx: 40, ry: 40 };
      if (opts.happy) m.happyT = 99;
      if (opts.setup) opts.setup(m, W, H);
      for (let i = 0; i < (opts.frames || 50); i++) m.update(1 / 60);
      const c = canvas.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0); m.draw(c, W, H);
    }
  }

  /** Live preview for the settings window: same character, no window around it. */
  function attachPreview(canvas, getCfg, { hoverAware = true } = {}) {
    const mochi = new Mochi(); const ctx = canvas.getContext('2d');
    let last = performance.now(); let raf = 0; let stopped = false;
    const dpr = () => window.devicePixelRatio || 1;
    function fit() {
      const r = canvas.getBoundingClientRect(); const d = dpr();
      canvas.width = Math.round(r.width * d); canvas.height = Math.round(r.height * d);
    }
    new ResizeObserver(fit).observe(canvas); fit();
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect(); const x = e.clientX - r.left; const y = e.clientY - r.top;
      mochi.setFrame({ cx: x, cy: y, vx: 0, vy: 0, walking: false, dragging: false });
      if (hoverAware) mochi.setHover(mochi.hitTest(x, y));
    });
    canvas.addEventListener('pointerleave', () => mochi.setHover(false));
    canvas.addEventListener('pointerdown', (e) => { const r = canvas.getBoundingClientRect(); if (mochi.hitTest(e.clientX - r.left, e.clientY - r.top)) mochi.click(); });
    function loop(now) {
      if (stopped) return;
      const dt = (now - last) / 1000; last = now;
      mochi.configure(getCfg());
      mochi.update(dt);
      const d = dpr(); ctx.setTransform(d, 0, 0, d, 0, 0);
      mochi.draw(ctx, canvas.width / d, canvas.height / d);
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return { mochi, stop() { stopped = true; cancelAnimationFrame(raf); } };
  }

  g.Mochi = Mochi;
  g.attachPreview = attachPreview;
})(typeof window !== 'undefined' ? window : globalThis);
