use crate::{atomic_write, data_file, notes, read_optional, NotesFileLock};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

pub struct Integration(pub Mutex<Value>);

fn config(app: &AppHandle) -> Result<Value, String> {
    let raw = read_optional(data_file(app, "integration.json")?)?;
    match raw {
        Some(raw) => serde_json::from_str(&raw).map_err(|e| e.to_string()),
        None => Ok(json!({"enabled":false,"write":false,"scope":"active"})),
    }
}

pub fn tool(app: &AppHandle, request: &Value, settings: &Value) -> Result<Value, String> {
    if settings["enabled"] != true {
        return Err("INTEGRATION_DISABLED: 请在 InkPin 设置中启用集成".into());
    }
    let name = request["name"].as_str().ok_or("Missing tool name")?;
    let args = &request["arguments"];
    let state = app.state::<NotesFileLock>();
    let guard = state.0.lock().map_err(|_| "Cannot lock notes")?;
    let file = notes::load(app)?;
    let allowed = |n: &Value| settings["scope"] == "all" || n["lifecycle"] == "active";
    if name == "search_notes" {
        let query = args["query"].as_str().unwrap_or("").to_lowercase();
        let results: Vec<_> = file["notes"]
            .as_object()
            .unwrap()
            .values()
            .filter(|n| {
                if !allowed(n) {
                    return false;
                }
                let tags = n["tags"]
                    .as_array()
                    .map(|list| {
                        list.iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join(" ")
                    })
                    .unwrap_or_default();
                format!(
                    "{}\n{}\n{}",
                    n["title"].as_str().unwrap_or(""),
                    n["content"].as_str().unwrap_or(""),
                    tags
                )
                .to_lowercase()
                .contains(&query)
            })
            .take(100)
            .map(|n| {
                json!({
                    "id": n["id"],
                    "title": n["title"],
                    "revision": n["revision"],
                    "lifecycle": n["lifecycle"],
                    "placement": n["placement"],
                    "tags": n["tags"],
                    "starredAt": n["starredAt"]
                })
            })
            .collect();
        return Ok(json!(results));
    }
    if name == "create_note" {
        drop(guard);
        if settings["write"] != true {
            return Err("READ_ONLY: 未启用写入权限".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let placement = match args.get("placement").and_then(Value::as_str) {
            Some("desktop") => "desktop",
            Some("center") | None => "center",
            Some(_) => return Err("placement must be 'center' or 'desktop'".into()),
        };
        let theme = match args.get("theme").and_then(Value::as_str) {
            Some(t)
                if matches!(
                    t,
                    "paper" | "cream" | "mint" | "rose" | "sky" | "grape" | "ink" | "custom"
                ) =>
            {
                t
            }
            None => "paper",
            Some(_) => return Err("Unsupported theme".into()),
        };
        let tags: Vec<String> = args
            .get("tags")
            .and_then(Value::as_array)
            .map(|list| {
                let mut seen = Vec::<String>::new();
                for item in list {
                    if let Some(raw) = item.as_str() {
                        let cleaned: String = raw.trim().trim_start_matches('#').trim().chars().take(20).collect();
                        if !cleaned.is_empty() && !seen.iter().any(|s| s.eq_ignore_ascii_case(&cleaned)) {
                            seen.push(cleaned);
                            if seen.len() >= 8 {
                                break;
                            }
                        }
                    }
                }
                seen
            })
            .unwrap_or_default();
        let mut note_payload = json!({
            "title": args["title"].as_str().unwrap_or(""),
            "content": args["content"].as_str().unwrap_or(""),
            "placement": placement,
            "theme": theme,
            "customColor": "#2563eb",
            "opacity": 0.96,
            "alwaysOnTop": true,
            "window": {"width": 420, "height": 560},
            "lastFocusedAt": 0
        });
        if !tags.is_empty() {
            note_payload["tags"] = json!(tags);
        }
        let created = notes::operation(
            app,
            json!({"id": id, "op": "create", "source": "agent", "note": note_payload}),
        )?;
        if placement == "desktop" {
            let _ = app.emit("agent-open-note", json!({"id": id}));
        }
        return Ok(created);
    }
    let id = args["id"].as_str().ok_or("Missing note id")?;
    let note = file["notes"]
        .get(id)
        .filter(|n| allowed(n))
        .ok_or("NOT_FOUND_OR_OUT_OF_SCOPE")?
        .clone();
    if name == "read_note" {
        return Ok(note);
    }
    if settings["write"] != true {
        return Err("READ_ONLY: 未启用写入权限".into());
    }
    if name == "open_note" {
        if note["lifecycle"] != "active" {
            return Err("请先恢复便签".into());
        }
        drop(guard);
        app.emit("agent-open-note", json!({"id":id}))
            .map_err(|e| e.to_string())?;
        return Ok(json!({"id":id,"requested":true}));
    }
    let op = match name {
        "update_note" | "append_note" => "save",
        "archive_note" => "archive",
        "trash_note" => "trash",
        "restore_note" => "restore",
        "set_reminder" | "cancel_reminder" => "reminder",
        _ => return Err("Unknown tool".into()),
    };
    let mut mutation =
        json!({"id":id,"op":op,"source":"agent","expectedRevision":args["expectedRevision"]});
    if op == "save" {
        let mut patch = json!({});
        if name == "append_note" {
            patch["content"] = json!(format!(
                "{}{}",
                note["content"].as_str().unwrap_or(""),
                args["content"].as_str().ok_or("content must be a string")?
            ));
        } else {
            for key in ["title", "content"] {
                if let Some(value) = args.get(key) {
                    if !value.is_string() {
                        return Err("title/content must be strings".into());
                    }
                    patch[key] = value.clone();
                }
            }
        }
        mutation["patch"] = patch;
    }
    if op == "reminder" {
        mutation["at"] = if name == "cancel_reminder" {
            Value::Null
        } else {
            args["at"].clone()
        };
    }
    drop(guard);
    notes::operation(app, mutation)
}

#[tauri::command]
pub fn integration_status(app: AppHandle) -> Result<Value, String> {
    let mut settings = config(&app)?;
    let live = app
        .state::<Integration>()
        .0
        .lock()
        .map_err(|_| "Cannot lock integration")?
        .clone();
    settings["connectionFile"] = json!(data_file(&app, "mcp-connection.json")?.to_string_lossy());
    settings["lastConnectedAt"] = live["lastConnectedAt"].clone();
    settings["listening"] = live["listening"].clone();
    Ok(settings)
}

#[tauri::command]
pub fn integration_configure(
    app: AppHandle,
    enabled: bool,
    write: bool,
    scope: String,
) -> Result<(), String> {
    if scope != "active" && scope != "all" {
        return Err("Invalid scope".into());
    }
    atomic_write(
        data_file(&app, "integration.json")?,
        json!({"enabled":enabled,"write":write,"scope":scope}).to_string(),
    )
}

pub fn start(app: AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let token = uuid::Uuid::new_v4().to_string();
    let path = data_file(&app, "mcp-connection.json")?;
    atomic_write(
        path.clone(),
        json!({"port":listener.local_addr().map_err(|e|e.to_string())?.port(),"token":token})
            .to_string(),
    )?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    app.manage(Integration(Mutex::new(
        json!({"listening":true,"lastConnectedAt":null}),
    )));
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
            let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(5)));
            let result = (|| {
                use std::io::Read;
                let mut line = String::new();
                BufReader::new((&stream).take(2_000_001))
                    .read_line(&mut line)
                    .map_err(|e| e.to_string())?;
                if line.len() > 2_000_000 {
                    return Err("Request too large".into());
                }
                let request: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
                if request["token"] != token {
                    return Err("UNAUTHORIZED".into());
                }
                app.state::<Integration>()
                    .0
                    .lock()
                    .map_err(|_| "Cannot lock integration")?["lastConnectedAt"] =
                    json!(notes::now());
                tool(&app, &request, &config(&app)?)
            })();
            let reply = match result {
                Ok(value) => json!({"result":value}),
                Err(error) => json!({"error":error}),
            };
            let _ = writeln!(stream, "{reply}");
        }
    });
    Ok(())
}
