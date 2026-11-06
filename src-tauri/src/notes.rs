//! Shared persistence and conflict checks for UI and local integrations.
use crate::{atomic_write, data_file, read_optional, NotesFileLock};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

pub fn normalize(file: &mut Value) -> Result<(), String> {
    let notes = file.get_mut("notes").and_then(Value::as_object_mut).ok_or("便签数据格式无效，原文件已保留")?;
    for (id, note) in notes {
        if !note.is_object() || !note["title"].is_string() || !note["content"].is_string() { return Err("便签数据格式无效，原文件已保留".into()); }
        note["id"] = json!(id);
        if note.get("revision").is_none() { note["revision"] = json!(1); }
        if note.get("lifecycle").is_none() { note["lifecycle"] = json!("active"); }
        if note.get("placement").is_none() { note["placement"] = json!("desktop"); }
        if note["lifecycle"] != "active" { note["placement"] = json!("center"); }
    }
    file["version"] = json!(2);
    if !file["history"].is_array() { file["history"] = json!([]); }
    if !file["tombstones"].is_array() { file["tombstones"] = json!([]); }
    Ok(())
}

pub fn load(app: &AppHandle) -> Result<Value, String> {
    let path = data_file(app, "notes.json")?;
    let raw = read_optional(path.clone())?;
    let mut file: Value = match &raw {
        Some(raw) => serde_json::from_str(raw).map_err(|e| format!("Cannot parse notes file: {e}"))?,
        None => json!({"version":2,"notes":{},"lastActiveNoteId":"","lastClosedNoteId":""}),
    };
    let migrate = file["version"] != 2;
    normalize(&mut file)?;
    if migrate {
        let backup = path.with_file_name("notes.before-v2.json");
        if !backup.exists() {
            let mut target = std::fs::File::create_new(&backup).map_err(|e| format!("备份失败：{e}"))?;
            use std::io::Write;
            target.write_all(raw.as_ref().unwrap().as_bytes()).and_then(|_| target.sync_all()).map_err(|e| format!("备份失败：{e}"))?;
        }
        atomic_write(path, file.to_string())?;
    }
    Ok(file)
}

