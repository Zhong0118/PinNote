use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::Duration;
use tauri::{menu::MenuItem, AppHandle, Manager, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

pub struct UpdateMenu(pub MenuItem<Wry>);

#[derive(Default)]
pub struct UpdateState {
    busy: AtomicBool,
    notified: Mutex<Option<String>>,
}

impl UpdateState {
    fn start(&self) -> bool {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
            .is_ok()
    }

    fn should_prompt(&self, version: &str, manual: bool) -> bool {
        let mut notified = self.notified.lock().unwrap();
        if !manual && notified.as_deref() == Some(version) {
            return false;
        }
        *notified = Some(version.to_owned());
        true
    }
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
    if app.state::<super::QuitLock>().0.lock().unwrap().approved
        || !app.state::<UpdateState>().start()
    {
        return;
    }
    let _ = app.state::<UpdateMenu>().0.set_enabled(false);
    menu_status(&app, "正在检查更新…");
    tauri::async_runtime::spawn(async move {
        let _run = UpdateRun(app.clone());
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
    });
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
            check(app.clone(), false);
            tokio::time::sleep(Duration::from_secs(24 * 60 * 60)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlapping_manual_and_background_checks_are_ignored_until_finished() {
        let state = UpdateState::default();
        assert!(state.start());
        assert!(!state.start());
        state.busy.store(false, Ordering::Release);
        assert!(state.start());
    }

    #[test]
    fn background_reminds_once_per_version_but_manual_check_can_retry() {
        let state = UpdateState::default();
        assert!(state.should_prompt("1.1.4", false));
        assert!(!state.should_prompt("1.1.4", false));
        assert!(state.should_prompt("1.1.4", true));
        assert!(state.should_prompt("1.1.5", false));
    }
}
