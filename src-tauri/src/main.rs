mod project_files;

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(project_files::ProjectFiles::default());
    #[cfg(not(feature = "performance"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        project_files::choose_project,
        project_files::read_project,
        project_files::write_project
    ]);
    #[cfg(feature = "performance")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        project_files::choose_project,
        project_files::read_project,
        project_files::write_project,
        performance_mode,
        performance_event
    ]);
    builder
        .run(tauri::generate_context!())
        .expect("Tilewright could not start its desktop shell");
}

// Compiled only into the dedicated local performance build. No filesystem or
// arbitrary execution capability is exposed to the webview.
#[cfg(feature = "performance")]
#[tauri::command]
fn performance_mode() -> String {
    std::env::var("TILEWRIGHT_PERFORMANCE_MODE").unwrap_or_else(|_| "quick".into())
}

#[cfg(feature = "performance")]
#[tauri::command]
fn performance_event(payload: String) {
    use std::io::Write;
    println!("TW_PERF {payload}");
    let _ = std::io::stdout().flush();
}
