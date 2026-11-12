//! Per-note version history and daily activity counts, kept beside `notes.json`.
//!
//! Both are written while the notes lock is held (from `notes::operation`), and both are best
//! effort: a failure here never fails the note save that triggered it.
//!
//! - `versions.json`: for each note, earlier titles and bodies, newest last. A version is the
//!   text as it stood when an editing session ended: it is recorded on the first change after
//!   a pause of `SESSION_GAP`, and before every restore.
//! - `activity.json`: counts per half-hour bucket (UTC), so the UI can group them by local
//!   day in any time zone: notes edited (once per note per bucket), notes created, and
//!   checklist items ticked. Agent (MCP) changes are not the user's activity and are skipped.
use crate::{atomic_write, data_file, read_optional};
use serde_json::{json, Value};
use tauri::AppHandle;

const SESSION_GAP: u64 = 10 * 60 * 1000;
const VERSIONS_PER_NOTE: usize = 20;
const BUCKET: u64 = 30 * 60 * 1000;
const ACTIVITY_DAYS: u64 = 400;

fn read(app: &AppHandle, name: &str) -> Value {
    data_file(app, name)
        .ok()
        .and_then(|path| read_optional(path).ok().flatten())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

fn write(app: &AppHandle, name: &str, value: &Value) -> Result<(), String> {
    atomic_write(data_file(app, name)?, value.to_string())
}

fn text_of(note: &Value) -> (&str, &str) {
    (
        note["title"].as_str().unwrap_or(""),
        note["content"].as_str().unwrap_or(""),
    )
}

/// Checklist items marked done (`- [x]`, `* [X]`, `1. [x]` …).
pub fn ticked(content: &str) -> u64 {
    content
        .lines()
        .filter(|line| {
            let line = line.trim_start();
            let rest = line
                .strip_prefix("- ")
                .or_else(|| line.strip_prefix("* "))
                .or_else(|| line.strip_prefix("+ "))
                .or_else(|| {
                    let digits = line.chars().take_while(char::is_ascii_digit).count();
                    (digits > 0)
                        .then(|| line[digits..].strip_prefix(". "))
                        .flatten()
                });
            rest.is_some_and(|r| r.starts_with("[x]") || r.starts_with("[X]"))
        })
        .count() as u64
}

/// Whether the text a save replaces should be kept as a version.
pub fn version_due(before: &Value, versions: &[Value], now: u64) -> bool {
    let (title, content) = text_of(before);
    if content.trim().is_empty() {
        return false;
    }
    if versions
        .last()
        .is_some_and(|v| v["title"] == title && v["content"] == content)
    {
        return false;
    }
    let last = before["editedAt"]
        .as_u64()
        .or_else(|| before["updatedAt"].as_u64())
        .unwrap_or(0);
    now.saturating_sub(last) >= SESSION_GAP
}

/// Record the note's text as of `before` (for a session end or a restore).
pub fn push_version(versions: &mut Value, id: &str, before: &Value) {
    let (title, content) = text_of(before);
    let at = before["editedAt"]
        .as_u64()
        .or_else(|| before["updatedAt"].as_u64())
        .unwrap_or(0);
    if !versions["notes"].is_object() {
        versions["notes"] = json!({});
    }
    let list = &mut versions["notes"][id];
    if !list.is_array() {
        *list = json!([]);
    }
    let list = list.as_array_mut().unwrap();
    if list
        .last()
        .is_some_and(|v| v["title"] == title && v["content"] == content)
    {
        return;
    }
    // Keys stay unique even when two versions share an edit time.
    let at = list
        .last()
        .and_then(|v| v["at"].as_u64())
        .map_or(at, |last| at.max(last + 1));
    list.push(json!({"at":at,"title":title,"content":content}));
    let extra = list.len().saturating_sub(VERSIONS_PER_NOTE);
    list.drain(..extra);
}

/// Add counts to the bucket containing `now`; drop buckets older than about a year.
pub fn count(activity: &mut Value, now: u64, edits: u64, created: u64, done: u64) {
    if !activity["since"].is_u64() {
        activity["since"] = json!(now);
    }
    if !activity["b"].is_object() {
        activity["b"] = json!({});
    }
    let key = (now / BUCKET).to_string();
    let entry = &mut activity["b"][&key];
    let old = |i: usize| entry[i].as_u64().unwrap_or(0);
    let next = json!([old(0) + edits, old(1) + created, old(2) + done]);
    *entry = next;
    let oldest = now.saturating_sub(ACTIVITY_DAYS * 24 * 3600 * 1000) / BUCKET;
    activity["b"]
        .as_object_mut()
        .unwrap()
        .retain(|k, _| k.parse::<u64>().is_ok_and(|b| b >= oldest));
}

pub fn after_change(app: &AppHandle, request: &Value, before: Option<&Value>, note: &Value) {
    let op = request["op"].as_str().unwrap_or("");
    let id = request["id"].as_str().unwrap_or("");
    let now = crate::notes::now();
    if op == "purge" {
        let mut versions = read(app, "versions.json");
        if versions["notes"].get(id).is_some() {
            versions["notes"].as_object_mut().unwrap().remove(id);
            let _ = write(app, "versions.json", &versions);
        }
        return;
    }
    let user = request["source"] != "agent";
    if op == "create" {
        if user {
            let mut activity = read(app, "activity.json");
            count(&mut activity, now, 0, 1, ticked(text_of(note).1));
            let _ = write(app, "activity.json", &activity);
        }
        return;
    }
    let Some(before) = before else { return };
    if !matches!(op, "save" | "revert") || text_of(before) == text_of(note) {
        return;
    }
    let mut versions = read(app, "versions.json");
    let list = versions["notes"][id].as_array().cloned().unwrap_or_default();
    if op == "revert" || version_due(before, &list, now) {
        push_version(&mut versions, id, before);
        let _ = write(app, "versions.json", &versions);
    }
    if user {
        // One edit per note per half hour, however many autosaves that took.
        let last = before["editedAt"].as_u64().unwrap_or(0);
        let edits = u64::from(last / BUCKET != now / BUCKET);
        let done = ticked(text_of(note).1).saturating_sub(ticked(text_of(before).1));
        if edits + done > 0 {
            let mut activity = read(app, "activity.json");
            count(&mut activity, now, edits, 0, done);
            let _ = write(app, "activity.json", &activity);
        }
    }
}

pub fn find_version(app: &AppHandle, id: &str, at: u64) -> Result<Value, String> {
    read(app, "versions.json")["notes"][id]
        .as_array()
        .and_then(|list| list.iter().find(|v| v["at"].as_u64() == Some(at)).cloned())
        .ok_or_else(|| "恢复版本不存在".into())
}

/// Earlier versions of one note, newest first.
#[tauri::command]
pub fn note_versions(app: AppHandle, id: String) -> Value {
    let mut list = read(&app, "versions.json")["notes"][&id]
        .as_array()
        .cloned()
        .unwrap_or_default();
    list.reverse();
    json!(list)
}

#[tauri::command]
pub fn load_activity(app: AppHandle) -> Value {
    read(&app, "activity.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ticked_items_are_counted_in_any_list_style() {
        assert_eq!(ticked("- [x] a\n- [ ] b\n  * [X] c\n1. [x] d\n[x] not a list\n-[x] no space"), 3);
    }
    #[test]
    fn a_version_is_kept_after_a_pause_and_never_twice() {
        let before = json!({"title":"t","content":"正文","editedAt":0});
        assert!(version_due(&before, &[], SESSION_GAP));
        assert!(!version_due(&before, &[], SESSION_GAP - 1), "still the same session");
        assert!(!version_due(&json!({"title":"t","content":"  ","editedAt":0}), &[], SESSION_GAP));
        let same = json!({"at":1,"title":"t","content":"正文"});
        assert!(!version_due(&before, &[same], SESSION_GAP));
        let mut versions = json!({});
        for i in 0..25 {
            push_version(&mut versions, "a", &json!({"title":"t","content":format!("v{i}"),"editedAt":7}));
        }
        let list = versions["notes"]["a"].as_array().unwrap();
        assert_eq!(list.len(), VERSIONS_PER_NOTE);
        assert_eq!(list.last().unwrap()["content"], "v24");
        let keys: std::collections::HashSet<_> = list.iter().map(|v| v["at"].as_u64()).collect();
        assert_eq!(keys.len(), list.len(), "version keys stay unique");
    }
    #[test]
    fn activity_adds_up_per_bucket_and_forgets_old_buckets() {
        let mut a = json!({});
        count(&mut a, BUCKET * 1000, 1, 0, 2);
        count(&mut a, BUCKET * 1000 + 5, 1, 1, 0);
        assert_eq!(a["b"]["1000"], json!([2, 1, 2]));
        count(&mut a, BUCKET * 1000 + ACTIVITY_DAYS * 24 * 3600 * 1000 + BUCKET, 1, 0, 0);
        assert!(a["b"].get("1000").is_none());
    }
}
