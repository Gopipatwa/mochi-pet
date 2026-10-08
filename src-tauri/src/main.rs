#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ics;
mod movement;
mod platform;
mod reminders;
mod settings;

use chrono::{Local, Timelike};
use movement::{visible_top_edges, Mon, Movement, Seg, State as MoveState, World, FOOT_PAD};
use platform::TopWin;
use reminders::{Engine, Payload};
use serde_json::{json, Value};
use settings::{get, get_bool, get_f64, get_str, Store};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_dialog::DialogExt as _;
use tauri_plugin_notification::NotificationExt as _;

struct Runtime {
    sleeping: bool,
    fullscreen: bool,
    pet_visible: bool,
}

struct Core {
    store: Store,
    rt: Runtime,
    movement: Movement,
    engine: Engine,
    mons: Vec<Mon>,
    dragging: bool,
    bubble_hot: bool, // the page says the cursor is on its speech bubble (buttons must be clickable)
    active_speech: HashMap<String, Payload>,
    last_greeting: String,
    buddy: Movement,
    wins: Vec<TopWin>,
    segs: Vec<Seg>,
    next_tease: Instant,
}

type Shared = Arc<Mutex<Core>>;

fn shared(app: &AppHandle) -> Shared {
    app.state::<Shared>().inner().clone()
}

// ---- small helpers ---------------------------------------------------------------------------------
fn pet_size(size: f64) -> (f64, f64) {
    ((size * 1.9).max(340.0).round(), (size * 1.6 + 190.0).round())
}

/// The buddy's body size and its (smaller) window: it never shows a speech bubble.
fn buddy_px(data: &Value) -> f64 {
    (get_f64(data, "general.size") * get_f64(data, "buddy.scale")).round().max(40.0)
}

fn buddy_win(size: f64) -> (f64, f64) {
    ((size * 1.9).max(150.0).round(), (size * 1.6 + 70.0).round())
}

fn today_key() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn runtime_json(core: &Core) -> Value {
    json!({
        "paused": get_bool(&core.store.data, "reminders.paused"),
        "dnd": get_bool(&core.store.data, "reminders.dnd"),
        "fullscreen": core.rt.fullscreen,
        "sleeping": core.rt.sleeping,
        "petVisible": core.rt.pet_visible,
        "version": env!("CARGO_PKG_VERSION"),
        "packaged": !cfg!(debug_assertions),
    })
}

fn emit_pet(app: &AppHandle, channel: &str, payload: Value) {
    let _ = app.emit_to("pet", &format!("mochi:{channel}"), payload);
}

fn broadcast(app: &AppHandle, channel: &str, payload: Value) {
    let _ = app.emit(&format!("mochi:{channel}"), payload);
}

fn broadcast_settings(app: &AppHandle, origin: &str) {
    let (s, rt) = {
        let c = shared(app);
        let c = c.lock().unwrap();
        (c.store.data.clone(), runtime_json(&c))
    };
    broadcast(app, "settings:changed", json!({ "settings": s, "origin": origin }));
    broadcast(app, "runtime:changed", rt);
    refresh_tray(app);
}

fn query_monitors(app: &AppHandle) -> Vec<Mon> {
    let primary = app.primary_monitor().ok().flatten();
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let (p, s, w) = (m.position(), m.size(), m.work_area());
            Mon {
                x: p.x as f64, y: p.y as f64, w: s.width as f64, h: s.height as f64,
                wx: w.position.x as f64, wy: w.position.y as f64, ww: w.size.width as f64, wh: w.size.height as f64,
                primary: primary.as_ref().map_or(false, |pm| pm.position() == p),
            }
        })
        .collect()
}

// ---- settings changes & side effects ------------------------------------------------------------------
fn patch_settings(app: &AppHandle, partial: &Value, origin: &str, silent: bool) -> Value {
    let core = shared(app);
    let (before, after) = {
        let mut c = core.lock().unwrap();
        let b = (get_f64(&c.store.data, "general.size"), get_bool(&c.store.data, "general.alwaysOnTop"), get_bool(&c.store.data, "general.startWithWindows"), get_str(&c.store.data, "movement.fullscreen").to_string());
        c.store.patch(partial);
        let a = (get_f64(&c.store.data, "general.size"), get_bool(&c.store.data, "general.alwaysOnTop"), get_bool(&c.store.data, "general.startWithWindows"), get_str(&c.store.data, "movement.fullscreen").to_string());
        (b, a)
    };
    after_settings_change(app, before, after);
    sync_buddy(app);
    if !silent {
        broadcast_settings(app, origin);
    }
    let data = core.lock().unwrap().store.data.clone();
    data
}

type Snap = (f64, bool, bool, String);

fn after_settings_change(app: &AppHandle, before: Snap, after: Snap) {
    if before.0 != after.0 {
        resize_pet(app);
    }
    if before.1 != after.1 {
        if let Some(w) = app.get_webview_window("pet") {
            let _ = w.set_always_on_top(after.1);
        }
    }
    if before.2 != after.2 {
        apply_login_item(app);
    }
    if before.3 != after.3 {
        apply_visibility(app);
    }
}

fn apply_login_item(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return; // a dev build would register the debug exe
    }
    let on = get_bool(&shared(app).lock().unwrap().store.data, "general.startWithWindows");
    let m = app.autolaunch();
    let _ = if on { m.enable() } else { m.disable() };
}

