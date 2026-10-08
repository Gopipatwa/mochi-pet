//! Settings: defaults are embedded JSON (defaults.json); every load and patch is merged onto them and
//! clamped, so a hand-edited or imported file can never put the app in a bad state.

use serde_json::{json, Map, Value};
use std::fs;
use std::path::PathBuf;

const DEFAULTS: &str = include_str!("defaults.json");

pub fn defaults() -> Value {
    serde_json::from_str(DEFAULTS).expect("defaults.json is valid")
}

fn range(path: &str) -> Option<(f64, f64)> {
    Some(match path {
        "general.size" => (70.0, 280.0),
        "general.volume" => (0.0, 1.0),
        "general.sleepAfterSec" => (10.0, 3600.0),
        "look.rainbowSeconds" => (10.0, 600.0),
        "look.smoothness" => (0.0, 1.0),
        "look.jelly" => (0.0, 1.0),
        "buddy.scale" => (0.35, 0.9),
        "movement.speed" => (10.0, 500.0),
        "movement.frequency" => (2.0, 300.0),
        "reminders.snoozeMinutes" => (1.0, 240.0),
        "reminders.bubbleSeconds" => (5.0, 300.0),
        _ => return None,
    })
}

fn enum_values(path: &str) -> Option<&'static [&'static str]> {
    Some(match path {
        "look.shape" => &["blob", "slime", "circle", "heart", "triangle", "star", "square", "cloud", "drop", "ghost", "cat", "bear", "bunny"],
        "look.eyes" => &["classic", "sparkly", "sleepy", "googly"],
        "look.happyEyes" => &["arcs", "stars", "hearts"],
        "buddy.shape" => &["blob", "slime", "circle", "heart", "triangle", "star", "square", "cloud", "drop", "ghost", "cat", "bear", "bunny"],
        "buddy.style" => &["neutral", "male", "female"],
        "buddy.side" => &["left", "right"],
        "teasing.level" => &["mild", "cheeky"],
        "look.style" => &["neutral", "male", "female"],
        "look.colorMode" => &["fixed", "picker", "rainbow", "mood", "time", "season"],
        "movement.mode" => &["still", "wander", "taskbar", "windows", "follow", "corner"],
        "movement.area" => &["all", "primary", "current"],
        "movement.corner" => &["topLeft", "topRight", "bottomLeft", "bottomRight"],
        "movement.fullscreen" => &["hide", "ignore"],
        "theme.id" => &["light", "dark", "pastel", "neon", "retro", "auto"],
        "seasonal.mode" => &["auto", "off", "winter", "spring", "summer", "autumn", "halloween", "christmas", "newyear", "valentine", "easter"],
        "seasonal.hemisphere" => &["north", "south"],
        _ => return None,
    })
}

fn is_hex(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

fn is_hhmm(s: &str) -> bool {
    let b = s.as_bytes();
    s.len() == 5
        && b[2] == b':'
        && s[..2].parse::<u32>().map_or(false, |h| h < 24)
        && s[3..].parse::<u32>().map_or(false, |m| m < 60)
}

fn num(f: f64) -> Value {
    if f.fract() == 0.0 && f.abs() < 1e15 {
        json!(f as i64)
    } else {
        json!(f)
    }
}

fn trunc(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}{:x}{:x}", chrono::Local::now().timestamp_millis(), fastrand::u16(..))
}

fn sanitize_reminder(r: &Value) -> Option<Value> {
    let o = r.as_object()?;
    let mut days: Vec<i64> = o
        .get("days")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_i64).filter(|d| (0..=6).contains(d)).collect())
        .unwrap_or_else(|| (0..=6).collect());
    days.sort_unstable();
    days.dedup();
    let times: Vec<Value> = o
        .get("times")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).filter(|t| is_hhmm(t)).take(24).map(|t| json!(t)).collect())
        .unwrap_or_default();
    let id = o.get("id").and_then(Value::as_str).filter(|s| !s.is_empty()).map(|s| trunc(s, 40)).unwrap_or_else(|| new_id("c"));
    Some(json!({
        "id": id,
        "builtin": o.get("builtin").and_then(Value::as_bool).unwrap_or(false),
        "enabled": o.get("enabled").and_then(Value::as_bool).unwrap_or(true),
        "text": trunc(o.get("text").and_then(Value::as_str).unwrap_or("Reminder"), 400),
        "type": if o.get("type").and_then(Value::as_str) == Some("times") { "times" } else { "interval" },
        "everyMin": o.get("everyMin").and_then(Value::as_f64).unwrap_or(60.0).clamp(1.0, 1440.0).round(),
        "times": times,
        "days": days,
    }))
}

