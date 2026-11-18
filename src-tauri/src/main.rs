fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Tilewright could not start its desktop shell");
}