fn resize_pet(app: &AppHandle) {
    let Some(win) = app.get_webview_window("pet") else { return };
    let core = shared(app);
    let (w, h, pos) = {
        let mut c = core.lock().unwrap();
        let (w, h) = pet_size(get_f64(&c.store.data, "general.size"));
        c.movement.win_w = w;
        c.movement.win_h = h;
        (w, h, c.movement.window_pos())
    };
    let _ = win.set_size(LogicalSize::new(w, h));
    let _ = win.set_position(PhysicalPosition::new(pos.0, pos.1));
    sync_buddy(app);
}

/// Pet window is shown unless the user hid it or a fullscreen app is up (and the policy says hide).
fn apply_visibility(app: &AppHandle) {
    let Some(win) = app.get_webview_window("pet") else { return };
    let show = {
        let c = shared(app);
        let c = c.lock().unwrap();
        c.rt.pet_visible && !(c.rt.fullscreen && get_str(&c.store.data, "movement.fullscreen") == "hide")
    };
    let _ = if show { win.show() } else { win.hide() };
    if let Some(b) = app.get_webview_window("buddy") {
        let _ = if show { b.show() } else { b.hide() };
    }
}

fn set_pet_visible(app: &AppHandle, visible: bool) {
    shared(app).lock().unwrap().rt.pet_visible = visible;
    apply_visibility(app);
    broadcast_settings(app, "visibility");
}

// ---- speech -----------------------------------------------------------------------------------------
fn time_bucket() -> &'static str {
    match Local::now().hour() {
        5..=11 => "morning",
        12..=16 => "afternoon",
        17..=21 => "evening",
        _ => "night",
    }
}

fn greeting_text(app: &AppHandle) -> String {
    let core = shared(app);
    let mut c = core.lock().unwrap();
    let list: Vec<String> = get(&c.store.data, &format!("greetings.{}", time_bucket()))
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();
    if list.is_empty() {
        return "Hello!".into();
    }
    let mut idx = fastrand::usize(..list.len());
    if list.len() > 1 && list[idx] == c.last_greeting {
        idx = (idx + 1) % list.len();
    }
    let line = list[idx].clone();
    c.last_greeting = line.clone();
    line.replace("{name}", get_str(&c.store.data, "general.name")).replace("{pet}", get_str(&c.store.data, "general.petName"))
}

fn speak(app: &AppHandle, id: String, kind: &'static str, text: String, ttl: f64, actions: &[&str]) {
    let core = shared(app);
    let (sound, notify, pet_name) = {
        let mut c = core.lock().unwrap();
        let alert = kind == "reminder" || kind == "meeting";
        if alert {
            c.active_speech.insert(id.clone(), Payload { id: id.clone(), kind, text: text.clone(), ttl });
        } else {
            c.active_speech.insert(id.clone(), Payload { id: id.clone(), kind: "reminder", text: text.clone(), ttl });
        }
        let s = &c.store.data;
        (
            alert && get_bool(s, "general.sounds") && get_bool(s, "reminders.sound"),
            alert && (get_bool(s, "reminders.notify") || !c.rt.pet_visible),
            get_str(s, "general.petName").to_string(),
        )
    };
    emit_pet(app, "pet:speak", json!({ "id": id, "kind": kind, "text": text, "ttl": ttl, "actions": actions, "sound": sound }));
    if notify {
        let _ = app.notification().builder().title(pet_name).body(text).show();
    }
}

fn greet(app: &AppHandle) {
    let (enabled, blocked) = {
        let c = shared(app);
        let c = c.lock().unwrap();
        (
            get_bool(&c.store.data, "greetings.enabled"),
            get_bool(&c.store.data, "reminders.dnd") || (c.rt.fullscreen && get_str(&c.store.data, "movement.fullscreen") == "hide"),
        )
    };
    if !enabled || blocked {
        return;
    }
    patch_settings(app, &json!({ "general": { "lastGreetDate": today_key() } }), "greet", true);
    let text = greeting_text(app);
    speak(app, format!("greet-{}", Local::now().timestamp_millis()), "greeting", text, 8.0, &[]);
}

fn deliver(app: &AppHandle, p: Payload) {
    speak(app, p.id, p.kind, p.text, p.ttl, &["done", "snooze"]);
}

// ---- windows ----------------------------------------------------------------------------------------
fn create_pet_window(app: &AppHandle) -> tauri::Result<()> {
    let core = shared(app);
    let (w, h, pos) = {
        let mut c = core.lock().unwrap();
        let size = get_f64(&c.store.data, "general.size");
        let (w, h) = pet_size(size);
        let scale = app.primary_monitor().ok().flatten().map_or(1.0, |m| m.scale_factor());
        c.movement.win_w = w;
        c.movement.win_h = h;
        c.movement.scale = scale;
        let saved = get(&c.store.data, "general.position");
        let mons = c.mons.clone();
        let mut start: Option<(f64, f64)> = None;
        if let (Some(x), Some(y)) = (saved.get("x").and_then(Value::as_f64), saved.get("y").and_then(Value::as_f64)) {
            let (fx, fy) = (x + w * scale / 2.0, y + (h - FOOT_PAD) * scale);
            if mons.iter().any(|m| fx >= m.x && fx <= m.x + m.w && fy >= m.y && fy <= m.y + m.h) {
                start = Some((x, y));
            }
        }
        let (x, y) = start.unwrap_or_else(|| {
            let m = mons.iter().find(|m| m.primary).or(mons.first()).copied().unwrap_or(Mon { x: 0.0, y: 0.0, w: 1920.0, h: 1080.0, wx: 0.0, wy: 0.0, ww: 1920.0, wh: 1040.0, primary: true });
            (m.wx + m.ww - (w / 2.0 + 70.0) * scale, m.wy + m.wh - (h - FOOT_PAD) * scale)
        });
        c.movement.set_window_pos(x, y);
        (w, h, (x, y))
    };

    let win = WebviewWindowBuilder::new(app, "pet", WebviewUrl::App("pet/index.html".into()))
        .title("Pet")
        .inner_size(w, h)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .visible(false)
        .build()?;
    win.set_position(PhysicalPosition::new(pos.0.round() as i32, pos.1.round() as i32))?;
    win.set_ignore_cursor_events(true)?;
    let app2 = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(350));
        apply_visibility(&app2);
    });
    Ok(())
}

