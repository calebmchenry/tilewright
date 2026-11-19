fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "choose_project",
            "read_project",
            "write_project",
            // Only the dedicated performance config grants these permissions.
            "performance_mode",
            "performance_event",
        ]),
    ))
    .expect("Could not build native permissions");
}
