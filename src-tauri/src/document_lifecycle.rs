use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

// Muda's predefined macOS Quit calls NSApplication.terminate directly, bypassing
// Tauri's ExitRequested callback. Replace that application submenu with a custom
// Quit action. application_menu installs the shared File/Edit actions next.
#[cfg(all(target_os = "macos", not(feature = "performance")))]
pub fn protected_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
    let menu = Menu::default(app)?;
    let app_menu = Submenu::with_items(
        app,
        "Tilewright",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Tilewright"), None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "document-quit", "Quit Tilewright", true, Some("Cmd+Q"))?,
        ],
    )?;
    menu.remove_at(0)?;
    menu.insert(&app_menu, 0)?;
    Ok(menu)
}

#[derive(Default)]
pub struct CloseGuard {
    pending: AtomicBool,
    approved: AtomicBool,
}

impl CloseGuard {
    pub fn approved(&self) -> bool {
        self.approved.load(Ordering::SeqCst)
    }
    fn take_request(&self) -> bool {
        self.pending.swap(false, Ordering::SeqCst)
    }
}

// Prevent natively before asking the webview. A request made before the listener
// is ready stays pending; an unavailable/crashed frontend cannot discard work.
pub fn request_close(app: &tauri::AppHandle) {
    app.state::<CloseGuard>()
        .pending
        .store(true, Ordering::SeqCst);
    let _ = app.emit_to("main", "document-close-requested", ());
}

#[tauri::command]
pub fn take_document_close_request(state: tauri::State<'_, CloseGuard>) -> bool {
    state.take_request()
}

#[tauri::command]
pub fn finish_document_close(app: tauri::AppHandle, state: tauri::State<'_, CloseGuard>) {
    state.approved.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_close_survives_startup_and_is_consumed_once_without_approval() {
        let guard = CloseGuard::default();
        assert!(!guard.approved());
        assert!(!guard.take_request());
        guard.pending.store(true, Ordering::SeqCst);
        guard.pending.store(true, Ordering::SeqCst);
        assert!(guard.take_request());
        assert!(!guard.take_request());
        assert!(!guard.approved());
        // Cancel does not grant an exit; a subsequent native request works again.
        guard.pending.store(true, Ordering::SeqCst);
        assert!(guard.take_request());
        assert!(!guard.approved());
    }
}