fn theme_bg(id: &str) -> tauri::window::Color {
    let (r, g, b) = match id {
        "light" => (0xf6, 0xf7, 0xfb),
        "pastel" => (0xfd, 0xf4, 0xf7),
        "neon" => (0x0b, 0x0b, 0x17),
        "retro" => (0xf2, 0xe6, 0xc9),
        _ => (0x14, 0x16, 0x1c),
    };
    tauri::window::Color(r, g, b, 255)
}

fn open_settings(app: &AppHandle, tab: Option<&str>) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        if let Some(t) = tab {
            let s = shared(app).lock().unwrap().store.data.clone();
            let _ = app.emit_to("settings", "mochi:settings:changed", json!({ "settings": s, "origin": format!("tab:{t}") }));
        }
        return;
    }
    let (pet_name, theme) = {
        let c = shared(app);
        let c = c.lock().unwrap();
        (get_str(&c.store.data, "general.petName").to_string(), get_str(&c.store.data, "theme.id").to_string())
    };
    let _ = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings/index.html".into()))
        .title(format!("{pet_name} Settings"))
        .inner_size(980.0, 700.0)
        .min_inner_size(780.0, 560.0)
        .background_color(theme_bg(&theme))
        .build();
}

// ---- buddy (the second, smaller pet) ----------------------------------------------------------------
fn create_buddy_window(app: &AppHandle, w: f64, h: f64) {
    let core = shared(app);
    let start = {
        let mut c = core.lock().unwrap();
        let size = buddy_px(&c.store.data);
        let (bw, bh) = buddy_win(size);
        c.buddy.win_w = bw;
        c.buddy.win_h = bh;
        c.buddy.scale = c.movement.scale;
        let side = if get_str(&c.store.data, "buddy.side") == "left" { -1.0 } else { 1.0 };
        let (lx, ly) = (c.movement.fx, c.movement.fy);
        let gap = get_f64(&c.store.data, "general.size") * 0.9 * c.movement.scale;
        c.buddy.fx = lx + side * gap;
        c.buddy.fy = ly;
        c.buddy.window_pos()
    };
    let built = WebviewWindowBuilder::new(app, "buddy", WebviewUrl::App("pet/index.html".into()))
        .title("Buddy")
        .inner_size(w, h)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .visible(false)
        .build();
    if let Ok(win) = built {
        let _ = win.set_position(PhysicalPosition::new(start.0, start.1));
        let _ = win.set_ignore_cursor_events(true);
        let a = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(350));
            apply_visibility(&a);
        });
    }
}

/// Creates, resizes or removes the buddy window so it matches the settings. Cheap when nothing changed.
fn sync_buddy(app: &AppHandle) {
    let core = shared(app);
    let (enabled, w, h) = {
        let mut c = core.lock().unwrap();
        let enabled = get_bool(&c.store.data, "buddy.enabled");
        let (w, h) = buddy_win(buddy_px(&c.store.data));
        if enabled {
            c.buddy.win_w = w;
            c.buddy.win_h = h;
        }
        (enabled, w, h)
    };
    match (enabled, app.get_webview_window("buddy")) {
        (false, Some(win)) => {
            let _ = win.destroy();
        }
        (true, None) => create_buddy_window(app, w, h),
        (true, Some(win)) => {
            if let Ok(sz) = win.inner_size() {
                let sf = win.scale_factor().unwrap_or(1.0);
                if ((sz.width as f64 / sf) - w).abs() > 1.0 || ((sz.height as f64 / sf) - h).abs() > 1.0 {
                    let _ = win.set_size(LogicalSize::new(w, h));
                }
            }
        }
        _ => {}
    }
}

fn emit_buddy(app: &AppHandle, channel: &str, payload: Value) {
    let _ = app.emit_to("buddy", &format!("mochi:{channel}"), payload);
}

// ---- teasing ---------------------------------------------------------------------------------------------
fn tease_gap(data: &Value) -> Duration {
    let (lo, hi) = if get_str(data, "teasing.level") == "cheeky" { (180.0, 480.0) } else { (600.0, 1500.0) };
    Duration::from_secs_f64(lo + fastrand::f64() * (hi - lo))
}

