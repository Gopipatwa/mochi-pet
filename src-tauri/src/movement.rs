//! Moves a pet's *feet* point in physical pixels. The window is placed so the feet sit at the
//! bottom-centre of the pet window. Smoothness comes from velocity damping and real dt.
//!
//! Modes: still, wander, taskbar, windows (perch on other apps' windows and peek over the edge),
//! follow (the cursor) and corner. A second `Movement` drives the buddy with `follow_leader`.

use crate::platform::TopWin;
use crate::settings::{get_bool, get_f64, get_str};
use serde_json::Value;
use std::time::{Duration, Instant};

pub const FOOT_PAD: f64 = 18.0; // logical px between window bottom and the feet
const GRAVITY: f64 = 2600.0; // logical px / s^2

#[derive(Clone, Copy, Debug)]
pub struct Rect {
    pub x0: f64,
    pub x1: f64,
    pub y0: f64,
    pub y1: f64,
}

/// A monitor in physical pixels; `w*` is the work area (minus the taskbar).
#[derive(Clone, Copy, Debug)]
pub struct Mon {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub wx: f64,
    pub wy: f64,
    pub ww: f64,
    pub wh: f64,
    pub primary: bool,
}

#[derive(PartialEq, Clone, Copy, Debug)]
pub enum State {
    Idle,
    Walk,
    Fall,
    Drag,
}

/// The visible part of one window's top edge: somewhere a pet can stand.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Seg {
    pub hwnd: isize,
    pub l: f64, // window left, so an offset survives the window moving
    pub y: f64,
    pub x0: f64,
    pub x1: f64,
}

/// What the movement code needs to know about the outside world this frame.
pub struct World<'a> {
    pub segs: &'a [Seg],
    pub perch_rect: Option<(f64, f64, f64, f64)>, // current rect of the window we are perched on
}

/// Top edges of `wins` (front-most first) minus the parts hidden behind windows in front of them.
pub fn visible_top_edges(wins: &[TopWin], min_len: f64) -> Vec<Seg> {
    let mut out = Vec::new();
    for (i, w) in wins.iter().enumerate() {
        let mut spans = vec![(w.l, w.r)];
        for above in &wins[..i] {
            if above.t <= w.t && w.t < above.b {
                spans = spans
                    .into_iter()
                    .flat_map(|(a, b)| {
                        if above.r <= a || above.l >= b {
                            vec![(a, b)]
                        } else {
                            let mut v = Vec::new();
                            if above.l > a { v.push((a, above.l)); }
                            if above.r < b { v.push((above.r, b)); }
                            v
                        }
                    })
                    .collect();
            }
        }
        for (a, b) in spans {
            if b - a >= min_len {
                out.push(Seg { hwnd: w.hwnd, l: w.l, y: w.t, x0: a, x1: b });
            }
        }
    }
    out
}

enum WinAct {
    Riding,
    Walk(f64, f64),
    Fall,
    Nothing,
}

pub struct Movement {
    pub fx: f64,
    pub fy: f64,
    pub vx: f64,
    pub vy: f64,
    pub state: State,
    target: Option<(f64, f64)>,
    next_decision: Instant,
    drag_offset: (f64, f64),
    pub landed: f64,
    pub scale: f64,
    pub win_w: f64, // logical
    pub win_h: f64,
    // windows mode
    perch: Option<isize>,
    perch_off: f64,
    perch_until: Instant,
    pub riding: bool,
    pub peeking: bool,
    peek_until: Instant,
    next_peek: Instant,
}

fn rnd(a: f64, b: f64) -> f64 {
    a + fastrand::f64() * (b - a)
}

fn secs(s: f64) -> Duration {
    Duration::from_secs_f64(s.max(0.0))
}

