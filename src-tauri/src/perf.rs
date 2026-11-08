//! Debug-only counters for before/after performance comparisons.
//! Enabled with `PINNOTE_PERF=1` in debug builds; a no-op otherwise.
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

struct Perf {
    backend: BTreeMap<String, (u64, f64)>,
    windows: Map<String, Value>,
    marks: Vec<Value>,
}

fn state() -> Option<&'static Mutex<Perf>> {
    static STATE: OnceLock<Option<Mutex<Perf>>> = OnceLock::new();
    STATE
        .get_or_init(|| {
            (cfg!(debug_assertions) && std::env::var_os("PINNOTE_PERF").is_some()).then(|| {
                Mutex::new(Perf {
                    backend: BTreeMap::new(),
                    windows: Map::new(),
                    marks: Vec::new(),
                })
            })
        })
        .as_ref()
}

pub fn enabled() -> bool {
    state().is_some()
}

/// Count one occurrence of `name`, adding the time since `start` when given.
pub fn count(name: &str, start: Option<Instant>) {
    if let Some(state) = state() {
        if let Ok(mut perf) = state.lock() {
            let entry = perf.backend.entry(name.to_string()).or_default();
            entry.0 += 1;
            entry.1 += start.map_or(0.0, |s| s.elapsed().as_secs_f64() * 1000.0);
        }
    }
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

fn write(app: &tauri::AppHandle, perf: &Perf) {
    let backend: Map<String, Value> = perf
        .backend
        .iter()
        .map(|(k, (n, ms))| (k.clone(), json!({"n":n,"ms":(ms*100.0).round()/100.0})))
        .collect();
    let report = json!({"at":now_ms(),"backend":backend,"windows":perf.windows,"marks":perf.marks});
    if let Ok(path) = crate::data_file(app, "perf.json") {
        let _ = std::fs::write(path, report.to_string());
    }
}

#[tauri::command]
pub fn perf_enabled() -> Value {
    let flag = |name: &str| enabled() && std::env::var_os(name).is_some();
    json!({"enabled":enabled(),"scenario":flag("PINNOTE_PERF_SCENARIO"),"check":flag("PINNOTE_UI_CHECK"),"tour":flag("PINNOTE_UI_TOUR")})
}

#[tauri::command]
pub fn perf_log(app: tauri::AppHandle, label: String, counters: Value) {
    let Some(state) = state() else { return };
    let Ok(mut perf) = state.lock() else { return };
    perf.windows.insert(label, counters);
    write(&app, &perf);
}

#[tauri::command]
pub fn perf_mark(app: tauri::AppHandle, name: String) {
    let Some(state) = state() else { return };
    let Ok(mut perf) = state.lock() else { return };
    perf.marks.push(json!({"name":name,"at":now_ms()}));
    write(&app, &perf);
}
