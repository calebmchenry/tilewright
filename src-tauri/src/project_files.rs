use crate::atomic_io::{write_synced, Stage};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{self, Read},
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    Manager,
};
use tauri_plugin_dialog::DialogExt;

// Matches the v1 codec policy. Enforced before allocation and while reading.
const MAX_BYTES: u64 = 268_435_456;

#[derive(Default)]
pub struct ProjectFiles(Mutex<Grants>);
#[derive(Default)]
struct Grants {
    next: u64,
    paths: HashMap<String, PathBuf>,
}
#[derive(Serialize)]
pub struct ChosenProject {
    token: String,
    path: String,
}
impl Grants {
    fn grant(&mut self, path: PathBuf) -> Result<ChosenProject, String> {
        let text = path
            .to_str()
            .ok_or("Choose a path with a valid Unicode name.")?
            .to_owned();
        self.next += 1;
        let token = self.next.to_string();
        self.paths.insert(token.clone(), path);
        Ok(ChosenProject { token, path: text })
    }
    fn path(&self, token: &str) -> Result<&Path, String> {
        self.paths.get(token).map(PathBuf::as_path).ok_or_else(|| {
            "This file is not authorized. Choose it with Open or Save As again.".into()
        })
    }
}

fn io_message(action: &str, path: &Path, error: io::Error) -> String {
    let help = match error.kind() {
        io::ErrorKind::PermissionDenied => {
            "Check file and folder permissions, or use Save As in a writable folder."
        }
        io::ErrorKind::NotFound => {
            "The file or folder is unavailable. Reconnect the drive or choose another location."
        }
        _ => "Check the disk's availability and free space, then retry or choose another location.",
    };
    format!("Could not {action} “{}”: {error}. {help}", path.display())
}

// Resolve a selected symlink to its target, including parent directory symlinks.
// Never create directories or infer an extension after the overwrite confirmation.
fn selected_path(path: PathBuf) -> io::Result<PathBuf> {
    match fs::symlink_metadata(&path) {
        Ok(_) => path.canonicalize(),
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            let parent = path
                .parent()
                .ok_or_else(|| io::Error::other("Missing parent folder"))?;
            let name = path
                .file_name()
                .ok_or_else(|| io::Error::other("Missing filename"))?;
            Ok(parent.canonicalize()?.join(name))
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn choose_project(
    app: tauri::AppHandle,
    save: bool,
    current: Option<String>,
    suggested_name: Option<String>,
) -> Result<Option<ChosenProject>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let files = app.state::<ProjectFiles>();
        let previous = current
            .map(|token| {
                files
                    .0
                    .lock()
                    .map_err(|_| "File access is unavailable; restart the app.".to_string())?
                    .path(&token)
                    .map(Path::to_path_buf)
            })
            .transpose()?;
        let mut dialog = app
            .dialog()
            .file()
            .add_filter("Tilewright project", &["tilewright"]);
        if save {
            dialog = dialog.set_title("Save Tilewright project").set_file_name(
                suggested_name
                    .filter(|name| name.len() <= 4096 && !name.contains(['/', '\\', '\0']))
                    .unwrap_or_else(|| "Untitled.tilewright".into()),
            );
            if let Some(path) = previous {
                if let Some(parent) = path.parent() {
                    dialog = dialog.set_directory(parent);
                }
                if let Some(name) = path.file_name() {
                    dialog = dialog.set_file_name(name.to_string_lossy());
                }
            }
        } else {
            dialog = dialog.set_title("Open Tilewright project");
        }
        #[cfg(all(target_os = "macos", not(feature = "performance")))]
        let native_editing = crate::application_menu::DialogEditing::begin(&app)?;
        let chosen = if save {
            dialog.blocking_save_file()
        } else {
            dialog.blocking_pick_file()
        };
        #[cfg(all(target_os = "macos", not(feature = "performance")))]
        drop(native_editing);
        let Some(chosen) = chosen else {
            return Ok(None);
        };
        let path = chosen
            .into_path()
            .map_err(|e| format!("Choose a local project file: {e}"))?;
        if save
            && !path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("tilewright"))
        {
            return Err(
                "Save the project with a .tilewright extension. Choose Save As again.".into(),
            );
        }
        let path = selected_path(path.clone())
            .map_err(|e| io_message("access this location", &path, e))?;
        let result = files
            .0
            .lock()
            .map_err(|_| "File access is unavailable; restart the app.".to_string())?
            .grant(path);
        result.map(Some)
    })
    .await
    .map_err(|e| format!("File dialog failed: {e}. Try again."))?
}