impl Movement {
    pub fn new() -> Self {
        let now = Instant::now();
        Movement {
            fx: 0.0, fy: 0.0, vx: 0.0, vy: 0.0, state: State::Idle, target: None,
            next_decision: now + secs(3.0), drag_offset: (0.0, 0.0), landed: 0.0, scale: 1.0, win_w: 340.0, win_h: 400.0,
            perch: None, perch_off: 0.0, perch_until: now, riding: false, peeking: false, peek_until: now, next_peek: now + secs(8.0),
        }
    }

    fn anchor(&self) -> (f64, f64) {
        (self.win_w * self.scale / 2.0, (self.win_h - FOOT_PAD) * self.scale)
    }

    pub fn set_window_pos(&mut self, x: f64, y: f64) {
        let (ax, ay) = self.anchor();
        self.fx = x + ax;
        self.fy = y + ay;
    }

    pub fn window_pos(&self) -> (i32, i32) {
        let (ax, ay) = self.anchor();
        ((self.fx - ax).round() as i32, (self.fy - ay).round() as i32)
    }

    pub fn perch_hwnd(&self) -> Option<isize> {
        self.perch
    }

    /// Allowed regions for the feet, per monitor, honouring the "area" setting.
    pub fn rects(&self, settings: &Value, mons: &[Mon]) -> Vec<Rect> {
        let size = get_f64(settings, "general.size");
        let half = (size / 2.0 + 6.0) * self.scale;
        let pick: Vec<&Mon> = match get_str(settings, "movement.area") {
            "primary" => mons.iter().filter(|m| m.primary).take(1).collect(),
            "current" => self.nearest(mons).into_iter().collect(),
            _ => mons.iter().collect(),
        };
        let pick = if pick.is_empty() { mons.iter().take(1).collect() } else { pick };
        pick.iter()
            .map(|m| {
                let min_y = (m.wy + (self.win_h - FOOT_PAD) * self.scale).min(m.wy + m.wh);
                Rect { x0: m.wx + half, x1: (m.wx + m.ww - half).max(m.wx + half), y0: min_y, y1: m.wy + m.wh }
            })
            .collect()
    }

