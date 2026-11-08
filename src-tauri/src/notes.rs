//! Shared persistence and conflict checks for UI and local integrations.
use crate::{atomic_write, data_file, read_optional, NotesFileLock};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
#[derive(Default)]
pub struct Drafts(pub Mutex<HashMap<String, String>>);
#[tauri::command]
pub fn note_draft(
    app: AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    dirty: bool,
) -> Result<(), String> {
    crate::perf::count("ipc.note_draft", None);
    let state = app.state::<Drafts>();
    let mut drafts = state.0.lock().map_err(|_| "Cannot lock drafts")?;
    if dirty {
        drafts.insert(id, window.label().into());
    } else if drafts.get(&id).is_some_and(|label| label == window.label()) {
        drafts.remove(&id);
    }
    Ok(())
}

pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn normalize(file: &mut Value) -> Result<(), String> {
    if file["version"].as_u64().is_some_and(|v| v > 2) {
        return Err("便签来自更新版本，请升级应用；原数据已保留".into());
    }
    let notes = file
        .get_mut("notes")
        .and_then(Value::as_object_mut)
        .ok_or("便签数据格式无效，原文件已保留")?;
    for (id, note) in notes {
        if !note.is_object() || !note["title"].is_string() || !note["content"].is_string() {
            return Err("便签数据格式无效，原文件已保留".into());
        }
        note["id"] = json!(id);
        if note.get("revision").is_none() || note["revision"] == 0 {
            note["revision"] = json!(1);
        }
        if note.get("lifecycle").is_none() {
            note["lifecycle"] = json!("active");
        }
        if note.get("placement").is_none() {
            note["placement"] = json!("desktop");
        }
        if !matches!(
            note["lifecycle"].as_str(),
            Some("active" | "archived" | "trash")
        ) || !matches!(note["placement"].as_str(), Some("center" | "desktop"))
            || note["revision"].as_u64().is_none()
        {
            return Err("便签状态格式无效，原文件已保留".into());
        }
        if note["lifecycle"] != "active" {
            note["placement"] = json!("center");
        }
    }
    file["version"] = json!(2);
    if !file["history"].is_array() {
        file["history"] = json!([]);
    }
    if !file["tombstones"].is_array() {
        file["tombstones"] = json!([]);
    }
    Ok(())
}

/// The parsed notes file, valid while the file on disk keeps the same mtime and size.
/// Every write in this process goes through `store`, so the app reads and parses the
/// library once instead of on every operation; an outside change is still picked up.
struct Cached {
    path: std::path::PathBuf,
    stamp: (std::time::SystemTime, u64),
    file: Value,
}
static CACHE: std::sync::Mutex<Option<Cached>> = std::sync::Mutex::new(None);

fn stamp(path: &std::path::Path) -> Option<(std::time::SystemTime, u64)> {
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.modified().ok()?, meta.len()))
}

fn remember(path: &std::path::Path, file: &Value) {
    if let (Some(stamp), Ok(mut cache)) = (stamp(path), CACHE.lock()) {
        *cache = Some(Cached {
            path: path.to_path_buf(),
            stamp,
            file: file.clone(),
        });
    }
}

/// Atomically writes the notes file and keeps the in-memory copy authoritative.
pub fn store(app: &AppHandle, file: &Value) -> Result<(), String> {
    let path = data_file(app, "notes.json")?;
    if let Err(error) = atomic_write(path.clone(), file.to_string()) {
        if let Ok(mut cache) = CACHE.lock() {
            *cache = None;
        }
        return Err(error);
    }
    remember(&path, file);
    Ok(())
}