fn read_bounded(path: &Path, limit: u64) -> io::Result<Vec<u8>> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW)
        .open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(io::Error::other("Choose a regular project file"));
    }
    if metadata.len() > limit {
        return Err(io::Error::other("Project exceeds the 256 MiB file limit"));
    }
    read_stream(file, limit)
}
fn read_stream(reader: impl Read, limit: u64) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(io::Error::other("Project exceeds the 256 MiB file limit"));
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn read_project(app: tauri::AppHandle, token: String) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let files = app.state::<ProjectFiles>();
        let grants = files
            .0
            .lock()
            .map_err(|_| "File access is unavailable; restart the app.".to_string())?;
        let path = grants.path(&token)?;
        read_bounded(path, MAX_BYTES)
            .map(Response::new)
            .map_err(|e| io_message("read project", path, e))
    })
    .await
    .map_err(|e| format!("Project read failed: {e}. Try again."))?
}

// All fallible pre-commit work targets a private sibling. Persist is one atomic
// rename on the same filesystem; drop removes the temp file after any failure.
fn atomic_write(
    path: &Path,
    bytes: &[u8],
    mut check: impl FnMut(Stage) -> io::Result<()>,
) -> io::Result<Option<String>> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err(io::Error::other("Project exceeds the 256 MiB file limit"));
    }
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("Missing destination folder"))?;
    let permissions = match fs::symlink_metadata(path) {
        Ok(meta) => {
            if !meta.is_file() {
                return Err(io::Error::other(
                    "Destination is no longer a regular file; choose Save As again",
                ));
            }
            if meta.permissions().readonly() {
                return Err(io::Error::from(io::ErrorKind::PermissionDenied));
            }
            Some(meta.permissions())
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => None,
        Err(e) => return Err(e),
    };
    let mut temp = tempfile::Builder::new()
        .prefix(".tilewright-")
        .suffix(".tmp")
        .tempfile_in(parent)?;
    if let Some(permissions) = permissions {
        temp.as_file().set_permissions(permissions)?;
    }
    write_synced(temp.as_file_mut(), bytes, &mut check)?;
    check(Stage::Rename)?;
    temp.persist(path).map_err(|e| e.error)?;
    // Commit already happened. A directory flush failure is a durability warning,
    // never an apparent failed write with an incorrectly unchanged active path.
    let warning = File::open(parent).and_then(|dir| dir.sync_all()).err().map(|e|
        format!("The complete project was saved, but directory durability could not be confirmed: {e}. Keep the app open and retry Save before disconnecting the disk."));
    Ok(warning)
}

