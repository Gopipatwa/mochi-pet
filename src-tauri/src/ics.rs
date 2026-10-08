//! Offline calendar layer: manual meetings and imported .ics files both become `Event`s.

use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, NaiveDateTime, TimeZone, Timelike, Utc};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Clone, Debug)]
pub struct Event {
    pub id: String,
    pub title: String,
    pub start: NaiveDateTime, // local wall-clock time
    pub freq: String,         // none | daily | weekdays | weekly
    pub byday: Vec<u32>,      // 0 = Sunday
    pub interval: i64,
    pub until: Option<NaiveDateTime>,
    pub ex: HashSet<NaiveDate>,
}

pub fn from_manual(m: &Value) -> Option<Event> {
    let start = NaiveDateTime::parse_from_str(m.get("start")?.as_str()?, "%Y-%m-%dT%H:%M").ok()?;
    Some(Event {
        id: m.get("id")?.as_str()?.to_string(),
        title: m.get("title")?.as_str()?.to_string(),
        start,
        freq: m.get("repeat").and_then(Value::as_str).unwrap_or("none").to_string(),
        byday: vec![],
        interval: 1,
        until: None,
        ex: HashSet::new(),
    })
}

fn parse_date(value: &str, params: &str) -> Option<NaiveDateTime> {
    if params.contains("VALUE=DATE") && !value.contains('T') {
        return None; // all-day events have no time to remind about
    }
    let z = value.ends_with('Z');
    let v = value.trim_end_matches('Z');
    let fmt = if v.len() == 13 { "%Y%m%dT%H%M" } else { "%Y%m%dT%H%M%S" };
    let n = NaiveDateTime::parse_from_str(v, fmt).ok()?;
    if z {
        Some(Utc.from_utc_datetime(&n).with_timezone(&Local).naive_local())
    } else {
        Some(n)
    }
}

fn unescape(s: &str) -> String {
    s.replace("\\n", " ").replace("\\N", " ").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\").trim().to_string()
}

fn byday(code: &str) -> Option<u32> {
    Some(match &code[code.len().saturating_sub(2)..] {
        "SU" => 0,
        "MO" => 1,
        "TU" => 2,
        "WE" => 3,
        "TH" => 4,
        "FR" => 5,
        "SA" => 6,
        _ => return None,
    })
}

