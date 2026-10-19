use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::{collections::BTreeSet, fs, path::PathBuf};
use tauri::{menu::MenuItem, AppHandle, Manager, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

pub struct UpdateMenu(pub MenuItem<Wry>);

const CHECK_INTERVAL: u64 = 24 * 60 * 60;
const MANUAL_COOLDOWN: u64 = 30;

#[derive(Default, Deserialize, Serialize)]
#[serde(default)]
struct UpdateHistory {
    last_check: Option<u64>,
    notified_versions: BTreeSet<String>,
}

impl UpdateHistory {
    fn remaining(&self, manual: bool, now: u64) -> u64 {
        let interval = if manual {
            MANUAL_COOLDOWN
        } else {
            CHECK_INTERVAL
        };
        self.last_check
            // A clock adjustment must not block checks indefinitely.
            .and_then(|last| now.checked_sub(last))
            .map(|elapsed| interval.saturating_sub(elapsed))
            .unwrap_or(0)
    }
}

pub struct UpdateState {
    busy: AtomicBool,
    history: Mutex<UpdateHistory>,
    path: PathBuf,
}

impl UpdateState {
    pub fn load(path: PathBuf) -> Self {
        let history = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|error| {
                eprintln!("Cannot read update history: {error}");
                UpdateHistory::default()
            }),
            Err(error) => {
                if error.kind() != std::io::ErrorKind::NotFound {
                    eprintln!("Cannot read update history: {error}");
                }
                UpdateHistory::default()
            }
        };
        Self {
            busy: AtomicBool::new(false),
            history: Mutex::new(history),
            path,
        }
    }

    fn save(&self, history: &UpdateHistory) {
        let result = serde_json::to_string(history)
            .map_err(|error| error.to_string())
            .and_then(|json| super::atomic_write(self.path.clone(), json));
        if let Err(error) = result {
            // Keep the in-memory throttle even if the data directory is not writable.
            eprintln!("Cannot save update history: {error}");
        }
    }

    fn start(&self) -> bool {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
            .is_ok()
    }

    fn remaining(&self, manual: bool, now: u64) -> u64 {
        self.history.lock().unwrap().remaining(manual, now)
    }

    fn begin_check(&self, manual: bool, now: u64) -> u64 {
        let mut history = self.history.lock().unwrap();
        let remaining = history.remaining(manual, now);
        if remaining == 0 {
            // Record attempts before networking, including offline/failed checks.
            history.last_check = Some(now);
            self.save(&history);
        }
        remaining
    }

    fn should_prompt(&self, version: &str, manual: bool) -> bool {
        let mut history = self.history.lock().unwrap();
        if history.notified_versions.insert(version.to_owned()) {
            self.save(&history);
            true
        } else {
            manual
        }
    }
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn menu_status(app: &AppHandle, text: &str) {
    let _ = app.state::<UpdateMenu>().0.set_text(text);
}

// A guard covers checks, dialogs, downloads and installation, including early errors.
struct UpdateRun(AppHandle);
impl Drop for UpdateRun {
    fn drop(&mut self) {
        menu_status(&self.0, "检查更新");
        let _ = self.0.state::<UpdateMenu>().0.set_enabled(true);
        self.0
            .state::<UpdateState>()
            .busy
            .store(false, Ordering::Release);
    }
}

async fn message(app: &AppHandle, text: impl Into<String>, confirm: bool) -> bool {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let dialog = app
        .dialog()
        .message(text)
        .title("PinNote")
        .kind(MessageDialogKind::Info);
    let dialog = if confirm {
        dialog.buttons(MessageDialogButtons::OkCancelCustom(
            "更新并重启".into(),
            "稍后".into(),
        ))
    } else {
        dialog.buttons(MessageDialogButtons::OkCustom("知道了".into()))
    };
    dialog.show(move |accepted| {
        let _ = tx.send(accepted);
    });
    rx.await.unwrap_or(false)
}

pub fn check(app: AppHandle, manual: bool) {
    tauri::async_runtime::spawn(check_once(app, manual));
}