pub fn load(app: &AppHandle) -> Result<Value, String> {
    let started = std::time::Instant::now();
    let path = data_file(app, "notes.json")?;
    if let (Some(current), Ok(cache)) = (stamp(&path), CACHE.lock()) {
        if let Some(cached) = cache.as_ref().filter(|c| c.path == path && c.stamp == current) {
            crate::perf::count("disk.cache_hit", Some(started));
            return Ok(cached.file.clone());
        }
    }
    let raw = read_optional(path.clone())?;
    let mut file: Value = match &raw {
        Some(raw) => {
            serde_json::from_str(raw).map_err(|e| format!("Cannot parse notes file: {e}"))?
        }
        None => json!({"version":2,"notes":{},"lastActiveNoteId":"","lastClosedNoteId":""}),
    };
    let migrate = file["version"] != 2;
    normalize(&mut file)?;
    crate::perf::count("disk.read_parse", Some(started));
    if migrate {
        let mut backup = path.with_file_name("notes.before-v2.json");
        if backup.exists()
            && std::fs::read_to_string(&backup).map_err(|e| format!("无法读取迁移备份：{e}"))?
                != *raw.as_ref().unwrap()
        {
            backup = path.with_file_name(format!("notes.before-v2-{}.json", uuid::Uuid::new_v4()));
        }
        if !backup.exists() {
            let mut target =
                std::fs::File::create_new(&backup).map_err(|e| format!("备份失败：{e}"))?;
            use std::io::Write;
            let result = target
                .write_all(raw.as_ref().unwrap().as_bytes())
                .and_then(|_| target.sync_all())
                .map_err(|e| format!("备份失败：{e}"));
            if let Err(error) = result {
                drop(target);
                let _ = std::fs::remove_file(&backup);
                return Err(error);
            }
        }
        atomic_write(path.clone(), file.to_string())?;
    }
    remember(&path, &file);
    Ok(file)
}