    fn nearest<'a>(&self, mons: &'a [Mon]) -> Option<&'a Mon> {
        mons.iter().min_by(|a, b| {
            let d = |m: &Mon| {
                let cx = self.fx.clamp(m.x, m.x + m.w);
                let cy = self.fy.clamp(m.y, m.y + m.h);
                (cx - self.fx).powi(2) + (cy - self.fy).powi(2)
            };
            d(a).partial_cmp(&d(b)).unwrap_or(std::cmp::Ordering::Equal)
        })
    }

    fn current_rect(&self, rects: &[Rect]) -> Rect {
        let mut best = rects[0];
        let mut bd = f64::INFINITY;
        for r in rects {
            let cx = self.fx.clamp(r.x0, r.x1);
            let cy = self.fy.clamp(r.y0.min(r.y1), r.y1);
            let d = (cx - self.fx).powi(2) + (cy - self.fy).powi(2);
            if d < bd {
                bd = d;
                best = *r;
            }
        }
        best
    }

    pub fn begin_drag(&mut self, cursor: (f64, f64)) {
        self.state = State::Drag;
        self.target = None;
        self.perch = None;
        self.riding = false;
        self.peeking = false;
        self.drag_offset = (self.fx - cursor.0, self.fy - cursor.1);
    }

    pub fn drag_to(&mut self, cursor: (f64, f64), dt: f64) {
        let (nx, ny) = (cursor.0 + self.drag_offset.0, cursor.1 + self.drag_offset.1);
        let k = 1.0 - (-dt * 30.0).exp();
        let d = dt.max(0.001);
        self.vx += ((nx - self.fx) / d - self.vx) * k;
        self.vy += ((ny - self.fy) / d - self.vy) * k;
        self.fx = nx;
        self.fy = ny;
    }

    pub fn end_drag(&mut self, settings: &Value, mons: &[Mon]) {
        self.state = State::Idle;
        if mons.is_empty() {
            return;
        }
        let inside = mons.iter().any(|m| self.fx >= m.x && self.fx <= m.x + m.w && self.fy >= m.y && self.fy <= m.y + m.h);
        if !inside {
            let rects = self.rects(settings, mons);
            let r = self.current_rect(&rects);
            self.fx = self.fx.clamp(r.x0, r.x1);
            self.fy = self.fy.clamp(r.y0.min(r.y1), r.y1);
        }
        // gravity: he falls until something is under him (the taskbar, or in windows mode a window edge)
        if matches!(get_str(settings, "movement.mode"), "taskbar" | "windows") {
            self.state = State::Fall;
        }
        self.vx *= 0.4;
        self.next_decision = Instant::now() + secs(2.5);
    }

    pub fn consume_landing(&mut self) -> f64 {
        std::mem::take(&mut self.landed)
    }

    // ---- per frame ------------------------------------------------------------------------------
    pub fn update(&mut self, dt: f64, settings: &Value, mons: &[Mon], cursor: (f64, f64), sleeping: bool, world: &World) {
        let dt = dt.min(0.05);
        if self.state == State::Drag || mons.is_empty() {
            return;
        }
        let rects = self.rects(settings, mons);
        if self.state == State::Fall {
            let half = (get_f64(settings, "general.size") / 2.0 + 6.0) * self.scale;
            let windows = get_str(settings, "movement.mode") == "windows";
            self.fall(dt, &rects, if windows { world.segs } else { &[] }, half);
            return;
        }
        let mode = get_str(settings, "movement.mode");
        let size = get_f64(settings, "general.size");
        let speed = get_f64(settings, "movement.speed") * self.scale;
        let freq = get_f64(settings, "movement.frequency");
        // He always stands still while your cursor is on him, so you can grab him whenever you like.
        let body_cy = self.fy - size * 0.5 * self.scale;
        let hovered = (cursor.0 - self.fx).abs() < size * 0.62 * self.scale && (cursor.1 - body_cy).abs() < size * 0.68 * self.scale;
        let can_move = !get_bool(settings, "movement.locked") && !sleeping && !hovered;
        let now = Instant::now();

        let mut desired: Option<(f64, f64, f64)> = None;

        if mode == "windows" {
            match self.windows_logic(now, settings, mons, world, can_move, size) {
                WinAct::Riding => {
                    self.state = State::Idle;
                    return;
                }
                WinAct::Walk(x, y) => {
                    if !hovered {
                        desired = Some((x, y, 1.3));
                    }
                }
                WinAct::Fall => {
                    self.state = State::Fall;
                    return;
                }
                WinAct::Nothing => {
                    if can_move {
                        desired = self.taskbar(now, &rects);
                    }
                }
            }
        } else {
            self.perch = None;
            self.riding = false;
            self.peeking = false;
            if can_move {
                desired = match mode {
                    "wander" => self.wander(now, &rects),
                    "taskbar" => self.taskbar(now, &rects),
                    "follow" => self.follow(cursor, &rects, size),
                    "corner" => Some(self.corner(&rects, get_str(settings, "movement.corner"))),
                    _ => None,
                };
            }
        }
        let (mut dvx, mut dvy) = (0.0, 0.0);
        if let Some((tx, ty, mul)) = desired {
            let (dx, dy) = (tx - self.fx, ty - self.fy);
            let dist = dx.hypot(dy);
            if dist < 3.0 * self.scale {
                self.target = None;
                if !matches!(mode, "follow") {
                    self.next_decision = now + secs(rnd(0.6, 1.4) * freq);
                }
            } else {
                let sp = (speed * mul).min(dist * 2.4 + 8.0 * self.scale);
                dvx = dx / dist * sp;
                dvy = dy / dist * sp;
            }
        }
        let k = 1.0 - (-dt * if desired.is_some() { 5.0 } else { 9.0 }).exp();
        self.vx += (dvx - self.vx) * k;
        self.vy += (dvy - self.vy) * k;
        if self.vx.abs() < 0.05 { self.vx = 0.0; }
        if self.vy.abs() < 0.05 { self.vy = 0.0; }
        self.fx += self.vx * dt;
        self.fy += self.vy * dt;
        self.state = if self.vx.hypot(self.vy) > 6.0 * self.scale { State::Walk } else { State::Idle };
    }

    fn windows_logic(&mut self, now: Instant, settings: &Value, mons: &[Mon], world: &World, can_move: bool, size: f64) -> WinAct {
        let half = (size / 2.0 + 6.0) * self.scale;
        let peek_on = get_bool(settings, "movement.peek");

        if let Some(h) = self.perch {
            let Some((l, t, r, _)) = world.perch_rect else {
                // the window closed or was minimised under us
                let was_riding = self.riding;
                self.perch = None;
                self.riding = false;
                self.peeking = false;
                return if was_riding { WinAct::Fall } else { WinAct::Nothing };
            };
            let _ = h;
            let tx = (l + self.perch_off).clamp(l + half.min((r - l) / 2.0), (r - half).max(l + half.min((r - l) / 2.0)));
            let ty = t + self.scale;
            if (tx - self.fx).hypot(ty - self.fy) < 10.0 * self.scale {
                // attached: ride the window rigidly, so dragging the window carries the pet with it
                self.fx = tx;
                self.fy = ty;
                self.vx = 0.0;
                self.vy = 0.0;
                self.target = None;
                self.riding = true;
                if can_move && now >= self.perch_until {
                    self.perch = None;
                    self.riding = false;
                    self.peeking = false;
                    self.next_decision = now + secs(rnd(1.0, 4.0));
                    return WinAct::Nothing;
                }
                if peek_on && can_move {
                    if self.peeking {
                        if now >= self.peek_until {
                            self.peeking = false;
                            self.next_peek = now + secs(rnd(8.0, 20.0));
                        }
                    } else if now >= self.next_peek {
                        self.peeking = true;
                        self.peek_until = now + secs(rnd(3.5, 6.5));
                    }
                } else {
                    self.peeking = false;
                }
                return WinAct::Riding;
            }
            self.riding = false;
            self.peeking = false;
            return WinAct::Walk(tx, ty);
        }

        self.riding = false;
        self.peeking = false;
        if !can_move || now < self.next_decision {
            return WinAct::Nothing;
        }
        // pick a window whose visible top edge is long enough and high enough to see the whole pet
        let body = size * 1.7 * self.scale;
        let cands: Vec<&Seg> = world
            .segs
            .iter()
            .filter(|s| {
                s.x1 - s.x0 >= 2.0 * half + 30.0 * self.scale
                    && mons.iter().any(|m| s.x0 >= m.x && s.x0 <= m.x + m.w && s.y >= m.y + body && s.y <= m.y + m.h - 40.0 * self.scale)
            })
            .collect();
        if cands.is_empty() {
            return WinAct::Nothing;
        }
        let s = cands[fastrand::usize(..cands.len())];
        let x = rnd(s.x0 + half, (s.x1 - half).max(s.x0 + half));
        self.perch = Some(s.hwnd);
        self.perch_off = x - s.l;
        self.perch_until = now + secs(rnd(18.0, 50.0));
        self.next_peek = now + secs(rnd(5.0, 12.0));
        WinAct::Walk(x, s.y + self.scale)
    }

    /// Gravity. The floor is the ground, or the nearest visible window edge under him (windows mode),
    /// in which case he lands on it and stays there.
    fn fall(&mut self, dt: f64, rects: &[Rect], segs: &[Seg], half: f64) {
        let ground = self.current_rect(rects).y1;
        let mut floor = ground;
        let mut onto: Option<Seg> = None;
        for s in segs {
            if self.fx >= s.x0 + half * 0.5 && self.fx <= s.x1 - half * 0.5 && s.y >= self.fy - 4.0 * self.scale && s.y < floor {
                floor = s.y + self.scale;
                onto = Some(*s);
            }
        }
        if self.fy < floor {
            self.vy += GRAVITY * self.scale * dt;
            self.fy += self.vy * dt;
            self.fx += self.vx * dt;
            self.vx *= 0.98;
            if self.fy >= floor {
                self.fy = floor;
                self.landed = self.vy / self.scale; // report in logical px/s
                self.vy = 0.0;
                self.vx = 0.0;
                self.state = State::Idle;
                if let Some(s) = onto {
                    let now = Instant::now();
                    self.perch = Some(s.hwnd);
                    self.perch_off = self.fx - s.l;
                    self.perch_until = now + secs(rnd(20.0, 50.0));
                    self.next_peek = now + secs(rnd(5.0, 12.0));
                }
            }
        } else {
            self.fy += (floor - self.fy) * (1.0 - (-dt * 8.0).exp());
            if self.fy > floor - 0.5 {
                self.fy = floor;
                self.state = State::Idle;
            }
        }
    }

    fn pick_point(&self, rects: &[Rect], near: bool) -> (f64, f64) {
        let r = rects[fastrand::usize(..rects.len())];
        let (mut x, mut y) = (rnd(r.x0, r.x1.max(r.x0)), rnd(r.y0.min(r.y1), r.y1));
        let cur = self.current_rect(rects);
        if near && (r.x0, r.y1) == (cur.x0, cur.y1) {
            x = (self.fx + rnd(-420.0, 420.0) * self.scale).clamp(r.x0, r.x1.max(r.x0));
            y = (self.fy + rnd(-260.0, 260.0) * self.scale).clamp(r.y0.min(r.y1), r.y1);
        }
        (x, y)
    }

    fn wander(&mut self, now: Instant, rects: &[Rect]) -> Option<(f64, f64, f64)> {
        if self.target.is_none() && now >= self.next_decision {
            self.target = Some(self.pick_point(rects, fastrand::f64() < 0.75));
        }
        self.target.map(|t| (t.0, t.1, 1.0))
    }

    fn taskbar(&mut self, now: Instant, rects: &[Rect]) -> Option<(f64, f64, f64)> {
        let r = self.current_rect(rects);
        if (self.fy - r.y1).abs() > 4.0 * self.scale && self.target.is_none() {
            self.target = Some((self.fx.clamp(r.x0, r.x1), r.y1));
        }
        if self.target.is_none() && now >= self.next_decision {
            let pick = rects[fastrand::usize(..rects.len())];
            let near = (pick.x0, pick.y1) == (r.x0, r.y1) && fastrand::f64() < 0.8;
            let x = if near { (self.fx + rnd(-500.0, 500.0) * self.scale).clamp(r.x0, r.x1) } else { rnd(pick.x0, pick.x1.max(pick.x0)) };
            self.target = Some((x, pick.y1));
        }
        self.target.map(|t| (t.0, t.1, 1.0))
    }

    fn follow(&self, cursor: (f64, f64), rects: &[Rect], size: f64) -> Option<(f64, f64, f64)> {
        let stop = size * 0.95 * self.scale;
        let (dx, dy) = (cursor.0 - self.fx, cursor.1 - self.fy);
        let dist = dx.hypot(dy);
        if dist < stop {
            return None;
        }
        let (tx, ty) = (cursor.0 - dx / dist * stop, cursor.1 - dy / dist * stop);
        let mut best = rects[0];
        let mut bd = f64::INFINITY;
        for q in rects {
            let d = (tx.clamp(q.x0, q.x1) - tx).powi(2) + (ty.clamp(q.y0.min(q.y1), q.y1) - ty).powi(2);
            if d < bd {
                bd = d;
                best = *q;
            }
        }
        Some((tx.clamp(best.x0, best.x1), ty.clamp(best.y0.min(best.y1), best.y1), 1.5))
    }

    fn corner(&self, rects: &[Rect], corner: &str) -> (f64, f64, f64) {
        let r = self.current_rect(rects);
        let x = if corner.ends_with("Left") { r.x0 } else { r.x1 };
        let y = if corner.starts_with("top") { r.y0.min(r.y1) } else { r.y1 };
        (x, y, 1.0)
    }

    /// The buddy: stay `gap` pixels to one side of the leader's feet.
    pub fn follow_leader(&mut self, dt: f64, speed: f64, leader: (f64, f64), side: f64, gap: f64, sleeping: bool) {
        let dt = dt.min(0.05);
        let (tx, ty) = (leader.0 + side * gap, leader.1);
        let (dx, dy) = (tx - self.fx, ty - self.fy);
        let dist = dx.hypot(dy);
        if dist > 2500.0 * self.scale {
            self.fx = tx;
            self.fy = ty;
            return;
        }
        let (mut dvx, mut dvy) = (0.0, 0.0);
        if dist > 5.0 * self.scale && !sleeping {
            let sp = (speed * 1.2 * self.scale).max(60.0 * self.scale).min(dist * 2.8 + 12.0 * self.scale);
            dvx = dx / dist * sp;
            dvy = dy / dist * sp;
        }
        let k = 1.0 - (-dt * 6.0).exp();
        self.vx += (dvx - self.vx) * k;
        self.vy += (dvy - self.vy) * k;
        if self.vx.abs() < 0.05 { self.vx = 0.0; }
        if self.vy.abs() < 0.05 { self.vy = 0.0; }
        self.fx += self.vx * dt;
        self.fy += self.vy * dt;
        self.state = if self.vx.hypot(self.vy) > 6.0 * self.scale { State::Walk } else { State::Idle };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win(hwnd: isize, l: f64, t: f64, r: f64, b: f64) -> TopWin {
        TopWin { hwnd, l, t, r, b }
    }

    #[test]
    fn a_lone_window_exposes_its_whole_top_edge() {
        let segs = visible_top_edges(&[win(1, 100.0, 200.0, 900.0, 700.0)], 50.0);
        assert_eq!(segs, vec![Seg { hwnd: 1, l: 100.0, y: 200.0, x0: 100.0, x1: 900.0 }]);
    }

    #[test]
    fn a_window_in_front_hides_the_part_of_the_edge_it_covers() {
        // front window covers x 400..600 across y=200; back window's top edge is split in two
        let wins = [win(1, 400.0, 100.0, 600.0, 500.0), win(2, 100.0, 200.0, 900.0, 700.0)];
        let segs: Vec<(isize, f64, f64)> = visible_top_edges(&wins, 50.0).iter().map(|s| (s.hwnd, s.x0, s.x1)).collect();
        assert_eq!(segs, vec![(1, 400.0, 600.0), (2, 100.0, 400.0), (2, 600.0, 900.0)]);
    }

    #[test]
    fn a_window_that_starts_below_the_front_one_keeps_its_edge() {
        let wins = [win(1, 400.0, 100.0, 600.0, 150.0), win(2, 100.0, 200.0, 900.0, 700.0)];
        assert_eq!(visible_top_edges(&wins, 50.0).len(), 2);
        assert!(visible_top_edges(&wins, 50.0).iter().any(|s| s.hwnd == 2 && s.x0 == 100.0 && s.x1 == 900.0));
    }

    /// Drop him at (fx, fy) in windows mode and let gravity run for three seconds.
    fn dropped(fx: f64, fy: f64, segs: &[Seg]) -> Movement {
        let mut m = Movement::new();
        m.fx = fx;
        m.fy = fy;
        let mut s = crate::settings::defaults();
        s["movement"]["mode"] = serde_json::json!("windows");
        s["teasing"]["enabled"] = serde_json::json!(false);
        let mons = [Mon { x: 0.0, y: 0.0, w: 1920.0, h: 1200.0, wx: 0.0, wy: 0.0, ww: 1920.0, wh: 1160.0, primary: true }];
        m.begin_drag((fx, fy));
        m.end_drag(&s, &mons);
        assert_eq!(m.state, State::Fall, "letting go must start gravity");
        // the window he lands on keeps existing, so the engine can report its rectangle
        let rect = segs.first().map(|g| (g.l, g.y, g.x1, g.y + 300.0));
        let world = World { segs, perch_rect: rect };
        for _ in 0..180 {
            m.update(1.0 / 60.0, &s, &mons, (0.0, 0.0), false, &world);
        }
        m
    }

    #[test]
    fn he_falls_onto_a_window_edge_under_him_and_stays_on_it() {
        let seg = Seg { hwnd: 42, l: 100.0, y: 600.0, x0: 100.0, x1: 900.0 };
        let m = dropped(500.0, 300.0, &[seg]);
        assert_eq!(m.perch_hwnd(), Some(42));
        assert!((m.fy - 601.0).abs() < 2.0, "landed on the edge, not the ground (fy = {})", m.fy);
    }

    #[test]
    fn with_nothing_under_him_he_falls_to_the_ground() {
        let m = dropped(500.0, 300.0, &[]);
        assert_eq!(m.perch_hwnd(), None);
        assert!((m.fy - 1160.0).abs() < 2.0, "ground = bottom of the work area (fy = {})", m.fy);
    }

    #[test]
    fn he_falls_past_a_window_that_is_not_under_him() {
        let seg = Seg { hwnd: 7, l: 1200.0, y: 600.0, x0: 1200.0, x1: 1900.0 };
        let m = dropped(500.0, 300.0, &[seg]);
        assert_eq!(m.perch_hwnd(), None);
        assert!((m.fy - 1160.0).abs() < 2.0);
    }

    #[test]
    fn he_stands_still_while_the_cursor_is_on_him_so_he_can_always_be_grabbed() {
        let mut m = Movement::new();
        m.fx = 500.0;
        m.fy = 1160.0;
        let mut s = crate::settings::defaults();
        s["movement"]["mode"] = serde_json::json!("wander");
        s["movement"]["speed"] = serde_json::json!(400);
        s["movement"]["frequency"] = serde_json::json!(2);
        let mons = [Mon { x: 0.0, y: 0.0, w: 1920.0, h: 1200.0, wx: 0.0, wy: 0.0, ww: 1920.0, wh: 1160.0, primary: true }];
        let world = World { segs: &[], perch_rect: None };
        m.next_decision = Instant::now() - Duration::from_secs(1); // he wants to wander right now
        let on_him = (500.0, 1160.0 - 65.0);
        for _ in 0..120 {
            m.update(1.0 / 60.0, &s, &mons, on_him, false, &world);
        }
        assert!((m.fx - 500.0).abs() < 1.0 && (m.fy - 1160.0).abs() < 1.0, "he must not walk away from a cursor that is on him");
        let far = (1700.0, 200.0);
        for _ in 0..240 {
            m.update(1.0 / 60.0, &s, &mons, far, false, &world);
        }
        assert!((m.fx - 500.0).abs() > 5.0 || (m.fy - 1160.0).abs() > 5.0, "once the cursor leaves he carries on wandering");
    }

    #[test]
    fn he_does_not_fall_up_onto_a_window_that_is_above_him() {
        let seg = Seg { hwnd: 9, l: 0.0, y: 200.0, x0: 0.0, x1: 1900.0 };
        let m = dropped(500.0, 700.0, &[seg]);
        assert_eq!(m.perch_hwnd(), None);
        assert!((m.fy - 1160.0).abs() < 2.0);
    }

    #[test]
    fn short_slivers_are_dropped() {
        let wins = [win(1, 120.0, 100.0, 880.0, 500.0), win(2, 100.0, 200.0, 900.0, 700.0)];
        let segs = visible_top_edges(&wins, 50.0);
        assert!(segs.iter().all(|s| s.hwnd != 2), "slivers of 20px on either side are too small to stand on");
    }
}