/// A playful moment: tongue out, a cheeky remark, and the buddy giggles.
fn tease(app: &AppHandle, with_line: bool) {
    let (line, tongue) = {
        let c = shared(app);
        let c = c.lock().unwrap();
        let d = &c.store.data;
        if !get_bool(d, "teasing.enabled") || get_bool(d, "reminders.dnd") || (c.rt.fullscreen && get_str(d, "movement.fullscreen") == "hide") {
            return;
        }
        let lines: Vec<&str> = get(d, "teasing.lines").as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
        let line = if with_line && !lines.is_empty() {
            Some(lines[fastrand::usize(..lines.len())].replace("{name}", get_str(d, "general.name")))
        } else {
            None
        };
        (line, get_bool(d, "teasing.tongue"))
    };
    if tongue {
        emit_pet(app, "pet:tease", json!({ "kind": "tongue" }));
    }
    emit_buddy(app, "pet:friend", json!({ "kind": "giggle" }));
    if let Some(l) = line {
        speak(app, format!("tease-{}", Local::now().timestamp_millis()), "greeting", l, 5.0, &[]);
    }
}

// ---- tray & menus --------------------------------------------------------------------------------------
const MODES: [(&str, &str); 6] = [("still", "Stay still"), ("wander", "Wander around"), ("taskbar", "Walk along the taskbar"), ("windows", "Sit on windows"), ("follow", "Follow my cursor"), ("corner", "Sit in a corner")];