pub fn mutate(file: &mut Value, request: &Value) -> Result<Value, String> {
    let op = request["op"].as_str().ok_or("Missing operation")?;
    let id = request["id"].as_str().ok_or("Missing note id")?;
    if id.is_empty() || id.len() > 150 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Invalid note id".into());
    }
    let existing = file["notes"].get(id).cloned();
    if op == "create" {
        if existing.is_some()
            || file["tombstones"]
                .as_array()
                .is_some_and(|ids| ids.contains(&json!(id)))
        {
            return Err("Note id already used".into());
        }
        let mut note = request["note"].clone();
        if !note.is_object() || !note["title"].is_string() || !note["content"].is_string() {
            return Err("Invalid note".into());
        }
        note["id"] = json!(id);
        note["revision"] = json!(1);
        note["lifecycle"] = json!("active");
        note["placement"] = json!(if note["placement"] == "desktop" {
            "desktop"
        } else {
            "center"
        });
        note["createdAt"] = json!(now());
        note["updatedAt"] = json!(now());
        file["notes"][id] = note.clone();
        if request["source"] == "agent" {
            let history = file["history"].as_array_mut().unwrap();
            let at = history
                .last()
                .and_then(|h| h["at"].as_u64())
                .unwrap_or(0)
                .saturating_add(1)
                .max(now());
            history.push(json!({"at":at,"op":"create","source":"agent","note":note}));
            if history.len() > 100 {
                history.remove(0);
            }
        }
        return Ok(note);
    }
    let before = existing.ok_or("NOT_FOUND: 便签已永久删除")?;
    if op == "focus" {
        if before["lifecycle"] == "active" {
            file["notes"][id]["lastFocusedAt"] = json!(now());
            file["lastActiveNoteId"] = json!(id);
        }
        return Ok(file["notes"][id].clone());
    }
    if op == "appearance" {
        if before["lifecycle"] != "active" {
            return Err("请先恢复便签".into());
        }
        let mut note = before.clone();
        let patch = &request["patch"];
        if let Some(theme) = patch.get("theme") {
            if !matches!(
                theme.as_str(),
                Some("paper" | "mint" | "rose" | "sky" | "grape" | "ink" | "custom")
            ) {
                return Err("Invalid theme".into());
            }
            note["theme"] = theme.clone();
        }
        if let Some(color) = patch.get("customColor") {
            let text = color.as_str().ok_or("Invalid color")?;
            if text.len() != 7
                || !text.starts_with('#')
                || !text[1..].chars().all(|c| c.is_ascii_hexdigit())
            {
                return Err("Invalid color".into());
            }
            note["customColor"] = color.clone();
        }
        if let Some(opacity) = patch.get("opacity") {
            if !opacity.as_f64().is_some_and(|v| (0.0..=1.0).contains(&v)) {
                return Err("Invalid opacity".into());
            }
            note["opacity"] = opacity.clone();
        }
        if let Some(pin) = patch.get("alwaysOnTop") {
            if !pin.is_boolean() {
                return Err("Invalid pin state".into());
            }
            note["alwaysOnTop"] = pin.clone();
        }
        // Independent presentation metadata must not invalidate an unsaved body.
        file["notes"][id] = note.clone();
        return Ok(note);
    }
    if op != "window" && request["expectedRevision"].as_u64() != before["revision"].as_u64() {
        return Err(format!(
            "VERSION_CONFLICT: 便签已更改（版本 {}），草稿保留，请重新读取或导出",
            before["revision"]
        ));
    }
    if op == "purge" {
        if before["lifecycle"] != "trash" {
            return Err("只能在回收站永久删除".into());
        }
        file["notes"].as_object_mut().unwrap().remove(id);
        file["tombstones"].as_array_mut().unwrap().push(json!(id));
        file["history"]
            .as_array_mut()
            .unwrap()
            .retain(|h| h["note"]["id"] != id);
        return Ok(Value::Null);
    }
    let mut note = before.clone();
    match op {
        "window" => {
            if before["lifecycle"] != "active" {
                return Err("请先恢复便签".into());
            }
            let window = request["patch"]["window"].clone();
            if !window.is_object() {
                return Err("Invalid window".into());
            }
            note["window"] = window;
            // Geometry is last-writer-wins presentation state, like appearance: it must
            // neither conflict with nor invalidate a body draft being edited elsewhere.
            file["notes"][id] = note.clone();
            return Ok(note);
        }
        "save" => {
            if before["lifecycle"] != "active" {
                return Err("便签不在普通列表，草稿未覆盖".into());
            }
            if let Some(owner) = request["owner"].as_str() {
                // A desktop note edits in its own window only while expanded. As a
                // capsule or edge tab it is just an entry point; the center owns edits.
                let expected = if before["placement"] == "desktop"
                    && before["window"]["collapsed"] != json!(true)
                {
                    format!("note-{id}")
                } else {
                    "main".into()
                };
                if (request["patch"].get("content").is_some()
                    || request["patch"].get("title").is_some())
                    && owner != expected
                {
                    return Err("EDITOR_MOVED: 编辑位置已改变，草稿未覆盖".into());
                }
            }
            for field in ["title", "content", "window"] {
                if let Some(value) = request["patch"].get(field) {
                    note[field] = value.clone();
                }
            }
            if !note["title"].is_string() || !note["content"].is_string() {
                return Err("Invalid content".into());
            }
        }
        "archive" | "trash" => {
            note["lifecycle"] = json!(if op == "archive" { "archived" } else { "trash" });
            note["placement"] = json!("center");
            note["window"]["edge"] = Value::Null;
            if op == "archive" && note["reminder"].is_object() {
                note["reminder"]["state"] = json!("paused");
            } else {
                note["reminder"] = Value::Null;
            }
        }
        "restore" => {
            note["lifecycle"] = json!("active");
            note["placement"] = json!("center");
            note["reminder"] = Value::Null;
        }
        "reminder" => {
            if before["lifecycle"] != "active" {
                return Err("请先恢复便签".into());
            }
            if request["at"].is_null() {
                note["reminder"] = Value::Null;
            } else {
                let at = request["at"]
                    .as_u64()
                    .filter(|at| *at > now())
                    .ok_or("请选择未来的提醒时间")?;
                note["reminder"] = json!({"at":at,"state":"pending"});
            }
        }
        "desktop" | "center" => {
            if before["lifecycle"] != "active" {
                return Err("请先恢复便签".into());
            }
            note["placement"] = json!(op);
            if op == "center" {
                note["window"]["edge"] = Value::Null;
            }
        }
        "undo" => {
            let index = request["historyId"].as_u64().ok_or("Missing history id")?;
            let old = file["history"]
                .as_array()
                .unwrap()
                .iter()
                .find(|h| h["at"].as_u64() == Some(index) && h["note"]["id"] == id)
                .ok_or("恢复版本不存在")?;
            note = old["note"].clone();
            if old["op"] == "create" {
                note["lifecycle"] = json!("trash");
            }
            note["placement"] = json!("center");
            note["reminder"] = Value::Null;
            note["window"]["edge"] = Value::Null;
        }
        _ => return Err(format!("Unknown operation: {op}")),
    }
    if matches!(op, "archive" | "trash" | "undo") || request["source"] == "agent" {
        let history = file["history"].as_array_mut().unwrap();
        let at = history
            .last()
            .and_then(|h| h["at"].as_u64())
            .unwrap_or(0)
            .saturating_add(1)
            .max(now());
        history.push(json!({"at":at,"op":op,"source":request["source"],"note":before}));
        if history.len() > 100 {
            history.remove(0);
        }
    }
    note["revision"] = json!(before["revision"].as_u64().unwrap_or(0) + 1);
    note["updatedAt"] = json!(now());
    file["notes"][id] = note.clone();
    Ok(note)
}

