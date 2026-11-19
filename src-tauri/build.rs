fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "discover_recovery",
            "read_recovery",
            "claim_recovery",
            "release_recovery",
            "discard_recovery",
            "initialize_recovery",
            "control_recovery",
            "prepare_recovery",
            "commit_recovery",
            "cancel_recovery",
            "choose_agent_export",
            "prepare_agent_export",
            "commit_agent_export",
            "cancel_agent_export",
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