pub fn mutate(file: &mut Value, request: &Value) -> Result<Value, String> {
    let op = request["op"].as_str().ok_or("Missing operation")?;
    let id = request["id"].as_str().ok_or("Missing note id")?;
    if id.is_empty() || id.len() > 150 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { return Err("Invalid note id".into()); }
    let existing = file["notes"].get(id).cloned();
    if op == "create" {
        if existing.is_some() || file["tombstones"].as_array().is_some_and(|ids| ids.contains(&json!(id))) { return Err("Note id already used".into()); }
        let mut note = request["note"].clone();
        if !note.is_object() || !note["title"].is_string() || !note["content"].is_string() { return Err("Invalid note".into()); }
        note["id"] = json!(id);
        note["revision"] = json!(1);
        note["lifecycle"] = json!("active");
        note["placement"] = json!(if note["placement"] == "desktop" { "desktop" } else { "center" });
        note["createdAt"] = json!(now());
        note["updatedAt"] = json!(now());
        file["notes"][id] = note.clone();
        return Ok(note);
    }
    let before = existing.ok_or("NOT_FOUND: 便签已永久删除")?;
    if op == "focus" {
        if before["lifecycle"] == "active" { file["notes"][id]["lastFocusedAt"] = json!(now()); file["lastActiveNoteId"] = json!(id); }
        return Ok(file["notes"][id].clone());
    }
    if request["expectedRevision"].as_u64() != before["revision"].as_u64() {
        return Err(format!("VERSION_CONFLICT: 便签已更改（版本 {}），草稿保留，请重新读取或导出", before["revision"]));
    }
    if op == "purge" {
        if before["lifecycle"] != "trash" { return Err("只能在回收站永久删除".into()); }
        file["notes"].as_object_mut().unwrap().remove(id);
        file["tombstones"].as_array_mut().unwrap().push(json!(id));
        file["history"].as_array_mut().unwrap().retain(|h| h["note"]["id"] != id);
        return Ok(Value::Null);
    }
    let mut note = before.clone();
    match op {
        "save" => {
            if before["lifecycle"] != "active" { return Err("便签不在普通列表，草稿未覆盖".into()); }
            for field in ["title", "content", "theme", "customColor", "opacity", "alwaysOnTop", "window"] {
                if let Some(value) = request["patch"].get(field) { note[field] = value.clone(); }
            }
            if !note["title"].is_string() || !note["content"].is_string() { return Err("Invalid content".into()); }
        }
        "archive" | "trash" => {
            note["lifecycle"] = json!(if op == "archive" { "archived" } else { "trash" });
            note["placement"] = json!("center"); note["window"]["edge"] = Value::Null; note["reminder"] = Value::Null;
        }
        "restore" => { note["lifecycle"] = json!("active"); note["placement"] = json!("center"); note["reminder"] = Value::Null; }
        "desktop" | "center" => {
            if before["lifecycle"] != "active" { return Err("请先恢复便签".into()); }
            note["placement"] = json!(op);
            if op == "center" { note["window"]["edge"] = Value::Null; }
        }
        "undo" => {
            let index = request["historyId"].as_u64().ok_or("Missing history id")?;
            let old = file["history"].as_array().unwrap().iter().find(|h| h["at"].as_u64() == Some(index) && h["note"]["id"] == id).ok_or("恢复版本不存在")?;
            note = old["note"].clone(); note["placement"] = json!("center"); note["reminder"] = Value::Null; note["window"]["edge"] = Value::Null;
        }
        _ => return Err(format!("Unknown operation: {op}")),
    }
    if matches!(op, "archive" | "trash" | "undo") || request["source"] == "agent" {
        let history = file["history"].as_array_mut().unwrap();
        let at = history.last().and_then(|h| h["at"].as_u64()).unwrap_or(0).saturating_add(1).max(now());
        history.push(json!({"at":at,"op":op,"source":request["source"],"note":before}));
        if history.len() > 100 { history.remove(0); }
    }
    note["revision"] = json!(before["revision"].as_u64().unwrap_or(0) + 1);
    note["updatedAt"] = json!(now()); file["notes"][id] = note.clone();
    Ok(note)
}

pub fn operation(app: &AppHandle, request: Value) -> Result<Value, String> {
    let state = app.state::<NotesFileLock>();
    let _guard = state.0.lock().map_err(|_| "Cannot lock notes")?;
    let mut file = load(app)?;
    let note = mutate(&mut file, &request)?;
    atomic_write(data_file(app, "notes.json")?, file.to_string())?;
    let _ = app.emit("notes-changed", json!({"id":request["id"],"note":note,"op":request["op"]}));
    Ok(note)
}

#[tauri::command]
pub fn note_operation(app: AppHandle, request: Value) -> Result<Value, String> { operation(&app, request) }

#[cfg(test)]
mod tests {
    use super::*;
    fn file() -> Value { let mut f = json!({"version":1,"notes":{"a":{"title":"旧便签","content":"草稿","window":{}}}}); normalize(&mut f).unwrap(); f }
    #[test]
    fn lifecycle_conflicts_and_tombstones() {
        let mut f = file(); assert_eq!(f["notes"]["a"]["placement"], "desktop");
        mutate(&mut f, &json!({"id":"a","op":"trash","expectedRevision":1})).unwrap();
        assert!(mutate(&mut f, &json!({"id":"a","op":"save","expectedRevision":1,"patch":{"content":"stale"}})).is_err());
        mutate(&mut f, &json!({"id":"a","op":"restore","expectedRevision":2})).unwrap();
        assert_eq!(f["notes"]["a"]["placement"], "center"); assert_eq!(f["notes"]["a"]["content"], "草稿");
        assert!(mutate(&mut f, &json!({"id":"a","op":"purge","expectedRevision":3})).is_err());
        mutate(&mut f, &json!({"id":"a","op":"trash","expectedRevision":3})).unwrap();
        mutate(&mut f, &json!({"id":"a","op":"purge","expectedRevision":4})).unwrap();
        assert!(mutate(&mut f, &json!({"id":"a","op":"create","note":{"title":"","content":""}})).is_err());
    }
    #[test]
    fn invalid_migration_preserves_data() { assert!(normalize(&mut json!({"notes":[]})).is_err()); }
}
