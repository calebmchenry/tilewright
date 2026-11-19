fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "choose_project",
            "read_project",
            "write_project",
            "take_document_close_request",
            "finish_document_close",
            "update_application_menu",
            "edit_focused_text",
            // Only the dedicated performance config grants these permissions.
            "performance_mode",
            "performance_event",
        ]),
    ))
    .expect("Could not build native permissions");
}