async fn check_once(app: AppHandle, manual: bool) {
    if app.state::<super::QuitLock>().0.lock().unwrap().approved
        || !app.state::<UpdateState>().start()
    {
        return;
    }
    let _run = UpdateRun(app.clone());
    let remaining = app
        .state::<UpdateState>()
        .begin_check(manual, now_seconds());
    if remaining > 0 {
        if manual {
            show_cooldown(&app).await;
        }
        return;
    }
    let _ = app.state::<UpdateMenu>().0.set_enabled(false);
    menu_status(&app, "正在检查更新…");
    let mut report_error = manual;
    if let Err(error) = run_update(&app, manual, &mut report_error).await {
        eprintln!("Update failed: {error}");
        // An offline startup is silent. A requested check/install always gets feedback.
        if report_error {
            message(
                &app,
                format!("更新未完成\n{error}\n可以稍后从托盘重试"),
                false,
            )
            .await;
        }
    }
    show_cooldown(&app).await;
}

async fn show_cooldown(app: &AppHandle) {
    let remaining = app.state::<UpdateState>().remaining(true, now_seconds());
    if remaining > 0 {
        menu_status(app, "检查更新（稍后重试）");
        let _ = app.state::<UpdateMenu>().0.set_enabled(false);
        tokio::time::sleep(Duration::from_secs(remaining)).await;
    }
}

async fn run_update(app: &AppHandle, manual: bool, report_error: &mut bool) -> Result<(), String> {
    let updater = app
        .updater_builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "无法初始化更新检查")?;
    let Some(mut update) = updater.check().await.map_err(|error| {
        eprintln!("Update check: {error}");
        "无法连接更新服务，请检查网络后重试"
    })?
    else {
        if manual {
            message(
                app,
                format!("当前已是最新版本 {}", app.package_info().version),
                false,
            )
            .await;
        }
        return Ok(());
    };
    if !app
        .state::<UpdateState>()
        .should_prompt(&update.version, manual)
    {
        return Ok(());
    }
    menu_status(app, "发现新版本");
    if !message(
        app,
        format!(
            "发现新版本 {}\n当前版本 {}\n更新前会保存所有便签，完成后自动重启",
            update.version,
            app.package_info().version
        ),
        true,
    )
    .await
    {
        return Ok(());
    }
    *report_error = true;
    menu_status(app, "正在下载更新…");
    update.timeout = Some(Duration::from_secs(300));
    let mut downloaded = 0_u64;
    let mut last_percent = None;
    // download() verifies the signature before returning any bytes to install().
    let bytes = update
        .download(
            |chunk, total| {
                downloaded = downloaded.saturating_add(chunk as u64);
                if let Some(total) = total.filter(|total| *total > 0) {
                    let percent = (downloaded.saturating_mul(100) / total).min(100);
                    if last_percent != Some(percent) {
                        last_percent = Some(percent);
                        menu_status(app, &format!("正在下载更新… {percent}%"));
                    }
                }
            },
            || {},
        )
        .await
        .map_err(|error| {
            eprintln!("Update download: {error}");
            "下载或签名校验失败，未安装更新"
        })?;
    menu_status(app, "正在保存便签…");
    let attempt = super::prepare_update(app).await?;
    menu_status(app, "正在安装更新…");
    // Windows starts the installer and exits here; macOS replaces the .app then restarts.
    let result = tauri::async_runtime::spawn_blocking(move || update.install(bytes)).await;
    match result {
        Ok(Ok(())) => {
            app.state::<super::QuitLock>().0.lock().unwrap().approved = true;
            app.restart()
        }
        error => {
            super::resume_after_update(app, attempt);
            eprintln!("Update install: {error:?}");
            Err(
                "安装失败，便签已保存。请确认应用位于可写目录，或从 GitHub Releases 手动安装"
                    .into(),
            )
        }
    }
}