fn movement_submenu(app: &AppHandle, data: &Value) -> tauri::Result<Submenu<tauri::Wry>> {
    let mode = get_str(data, "movement.mode").to_string();
    let mut items: Vec<CheckMenuItem<tauri::Wry>> = Vec::new();
    for (id, label) in MODES {
        items.push(CheckMenuItem::with_id(app, format!("mode:{id}"), label, true, mode == id, None::<&str>)?);
    }
    let lock = CheckMenuItem::with_id(app, "lock", "Never move (lock)", true, get_bool(data, "movement.locked"), None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let mut refs: Vec<&dyn IsMenuItem<tauri::Wry>> = items.iter().map(|i| i as &dyn IsMenuItem<tauri::Wry>).collect();
    refs.push(&sep);
    refs.push(&lock);
    Submenu::with_items(app, "Movement", true, &refs)
}

fn build_tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let (data, visible) = {
        let c = shared(app);
        let c = c.lock().unwrap();
        (c.store.data.clone(), c.rt.pet_visible)
    };
    let toggle = MenuItem::with_id(app, "toggle", if visible { "Hide pet" } else { "Show pet" }, true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
    let paused = CheckMenuItem::with_id(app, "paused", "Pause reminders", true, get_bool(&data, "reminders.paused"), None::<&str>)?;
    let dnd = CheckMenuItem::with_id(app, "dnd", "Do not disturb", true, get_bool(&data, "reminders.dnd"), None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let (s1, s2) = (PredefinedMenuItem::separator(app)?, PredefinedMenuItem::separator(app)?);
    Menu::with_items(app, &[&toggle, &settings, &s1, &paused, &dnd, &s2, &quit])
}

fn refresh_tray(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id("main") {
        if let Ok(menu) = build_tray_menu(app) {
            let _ = tray.set_menu(Some(menu));
        }
        let (name, paused, dnd) = {
            let c = shared(app);
            let c = c.lock().unwrap();
            (get_str(&c.store.data, "general.petName").to_string(), get_bool(&c.store.data, "reminders.paused"), get_bool(&c.store.data, "reminders.dnd"))
        };
        let _ = tray.set_tooltip(Some(format!("{name}{}{}", if paused { " (reminders paused)" } else { "" }, if dnd { " (do not disturb)" } else { "" })));
    }
}

fn show_pet_menu(app: &AppHandle) {
    let Some(win) = app.get_webview_window("pet") else { return };
    let data = shared(app).lock().unwrap().store.data.clone();
    let build = || -> tauri::Result<Menu<tauri::Wry>> {
        let pet = get_str(&data, "general.petName");
        let hi = MenuItem::with_id(app, "hi", format!("Say hi to {pet}"), true, None::<&str>)?;
        let settings = MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
        let dnd = CheckMenuItem::with_id(app, "dnd", "Do not disturb", true, get_bool(&data, "reminders.dnd"), None::<&str>)?;
        let paused = CheckMenuItem::with_id(app, "paused", "Pause reminders", true, get_bool(&data, "reminders.paused"), None::<&str>)?;
        let moving = movement_submenu(app, &data)?;
        let hide = MenuItem::with_id(app, "hide", "Hide pet", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
        let (a, b) = (PredefinedMenuItem::separator(app)?, PredefinedMenuItem::separator(app)?);
        Menu::with_items(app, &[&hi, &a, &settings, &dnd, &paused, &moving, &b, &hide, &quit])
    };
    if let Ok(menu) = build() {
        let _ = win.popup_menu(&menu);
    }
}

fn handle_menu(app: &AppHandle, id: &str) {
    let data = shared(app).lock().unwrap().store.data.clone();
    match id {
        "toggle" => {
            let v = shared(app).lock().unwrap().rt.pet_visible;
            set_pet_visible(app, !v);
        }
        "hide" => set_pet_visible(app, false),
        "settings" => open_settings(app, None),
        "dnd" => { patch_settings(app, &json!({ "reminders": { "dnd": !get_bool(&data, "reminders.dnd") } }), "menu", false); }
        "paused" => { patch_settings(app, &json!({ "reminders": { "paused": !get_bool(&data, "reminders.paused") } }), "menu", false); }
        "lock" => { patch_settings(app, &json!({ "movement": { "locked": !get_bool(&data, "movement.locked") } }), "menu", false); }
        "hi" => {
            let text = greeting_text(app);
            speak(app, format!("hi-{}", Local::now().timestamp_millis()), "greeting", text, 7.0, &[]);
        }
        "quit" => {
            shared(app).lock().unwrap().store.flush();
            app.exit(0);
        }
        other => {
            if let Some(mode) = other.strip_prefix("mode:") {
                patch_settings(app, &json!({ "movement": { "mode": mode } }), "menu", false);
            }
        }
    }
}

// ---- IPC ------------------------------------------------------------------------------------------------
fn arg(args: &[Value], i: usize) -> Value {
    args.get(i).cloned().unwrap_or(Value::Null)
}

#[tauri::command]
async fn ipc_invoke(app: AppHandle, window: WebviewWindow, channel: String, args: Vec<Value>) -> Result<Value, String> {
    let label = window.label().to_string();
    let is_settings = label == "settings";
    let core = shared(&app);
    match channel.as_str() {
        "app:get-state" => {
            let c = core.lock().unwrap();
            Ok(json!({ "settings": c.store.data, "runtime": runtime_json(&c) }))
        }
        "settings:patch" if is_settings => Ok(patch_settings(&app, &arg(&args, 0), "settings", false)),
        "settings:reset" if is_settings => {
            core.lock().unwrap().store.reset();
            patch_settings(&app, &json!({}), "reset", false);
            apply_login_item(&app);
            Ok(core.lock().unwrap().store.data.clone())
        }
        "settings:export" if is_settings => {
            let Some(path) = app.dialog().file().set_title("Export settings").set_file_name("mochi-settings.json").add_filter("JSON", &["json"]).set_parent(&window).blocking_save_file() else {
                return Ok(json!({ "ok": false }));
            };
            let mut out = core.lock().unwrap().store.data.clone();
            out["general"]["position"] = Value::Null;
            let path = path.into_path().map_err(|e| e.to_string())?;
            std::fs::write(&path, serde_json::to_string_pretty(&out).unwrap_or_default()).map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "path": path.to_string_lossy() }))
        }
        "settings:import" if is_settings => {
            let Some(path) = app.dialog().file().set_title("Import settings").add_filter("JSON", &["json"]).set_parent(&window).blocking_pick_file() else {
                return Ok(json!({ "ok": false }));
            };
            let path = path.into_path().map_err(|e| e.to_string())?;
            let parsed = std::fs::read_to_string(&path).map_err(|e| e.to_string()).and_then(|t| serde_json::from_str::<Value>(&t).map_err(|e| e.to_string()));
            match parsed {
                Ok(mut raw) if raw.is_object() => {
                    {
                        let mut c = core.lock().unwrap();
                        let (pos, last) = (get(&c.store.data, "general.position").clone(), get(&c.store.data, "general.lastGreetDate").clone());
                        raw["general"] = raw.get("general").cloned().unwrap_or_else(|| json!({}));
                        raw["general"]["position"] = pos;
                        raw["general"]["lastGreetDate"] = last;
                        c.store.replace(&raw);
                    }
                    patch_settings(&app, &json!({}), "import", false);
                    resize_pet(&app);
                    apply_login_item(&app);
                    Ok(json!({ "ok": true }))
                }
                Ok(_) => Ok(json!({ "ok": false, "error": "Not a settings file" })),
                Err(e) => Ok(json!({ "ok": false, "error": e })),
            }
        }
        "meetings:upcoming" if is_settings => {
            let mut c = core.lock().unwrap();
            let data = c.store.data.clone();
            Ok(c.engine.upcoming(&data, 6))
        }
        "meetings:pick-ics" if is_settings => {
            let Some(path) = app.dialog().file().set_title("Choose a calendar (.ics) file").add_filter("Calendar", &["ics"]).set_parent(&window).blocking_pick_file() else {
                return Ok(json!({ "ok": false }));
            };
            let path = path.into_path().map_err(|e| e.to_string())?;
            let Ok(text) = std::fs::read_to_string(&path) else { return Ok(json!({ "ok": false })) };
            let count = ics::parse_ics(&text).len();
            patch_settings(&app, &json!({ "meetings": { "icsPath": path.to_string_lossy() } }), "ics", false);
            let mut c = core.lock().unwrap();
            let data = c.store.data.clone();
            c.engine.refresh_ics(&data, true);
            Ok(json!({ "ok": true, "path": path.to_string_lossy(), "count": count }))
        }
        "meetings:clear-ics" if is_settings => {
            patch_settings(&app, &json!({ "meetings": { "icsPath": "" } }), "ics", false);
            let mut c = core.lock().unwrap();
            let data = c.store.data.clone();
            c.engine.refresh_ics(&data, true);
            Ok(json!({ "ok": true }))
        }
        "test:fire" if is_settings => {
            let ttl = get_f64(&core.lock().unwrap().store.data, "reminders.bubbleSeconds");
            match arg(&args, 0).as_str().unwrap_or("reminder") {
                "greeting" => {
                    let t = greeting_text(&app);
                    speak(&app, format!("test-{}", Local::now().timestamp_millis()), "greeting", t, 8.0, &[]);
                }
                "tease" => tease(&app, true),
                "meeting" => speak(&app, "meeting:test".into(), "meeting", "\u{1F4C5} Weekly sync starts in 10 min".into(), ttl, &["done", "snooze"]),
                _ => {
                    let text = get_str(get(&core.lock().unwrap().store.data, "reminders.items").get(0).unwrap_or(&Value::Null), "text").to_string();
                    let text = if text.is_empty() { "Time to drink some water!".to_string() } else { text };
                    speak(&app, "test-reminder".into(), "reminder", text, ttl, &["done", "snooze"]);
                }
            }
            Ok(Value::Null)
        }
        _ => Err(format!("blocked or unknown channel {channel} for window {label}")),
    }
}

