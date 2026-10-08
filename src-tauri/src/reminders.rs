//! Decides *when* something should be said. Never touches the UI: `tick` returns payloads.

use crate::ics::{self, Event};
use crate::settings::{get, get_bool, get_f64, get_str};
use chrono::{Datelike, Local, Timelike};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

const MIN: i64 = 60_000;

#[derive(Clone, Debug)]
pub struct Payload {
    pub id: String,
    pub kind: &'static str, // reminder | meeting
    pub text: String,
    pub ttl: f64,
}

struct Snoozed {
    due: i64,
    payload: Payload,
}

#[derive(Default)]
pub struct Engine {
    next_due: HashMap<String, (i64, i64)>, // id -> (due ms, signature)
    fired: HashSet<String>,
    snoozed: Vec<Snoozed>,
    ics_events: Vec<Event>,
    ics_loaded_at: i64,
}

fn hhmm_to_min(s: &str) -> i64 {
    let mut p = s.split(':').map(|x| x.parse::<i64>().unwrap_or(0));
    p.next().unwrap_or(0) * 60 + p.next().unwrap_or(0)
}

impl Engine {
    fn in_active_hours(r: &Value, cur_min: i64) -> bool {
        let a = hhmm_to_min(get_str(r, "activeStart"));
        let b = hhmm_to_min(get_str(r, "activeEnd"));
        if a <= b { cur_min >= a && cur_min <= b } else { cur_min >= a || cur_min <= b }
    }

    /// Runs every few seconds. `blocked` = a fullscreen app is up, so everything waits.
    pub fn tick(&mut self, settings: &Value, blocked: bool) -> Vec<Payload> {
        let r = get(settings, "reminders");
        let now = Local::now();
        let now_ms = now.timestamp_millis();
        let mut out = Vec::new();
        self.refresh_ics(settings, false);

        if !blocked {
            let mut i = 0;
            while i < self.snoozed.len() {
                if self.snoozed[i].due <= now_ms {
                    out.push(self.snoozed.remove(i).payload);
                } else {
                    i += 1;
                }
            }
        }
        if self.fired.len() > 500 {
            self.fired.clear();
        }

        if !get_bool(r, "paused") && !blocked {
            let cur_min = (now.hour() * 60 + now.minute()) as i64;
            if Self::in_active_hours(r, cur_min) {
                self.tick_reminders(r, &now, now_ms, &mut out);
            } else {
                self.reset_intervals(r, now_ms);
            }
            self.tick_meetings(get(settings, "meetings"), now_ms, r, &mut out);
        }
        if get_bool(r, "dnd") {
            out.clear();
        }
        out
    }

    fn reset_intervals(&mut self, r: &Value, now_ms: i64) {
        for item in get(r, "items").as_array().into_iter().flatten() {
            if get_str(item, "type") == "interval" {
                let every = get_f64(item, "everyMin") as i64;
                self.next_due.insert(get_str(item, "id").to_string(), (now_ms + every * MIN, every));
            }
        }
    }

    fn tick_reminders(&mut self, r: &Value, now: &chrono::DateTime<Local>, now_ms: i64, out: &mut Vec<Payload>) {
        let ttl = get_f64(r, "bubbleSeconds");
        let mut known = HashSet::new();
        for item in get(r, "items").as_array().into_iter().flatten() {
            let id = get_str(item, "id").to_string();
            known.insert(id.clone());
            if !get_bool(item, "enabled") {
                self.next_due.remove(&id);
                continue;
            }
            let dow = now.weekday().num_days_from_sunday() as i64;
            if !get(item, "days").as_array().map_or(false, |d| d.iter().any(|x| x.as_i64() == Some(dow))) {
                continue;
            }
            let text = get_str(item, "text").to_string();
            if get_str(item, "type") == "interval" {
                let every = get_f64(item, "everyMin") as i64;
                let st = self.next_due.entry(id.clone()).or_insert((now_ms + every * MIN, every));
                if st.1 != every {
                    *st = (now_ms + every * MIN, every);
                }
                if now_ms >= st.0 {
                    st.0 = now_ms + every * MIN;
                    out.push(Payload { id, kind: "reminder", text, ttl });
                }
            } else {
                let cur = (now.hour() * 60 + now.minute()) as i64;
                for t in get(item, "times").as_array().into_iter().flatten().filter_map(Value::as_str) {
                    let at = hhmm_to_min(t);
                    let key = format!("{id}|{}|{t}", now.format("%Y-%m-%d"));
                    // 15 minute grace so a reminder held back by a fullscreen app still shows afterwards.
                    if cur >= at && cur < at + 15 && !self.fired.contains(&key) {
                        self.fired.insert(key);
                        out.push(Payload { id: id.clone(), kind: "reminder", text: text.clone(), ttl });
                    }
                }
            }
        }
        self.next_due.retain(|k, _| known.contains(k));
    }

    fn all_events(&self, m: &Value) -> Vec<Event> {
        let mut v: Vec<Event> = get(m, "items").as_array().into_iter().flatten().filter_map(ics::from_manual).collect();
        v.extend(self.ics_events.iter().cloned());
        v
    }

