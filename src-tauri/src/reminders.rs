use crate::{atomic_write, data_file, notes, NotesFileLock};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

// Claim before delivery: at-most-once across restarts, even when a process exits
// between the OS call and writing state. OS delivery itself is not guaranteed.
pub fn claim_due(file: &mut Value, now: u64) -> Vec<Value> {
    let mut due = Vec::new();
    if let Some(notes) = file["notes"].as_object_mut() {
        for note in notes.values_mut() {
            if note["lifecycle"] == "active"
                && note["reminder"]["state"] == "pending"
                && note["reminder"]["at"].as_u64().is_some_and(|at| at <= now)
            {
                note["reminder"]["state"] = json!("delivered");
                note["reminder"]["deliveredAt"] = json!(now);
                // Reminder delivery is metadata: do not invalidate an editor draft.
                due.push(note.clone());
            }
        }
    }
    due
}

fn dispatch(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<NotesFileLock>();
    let guard = state.0.lock().map_err(|_| "Cannot lock notes")?;
    if !data_file(app, "notes.json")?.exists() {
        return Ok(());
    }
    let mut file = notes::load(app)?;
    let due = claim_due(&mut file, notes::now());
    if due.is_empty() {
        return Ok(());
    }
    atomic_write(data_file(app, "notes.json")?, file.to_string())?;
    drop(guard);
    for note in due {
        let error = app
            .notification()
            .builder()
            .title(note["title"].as_str().unwrap_or("PinNote"))
            .body("便签提醒到期 · 在便签中心打开或稍后提醒")
            .show()
            .err()
            .map(|e| e.to_string());
        let _ = app.emit("reminder-due", json!({"note":note,"error":error}));
    }
    Ok(())
}

#[tauri::command]
pub fn reminder_permission(app: AppHandle) -> Result<String, String> {
    let permission = app
        .notification()
        .request_permission()
        .map_err(|e| e.to_string())?;
    Ok(format!("{permission:?}"))
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(error) = dispatch(&app) {
                let _ = app.emit("reminder-error", error);
            }
            tokio::time::sleep(std::time::Duration::from_secs(15)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missed_reminders_are_claimed_once_and_archives_are_paused() {
        let mut file = json!({"notes":{
            "a":{"lifecycle":"active","reminder":{"at":100,"state":"pending"}},
            "b":{"lifecycle":"archived","reminder":{"at":100,"state":"paused"}},
            "c":{"lifecycle":"active","reminder":{"at":900,"state":"pending"}}
        }});
        assert_eq!(claim_due(&mut file, 500).len(), 1);
        let mut restarted: Value = serde_json::from_str(&file.to_string()).unwrap();
        assert!(claim_due(&mut restarted, 500).is_empty());
        assert_eq!(claim_due(&mut restarted, 1000).len(), 1);
    }
}
