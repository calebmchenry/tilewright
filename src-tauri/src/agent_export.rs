use crate::atomic_io::{write_synced, Stage};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::{self, File},
    io,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{
    ipc::{InvokeBody, Request},
    Manager,
};
use tauri_plugin_dialog::DialogExt;

const MAX_BYTES: usize = 268_435_456;
#[derive(Default)]
pub struct AgentExports(Mutex<Grants>);
#[derive(Default)]
struct Grants {
    next: u64,
    entries: HashMap<String, Destination>,
}
struct Destination {
    path: PathBuf,
    protected: Option<PathBuf>,
    prepared: Option<tempfile::NamedTempFile>,
}
#[derive(Serialize)]
pub struct ChosenExport {
    token: String,
    path: String,
}

fn message(error: impl std::fmt::Display) -> String {
    format!("Could not export for agent: {error}. Choose a separate JSON file in a writable folder and retry.")
}
fn separate_json(path: &Path, protected: Option<&Path>) -> io::Result<()> {
    if !path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
    {
        return Err(io::Error::other("Use the .json extension"));
    }
    let resolved = crate::project_files::selected_path(path.to_path_buf())?;
    if !resolved
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
    {
        return Err(io::Error::other(
            "The destination resolves to a non-JSON file",
        ));
    }
    if let Some(protected) = protected {
        let original = crate::project_files::selected_path(protected.to_path_buf())?;
        let same_inode = match (fs::metadata(&resolved), fs::metadata(&original)) {
            (Ok(a), Ok(b)) => a.dev() == b.dev() && a.ino() == b.ino(),
            _ => false,
        };
        if resolved == original || same_inode {
            return Err(io::Error::other(
                "The active project cannot be an export destination",
            ));
        }
    }
    Ok(())
}
impl Destination {
    fn validate(&self) -> io::Result<Option<fs::Permissions>> {
        separate_json(&self.path, self.protected.as_deref())?;
        match fs::symlink_metadata(&self.path) {
            Ok(meta) => {
                if !meta.is_file() {
                    return Err(io::Error::other("Destination is no longer a regular file"));
                }
                if meta.permissions().readonly() {
                    return Err(io::ErrorKind::PermissionDenied.into());
                }
                Ok(Some(meta.permissions()))
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }
    fn prepare(
        &mut self,
        bytes: &[u8],
        mut check: impl FnMut(Stage) -> io::Result<()>,
    ) -> io::Result<()> {
        if bytes.is_empty() || bytes.len() > MAX_BYTES {
            return Err(io::Error::other("Export must contain 1 byte to 256 MiB"));
        }
        if self.prepared.is_some() {
            return Err(io::Error::other("Export already prepared"));
        }
        let permissions = self.validate()?;
        let mut temp = tempfile::Builder::new()
            .prefix(".tilewright-agent-")
            .suffix(".tmp")
            .tempfile_in(
                self.path
                    .parent()
                    .ok_or_else(|| io::Error::other("Missing destination folder"))?,
            )?;
        if let Some(permissions) = permissions {
            temp.as_file().set_permissions(permissions)?;
        }
        write_synced(temp.as_file_mut(), bytes, &mut check)?;
        self.prepared = Some(temp);
        Ok(())
    }
    fn commit(
        mut self,
        mut check: impl FnMut(Stage) -> io::Result<()>,
    ) -> io::Result<Option<String>> {
        self.validate()?; // Recheck aliases, permissions and substitution after encoding/writing.
        let temp = self
            .prepared
            .take()
            .ok_or_else(|| io::Error::other("Export has not been prepared"))?;
        check(Stage::Rename)?;
        temp.persist(&self.path).map_err(|e| e.error)?;
        // Publication has happened: a later sync error must not claim cancellation/failure.
        let warning = check(Stage::ParentSync).and_then(|_| File::open(self.path.parent().unwrap()))
            .and_then(|dir| dir.sync_all()).err().map(|e| format!(
                "The complete export was written, but directory durability could not be confirmed: {e}. Retry export before disconnecting the disk."
            ));
        Ok(warning)
    }
}
impl Grants {
    fn grant(&mut self, path: PathBuf, protected: Option<PathBuf>) -> Result<ChosenExport, String> {
        separate_json(&path, protected.as_deref()).map_err(message)?;
        let path = crate::project_files::selected_path(path).map_err(message)?;
        let text = path
            .to_str()
            .ok_or("Choose a path with a valid Unicode name.")?
            .to_owned();
        // One export per application. Drop abandoned uncommitted grants/temp files.
        self.entries.clear();
        self.next += 1;
        let token = format!("agent-{}", self.next);
        self.entries.insert(
            token.clone(),
            Destination {
                path,
                protected,
                prepared: None,
            },
        );
        Ok(ChosenExport { token, path: text })
    }
}

#[tauri::command]
pub async fn choose_agent_export(
    app: tauri::AppHandle,
    protected_path: Option<String>,
    suggested_name: String,
) -> Result<Option<ChosenExport>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let name = if suggested_name.len() <= 4096 && !suggested_name.contains(['/', '\\', '\0']) {
            suggested_name
        } else {
            "Untitled.agent-map.json".into()
        };
        let dialog = app
            .dialog()
            .file()
            .set_title("Export for Agent")
            .add_filter("Agent map (JSON)", &["json"])
            .set_file_name(name);
        #[cfg(all(target_os = "macos", not(feature = "performance")))]
        let native_editing = crate::application_menu::DialogEditing::begin(&app)?;
        let chosen = dialog.blocking_save_file();
        #[cfg(all(target_os = "macos", not(feature = "performance")))]
        drop(native_editing);
        let Some(chosen) = chosen else {
            return Ok(None);
        };
        let path = chosen.into_path().map_err(message)?;
        app.state::<AgentExports>()
            .0
            .lock()
            .map_err(message)?
            .grant(path, protected_path.map(PathBuf::from))
            .map(Some)
    })
    .await
    .map_err(message)?
}
#[tauri::command]
pub async fn prepare_agent_export(
    app: tauri::AppHandle,
    request: Request<'_>,
) -> Result<(), String> {
    let token = request
        .headers()
        .get("x-export-token")
        .and_then(|v| v.to_str().ok())
        .ok_or("Missing export destination handle")?
        .to_owned();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected encoded export bytes".into());
    };
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err(message("Export must contain 1 byte to 256 MiB"));
    }
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let exports = app.state::<AgentExports>();
        let mut grants = exports.0.lock().map_err(message)?;
        grants
            .entries
            .get_mut(&token)
            .ok_or("Choose an export destination again")?
            .prepare(&bytes, |_| Ok(()))
            .map_err(message)
    })
    .await
    .map_err(message)?
}
#[tauri::command]
pub async fn commit_agent_export(
    app: tauri::AppHandle,
    token: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AgentExports>()
            .0
            .lock()
            .map_err(message)?
            .entries
            .remove(&token)
            .ok_or("Choose an export destination again")?
            .commit(|_| Ok(()))
            .map_err(message)
    })
    .await
    .map_err(message)?
}
#[tauri::command]
pub async fn cancel_agent_export(app: tauri::AppHandle, token: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AgentExports>()
            .0
            .lock()
            .map_err(message)?
            .entries
            .remove(&token);
        Ok(()) // Dropping a prepared private sibling never touches the chosen file.
    })
    .await
    .map_err(message)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};
    const NEW: &[u8] = include_bytes!("../../docs/examples/agent-map-v1.json");
    fn destination(path: PathBuf) -> Destination {
        Destination {
            path,
            protected: None,
            prepared: None,
        }
    }
    #[test]
    fn separate_destination_rejects_project_aliases_and_substitution() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("project.json"); // Open can read a project regardless of suffix.
        let link = dir.path().join("link.json");
        fs::write(&original, b"original project").unwrap();
        let mut grants = Grants::default();
        assert!(grants
            .grant(original.clone(), Some(original.clone()))
            .is_err());
        symlink(&original, &link).unwrap();
        assert!(grants.grant(link.clone(), Some(original.clone())).is_err());
        fs::remove_file(&link).unwrap();
        fs::hard_link(&original, &link).unwrap();
        assert!(grants.grant(link.clone(), Some(original.clone())).is_err());
        fs::remove_file(&link).unwrap();
        let choice = grants.grant(link.clone(), Some(original.clone())).unwrap();
        let mut entry = grants.entries.remove(&choice.token).unwrap();
        entry.prepare(NEW, |_| Ok(())).unwrap();
        symlink(&original, &link).unwrap();
        assert!(entry.commit(|_| Ok(())).is_err());
        assert_eq!(fs::read(original).unwrap(), b"original project");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
        assert!(grants
            .grant(dir.path().join("project.tilewright"), None)
            .is_err());
    }
    #[test]
    fn new_and_existing_exports_commit_complete_bytes_and_preserve_mode() {
        for existing in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("café 地図.agent-map.json");
            if existing {
                fs::write(&path, b"old").unwrap();
                fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
            }
            let mut entry = destination(path.clone());
            entry.prepare(NEW, |_| Ok(())).unwrap();
            if existing {
                assert_eq!(fs::read(&path).unwrap(), b"old");
            } else {
                assert!(!path.exists());
            }
            assert!(entry.commit(|_| Ok(())).unwrap().is_none());
            assert_eq!(fs::read(&path).unwrap(), NEW);
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                if existing { 0o640 } else { 0o600 }
            );
            assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
        }
    }
    #[test]
    fn cancellation_and_write_sync_rename_failure_never_publish_partial_output() {
        for existing in [false, true] {
            for failure in [
                None,
                Some(Stage::PartialWrite),
                Some(Stage::Sync),
                Some(Stage::Rename),
            ] {
                let dir = tempfile::tempdir().unwrap();
                let path = dir.path().join("map.json");
                if existing {
                    fs::write(&path, b"old").unwrap();
                }
                let mut entry = destination(path.clone());
                let check = |stage| {
                    if failure == Some(stage) {
                        Err(io::Error::other("injected failure"))
                    } else {
                        Ok(())
                    }
                };
                if entry.prepare(NEW, check).is_ok() && failure.is_some() {
                    assert!(entry.commit(check).is_err());
                } else {
                    drop(entry);
                } // Same drop path used by cancel_agent_export.
                if existing {
                    assert_eq!(fs::read(path).unwrap(), b"old");
                } else {
                    assert!(!path.exists());
                }
                assert_eq!(
                    fs::read_dir(dir.path()).unwrap().count(),
                    usize::from(existing)
                );
            }
        }
    }
    #[test]
    fn unavailable_readonly_nonregular_destinations_and_unknown_handles_reject() {
        let dir = tempfile::tempdir().unwrap();
        let mut entry = destination(dir.path().join("missing/map.json"));
        assert!(entry.prepare(NEW, |_| Ok(())).is_err());
        let path = dir.path().join("map.json");
        fs::write(&path, b"old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o400)).unwrap();
        assert!(destination(path.clone()).prepare(NEW, |_| Ok(())).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"old");
        let folder = dir.path().join("folder.json");
        fs::create_dir(&folder).unwrap();
        assert!(destination(folder).prepare(NEW, |_| Ok(())).is_err());
        let locked = dir.path().join("locked");
        fs::create_dir(&locked).unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o500)).unwrap();
        assert!(destination(locked.join("map.json"))
            .prepare(NEW, |_| Ok(()))
            .is_err());
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(Grants::default().entries.remove("agent-1").is_none());
    }
    #[test]
    fn directory_sync_warning_is_success_and_grants_are_single_use() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("map.json");
        let mut grants = Grants::default();
        let choice = grants.grant(path.clone(), None).unwrap();
        grants
            .entries
            .get_mut(&choice.token)
            .unwrap()
            .prepare(NEW, |_| Ok(()))
            .unwrap();
        let warning = grants
            .entries
            .remove(&choice.token)
            .unwrap()
            .commit(|s| {
                if s == Stage::ParentSync {
                    Err(io::Error::other("injected"))
                } else {
                    Ok(())
                }
            })
            .unwrap()
            .unwrap();
        assert!(warning.contains("complete export was written"));
        assert_eq!(fs::read(path).unwrap(), NEW);
        assert!(grants.entries.remove(&choice.token).is_none());
    }
}