pub fn start_background_checks(app: AppHandle) {
    // Development builds must never replace the developer's application.
    if cfg!(debug_assertions) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(10)).await;
        loop {
            check_once(app.clone(), false).await;
            // Sleep only the remaining interval after a relaunch. Manual checks
            // can move the deadline; check_once rechecks it before each request.
            let remaining = app.state::<UpdateState>().remaining(false, now_seconds());
            tokio::time::sleep(Duration::from_secs(remaining.max(MANUAL_COOLDOWN))).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    struct HistoryFile(PathBuf);
    impl HistoryFile {
        fn new() -> Self {
            static ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let dir = std::env::temp_dir().join(format!(
                "pinnote-update-history-{}-{}-{}",
                std::process::id(),
                now_seconds(),
                ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&dir).unwrap();
            Self(dir.join("update-history.json"))
        }
        fn load(&self) -> UpdateState {
            UpdateState::load(self.0.clone())
        }
    }
    impl Drop for HistoryFile {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(self.0.parent().unwrap());
        }
    }

    #[test]
    fn overlapping_manual_and_background_checks_are_ignored_until_finished() {
        let file = HistoryFile::new();
        let state = file.load();
        assert!(state.start());
        assert!(!state.start());
        state.busy.store(false, Ordering::Release);
        assert!(state.start());
    }

    #[test]
    fn automatic_reminders_survive_restarts_but_manual_checks_can_retry() {
        let file = HistoryFile::new();
        let state = file.load();
        assert!(state.should_prompt("1.1.4", false));
        assert!(!state.should_prompt("1.1.4", false));
        drop(state);
        let restarted = file.load();
        assert!(!restarted.should_prompt("1.1.4", false));
        assert!(restarted.should_prompt("1.1.4", true));
        assert!(restarted.should_prompt("1.1.5", false));
        drop(restarted);
        assert!(!file.load().should_prompt("1.1.4", false));
        assert!(!file.load().should_prompt("1.1.5", false));
    }

    #[test]
    fn attempted_checks_survive_restart_and_wait_only_the_remaining_day() {
        let file = HistoryFile::new();
        assert_eq!(file.load().begin_check(false, 100_000), 0);
        let restarted = file.load();
        assert_eq!(restarted.remaining(false, 100_010), 86_390);
        assert_eq!(restarted.begin_check(false, 186_399), 1);
        // Suppressed checks must not postpone the original deadline.
        assert_eq!(file.load().begin_check(false, 186_400), 0);
        assert_eq!(file.load().remaining(false, 186_400), 86_400);
    }

    #[test]
    fn manual_checks_bypass_daily_interval_but_share_a_persistent_cooldown() {
        let file = HistoryFile::new();
        assert_eq!(file.load().begin_check(false, 100_000), 0);
        assert_eq!(file.load().begin_check(true, 100_029), 1);
        assert_eq!(file.load().begin_check(true, 100_030), 0);
        assert_eq!(file.load().begin_check(true, 100_031), 29);
        assert_eq!(file.load().remaining(false, 100_031), 86_399);
    }

    #[test]
    fn manually_seen_versions_do_not_trigger_later_automatic_reminders() {
        let file = HistoryFile::new();
        assert!(file.load().should_prompt("1.1.4", true));
        assert!(!file.load().should_prompt("1.1.4", false));
    }

    #[test]
    fn corrupt_or_old_history_recovers_without_touching_notes() {
        let file = HistoryFile::new();
        let notes = file.0.with_file_name("notes.json");
        fs::write(&notes, b"personal notes fixture").unwrap();
        for bytes in ["{broken", "{}"] {
            fs::write(&file.0, bytes).unwrap();
            let state = file.load();
            assert_eq!(state.begin_check(false, 100_000), 0);
            assert!(state.should_prompt("1.1.4", false));
            assert_eq!(file.load().remaining(false, 100_001), 86_399);
            assert!(!file.load().should_prompt("1.1.4", false));
        }
        assert_eq!(fs::read(&notes).unwrap(), b"personal notes fixture");
    }

    #[test]
    fn clock_rollback_repairs_the_deadline_instead_of_blocking_updates() {
        let file = HistoryFile::new();
        file.load().begin_check(false, 200_000);
        assert_eq!(file.load().begin_check(false, 100_000), 0);
        assert_eq!(file.load().remaining(false, 100_001), 86_399);
    }

    #[test]
    fn write_failure_keeps_in_memory_throttle_and_reminder_deduplication() {
        let file = HistoryFile::new();
        let state = file.load();
        fs::create_dir(&file.0).unwrap(); // destination cannot be replaced by a file
        assert_eq!(state.begin_check(false, 100_000), 0);
        assert_eq!(state.begin_check(true, 100_001), 29);
        assert!(state.should_prompt("1.1.4", false));
        assert!(!state.should_prompt("1.1.4", false));
    }
}