#[tauri::command]
pub async fn write_project(
    app: tauri::AppHandle,
    request: Request<'_>,
) -> Result<Option<String>, String> {
    let token = request
        .headers()
        .get("x-project-token")
        .and_then(|value| value.to_str().ok())
        .ok_or("Missing project handle. Choose Save As again.")?
        .to_owned();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected encoded project bytes.".into());
    };
    if bytes.len() as u64 > MAX_BYTES {
        return Err("Project exceeds the 256 MiB file limit.".into());
    }
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let files = app.state::<ProjectFiles>();
        // Serialize native writes, including calls outside the editor coordinator.
        let grants = files
            .0
            .lock()
            .map_err(|_| "File access is unavailable; restart the app.".to_string())?;
        let path = grants.path(&token)?;
        atomic_write(path, &bytes, |_| Ok(())).map_err(|e| io_message("save project", path, e))
    })
    .await
    .map_err(|e| format!("Project write failed: {e}. Check the destination before retrying."))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};
    const OLD: &[u8] = include_bytes!("../../docs/examples/project-v1.tilewright");
    const NEW: &[u8] = include_bytes!("../../tests/fixtures/project-v1.canonical.tilewright");
    #[test]
    fn atomic_unicode_round_trip_and_permissions() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Map café 地図.tilewright");
        atomic_write(&path, OLD, |_| Ok(())).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
        atomic_write(&path, NEW, |_| Ok(())).unwrap();
        assert_eq!(read_bounded(&path, MAX_BYTES).unwrap(), NEW);
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o640
        );
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn write_sync_rename_failures_preserve_original_and_clean_temp() {
        for stage in [Stage::PartialWrite, Stage::Sync, Stage::Rename] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("Original.tilewright");
            fs::write(&path, OLD).unwrap();
            assert!(atomic_write(&path, NEW, |s| if s == stage {
                Err(io::Error::other("injected failure"))
            } else {
                Ok(())
            })
            .is_err());
            assert_eq!(read_bounded(&path, MAX_BYTES).unwrap(), OLD);
            assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
        }
    }
    #[test]
    fn failed_new_save_leaves_no_destination() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("New.tilewright");
        assert!(atomic_write(&path, NEW, |_| Err(io::Error::other(
            "injected write failure"
        )))
        .is_err());
        assert!(!path.exists());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }
    #[test]
    fn real_rename_failure_keeps_destination_readable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Original.tilewright");
        fs::write(&path, OLD).unwrap();
        assert!(atomic_write(&path, NEW, |stage| {
            if stage == Stage::Rename {
                // Remove the source immediately before persist to make rename fail.
                for entry in fs::read_dir(dir.path())? {
                    let entry = entry?;
                    if entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with(".tilewright-")
                    {
                        fs::remove_file(entry.path())?;
                    }
                }
            }
            Ok(())
        })
        .is_err());
        assert_eq!(read_bounded(&path, MAX_BYTES).unwrap(), OLD);
    }
    #[test]
    fn unavailable_read_only_and_nonregular_paths_reject() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing/file.tilewright");
        assert!(read_bounded(&path, MAX_BYTES).is_err());
        assert!(atomic_write(&path, NEW, |_| Ok(())).is_err());
        let path = dir.path().join("Read only.tilewright");
        fs::write(&path, OLD).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o400)).unwrap();
        assert!(atomic_write(&path, NEW, |_| Ok(())).is_err());
        assert_eq!(read_bounded(&path, MAX_BYTES).unwrap(), OLD);
        assert!(read_bounded(dir.path(), MAX_BYTES).is_err());
        assert!(atomic_write(dir.path(), NEW, |_| Ok(())).is_err());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
        assert!(read_bounded(&path, MAX_BYTES).is_err());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    }
    #[test]
    fn read_size_growth_and_midstream_errors() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Map.tilewright");
        fs::write(&path, OLD).unwrap();
        assert!(read_bounded(&path, 5).is_err());
        assert!(read_stream(&OLD[..], 5).is_err());
        struct Broken;
        impl Read for Broken {
            fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
                Err(io::Error::other("injected read failure"))
            }
        }
        assert!(read_stream(io::Cursor::new(b"partial").chain(Broken), 100).is_err());
        assert_eq!(fs::read(&path).unwrap(), OLD);
    }
    #[test]
    fn selected_symlink_writes_target_and_unselected_handles_reject() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Original.tilewright");
        let link = dir.path().join("Link.tilewright");
        fs::write(&path, OLD).unwrap();
        symlink(&path, &link).unwrap();
        let mut grants = Grants::default();
        assert!(grants.path("/etc/passwd").is_err());
        assert!(grants.path("1").is_err());
        let choice = grants.grant(selected_path(link.clone()).unwrap()).unwrap();
        atomic_write(grants.path(&choice.token).unwrap(), NEW, |_| Ok(())).unwrap();
        assert_eq!(fs::read(&path).unwrap(), NEW);
        assert!(fs::symlink_metadata(link).unwrap().is_symlink());
    }
    #[test]
    fn interrupted_process_keeps_original() {
        const CHILD_PATH: &str = "TILEWRIGHT_ATOMIC_TEST_PATH";
        if let Ok(path) = std::env::var(CHILD_PATH) {
            let _ = atomic_write(Path::new(&path), NEW, |stage| {
                if stage == Stage::PartialWrite {
                    std::process::exit(73);
                }
                Ok(())
            });
            panic!("child should exit during write");
        }
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Interrupted 地図.tilewright");
        fs::write(&path, OLD).unwrap();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "project_files::tests::interrupted_process_keeps_original",
            ])
            .env(CHILD_PATH, &path)
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(73));
        assert_eq!(read_bounded(&path, MAX_BYTES).unwrap(), OLD);
    }
}