#[tauri::command]
async fn ipc_send(app: AppHandle, window: WebviewWindow, channel: String, args: Vec<Value>) -> Result<(), String> {
    let label = window.label().to_string();
    let (is_pet, is_buddy, is_settings) = (label == "pet", label == "buddy", label == "settings");
    let core = shared(&app);
    match channel.as_str() {
        "pet:ready" if is_pet || is_buddy => {
            let rt = runtime_json(&core.lock().unwrap());
            let _ = window.emit("mochi:runtime:changed", rt);
            if is_pet {
                let a = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(700));
                    greet(&a);
                });
            }
        }
        "pet:emote" if is_pet => {
            let kind = arg(&args, 0).as_str().unwrap_or("").to_string();
            emit_buddy(&app, "pet:friend", json!({ "kind": kind }));
        }
        "pet:drag-start" if is_pet => {
            let mut c = core.lock().unwrap();
            // ignore a late message from a click that has already ended, or he would stick to the cursor
            if !c.dragging && platform::left_button_down() && !get_bool(&c.store.data, "movement.locked") {
                c.dragging = true;
                c.movement.begin_drag(platform::cursor());
            }
        }
        "pet:drag-end" if is_pet => {
            {
                let mut c = core.lock().unwrap();
                if !c.dragging {
                    return Ok(());
                }
                c.dragging = false;
                let (data, mons) = (c.store.data.clone(), c.mons.clone());
                c.movement.end_drag(&data, &mons);
            }
        }
        "pet:ignore-mouse" if is_pet || is_buddy => {
            // only the speech bubble is still decided by the page; the pet itself is decided in the frame loop
            if is_pet {
                core.lock().unwrap().bubble_hot = !arg(&args, 0).as_bool().unwrap_or(true);
            }
        }
        "pet:context-menu" if is_pet => show_pet_menu(&app),
        "pet:bubble-action" if is_pet => {
            let id = arg(&args, 0).get("id").and_then(Value::as_str).unwrap_or("").to_string();
            let action = arg(&args, 0).get("action").and_then(Value::as_str).unwrap_or("").to_string();
            let mut c = core.lock().unwrap();
            if let Some(p) = c.active_speech.remove(&id) {
                if action == "snooze" {
                    let mins = get_f64(&c.store.data, "reminders.snoozeMinutes") as i64;
                    c.engine.snooze(p, mins);
                }
            }
        }
        "app:open-settings" if is_pet || is_settings => open_settings(&app, arg(&args, 0).as_str()),
        "app:toggle" if is_pet || is_settings => {
            let key = if arg(&args, 0).as_str() == Some("dnd") { "dnd" } else { "paused" };
            let cur = get_bool(&core.lock().unwrap().store.data, &format!("reminders.{key}"));
            patch_settings(&app, &json!({ "reminders": { key: !cur } }), "toggle", false);
        }
        _ => return Err(format!("blocked or unknown channel {channel} for window {label}")),
    }
    Ok(())
}

// ---- the frame loop -------------------------------------------------------------------------------------------
type Sent = (f64, f64, f64, f64, bool);
const NO_FRAME: Sent = (f64::NAN, f64::NAN, f64::NAN, f64::NAN, false);

/// Other apps' windows, only needed for "sit on windows". Enumerating them takes a while, so it runs on
/// its own thread and never delays the frame loop (which must react instantly when you grab him).
fn spawn_window_scanner(app: AppHandle) {
    std::thread::spawn(move || {
        let core = shared(&app);
        loop {
            std::thread::sleep(Duration::from_millis(250));
            let wanted = get_str(&core.lock().unwrap().store.data, "movement.mode") == "windows";
            let wins = if wanted { platform::top_windows() } else { Vec::new() };
            let mut c = core.lock().unwrap();
            let min_len = 120.0 * c.movement.scale;
            c.segs = visible_top_edges(&wins, min_len);
            c.wins = wins;
        }
    });
}

/// Is the cursor on (or close to) a pet standing with its feet at (fx, fy)? Generous on purpose: being
/// slightly early or late with a click must never make you miss him.
fn near_body(cursor: (f64, f64), fx: f64, fy: f64, size: f64, scale: f64) -> bool {
    let pad = 44.0;
    (cursor.0 - fx).abs() <= (size * 0.62 + pad) * scale && cursor.1 >= fy - (size * 1.3 + pad) * scale && cursor.1 <= fy + pad * scale
}

