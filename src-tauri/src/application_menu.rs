use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

const ACTIONS: [(&str, &str, &str); 10] = [
    ("new", "New…", "Cmd+N"),
    ("open", "Open…", "Cmd+O"),
    ("save", "Save", "Cmd+S"),
    ("save-as", "Save As…", "Cmd+Shift+S"),
    ("export-agent", "Export for Agent…", "Cmd+Shift+E"),
    ("undo", "Undo", "Cmd+Z"),
    ("redo", "Redo", "Cmd+Shift+Z"),
    ("cut", "Cut", "Cmd+X"),
    ("copy", "Copy", "Cmd+C"),
    ("paste", "Paste", "Cmd+V"),
];

pub fn menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = crate::document_lifecycle::protected_menu(app)?;
    let file = Submenu::with_id(app, "document-file", "File", true)?;
    let edit = Submenu::with_id(app, "document-edit", "Edit", true)?;
    for (index, (id, label, accelerator)) in ACTIONS.iter().enumerate() {
        let submenu = if index < 5 { &file } else { &edit };
        if index == 2 || index == 7 {
            submenu.append(&PredefinedMenuItem::separator(app)?)?;
        }
        // Enable only after the frontend action listener is installed.
        submenu.append(&MenuItem::with_id(
            app,
            *id,
            *label,
            false,
            Some(*accelerator),
        )?)?;
    }
    file.append(&PredefinedMenuItem::separator(app)?)?;
    file.append(&PredefinedMenuItem::close_window(app, None)?)?;
    edit.append(&PredefinedMenuItem::separator(app)?)?;
    edit.append(&PredefinedMenuItem::select_all(app, None)?)?;
    menu.remove_at(1)?;
    menu.insert(&file, 1)?;
    menu.remove_at(2)?;
    menu.insert(&edit, 2)?;
    let native_edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    app.manage(MenuState {
        file,
        edit,
        native_edit,
        native_dialog: AtomicBool::new(false),
    });
    Ok(menu)
}

pub fn dispatch(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();
    if id == "document-quit" {
        crate::document_lifecycle::request_close(app);
    } else if ACTIONS.iter().any(|(action, _, _)| *action == id) {
        // Ignore a queued custom action once a native picker owns focus.
        if !app
            .state::<MenuState>()
            .native_dialog
            .load(Ordering::SeqCst)
        {
            let _ = app.emit_to("main", "application-action", id);
        }
    }
}

#[derive(Clone, Deserialize)]
pub struct MenuActionState {
    id: String,
    label: String,
    enabled: bool,
}

#[tauri::command]
pub fn update_application_menu(
    app: tauri::AppHandle,
    items: Vec<MenuActionState>,
) -> Result<(), String> {
    if items.len() != ACTIONS.len()
        || ACTIONS
            .iter()
            .any(|(id, _, _)| items.iter().filter(|item| item.id == *id).count() != 1)
    {
        return Err("Invalid application menu state".into());
    }
    let menus = app.state::<MenuState>();
    for item in items {
        let submenu = if ACTIONS[..5].iter().any(|(id, _, _)| *id == item.id) {
            &menus.file
        } else {
            &menus.edit
        };
        // Keep updating the retained custom Edit submenu even while a native
        // file panel temporarily installs its predefined responder menu.
        let entry = submenu
            .get(&item.id)
            .and_then(|item| item.as_menuitem().cloned())
            .ok_or("Application action unavailable")?;
        entry
            .set_text(item.label)
            .map_err(|error| error.to_string())?;
        entry
            .set_enabled(item.enabled)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

struct MenuState {
    file: Submenu<tauri::Wry>,
    edit: Submenu<tauri::Wry>,
    native_edit: Submenu<tauri::Wry>,
    native_dialog: AtomicBool,
}

// AppKit file panels need predefined edit selectors: custom actions go through
// Tauri's event loop, which the panel's native modal loop can suspend.
pub struct DialogEditing(tauri::AppHandle);
impl DialogEditing {
    pub fn begin(app: &tauri::AppHandle) -> Result<Self, String> {
        let menu = app.menu().ok_or("Application menu unavailable")?;
        let menus = app.state::<MenuState>();
        menus.native_dialog.store(true, Ordering::SeqCst);
        let guard = Self(app.clone());
        menus
            .file
            .set_enabled(false)
            .map_err(|error| error.to_string())?;
        menu.remove(&menus.edit)
            .map_err(|error| error.to_string())?;
        menu.insert(&menus.native_edit, 2)
            .map_err(|error| error.to_string())?;
        Ok(guard)
    }
}
impl Drop for DialogEditing {
    fn drop(&mut self) {
        let menus = self.0.state::<MenuState>();
        if let Some(menu) = self.0.menu() {
            let _ = menu.remove(&menus.native_edit);
            if menu.get("document-edit").is_none() {
                let _ = menu.insert(&menus.edit, 2);
            }
        }
        menus.native_dialog.store(false, Ordering::SeqCst);
        let _ = menus.file.set_enabled(true);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextAction {
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
}

// Restrict the bridge to standard editing selectors. This preserves WKWebView's
// text selection, native undo manager and system pasteboard, including in dialogs.
#[tauri::command]
pub fn edit_focused_text(app: tauri::AppHandle, action: TextAction) -> Result<(), String> {
    app.run_on_main_thread(move || {
        use objc2::{sel, MainThreadMarker};
        use objc2_app_kit::NSApplication;
        let mtm = MainThreadMarker::new().expect("AppKit edits run on the main thread");
        let selector = match action {
            TextAction::Undo => sel!(undo:),
            TextAction::Redo => sel!(redo:),
            TextAction::Cut => sel!(cut:),
            TextAction::Copy => sel!(copy:),
            TextAction::Paste => sel!(paste:),
        };
        // SAFETY: these are AppKit's standard one-object-argument edit actions;
        // nil target uses the current first responder, and nil sender is valid.
        unsafe {
            NSApplication::sharedApplication(mtm).sendAction_to_from(selector, None, None);
        }
    })
    .map_err(|error| error.to_string())
}