    fn tick_meetings(&mut self, m: &Value, now_ms: i64, r: &Value, out: &mut Vec<Payload>) {
        if !get_bool(m, "enabled") {
            return;
        }
        let ttl = get_f64(r, "bubbleSeconds");
        let mut leads: Vec<i64> = get(m, "leadMinutes").as_array().into_iter().flatten().filter_map(Value::as_i64).collect();
        leads.sort_unstable();
        let max_lead = leads.iter().copied().max().unwrap_or(0);
        let also_start = get_bool(m, "alsoAtStart");
        for ev in self.all_events(m) {
            for occ in ics::occurrences(&ev, now_ms - 2 * MIN, now_ms + (max_lead + 1) * MIN) {
                // If we woke up late and several leads are already due, only say the most relevant one.
                let due: Vec<i64> = leads.iter().copied().filter(|&l| l > 0 && now_ms >= occ - l * MIN && now_ms < occ).collect();
                let mut any_fresh = false;
                for l in &due {
                    if self.fired.insert(format!("{}|{occ}|{l}", ev.id)) {
                        any_fresh = true;
                    }
                }
                if any_fresh {
                    let mins = ((occ - now_ms) as f64 / MIN as f64).ceil().max(1.0) as i64;
                    out.push(Payload { id: format!("meeting:{}", ev.id), kind: "meeting", text: format!("\u{1F4C5} {} starts in {mins} min", ev.title), ttl });
                }
                if also_start && now_ms >= occ && now_ms < occ + 2 * MIN && self.fired.insert(format!("{}|{occ}|0", ev.id)) {
                    out.push(Payload { id: format!("meeting:{}", ev.id), kind: "meeting", text: format!("\u{1F4C5} {} is starting now!", ev.title), ttl });
                }
            }
        }
    }

    pub fn snooze(&mut self, payload: Payload, minutes: i64) {
        self.snoozed.push(Snoozed { due: Local::now().timestamp_millis() + minutes * MIN, payload });
    }

    pub fn upcoming(&mut self, settings: &Value, limit: usize) -> Value {
        let m = get(settings, "meetings");
        let now = Local::now().timestamp_millis();
        let mut rows: Vec<(i64, String, &str)> = Vec::new();
        for ev in self.all_events(m) {
            let src = if ev.id.starts_with("ics") { "calendar" } else { "manual" };
            for t in ics::occurrences(&ev, now - 5 * MIN, now + 14 * 86_400_000) {
                rows.push((t, ev.title.clone(), src));
            }
        }
        rows.sort_by_key(|r| r.0);
        Value::Array(rows.into_iter().take(limit).map(|(at, title, source)| json!({ "title": title, "at": at, "source": source })).collect())
    }

    /// Re-read the linked calendar file (every 5 minutes unless forced). Returns the event count.
    pub fn refresh_ics(&mut self, settings: &Value, force: bool) -> usize {
        let p = get_str(settings, "meetings.icsPath");
        if p.is_empty() {
            self.ics_events.clear();
            return 0;
        }
        let now = Local::now().timestamp_millis();
        if !force && now - self.ics_loaded_at < 5 * MIN {
            return self.ics_events.len();
        }
        self.ics_loaded_at = now;
        self.ics_events = std::fs::read_to_string(p).map(|t| ics::parse_ics(&t)).unwrap_or_default();
        self.ics_events.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::defaults;
    use chrono::Duration;

    fn settings_with_meeting_in(minutes: i64) -> Value {
        let mut s = defaults();
        s["reminders"]["activeStart"] = json!("00:00");
        s["reminders"]["activeEnd"] = json!("23:59");
        s["reminders"]["items"] = json!([]);
        let start = (Local::now() + Duration::minutes(minutes)).format("%Y-%m-%dT%H:%M").to_string();
        s["meetings"]["items"] = json!([{ "id": "a", "title": "Standup", "start": start, "repeat": "none" }]);
        s
    }

    #[test]
    fn meeting_nudge_fires_once() {
        let s = settings_with_meeting_in(9);
        let mut e = Engine::default();
        let first = e.tick(&s, false);
        assert_eq!(first.len(), 1);
        assert!(first[0].text.contains("Standup"));
        assert!(e.tick(&s, false).is_empty(), "must not repeat on the next tick");
    }

    #[test]
    fn meeting_far_away_does_not_fire() {
        let mut e = Engine::default();
        assert!(e.tick(&settings_with_meeting_in(45), false).is_empty());
    }

    #[test]
    fn fullscreen_holds_reminders_until_it_ends() {
        let s = settings_with_meeting_in(9);
        let mut e = Engine::default();
        assert!(e.tick(&s, true).is_empty());
        assert_eq!(e.tick(&s, false).len(), 1);
    }

    #[test]
    fn do_not_disturb_and_pause_silence_everything() {
        let mut s = settings_with_meeting_in(9);
        s["reminders"]["dnd"] = json!(true);
        assert!(Engine::default().tick(&s, false).is_empty());
        s["reminders"]["dnd"] = json!(false);
        s["reminders"]["paused"] = json!(true);
        assert!(Engine::default().tick(&s, false).is_empty());
    }

    #[test]
    fn snoozed_reminder_comes_back() {
        let mut s = defaults();
        s["reminders"]["items"] = json!([]);
        let mut e = Engine::default();
        e.snooze(Payload { id: "water".into(), kind: "reminder", text: "Drink".into(), ttl: 30.0 }, 0);
        let out = e.tick(&s, false);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].text, "Drink");
    }
}