fn spawn_loop(app: AppHandle) {
    platform::precise_timers();
    spawn_window_scanner(app.clone());
    std::thread::spawn(move || {
        let core = shared(&app);
        let mut last = Instant::now();
        let mut last_slow = Instant::now() - Duration::from_secs(10);
        let mut last_engine = Instant::now() - Duration::from_secs(10);
        let mut last_ign = (true, true);
        let mut last_frame = Instant::now();
        let (mut sent, mut sent_b) = (NO_FRAME, NO_FRAME);
        let (mut last_pos, mut last_pos_b) = ((i32::MIN, i32::MIN), (i32::MIN, i32::MIN));
        let mut moved_at: Option<Instant> = None;
        let trace = std::env::var_os("MOCHI_TRACE").is_some(); // dev only: logs movement to %TEMP%\mochi-trace.log
        let trace_start = Instant::now();

        loop {
            std::thread::sleep(Duration::from_millis(8));
            let now = Instant::now();
            let dt = now.duration_since(last).as_secs_f64().min(0.05);
            last = now;

            let Some(win) = app.get_webview_window("pet") else { continue };
            let buddy_win_handle = app.get_webview_window("buddy");

            // ~1 Hz: monitors, scale, idle/sleep, fullscreen, settings flush, position save, teasing
            if now.duration_since(last_slow) >= Duration::from_secs(1) {
                last_slow = now;
                let mons = query_monitors(&app);
                let scale = win.scale_factor().unwrap_or(1.0);
                let idle = platform::idle_seconds();
                let fs = platform::fullscreen_active();
                let mut wake_greet = false;
                let mut tease_now = false;
                let (changed, save_pos) = {
                    let mut c = core.lock().unwrap();
                    if !mons.is_empty() {
                        c.mons = mons;
                    }
                    if (c.movement.scale - scale).abs() > 0.001 {
                        let (x, y) = c.movement.window_pos();
                        c.movement.scale = scale;
                        c.buddy.scale = scale;
                        c.movement.set_window_pos(x as f64, y as f64);
                    }
                    let sleepy = idle >= get_f64(&c.store.data, "general.sleepAfterSec");
                    let mut changed = false;
                    if sleepy != c.rt.sleeping {
                        c.rt.sleeping = sleepy;
                        changed = true;
                        wake_greet = !sleepy && get_str(&c.store.data, "general.lastGreetDate") != today_key();
                    }
                    if fs != c.rt.fullscreen {
                        c.rt.fullscreen = fs;
                        changed = true;
                    }
                    if now >= c.next_tease {
                        c.next_tease = now + tease_gap(&c.store.data);
                        tease_now = !c.rt.sleeping;
                    }
                    c.store.flush();
                    let save = moved_at.map_or(false, |t| now.duration_since(t) > Duration::from_millis(1500));
                    (changed, if save { Some(c.movement.window_pos()) } else { None })
                };
                if changed {
                    apply_visibility(&app);
                    broadcast_settings(&app, "runtime");
                }
                if wake_greet {
                    let a = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(900));
                        greet(&a);
                    });
                }
                if tease_now {
                    tease(&app, true);
                }
                if let Some(p) = save_pos {
                    moved_at = None;
                    patch_settings(&app, &json!({ "general": { "position": { "x": p.0, "y": p.1 } } }), "position", true);
                }
            }

            // reminders / meetings every 5 s
            if now.duration_since(last_engine) >= Duration::from_secs(5) {
                last_engine = now;
                let payloads = {
                    let mut c = core.lock().unwrap();
                    let data = c.store.data.clone();
                    let blocked = c.rt.fullscreen && get_str(&data, "movement.fullscreen") == "hide";
                    c.engine.tick(&data, blocked)
                };
                for p in payloads {
                    deliver(&app, p);
                }
            }

            // movement
            let cursor = platform::cursor();
            let button = platform::left_button_down();
            let (pos, frame, landed, buddy_out, ignores) = {
                let mut guard = core.lock().unwrap();
                let c = &mut *guard;
                let shown = c.rt.pet_visible && !(c.rt.fullscreen && get_str(&c.store.data, "movement.fullscreen") == "hide");
                if !shown {
                    continue;
                }
                // letting go of the mouse button always ends the drag, whatever messages arrive or not
                if c.dragging && !button {
                    c.dragging = false;
                    let (d, m) = (c.store.data.clone(), c.mons.clone());
                    c.movement.end_drag(&d, &m);
                }
                let data = &c.store.data;
                let perch_rect = c.movement.perch_hwnd().and_then(platform::window_rect);
                let world = World { segs: &c.segs, perch_rect };
                if c.dragging {
                    c.movement.drag_to(cursor, dt);
                } else {
                    c.movement.update(dt, data, &c.mons, cursor, c.rt.sleeping, &world);
                }
                let landed = c.movement.consume_landing();
                let pos = c.movement.window_pos();
                let s = c.movement.scale;
                let frame: Sent = (
                    (cursor.0 - pos.0 as f64) / s,
                    (cursor.1 - pos.1 as f64) / s,
                    c.movement.vx / s,
                    c.movement.vy / s,
                    c.movement.peeking,
                );
                let walking = c.movement.state == MoveState::Walk && !get_bool(data, "movement.locked");

                // the buddy trails the leader
                let mut buddy_out = None;
                if buddy_win_handle.is_some() {
                    let side = if get_str(data, "buddy.side") == "left" { -1.0 } else { 1.0 };
                    let gap = get_f64(data, "general.size") * 0.9 * s;
                    let speed = get_f64(data, "movement.speed");
                    let leader = (c.movement.fx, c.movement.fy);
                    c.buddy.scale = s;
                    c.buddy.follow_leader(dt, speed, leader, side, gap, c.rt.sleeping);
                    let bp = c.buddy.window_pos();
                    let bf: Sent = ((cursor.0 - bp.0 as f64) / s, (cursor.1 - bp.1 as f64) / s, c.buddy.vx / s, c.buddy.vy / s, c.movement.peeking);
                    buddy_out = Some((bp, bf, c.buddy.state == MoveState::Walk));
                }
                let size = get_f64(&c.store.data, "general.size");
                let ignore_main = !(c.dragging || c.bubble_hot || near_body(cursor, c.movement.fx, c.movement.fy, size, s));
                let ignore_buddy = !near_body(cursor, c.buddy.fx, c.buddy.fy, buddy_px(&c.store.data), s);
                (pos, (frame, walking, c.dragging), landed, buddy_out, (ignore_main, ignore_buddy))
            };

            // click-through is switched here, straight from the cursor position: no round trip through the page
            if ignores.0 != last_ign.0 {
                last_ign.0 = ignores.0;
                let _ = win.set_ignore_cursor_events(ignores.0);
            }
            if let Some(bw) = &buddy_win_handle {
                if ignores.1 != last_ign.1 {
                    last_ign.1 = ignores.1;
                    let _ = bw.set_ignore_cursor_events(ignores.1);
                }
            } else {
                last_ign.1 = true;
            }

            if trace {
                use std::io::Write;
                let c = core.lock().unwrap();
                let m = &c.movement;
                if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(std::env::temp_dir().join("mochi-trace.log")) {
                    let _ = writeln!(f, "{:.2} feet=({:.0},{:.0}) v=({:.0},{:.0}) state={:?} perch={:?} riding={} mons={}", now.duration_since(trace_start).as_secs_f64(), m.fx, m.fy, m.vx, m.vy, m.state, m.perch_hwnd(), m.riding, c.mons.len());
                }
            }
            if pos != last_pos {
                last_pos = pos;
                moved_at = Some(now);
                let _ = win.set_position(PhysicalPosition::new(pos.0, pos.1));
            }
            if landed > 0.0 {
                emit_pet(&app, "pet:landed", json!({ "impact": landed }));
            }
            let (f, walking, dragging) = frame;
            if f != sent || now.duration_since(last_frame) > Duration::from_millis(250) {
                sent = f;
                last_frame = now;
                emit_pet(&app, "pet:frame", json!({ "cx": f.0, "cy": f.1, "vx": f.2, "vy": f.3, "walking": walking, "dragging": dragging, "peek": f.4 }));
            }
            if let (Some(bw), Some((bp, bf, bwalk))) = (&buddy_win_handle, buddy_out) {
                if bp != last_pos_b {
                    last_pos_b = bp;
                    let _ = bw.set_position(PhysicalPosition::new(bp.0, bp.1));
                }
                if bf != sent_b || now.duration_since(last_frame) > Duration::from_millis(250) {
                    sent_b = bf;
                    emit_buddy(&app, "pet:frame", json!({ "cx": bf.0, "cy": bf.1, "vx": bf.2, "vy": bf.3, "walking": bwalk, "dragging": false, "peek": bf.4 }));
                }
            } else {
                last_pos_b = (i32::MIN, i32::MIN);
            }
        }
    });
}