pub fn operation(app: &AppHandle, request: Value) -> Result<Value, String> {
    let state = app.state::<NotesFileLock>();
    let _guard = state.0.lock().map_err(|_| "Cannot lock notes")?;
    let mut file = load(app)?;
    if request["source"] == "ui"
        && matches!(
            request["op"].as_str(),
            Some("archive" | "trash" | "restore" | "undo" | "center" | "desktop")
        )
    {
        if let Some(owner) = app
            .state::<Drafts>()
            .0
            .lock()
            .map_err(|_| "Cannot lock drafts")?
            .get(request["id"].as_str().unwrap_or(""))
        {
            return Err(format!("EDITOR_BUSY: {owner} 有未保存草稿，请保存后重试"));
        }
    }
    if request["source"] == "agent"
        && app
            .state::<Drafts>()
            .0
            .lock()
            .map_err(|_| "Cannot lock drafts")?
            .contains_key(request["id"].as_str().unwrap_or(""))
    {
        return Err("EDITOR_BUSY: 用户有未保存草稿，请稍后重新读取版本再试".into());
    }
    let before = file["notes"].get(request["id"].as_str().unwrap_or("")).cloned();
    // Re-focusing the note that is already the most recent one changes nothing a
    // reader relies on within a few seconds: skip the disk write and the broadcast.
    if request["op"] == "focus" {
        if let Some(b) = &before {
            let id = request["id"].as_str().unwrap_or("");
            if file["lastActiveNoteId"] == id
                && b["lifecycle"] == "active"
                && b["lastFocusedAt"]
                    .as_u64()
                    .is_some_and(|at| now().saturating_sub(at) < 10_000)
            {
                return Ok(b.clone());
            }
        }
    }
    let note = mutate(&mut file, &request)?;
    store(app, &file)?;
    // Edge queues only need to re-layout when docking-relevant state changed,
    // not on every body save.
    let layout = before.as_ref().is_none_or(|b| {
        ["lifecycle", "placement"].iter().any(|k| b[k] != note[k])
            || ["collapsed", "edge"]
                .iter()
                .any(|k| b["window"][k] != note["window"][k])
    });
    let _ = app.emit(
        "notes-changed",
        json!({"id":request["id"],"note":note,"op":request["op"],"layout":layout}),
    );
    Ok(note)
}