fn sanitize_meeting(m: &Value) -> Option<Value> {
    let o = m.as_object()?;
    let start = o.get("start")?.as_str()?;
    if chrono::NaiveDateTime::parse_from_str(start, "%Y-%m-%dT%H:%M").is_err() {
        return None;
    }
    let repeat = o.get("repeat").and_then(Value::as_str).filter(|r| ["none", "daily", "weekdays", "weekly"].contains(r)).unwrap_or("none");
    let id = o.get("id").and_then(Value::as_str).filter(|s| !s.is_empty()).map(|s| trunc(s, 40)).unwrap_or_else(|| new_id("m"));
    Some(json!({
        "id": id,
        "title": trunc(o.get("title").and_then(Value::as_str).unwrap_or("Meeting"), 120),
        "start": start,
        "repeat": repeat,
    }))
}

/// Merge `input` onto `base` following base's shape, clamping/validating leaf values.
pub fn merge(base: &Value, input: Option<&Value>, trail: &str) -> Value {
    match base {
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, d) in map {
                let p = if trail.is_empty() { key.clone() } else { format!("{trail}.{key}") };
                let v = input.and_then(Value::as_object).and_then(|o| o.get(key));
                out.insert(key.clone(), merge_leaf(key, d, v, &p));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

fn merge_leaf(key: &str, d: &Value, v: Option<&Value>, p: &str) -> Value {
    if d.is_object() {
        return merge(d, v, p);
    }
    match (p, d) {
        ("reminders.items", _) => {
            let list: Vec<Value> = match v.and_then(Value::as_array) {
                Some(a) => a.iter().filter_map(sanitize_reminder).collect(),
                None => d.as_array().cloned().unwrap_or_default(),
            };
            return Value::Array(list.into_iter().take(60).collect());
        }
        ("meetings.items", _) => {
            let list: Vec<Value> = match v.and_then(Value::as_array) {
                Some(a) => a.iter().filter_map(sanitize_meeting).collect(),
                None => d.as_array().cloned().unwrap_or_default(),
            };
            return Value::Array(list.into_iter().take(200).collect());
        }
        ("meetings.leadMinutes", _) => {
            let src = v.and_then(Value::as_array).or_else(|| d.as_array()).cloned().unwrap_or_default();
            let mut out: Vec<f64> = src.iter().filter_map(Value::as_f64).filter(|n| (0.0..=240.0).contains(n)).collect();
            out.dedup();
            return Value::Array(out.into_iter().take(5).map(num).collect());
        }
        ("general.position", _) => {
            if let Some(o) = v.and_then(Value::as_object) {
                if let (Some(x), Some(y)) = (o.get("x").and_then(Value::as_f64), o.get("y").and_then(Value::as_f64)) {
                    return json!({ "x": x.round() as i64, "y": y.round() as i64 });
                }
            }
            return Value::Null;
        }
        _ => {}
    }
    if (p.starts_with("greetings.") && ["morning", "afternoon", "evening", "night"].contains(&key)) || p == "teasing.lines" {
        let src = v.and_then(Value::as_array).or_else(|| d.as_array()).cloned().unwrap_or_default();
        let list: Vec<Value> = src.iter().filter_map(Value::as_str).filter(|s| !s.trim().is_empty()).take(40).map(|s| json!(trunc(s, 200))).collect();
        return if list.is_empty() { d.clone() } else { Value::Array(list) };
    }
    match d {
        Value::Number(_) => {
            let (lo, hi) = range(p).unwrap_or((f64::NEG_INFINITY, f64::INFINITY));
            match v.and_then(Value::as_f64) {
                Some(n) if n.is_finite() => num(n.clamp(lo, hi)),
                _ => d.clone(),
            }
        }
        Value::Bool(_) => v.and_then(Value::as_bool).map(Value::Bool).unwrap_or_else(|| d.clone()),
        Value::String(ds) => {
            let mut s = v.and_then(Value::as_str).unwrap_or(ds).to_string();
            if let Some(allowed) = enum_values(p) {
                if !allowed.contains(&s.as_str()) {
                    s = ds.clone();
                }
            }
            if key.to_lowercase().ends_with("color") && !is_hex(&s) {
                s = ds.clone();
            }
            if (key == "activeStart" || key == "activeEnd") && !is_hhmm(&s) {
                s = ds.clone();
            }
            Value::String(trunc(&s, 600))
        }
        _ => d.clone(),
    }
}

/// Deep-assign `src` into `target`; arrays and scalars replace.
pub fn deep_assign(target: &mut Value, src: &Value) {
    if let (Value::Object(t), Value::Object(s)) = (&mut *target, src) {
        for (k, v) in s {
            if k == "__proto__" || k == "constructor" || k == "prototype" {
                continue;
            }
            match t.get_mut(k) {
                Some(existing) if existing.is_object() && v.is_object() => deep_assign(existing, v),
                _ => {
                    t.insert(k.clone(), v.clone());
                }
            }
        }
    }
}

/// Dotted-path lookup: `get(&v, "movement.mode")`.
pub fn get<'a>(v: &'a Value, path: &str) -> &'a Value {
    let mut cur = v;
    for part in path.split('.') {
        cur = cur.get(part).unwrap_or(&Value::Null);
    }
    cur
}