// ---- entry ------------------------------------------------------------------------------------------------------
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            set_pet_visible(app, true);
            open_settings(app, None);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .invoke_handler(tauri::generate_handler![ipc_invoke, ipc_send])
        .on_menu_event(|app, event| handle_menu(app, event.id().as_ref()))
        .setup(|app| {
            let handle = app.handle().clone();
            let dir = app.path().app_data_dir()?;
            let store = Store::load(dir);
            let core: Shared = Arc::new(Mutex::new(Core {
                store,
                rt: Runtime { sleeping: false, fullscreen: false, pet_visible: true },
                movement: Movement::new(),
                engine: Engine::default(),
                mons: query_monitors(&handle),
                dragging: false,
                bubble_hot: false,
                active_speech: HashMap::new(),
                last_greeting: String::new(),
                buddy: Movement::new(),
                wins: Vec::new(),
                segs: Vec::new(),
                next_tease: Instant::now() + Duration::from_secs(600),
            }));
            app.manage(core);

            create_pet_window(&handle)?;
            sync_buddy(&handle);

            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;
            TrayIconBuilder::with_id("main")
                .icon(tray_icon)
                .tooltip("Mochi")
                .menu(&build_tray_menu(&handle)?)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } => {
                        let app = tray.app_handle();
                        let v = shared(app).lock().unwrap().rt.pet_visible;
                        set_pet_visible(app, !v);
                    }
                    TrayIconEvent::DoubleClick { .. } => open_settings(tray.app_handle(), None),
                    _ => {}
                })
                .build(app)?;

            if std::env::args().any(|a| a == "--settings") {
                open_settings(&handle, None);
            }
            spawn_loop(handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Mochi")
        .run(|app, event| {
            match event {
                // The tray keeps the app alive when the settings window is closed.
                tauri::RunEvent::ExitRequested { api, code, .. } if code.is_none() => api.prevent_exit(),
                tauri::RunEvent::Exit => shared(app).lock().unwrap().store.flush(),
                _ => {}
            }
        });
}