#[tauri::command]
pub fn note_operation(
    app: AppHandle,
    window: tauri::WebviewWindow,
    request: Value,
) -> Result<Value, String> {
    crate::perf::count(
        &format!("ipc.op.{}", request["op"].as_str().unwrap_or("?")),
        None,
    );
    let mut request = request;
    request["source"] = json!("ui");
    request["owner"] = json!(window.label());
    operation(&app, request)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn file() -> Value {
        let mut f =
            json!({"version":1,"notes":{"a":{"title":"旧便签","content":"草稿","window":{}}}});
        normalize(&mut f).unwrap();
        f
    }
    #[test]
    fn lifecycle_conflicts_and_tombstones() {
        let mut f = file();
        assert_eq!(f["notes"]["a"]["placement"], "desktop");
        mutate(&mut f, &json!({"id":"a","op":"trash","expectedRevision":1})).unwrap();
        assert!(mutate(
            &mut f,
            &json!({"id":"a","op":"save","expectedRevision":1,"patch":{"content":"stale"}})
        )
        .is_err());
        mutate(
            &mut f,
            &json!({"id":"a","op":"restore","expectedRevision":2}),
        )
        .unwrap();
        assert_eq!(f["notes"]["a"]["placement"], "center");
        assert_eq!(f["notes"]["a"]["content"], "草稿");
        assert!(mutate(&mut f, &json!({"id":"a","op":"purge","expectedRevision":3})).is_err());
        mutate(&mut f, &json!({"id":"a","op":"trash","expectedRevision":3})).unwrap();
        mutate(&mut f, &json!({"id":"a","op":"purge","expectedRevision":4})).unwrap();
        assert!(mutate(
            &mut f,
            &json!({"id":"a","op":"create","note":{"title":"","content":""}})
        )
        .is_err());
    }
    #[test]
    fn invalid_migration_preserves_data() {
        assert!(normalize(&mut json!({"notes":[]})).is_err());
        assert!(normalize(&mut json!({"version":3,"notes":{}})).is_err());
    }
    #[test]
    fn appearance_updates_do_not_conflict_with_or_get_overwritten_by_body_drafts() {
        let mut f = file();
        mutate(
            &mut f,
            &json!({"id":"a","op":"appearance","patch":{"theme":"sky"}}),
        )
        .unwrap();
        assert_eq!(f["notes"]["a"]["revision"], 1);
        mutate(&mut f,&json!({"id":"a","op":"save","expectedRevision":1,"patch":{"content":"new draft","theme":"paper"}})).unwrap();
        assert_eq!(f["notes"]["a"]["theme"], "sky");
        assert_eq!(f["notes"]["a"]["content"], "new draft");
        assert!(mutate(
            &mut f,
            &json!({"id":"a","op":"appearance","patch":{"customColor":"invalid"}})
        )
        .is_err());
    }
    #[test]
    fn agent_versions_can_be_restored_without_reopening_windows() {
        let mut f = file();
        mutate(&mut f,&json!({"id":"a","op":"save","expectedRevision":1,"source":"agent","patch":{"content":"agent change"}})).unwrap();
        let at = f["history"][0]["at"].clone();
        mutate(
            &mut f,
            &json!({"id":"a","op":"undo","expectedRevision":2,"historyId":at}),
        )
        .unwrap();
        assert_eq!(f["notes"]["a"]["content"], "草稿");
        assert_eq!(f["notes"]["a"]["placement"], "center");
        assert_eq!(f["notes"]["a"]["revision"], 3);
        mutate(&mut f,&json!({"id":"b","op":"create","source":"agent","note":{"title":"new","content":"original"}})).unwrap();
        let at = f["history"].as_array().unwrap().last().unwrap()["at"].clone();
        mutate(
            &mut f,
            &json!({"id":"b","op":"undo","expectedRevision":1,"historyId":at}),
        )
        .unwrap();
        assert_eq!(f["notes"]["b"]["lifecycle"], "trash");
        assert_eq!(f["notes"]["b"]["content"], "original");
    }
    #[test]
    fn collapsed_desktop_notes_are_edited_by_the_center() {
        let mut f = file();
        mutate(&mut f,&json!({"id":"a","op":"window","patch":{"window":{"collapsed":true,"width":420,"height":560}}})).unwrap();
        assert_eq!(f["notes"]["a"]["revision"], 1, "geometry must not bump the body revision");
        assert!(mutate(&mut f,&json!({"id":"a","op":"save","owner":"note-a","expectedRevision":1,"patch":{"content":"capsule"}})).is_err());
        mutate(&mut f,&json!({"id":"a","op":"save","owner":"main","expectedRevision":1,"patch":{"content":"center"}})).unwrap();
        // A stale window write never conflicts with or overwrites the body.
        mutate(&mut f,&json!({"id":"a","op":"window","expectedRevision":0,"patch":{"window":{"collapsed":false,"width":420,"height":560}}})).unwrap();
        assert_eq!(f["notes"]["a"]["content"], "center");
        assert!(mutate(&mut f,&json!({"id":"a","op":"save","owner":"main","expectedRevision":2,"patch":{"content":"late center"}})).is_err());
        mutate(&mut f,&json!({"id":"a","op":"save","owner":"note-a","expectedRevision":2,"patch":{"content":"window"}})).unwrap();
    }
    #[test]
    fn editor_location_changes_reject_old_writes() {
        let mut f = file();
        assert!(mutate(&mut f,&json!({"id":"a","op":"save","owner":"main","expectedRevision":1,"patch":{"content":"wrong editor"}})).is_err());
        mutate(
            &mut f,
            &json!({"id":"a","op":"center","expectedRevision":1}),
        )
        .unwrap();
        assert!(mutate(&mut f,&json!({"id":"a","op":"save","owner":"note-a","expectedRevision":2,"patch":{"content":"old window"}})).is_err());
        mutate(&mut f,&json!({"id":"a","op":"save","owner":"main","expectedRevision":2,"patch":{"content":"center"}})).unwrap();
        assert_eq!(f["notes"]["a"]["content"], "center");
    }
}