pub fn parse_ics(text: &str) -> Vec<Event> {
    let unfolded = text.replace("\r\n", "\n").replace('\r', "\n").replace("\n ", "").replace("\n\t", "");
    let mut events = Vec::new();
    let mut cur: Option<Event> = None;
    let mut have_start = false;
    for raw in unfolded.lines() {
        let line = raw.trim();
        if line == "BEGIN:VEVENT" {
            cur = Some(Event { id: String::new(), title: "Meeting".into(), start: NaiveDateTime::default(), freq: "none".into(), byday: vec![], interval: 1, until: None, ex: HashSet::new() });
            have_start = false;
            continue;
        }
        if line == "END:VEVENT" {
            if let Some(mut e) = cur.take() {
                if have_start {
                    e.id = format!("ics{}", events.len());
                    events.push(e);
                }
            }
            continue;
        }
        let Some(e) = cur.as_mut() else { continue };
        let Some(idx) = line.find(':') else { continue };
        let (head, value) = (&line[..idx], &line[idx + 1..]);
        let mut parts = head.split(';');
        let name = parts.next().unwrap_or("").to_uppercase();
        let params: String = parts.collect::<Vec<_>>().join(";");
        match name.as_str() {
            "SUMMARY" => {
                let t = unescape(value);
                e.title = if t.is_empty() { "Meeting".into() } else { t };
            }
            "DTSTART" => {
                if let Some(d) = parse_date(value, &params) {
                    e.start = d;
                    have_start = true;
                }
            }
            "EXDATE" => {
                for v in value.split(',') {
                    if let Some(d) = parse_date(v, &params) {
                        e.ex.insert(d.date());
                    }
                }
            }
            "RRULE" => {
                for kv in value.split(';') {
                    let Some((k, v)) = kv.split_once('=') else { continue };
                    match k {
                        "FREQ" => e.freq = match v { "DAILY" => "daily", "WEEKLY" => "weekly", _ => "none" }.into(),
                        "INTERVAL" => e.interval = v.parse::<i64>().unwrap_or(1).max(1),
                        "BYDAY" => e.byday = v.split(',').filter_map(byday).collect(),
                        "UNTIL" => {
                            let s = if v.len() == 8 { format!("{v}T235959") } else { v.to_string() };
                            e.until = parse_date(&s, "");
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    events
}

fn to_ms(n: NaiveDateTime) -> Option<i64> {
    Local.from_local_datetime(&n).earliest().map(|d: DateTime<Local>| d.timestamp_millis())
}

/// All occurrences (unix ms) of `ev` within [from, to].
pub fn occurrences(ev: &Event, from: i64, to: i64) -> Vec<i64> {
    let mut out = Vec::new();
    let from_dt = DateTime::<Local>::from(DateTime::from_timestamp_millis(from).unwrap_or_default());
    let to_dt = DateTime::<Local>::from(DateTime::from_timestamp_millis(to).unwrap_or_default());
    let base = ev.start.date();
    let mut d = (from_dt.date_naive() - Duration::days(1)).max(base - Duration::days(1));
    let last = to_dt.date_naive();
    let mut guard = 0;
    while d <= last && guard < 400 {
        guard += 1;
        let day = d;
        d += Duration::days(1);
        if day < base {
            continue;
        }
        let diff = (day - base).num_days();
        let dow = day.weekday().num_days_from_sunday();
        let ok = match ev.freq.as_str() {
            "none" => diff == 0,
            "daily" => diff % ev.interval == 0,
            "weekdays" => (1..=5).contains(&dow),
            "weekly" => {
                let days = if ev.byday.is_empty() { vec![ev.start.weekday().num_days_from_sunday()] } else { ev.byday.clone() };
                let base_dow = base.weekday().num_days_from_sunday() as i64;
                days.contains(&dow) && ((diff + base_dow) / 7) % ev.interval == 0
            }
            _ => false,
        };
        if !ok || ev.ex.contains(&day) {
            continue;
        }
        let Some(at) = day.and_hms_opt(ev.start.hour(), ev.start.minute(), 0) else { continue };
        if ev.until.map_or(false, |u| at > u) {
            continue;
        }
        if let Some(ms) = to_ms(at) {
            if ms >= from && ms <= to {
                out.push(ms);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_weekly_recurrence_and_escapes() {
        let text = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Team\\, weekly\r\nDTSTART:20260105T093000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:One off\r\nDTSTART:20261201T140000Z\r\nEND:VEVENT\r\nEND:VCALENDAR";
        let ev = parse_ics(text);
        assert_eq!(ev.len(), 2);
        assert_eq!(ev[0].title, "Team, weekly");
        assert_eq!(ev[0].freq, "weekly");
        assert_eq!(ev[0].byday, vec![1, 3]);
        assert_eq!(ev[1].freq, "none");

        let ms = |y, m, d| to_ms(NaiveDate::from_ymd_opt(y, m, d).unwrap().and_hms_opt(0, 0, 0).unwrap()).unwrap();
        let days: Vec<u32> = occurrences(&ev[0], ms(2026, 10, 5), ms(2026, 10, 12))
            .into_iter()
            .map(|t| DateTime::<Local>::from(DateTime::from_timestamp_millis(t).unwrap()).day())
            .collect();
        assert_eq!(days, vec![5, 7], "Monday Oct 5 and Wednesday Oct 7");
    }

    #[test]
    fn all_day_events_are_skipped() {
        assert!(parse_ics("BEGIN:VEVENT\r\nSUMMARY:Holiday\r\nDTSTART;VALUE=DATE:20261225\r\nEND:VEVENT").is_empty());
    }
}