pub fn get_str<'a>(v: &'a Value, path: &str) -> &'a str {
    get(v, path).as_str().unwrap_or("")
}
pub fn get_f64(v: &Value, path: &str) -> f64 {
    get(v, path).as_f64().unwrap_or(0.0)
}
pub fn get_bool(v: &Value, path: &str) -> bool {
    get(v, path).as_bool().unwrap_or(false)
}

pub struct Store {
    pub path: PathBuf,
    pub data: Value,
    dirty: bool,
}

impl Store {
    pub fn load(dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("settings.json");
        let data = fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .map(|v| merge(&defaults(), Some(&v), ""))
            .unwrap_or_else(defaults);
        let mut store = Store { path, data, dirty: false };
        store.drop_dodge_lines();
        store
    }

    /// Earlier versions teased by dodging the cursor ("Missed me!"). That is gone, so remove those lines
    /// from settings that were saved back then.
    fn drop_dodge_lines(&mut self) {
        const OLD: [&str; 4] = ["Too slow!", "You can't catch me!", "Missed me!", "Nice try, human."];
        let kept: Vec<Value> = get(&self.data, "teasing.lines").as_array().into_iter().flatten().filter(|l| !l.as_str().map_or(false, |t| OLD.contains(&t))).cloned().collect();
        let before = get(&self.data, "teasing.lines").as_array().map_or(0, Vec::len);
        if kept.len() != before && !kept.is_empty() {
            self.data["teasing"]["lines"] = Value::Array(kept);
            self.dirty = true;
        }
    }

    pub fn patch(&mut self, partial: &Value) {
        let mut combined = self.data.clone();
        deep_assign(&mut combined, partial);
        self.data = merge(&defaults(), Some(&combined), "");
        self.dirty = true;
    }

    pub fn replace(&mut self, full: &Value) {
        self.data = merge(&defaults(), Some(full), "");
        self.dirty = true;
    }

    pub fn reset(&mut self) {
        let keep = get(&self.data, "general.lastGreetDate").clone();
        self.data = defaults();
        self.data["general"]["lastGreetDate"] = keep;
        self.dirty = true;
    }

    /// Atomic write (temp file + rename). Called on a timer and on quit.
    pub fn flush(&mut self) {
        if !self.dirty {
            return;
        }
        self.dirty = false;
        let tmp = self.path.with_extension("json.tmp");
        if let Ok(text) = serde_json::to_string_pretty(&self.data) {
            if fs::write(&tmp, text).is_ok() {
                let _ = fs::rename(&tmp, &self.path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_numbers_and_rejects_bad_enums_and_colors() {
        let mut s = Store { path: std::env::temp_dir().join("mochi-test-settings.json"), data: defaults(), dirty: false };
        s.patch(&json!({ "general": { "size": 9999 }, "look": { "shape": "banana", "style": "robot", "fixedColor": "red" }, "movement": { "mode": "teleport" } }));
        assert_eq!(get_f64(&s.data, "general.size"), 280.0);
        assert_eq!(get_str(&s.data, "look.shape"), "blob");
        assert_eq!(get_str(&s.data, "look.style"), "neutral");
        assert_eq!(get_str(&s.data, "look.fixedColor"), "#f5a33a");
        assert_eq!(get_str(&s.data, "movement.mode"), "wander");
    }

    #[test]
    fn old_dodge_lines_are_removed_from_saved_settings() {
        let dir = std::env::temp_dir().join("mochi-test-migrate");
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(dir.join("settings.json"), r#"{"teasing":{"lines":["Missed me!","Bleh!","You can't catch me!","Hehe, boop!"]}}"#).unwrap();
        let s = Store::load(dir);
        assert_eq!(get(&s.data, "teasing.lines"), &json!(["Bleh!", "Hehe, boop!"]));
    }

    #[test]
    fn accepts_valid_values_and_sanitizes_lists() {
        let mut s = Store { path: std::env::temp_dir().join("mochi-test-settings.json"), data: defaults(), dirty: false };
        s.patch(&json!({
            "look": { "shape": "heart", "style": "female" },
            "reminders": { "items": [{ "text": "Stretch", "type": "times", "times": ["09:30", "99:99"], "days": [1, 9] }, "junk"] },
            "meetings": { "leadMinutes": [10, 2, 999] }
        }));
        assert_eq!(get_str(&s.data, "look.shape"), "heart");
        let items = get(&s.data, "reminders.items").as_array().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["times"], json!(["09:30"]));
        assert_eq!(items[0]["days"], json!([1]));
        assert_eq!(get(&s.data, "meetings.leadMinutes"), &json!([10, 2]));
    }
}
