#[cfg(all(target_os = "macos", not(feature = "performance")))]
mod application_menu;
mod document_lifecycle;
mod project_files;
use tauri::Manager;

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(document_lifecycle::CloseGuard::default())
        .manage(project_files::ProjectFiles::default());
    #[cfg(all(target_os = "macos", not(feature = "performance")))]
    let builder = builder
        .menu(application_menu::menu)
        .on_menu_event(application_menu::dispatch);
    #[cfg(not(feature = "performance"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        project_files::choose_project,
        project_files::read_project,
        project_files::write_project,
        document_lifecycle::take_document_close_request,
        document_lifecycle::finish_document_close,
        application_menu::update_application_menu,
        application_menu::edit_focused_text
    ]);
    #[cfg(feature = "performance")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        project_files::choose_project,
        project_files::read_project,
        project_files::write_project,
        document_lifecycle::take_document_close_request,
        document_lifecycle::finish_document_close,
        performance_mode,
        performance_event
    ]);
    let app = builder
        .build(tauri::generate_context!())
        .expect("Tilewright could not start its desktop shell");
    app.run(|app, event| {
        // The dedicated benchmark frontend owns no editable workspace.
        if cfg!(feature = "performance") {
            return;
        }
        if app.state::<document_lifecycle::CloseGuard>().approved() {
            return;
        }
        match event {
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main" => {
                api.prevent_close();
                document_lifecycle::request_close(app);
            }
            tauri::RunEvent::ExitRequested { api, .. } => {
                api.prevent_exit();
                document_lifecycle::request_close(app);
            }
            _ => {}
        }
    });
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
