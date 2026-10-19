//! Exercise the SDK boundary we rely on: signature verification before install,
//! normal version comparison, and macOS replacement in an isolated writable directory.
//! These fixtures use a throwaway test key, never the release signing key.
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};
use tauri_plugin_updater::UpdaterExt;

struct Server {
    endpoint: String,
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}
impl Server {
    fn start(version: &str, corrupt: bool) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let manifest = serde_json::json!({
            "version": version,
            "url": format!("{base}/update.app.tar.gz"),
            "signature": include_str!("fixtures/update.app.tar.gz.sig").trim(),
        })
        .to_string();
        let stop = Arc::new(AtomicBool::new(false));
        let done = stop.clone();
        let worker = thread::spawn(move || {
            while !done.load(Ordering::Relaxed) {
                let Ok((mut socket, _)) = listener.accept() else {
                    thread::sleep(Duration::from_millis(5));
                    continue;
                };
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut request = [0; 4096];
                let read = socket.read(&mut request).unwrap_or(0);
                let body: &[u8] =
                    if String::from_utf8_lossy(&request[..read]).starts_with("GET /latest.json ") {
                        manifest.as_bytes()
                    } else if corrupt {
                        b"corrupted installer"
                    } else {
                        include_bytes!("fixtures/update.app.tar.gz")
                    };
                write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
                socket.write_all(body).unwrap();
            }
        });
        Self {
            endpoint: format!("{base}/latest.json"),
            stop,
            thread: Some(worker),
        }
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        self.thread.take().unwrap().join().unwrap();
    }
}

#[test]
fn updater_verifies_download_before_replacing_an_app_and_rejects_older_versions() {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    let config: tauri::Config = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    context.config_mut().plugins = config.plugins;
    let app = tauri::test::mock_builder()
        .plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(include_str!("fixtures/update.pub").trim())
                .build(),
        )
        .build(context)
        .unwrap();
    let folder =
        std::env::temp_dir().join(format!("pinnote-updater-contract-{}", std::process::id()));
    let bundle = folder.join("Fixture.app");
    fs::create_dir_all(bundle.join("Contents/MacOS")).unwrap();
    fs::write(bundle.join("old-version"), "old").unwrap();
    let exe = bundle.join("Contents/MacOS/fixture");
    let make_updater = |server: &Server| {
        app.updater_builder()
            .executable_path(&exe)
            .endpoints(vec![server.endpoint.parse().unwrap()])
            .unwrap()
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap()
    };
    tauri::async_runtime::block_on(async {
        let old = Server::start("0.0.0", false);
        assert!(
            make_updater(&old).check().await.unwrap().is_none(),
            "old versions must not be offered"
        );
        let corrupt = Server::start("99.0.0", true);
        let update = make_updater(&corrupt).check().await.unwrap().unwrap();
        assert!(
            update.download(|_, _| {}, || {}).await.is_err(),
            "corrupted bytes must never reach install"
        );
        assert!(bundle.join("old-version").exists());
        let valid = Server::start("99.0.0", false);
        let update = make_updater(&valid).check().await.unwrap().unwrap();
        let bytes = update.download(|_, _| {}, || {}).await.unwrap();
        assert_eq!(bytes, include_bytes!("fixtures/update.app.tar.gz"));
        #[cfg(target_os = "macos")]
        {
            update.install(bytes).unwrap();
            assert!(!bundle.join("old-version").exists());
            assert_eq!(
                fs::read_to_string(bundle.join("Contents/Resources/version.txt")).unwrap(),
                "updated fixture\n"
            );
        }
        // Never launch a Windows installer from a unit test.
    });
    fs::remove_dir_all(folder).unwrap();
}
