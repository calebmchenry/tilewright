use crate::atomic_io::{write_synced, Stage};
use rustix::fs::{self as fd, AtFlags, FileType, Mode, OFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::File,
    io::{self, Read},
    path::{Component, Path},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    ipc::{InvokeBody, Request},
    Manager,
};
use uuid::Uuid;

#[path = "recovery_discovery.rs"]
mod discovery;
pub use discovery::*;

const RECORD: u64 = 65_536;
const PAYLOAD: u64 = 268_435_456;
const CAP: u64 = 1_073_741_824;
const SAFE: u64 = 9_007_199_254_740_991;
fn invalid(message: &str) -> io::Error {
    io::Error::other(message)
}
// Nullable wire fields are still required. Serde's default Option behavior would
// otherwise accept a missing field as null in a corrupted/incomplete record.
fn required<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    Option::deserialize(deserializer)
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn uuid(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}
fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Every descendant operation is relative to an open, no-follow directory.
/// Replacing a pathname with a symlink cannot redirect recovery into a project.
struct Directory(File);
impl Directory {
    fn root(path: &Path) -> io::Result<Self> {
        if !path.is_absolute() {
            return Err(invalid("Recovery root must be absolute"));
        }
        let mut dir = Self(File::open("/")?);
        for component in path.components() {
            if let Component::Normal(name) = component {
                let name = name
                    .to_str()
                    .ok_or_else(|| invalid("Invalid recovery path"))?;
                dir = dir.child(name, true)?;
            }
        }
        Ok(dir)
    }
    fn child(&self, name: &str, create: bool) -> io::Result<Self> {
        if create {
            match fd::mkdirat(&self.0, name, Mode::from_raw_mode(0o700)) {
                Ok(()) => self.0.sync_all()?,
                Err(rustix::io::Errno::EXIST) => {}
                Err(e) => return Err(e.into()),
            }
        }
        let file = File::from(fd::openat(
            &self.0,
            name,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )?);
        Ok(Self(file))
    }
    fn file(&self, name: &str, create: bool) -> io::Result<File> {
        let flags = if create {
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL
        } else {
            OFlags::RDONLY
        };
        let file = File::from(fd::openat(
            &self.0,
            name,
            flags | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::from_raw_mode(0o600),
        )?);
        if !file.metadata()?.is_file() {
            return Err(invalid("Unexpected nonregular recovery file"));
        }
        Ok(file)
    }
    fn read(&self, name: &str, limit: u64) -> io::Result<Vec<u8>> {
        let file = self.file(name, false)?;
        if file.metadata()?.len() > limit {
            return Err(invalid("Recovery file exceeds limit"));
        }
        let mut bytes = Vec::new();
        file.take(limit + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > limit {
            return Err(invalid("Recovery file exceeds limit"));
        }
        Ok(bytes)
    }
    fn names(&self) -> io::Result<Vec<String>> {
        let mut names = Vec::new();
        for entry in fd::Dir::read_from(&self.0)? {
            let entry = entry?;
            let name = entry
                .file_name()
                .to_str()
                .map_err(|_| invalid("Unknown recovery filename"))?;
            if name != "." && name != ".." {
                names.push(name.to_owned());
            }
            if names.len() > 256 {
                return Err(invalid(
                    "Recovery storage is full: too many directory entries",
                ));
            }
        }
        Ok(names)
    }
    fn remove_tree(&self, name: &str) -> io::Result<()> {
        // Only known generation/pending layouts may be removed. Never recurse
        // into an unknown directory or follow even a final-component symlink.
        let dir = self.child(name, false)?;
        let names = dir.names()?;
        if names
            .iter()
            .any(|n| n != "metadata.json" && n != "project.tilewright")
        {
            return Err(invalid("Unsupported recovery generation layout"));
        }
        for file in names {
            fd::unlinkat(&dir.0, file.as_str(), AtFlags::empty())?;
        }
        fd::unlinkat(&self.0, name, AtFlags::REMOVEDIR)?;
        self.0.sync_all()
    }
    fn replace(
        &self,
        name: &str,
        bytes: &[u8],
        check: &mut impl FnMut(Stage) -> io::Result<()>,
    ) -> io::Result<()> {
        if bytes.len() as u64 > RECORD {
            return Err(invalid("Recovery metadata exceeds limit"));
        }
        let temp = format!(".state-{}", Uuid::new_v4());
        let result = (|| {
            write_synced(&mut self.file(&temp, true)?, bytes, check)?;
            check(Stage::Rename)?;
            fd::renameat(&self.0, &temp, &self.0, name)?;
            check(Stage::ParentSync)?;
            self.0.sync_all()
        })();
        let _ = fd::unlinkat(&self.0, &temp, AtFlags::empty());
        result
    }
    fn usage(&self, depth: usize, count: &mut usize) -> io::Result<u64> {
        if depth > 3 {
            return Err(invalid("Unsupported recovery directory depth"));
        }
        let mut total = 0u64;
        for name in self.names()? {
            *count += 1;
            if *count > 1024 {
                return Err(invalid("Recovery storage is full: too many entries"));
            }
            let stat = fd::statat(&self.0, name.as_str(), AtFlags::SYMLINK_NOFOLLOW)?;
            let size = match FileType::from_raw_mode(stat.st_mode) {
                FileType::Directory => self.child(&name, false)?.usage(depth + 1, count)?,
                FileType::RegularFile => stat.st_size.max(0) as u64,
                _ => {
                    return Err(invalid(
                        "Unsupported recovery entry (symlink or nonregular file)",
                    ))
                }
            };
            total = total
                .checked_add(size)
                .ok_or_else(|| invalid("Recovery size overflow"))?;
        }
        Ok(total)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedContext {
    pub path: String,
    pub saved_at: u64,
    pub byte_hash: String,
    pub canonical_hash: String,
}
impl SavedContext {
    fn validate(&self) -> io::Result<()> {
        let digest = |s: &str| {
            s.len() == 64
                && s.bytes()
                    .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        };
        if !Path::new(&self.path).is_absolute()
            || self.path.len() > 4096
            || self.saved_at > SAFE
            || !digest(&self.byte_hash)
            || !digest(&self.canonical_hash)
        {
            return Err(invalid("Invalid saved recovery context"));
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Active,
    Resolved,
    Discarded,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Control {
    document_id: String,
    writer_id: String,
    epoch: u64,
    status: Status,
    #[serde(deserialize_with = "required")]
    saved: Option<SavedContext>,
}
impl Control {
    fn validate(&self) -> io::Result<()> {
        if !uuid(&self.document_id) || !uuid(&self.writer_id) || self.epoch > SAFE {
            return Err(invalid("Invalid recovery identity"));
        }
        if let Some(saved) = &self.saved {
            saved.validate()?;
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct State {
    format: String,
    version: u8,
    document_id: String,
    writer_id: String,
    epoch: u64,
    next_sequence: u64,
    status: Status,
    #[serde(deserialize_with = "required")]
    saved: Option<SavedContext>,
    #[serde(deserialize_with = "required")]
    resolved_through: Option<u64>,
    #[serde(deserialize_with = "required")]
    restored_from: Option<u64>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Ticket {
    document_id: String,
    writer_id: String,
    epoch: u64,
    sequence: u64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Capture {
    document_id: String,
    writer_id: String,
    epoch: u64,
    captured_at: u64,
    history_revision: u64,
    document_version: u64,
    #[serde(deserialize_with = "required")]
    saved_revision: Option<u64>,
    dirty: bool,
    display_name: String,
    #[serde(deserialize_with = "required")]
    saved: Option<SavedContext>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Metadata {
    format: String,
    version: u8,
    document_id: String,
    writer_id: String,
    epoch: u64,
    sequence: u64,
    captured_at: u64,
    history_revision: u64,
    document_version: u64,
    #[serde(deserialize_with = "required")]
    saved_revision: Option<u64>,
    dirty: bool,
    display_name: String,
    #[serde(deserialize_with = "required")]
    saved: Option<SavedContext>,
    project_format: String,
    project_version: u8,
    byte_length: u64,
    sha256: String,
    completed_at: u64,
}
struct Pending {
    ticket: Ticket,
    name: String,
}
#[derive(Default)]
pub struct Recovery(Mutex<Option<RecoveryStore>>);
struct RecoveryStore {
    live: std::collections::HashSet<String>,
    startup_warning: Option<String>,
    retired: HashMap<String, State>,
    root: Directory,
    _lock: File,
    pending: Option<Pending>,
    cap: u64,
    lineages: usize,
}
impl RecoveryStore {
    fn open(path: &Path) -> io::Result<Self> {
        let root = Directory::root(path)?;
        fd::fchmod(&root.0, Mode::from_raw_mode(0o700))?;
        let lock = File::from(fd::openat(
            &root.0,
            ".lock",
            OFlags::RDWR | OFlags::CREATE | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::from_raw_mode(0o600),
        )?);
        if !lock.metadata()?.is_file() {
            return Err(invalid("Invalid recovery lock"));
        }
        fd::flock(&lock, fd::FlockOperation::NonBlockingLockExclusive).map_err(|_| {
            invalid("Recovery unavailable: another Tilewright instance owns the recovery store")
        })?;
        let mut store = Self {
            live: Default::default(),
            startup_warning: None,
            retired: HashMap::new(),
            root,
            _lock: lock,
            pending: None,
            cap: CAP,
            lineages: 10,
        };
        // Bad entries must remain reviewable without preventing discovery of
        // independent valid work. Writes still require successful cleanup.
        store.startup_warning = store.cleanup().err().map(|e| e.to_string());
        Ok(store)
    }
    fn state(&self, id: &str) -> io::Result<State> {
        let dir = self.root.child(id, false)?;
        let state: State = serde_json::from_slice(&dir.read("state.json", RECORD)?)?;
        if state.format != "tilewright-recovery"
            || state.version != 1
            || state.document_id != id
            || !uuid(&state.writer_id)
            || state.epoch > SAFE
            || state.next_sequence == 0
            || state.next_sequence >= SAFE
            || state
                .resolved_through
                .is_some_and(|n| n >= state.next_sequence)
            || state
                .restored_from
                .is_some_and(|n| n >= state.next_sequence)
        {
            return Err(invalid("Unsupported or invalid recovery state"));
        }
        if let Some(saved) = &state.saved {
            saved.validate()?;
        }
        Ok(state)
    }
    fn capacity(&self, extra: u64, reserve: u64) -> io::Result<()> {
        let used = self.root.usage(0, &mut 0)?;
        if used.saturating_add(extra).saturating_add(reserve) > self.cap {
            return Err(invalid(
                "Recovery storage is full. Save the map or review recovery entries.",
            ));
        }
        Ok(())
    }
    fn write_state(
        &self,
        state: &State,
        check: &mut impl FnMut(Stage) -> io::Result<()>,
    ) -> io::Result<()> {
        let bytes = serde_json::to_vec(state)?;
        self.capacity(bytes.len() as u64, 0)?;
        self.root
            .child(&state.document_id, false)?
            .replace("state.json", &bytes, check)
    }
    fn control(
        &mut self,
        input: Control,
        check: &mut impl FnMut(Stage) -> io::Result<()>,
    ) -> io::Result<Option<String>> {
        input.validate()?;
        let mut state = match self.state(&input.document_id) {
            Ok(s) => s,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                if input.status != Status::Active
                    && fd::statat(&self.root.0, &input.document_id, AtFlags::SYMLINK_NOFOLLOW)
                        .is_err_and(|error| error == rustix::io::Errno::NOENT)
                {
                    if let Some(previous) = self.retired.get_mut(&input.document_id) {
                        if input.writer_id != previous.writer_id || input.epoch < previous.epoch {
                            return Err(invalid("Stale retired recovery lineage"));
                        }
                        previous.epoch = input.epoch;
                        previous.status = input.status;
                        previous.saved = input.saved;
                    }
                    return Ok(None); // No owned data: resolution needs no capacity slot.
                }
                self.capacity(RECORD, RECORD)?;
                // Empty resolved directories are removed, so rapid New/Open cannot
                // grow an unbounded collection of state-only lineages.
                let count = self.root.names()?.iter().filter(|n| uuid(n)).count();
                if count >= self.lineages {
                    return Err(invalid("Recovery storage is full: ten unresolved maps. Save or review recovery entries."));
                }
                if let Some(previous) = self.retired.get(&input.document_id) {
                    if input.writer_id != previous.writer_id || input.epoch <= previous.epoch {
                        return Err(invalid("Stale retired recovery lineage"));
                    }
                }
                self.root.child(&input.document_id, true)?;
                self.retired
                    .get(&input.document_id)
                    .cloned()
                    .unwrap_or_else(|| State {
                        format: "tilewright-recovery".into(),
                        version: 1,
                        document_id: input.document_id.clone(),
                        writer_id: input.writer_id.clone(),
                        epoch: input.epoch,
                        next_sequence: 1,
                        status: Status::Active,
                        saved: None,
                        resolved_through: None,
                        restored_from: None,
                    })
            }
            Err(e) => return Err(e),
        };
        if state.writer_id != input.writer_id
            || (input.epoch < state.epoch
                || (input.epoch == state.epoch && input.status != state.status))
        {
            return Err(invalid("Stale recovery writer or epoch"));
        }
        state.epoch = input.epoch;
        state.status = input.status;
        state.saved = input.saved;
        if state.status != Status::Active {
            state.resolved_through = Some(state.next_sequence - 1);
        }
        self.write_state(&state, check)?; // durable marker precedes all deletion
        if state.status == Status::Active {
            self.live.insert(state.document_id.clone());
        } else {
            self.live.remove(&state.document_id);
        }
        if self
            .pending
            .as_ref()
            .is_some_and(|p| p.ticket.document_id == state.document_id)
        {
            self.pending = None;
        }
        Ok(check(Stage::Cleanup)
            .and_then(|_| self.cleanup())
            .err()
            .map(|e| format!("Recovery bookkeeping completed; cleanup pending: {e}")))
    }
    fn matches(&self, ticket: &Ticket) -> io::Result<State> {
        if !uuid(&ticket.document_id)
            || !uuid(&ticket.writer_id)
            || ticket.epoch > SAFE
            || ticket.sequence == 0
            || ticket.sequence >= SAFE
        {
            return Err(invalid("Invalid recovery ticket"));
        }
        let state = self.state(&ticket.document_id)?;
        if state.writer_id != ticket.writer_id
            || state.epoch != ticket.epoch
            || state.status != Status::Active
            || state.resolved_through.is_some_and(|n| ticket.sequence <= n)
        {
            return Err(invalid("Stale recovery publication"));
        }
        Ok(state)
    }
    fn prepare(
        &mut self,
        capture: Capture,
        bytes: &[u8],
        check: &mut impl FnMut(Stage) -> io::Result<()>,
    ) -> io::Result<Ticket> {
        if self.pending.is_some() {
            return Err(invalid("A recovery generation is already pending"));
        }
        if !uuid(&capture.document_id)
            || !uuid(&capture.writer_id)
            || [
                capture.epoch,
                capture.captured_at,
                capture.history_revision,
                capture.document_version,
                capture.saved_revision.unwrap_or(0),
            ]
            .iter()
            .any(|n| *n > SAFE)
            || !capture.dirty
            || capture.display_name.len() > 4096
            || bytes.len() as u64 > PAYLOAD
        {
            return Err(invalid("Invalid recovery capture"));
        }
        if let Some(saved) = &capture.saved {
            saved.validate()?;
        }
        self.cleanup()?; // no new pending slot until surplus cleanup succeeds
        let mut state = self.state(&capture.document_id)?;
        let ticket = Ticket {
            document_id: capture.document_id.clone(),
            writer_id: capture.writer_id.clone(),
            epoch: capture.epoch,
            sequence: state.next_sequence,
        };
        self.matches(&ticket)?;
        let metadata = Metadata {
            format: "tilewright-recovery".into(),
            version: 1,
            document_id: capture.document_id,
            writer_id: capture.writer_id,
            epoch: capture.epoch,
            sequence: ticket.sequence,
            captured_at: capture.captured_at,
            history_revision: capture.history_revision,
            document_version: capture.document_version,
            saved_revision: capture.saved_revision,
            dirty: capture.dirty,
            display_name: capture.display_name,
            saved: capture.saved,
            project_format: "tilewright-project".into(),
            project_version: 1,
            byte_length: bytes.len() as u64,
            sha256: hash(bytes),
            completed_at: timestamp(),
        };
        let metadata = serde_json::to_vec(&metadata)?;
        if metadata.len() as u64 > RECORD {
            return Err(invalid("Recovery metadata exceeds limit"));
        }
        self.capacity(bytes.len() as u64 + metadata.len() as u64 + RECORD, RECORD)?;
        state.next_sequence += 1;
        self.write_state(&state, check)?; // reserve before any candidate; gaps are safe
        let dir = self.root.child(&ticket.document_id, false)?;
        let name = format!(".pending-{}", Uuid::new_v4());
        let result = (|| {
            let pending = dir.child(&name, true)?;
            write_synced(&mut pending.file("project.tilewright", true)?, bytes, check)?;
            write_synced(&mut pending.file("metadata.json", true)?, &metadata, check)?;
            pending.0.sync_all()
        })();
        if let Err(e) = result {
            let _ = dir.remove_tree(&name);
            return Err(e);
        }
        self.pending = Some(Pending {
            ticket: ticket.clone(),
            name,
        });
        Ok(ticket)
    }
    fn commit(
        &mut self,
        ticket: Ticket,
        check: &mut impl FnMut(Stage) -> io::Result<()>,
    ) -> io::Result<Option<String>> {
        self.matches(&ticket)?;
        let pending = self
            .pending
            .as_ref()
            .filter(|p| p.ticket == ticket)
            .ok_or_else(|| invalid("Recovery generation is no longer pending"))?;
        let dir = self.root.child(&ticket.document_id, false)?;
        let destination = ticket.sequence.to_string();
        // Reserved sequences are never reused, even across process restarts.
        if fd::statat(&dir.0, &destination, AtFlags::SYMLINK_NOFOLLOW).is_ok() {
            return Err(invalid("Recovery sequence already exists"));
        }
        check(Stage::Rename)?;
        fd::renameat(&dir.0, &pending.name, &dir.0, &destination)?;
        self.pending = None;
        let warning = check(Stage::ParentSync)
            .and_then(|_| dir.0.sync_all())
            .err()
            .map(|e| {
                format!("Recovery committed; directory durability could not be confirmed: {e}")
            });
        let cleanup = check(Stage::Cleanup)
            .and_then(|_| self.cleanup())
            .err()
            .map(|e| format!("Recovery committed; cleanup pending: {e}"));
        Ok(warning.or(cleanup))
    }
    fn cancel(&mut self, ticket: &Ticket) -> io::Result<()> {
        if self.pending.as_ref().is_some_and(|p| &p.ticket == ticket) {
            let pending = self.pending.take().unwrap();
            self.root
                .child(&ticket.document_id, false)?
                .remove_tree(&pending.name)?;
        }
        Ok(())
    }
    fn cleanup(&mut self) -> io::Result<()> {
        for id in self.root.names()? {
            if id == ".lock" {
                continue;
            }
            if !uuid(&id) {
                return Err(invalid("Unsupported recovery root layout"));
            }
            let dir = self.root.child(&id, false)?;
            let state = match self.state(&id) {
                Ok(state) => Some(state),
                Err(e) if e.kind() == io::ErrorKind::NotFound => None,
                // Preserve invalid/unsupported entries; count their bytes and slots.
                Err(_) => continue,
            };
            let mut sequences = Vec::new();
            for name in dir.names()? {
                if name == "state.json" {
                    continue;
                }
                if name.strip_prefix(".state-").is_some_and(uuid) {
                    fd::unlinkat(&dir.0, &name, AtFlags::empty())?;
                } else if name.strip_prefix(".pending-").is_some_and(uuid) {
                    if !self
                        .pending
                        .as_ref()
                        .is_some_and(|p| p.ticket.document_id == id && p.name == name)
                    {
                        dir.remove_tree(&name)?;
                    }
                } else if let Ok(n) = name.parse::<u64>() {
                    if n == 0 || n >= SAFE || n.to_string() != name {
                        return Err(invalid("Unsupported recovery sequence"));
                    }
                    sequences.push(n);
                } else {
                    return Err(invalid("Unsupported recovery lineage layout"));
                }
            }
            sequences.sort_unstable_by(|a, b| b.cmp(a));
            if let Some(mut state) = state {
                // A scan wins over a stale state receipt after a crash.
                if let Some(newest) = sequences.first() {
                    if state.next_sequence <= *newest {
                        state.next_sequence = newest + 1;
                        self.write_state(&state, &mut |_| Ok(()))?;
                    }
                }
                let mut retained = 0;
                for n in sequences {
                    if state.resolved_through.is_some_and(|through| n <= through) {
                        dir.remove_tree(&n.to_string())?;
                        continue;
                    }
                    let generation = dir.child(&n.to_string(), false)?;
                    // Corrupt/unsupported generations remain reviewable, and never
                    // cause deletion of the last checksum-valid fallback.
                    let valid = (|| -> io::Result<bool> {
                        let meta: Metadata =
                            serde_json::from_slice(&generation.read("metadata.json", RECORD)?)?;
                        let bytes = generation.read("project.tilewright", PAYLOAD)?;
                        Ok(meta.format == "tilewright-recovery"
                            && meta.version == 1
                            && meta.document_id == id
                            && meta.sequence == n
                            && meta.byte_length == bytes.len() as u64
                            && meta.sha256 == hash(&bytes))
                    })()
                    .unwrap_or(false);
                    if !valid {
                        return Err(invalid(
                            "Invalid recovery generation; review recovery before writing more",
                        ));
                    }
                    retained += 1;
                    if retained > 2 {
                        dir.remove_tree(&n.to_string())?;
                    }
                }
                if state.status != Status::Active && dir.names()? == ["state.json"] {
                    self.retired.insert(id.clone(), state);
                    fd::unlinkat(&dir.0, "state.json", AtFlags::empty())?;
                    fd::unlinkat(&self.root.0, &id, AtFlags::REMOVEDIR)?;
                    self.root.0.sync_all()?;
                }
            } else if dir.names()?.is_empty() {
                fd::unlinkat(&self.root.0, &id, AtFlags::REMOVEDIR)?;
            }
        }
        Ok(())
    }
}

async fn access<T: Send + 'static>(
    app: tauri::AppHandle,
    action: impl FnOnce(&mut RecoveryStore) -> io::Result<T> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let recovery = app.state::<Recovery>();
        let mut store = recovery
            .0
            .lock()
            .map_err(|_| "Recovery lock failed; restart Tilewright".to_string())?;
        if store.is_none() {
            let path = app
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .join("recovery/v1");
            *store = Some(RecoveryStore::open(&path).map_err(|e| e.to_string())?);
        }
        action(store.as_mut().unwrap()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn initialize_recovery(app: tauri::AppHandle) -> Result<(), String> {
    access(app, |_| Ok(())).await
}
#[tauri::command]
pub async fn control_recovery(
    app: tauri::AppHandle,
    control: Control,
) -> Result<Option<String>, String> {
    access(app, move |store| store.control(control, &mut |_| Ok(()))).await
}
#[tauri::command]
pub async fn prepare_recovery(
    app: tauri::AppHandle,
    request: Request<'_>,
) -> Result<Ticket, String> {
    let metadata = request
        .headers()
        .get("x-recovery-capture")
        .and_then(|v| v.to_str().ok())
        .ok_or("Missing recovery capture")?;
    if metadata.len() as u64 > RECORD {
        return Err("Recovery metadata exceeds limit".into());
    }
    let capture: Capture = serde_json::from_str(metadata).map_err(|e| e.to_string())?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected recovery bytes".into());
    };
    if bytes.len() as u64 > PAYLOAD {
        return Err("Recovery payload exceeds limit".into());
    }
    let bytes = bytes.clone();
    access(app, move |store| {
        store.prepare(capture, &bytes, &mut |_| Ok(()))
    })
    .await
}
#[tauri::command]
pub async fn commit_recovery(
    app: tauri::AppHandle,
    ticket: Ticket,
) -> Result<Option<String>, String> {
    access(app, move |store| store.commit(ticket, &mut |_| Ok(()))).await
}
#[tauri::command]
pub async fn cancel_recovery(app: tauri::AppHandle, ticket: Ticket) -> Result<(), String> {
    access(app, move |store| store.cancel(&ticket)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        os::unix::fs::{symlink, PermissionsExt},
    };
    const PROJECT: &[u8] = include_bytes!("../../tests/fixtures/project-v1.canonical.tilewright");
    fn setup() -> (
        tempfile::TempDir,
        std::path::PathBuf,
        RecoveryStore,
        Control,
    ) {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap().join("recovery/v1");
        let mut store = RecoveryStore::open(&root).unwrap();
        let control = Control {
            document_id: Uuid::new_v4().to_string(),
            writer_id: Uuid::new_v4().to_string(),
            epoch: 0,
            status: Status::Active,
            saved: None,
        };
        store.control(control.clone(), &mut |_| Ok(())).unwrap();
        (temp, root, store, control)
    }
    fn capture(c: &Control, revision: u64) -> Capture {
        Capture {
            document_id: c.document_id.clone(),
            writer_id: c.writer_id.clone(),
            epoch: c.epoch,
            captured_at: 1000,
            history_revision: revision,
            document_version: revision,
            saved_revision: None,
            dirty: true,
            display_name: "Untitled 地図".into(),
            saved: c.saved.clone(),
        }
    }
    fn publish(store: &mut RecoveryStore, c: &Control, revision: u64) -> Ticket {
        let ticket = store
            .prepare(capture(c, revision), PROJECT, &mut |_| Ok(()))
            .unwrap();
        store.commit(ticket.clone(), &mut |_| Ok(())).unwrap();
        ticket
    }
    fn fail(stage: Stage) -> impl FnMut(Stage) -> io::Result<()> {
        move |at| {
            if at == stage {
                Err(invalid("injected disk failure"))
            } else {
                Ok(())
            }
        }
    }
    #[test]
    fn saved_and_untitled_are_separate_and_rotation_keeps_two() {
        let (_temp, root, mut store, mut c) = setup();
        let original = root.parent().unwrap().join("explicit.tilewright");
        fs::write(&original, PROJECT).unwrap();
        publish(&mut store, &c, 9);
        c.epoch += 1;
        c.saved = Some(SavedContext {
            path: original.to_str().unwrap().into(),
            saved_at: 900,
            byte_hash: hash(PROJECT),
            canonical_hash: hash(PROJECT),
        });
        store.control(c.clone(), &mut |_| Ok(())).unwrap();
        publish(&mut store, &c, 3); // Undo revisions are not sequence numbers.
        let newest = publish(&mut store, &c, 12);
        let dir = root.join(&c.document_id);
        assert!(!dir.join("1").exists());
        assert!(dir.join("2/project.tilewright").exists());
        let meta: Metadata =
            serde_json::from_slice(&fs::read(dir.join("3/metadata.json")).unwrap()).unwrap();
        assert_eq!(newest.sequence, 3);
        assert_eq!(meta.history_revision, 12);
        assert_eq!(meta.sha256, hash(PROJECT));
        assert_eq!(meta.saved.unwrap().path, original.to_str().unwrap());
        assert_eq!(fs::read(original).unwrap(), PROJECT);
        assert_eq!(
            fs::metadata(dir.join("3/project.tilewright"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(&root).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }
    #[test]
    fn partial_sync_rename_and_cancel_preserve_last_generation() {
        let (_temp, root, mut store, c) = setup();
        publish(&mut store, &c, 1);
        for stage in [Stage::PartialWrite, Stage::Sync, Stage::Rename] {
            assert!(store
                .prepare(capture(&c, 2), PROJECT, &mut fail(stage))
                .is_err());
            assert_eq!(
                fs::read(root.join(&c.document_id).join("1/project.tilewright")).unwrap(),
                PROJECT
            );
        }
        // Fail the actual payload, after the state reservation has succeeded.
        let mut writes = 0;
        assert!(store
            .prepare(capture(&c, 2), PROJECT, &mut |stage| {
                if stage == Stage::PartialWrite {
                    writes += 1;
                    if writes == 2 {
                        return Err(invalid("partial payload"));
                    }
                }
                Ok(())
            })
            .is_err());
        let t = store
            .prepare(capture(&c, 3), PROJECT, &mut |_| Ok(()))
            .unwrap();
        assert!(store.commit(t.clone(), &mut fail(Stage::Rename)).is_err());
        store.cancel(&t).unwrap();
        assert!(store.commit(t, &mut |_| Ok(())).is_err());
        let dir = root.join(&c.document_id);
        assert_eq!(fs::read(dir.join("1/project.tilewright")).unwrap(), PROJECT);
        assert_eq!(fs::read_dir(dir).unwrap().count(), 2);
    }
    #[test]
    fn epochs_wrong_writers_and_retired_ids_cannot_publish() {
        let (_temp, root, mut store, mut c) = setup();
        publish(&mut store, &c, 1);
        let late = store
            .prepare(capture(&c, 2), PROJECT, &mut |_| Ok(()))
            .unwrap();
        let old = c.clone();
        c.epoch = 1;
        c.status = Status::Discarded;
        store.control(c.clone(), &mut |_| Ok(())).unwrap();
        assert!(!root.join(&c.document_id).exists());
        assert!(store.commit(late.clone(), &mut |_| Ok(())).is_err());
        assert!(store.control(old, &mut |_| Ok(())).is_err());
        c.epoch = 2;
        c.status = Status::Active;
        store.control(c.clone(), &mut |_| Ok(())).unwrap();
        let next = publish(&mut store, &c, 0);
        assert!(next.sequence > late.sequence);
        assert!(store.commit(late, &mut |_| Ok(())).is_err());
        c.writer_id = Uuid::new_v4().to_string();
        c.epoch = 3;
        assert!(store.control(c, &mut |_| Ok(())).is_err());
    }
    #[test]
    fn marker_failure_preserves_and_cleanup_failure_is_durable() {
        let (_temp, root, mut store, mut c) = setup();
        publish(&mut store, &c, 1);
        c.epoch = 1;
        c.status = Status::Discarded;
        assert!(store.control(c.clone(), &mut fail(Stage::Rename)).is_err());
        assert_eq!(store.state(&c.document_id).unwrap().status, Status::Active);
        let warning = store.control(c.clone(), &mut fail(Stage::Cleanup)).unwrap();
        assert!(warning.is_some());
        assert_eq!(
            store.state(&c.document_id).unwrap().status,
            Status::Discarded
        );
        assert!(root.join(&c.document_id).join("1").exists());
        drop(store);
        let _reopened = RecoveryStore::open(&root).unwrap();
        assert!(!root.join(&c.document_id).exists());
    }
    #[test]
    fn post_rename_warning_is_success_and_surplus_blocks_new_writes_until_cleanup() {
        let (_temp, root, mut store, c) = setup();
        publish(&mut store, &c, 1);
        publish(&mut store, &c, 2);
        let t = store
            .prepare(capture(&c, 3), PROJECT, &mut |_| Ok(()))
            .unwrap();
        assert!(store
            .commit(
                t.clone(),
                &mut |s| if s == Stage::ParentSync || s == Stage::Cleanup {
                    Err(invalid("fault"))
                } else {
                    Ok(())
                }
            )
            .unwrap()
            .is_some());
        assert!(root
            .join(&c.document_id)
            .join("3/project.tilewright")
            .exists());
        assert!(store.commit(t, &mut |_| Ok(())).is_err());
        let next = store
            .prepare(capture(&c, 4), PROJECT, &mut |_| Ok(()))
            .unwrap();
        assert!(!root.join(&c.document_id).join("1").exists());
        store.cancel(&next).unwrap();
    }
    #[test]
    fn lock_capacity_and_symlinks_preserve_existing_data() {
        let (_temp, root, mut store, c) = setup();
        publish(&mut store, &c, 1);
        assert!(RecoveryStore::open(&root).is_err());
        store.cap = store.root.usage(0, &mut 0).unwrap() + RECORD;
        assert!(store
            .prepare(capture(&c, 2), PROJECT, &mut |_| Ok(()))
            .is_err());
        store.cap = CAP;
        store.lineages = 1;
        let mut other = c.clone();
        other.document_id = Uuid::new_v4().to_string();
        assert!(store.control(other.clone(), &mut |_| Ok(())).is_err());
        let outside = root.parent().unwrap().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("project.tilewright"), PROJECT).unwrap();
        symlink(&outside, root.join(&other.document_id)).unwrap();
        assert!(store.control(other, &mut |_| Ok(())).is_err());
        assert!(store.capacity(0, 0).is_err());
        assert_eq!(
            fs::read(outside.join("project.tilewright")).unwrap(),
            PROJECT
        );
        assert_eq!(
            fs::read(root.join(c.document_id).join("1/project.tilewright")).unwrap(),
            PROJECT
        );
    }
    #[test]
    fn restart_cleans_pending_reserves_sequences_and_preserves_corrupt_fallback() {
        let (_temp, root, mut store, c) = setup();
        publish(&mut store, &c, 1);
        let pending = store
            .prepare(capture(&c, 2), PROJECT, &mut |_| Ok(()))
            .unwrap();
        drop(store);
        let mut store = RecoveryStore::open(&root).unwrap();
        assert_eq!(fs::read_dir(root.join(&c.document_id)).unwrap().count(), 2);
        let next = publish(&mut store, &c, 3);
        assert!(next.sequence > pending.sequence);
        fs::write(
            root.join(&c.document_id)
                .join(format!("{}/project.tilewright", next.sequence)),
            b"corrupt",
        )
        .unwrap();
        assert!(store
            .prepare(capture(&c, 4), PROJECT, &mut |_| Ok(()))
            .is_err());
        assert_eq!(
            fs::read(root.join(c.document_id).join("1/project.tilewright")).unwrap(),
            PROJECT
        );
    }
    #[test]
    fn process_death_mid_payload_preserves_committed_pair_and_releases_lock() {
        const CHILD: &str = "TILEWRIGHT_RECOVERY_TEST_ROOT";
        if let Ok(root) = std::env::var(CHILD) {
            let mut store = RecoveryStore::open(Path::new(&root)).unwrap();
            let id = store
                .root
                .names()
                .unwrap()
                .into_iter()
                .find(|id| uuid(id))
                .unwrap();
            let state = store.state(&id).unwrap();
            let c = Control {
                document_id: id,
                writer_id: state.writer_id,
                epoch: state.epoch,
                status: Status::Active,
                saved: None,
            };
            let mut writes = 0;
            let _ = store.prepare(capture(&c, 2), PROJECT, &mut |stage| {
                if stage == Stage::PartialWrite {
                    writes += 1;
                    if writes == 2 {
                        std::process::exit(73);
                    }
                }
                Ok(())
            });
            panic!("child should exit inside payload write");
        }
        let (_temp, root, mut store, c) = setup();
        publish(&mut store, &c, 1);
        drop(store);
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "recovery::tests::process_death_mid_payload_preserves_committed_pair_and_releases_lock"])
            .env(CHILD, &root).status().unwrap();
        assert_eq!(status.code(), Some(73));
        assert!(fs::read_dir(root.join(&c.document_id)).unwrap().count() > 2);
        let mut store = RecoveryStore::open(&root).unwrap();
        assert_eq!(
            fs::read(root.join(&c.document_id).join("1/project.tilewright")).unwrap(),
            PROJECT
        );
        assert_eq!(fs::read_dir(root.join(&c.document_id)).unwrap().count(), 2);
        assert_eq!(publish(&mut store, &c, 3).sequence, 3);
    }
    #[test]
    fn actual_changed_project_bytes_and_ten_lineage_limit() {
        let (_temp, root, mut store, c) = setup();
        let original = root.parent().unwrap().join("Saved.tilewright");
        fs::write(&original, PROJECT).unwrap();
        let mut project: serde_json::Value = serde_json::from_slice(PROJECT).unwrap();
        project["document"]["layers"][0]["name"] = serde_json::json!("Unsaved recovered layer");
        let changed = serde_json::to_vec(&project).unwrap();
        let t = store
            .prepare(capture(&c, 1), &changed, &mut |_| Ok(()))
            .unwrap();
        store.commit(t, &mut |_| Ok(())).unwrap();
        assert_eq!(
            fs::read(root.join(&c.document_id).join("1/project.tilewright")).unwrap(),
            changed
        );
        assert_eq!(fs::read(original).unwrap(), PROJECT);
        for _ in 1..10 {
            let mut other = c.clone();
            other.document_id = Uuid::new_v4().to_string();
            store.control(other.clone(), &mut |_| Ok(())).unwrap();
            publish(&mut store, &other, 1);
        }
        let mut other = c.clone();
        other.document_id = Uuid::new_v4().to_string();
        assert!(store.control(other.clone(), &mut |_| Ok(())).is_err());
        other.status = Status::Resolved;
        assert!(store.control(other, &mut |_| Ok(())).is_ok()); // unowned map can close at capacity
        assert_eq!(store.root.names().unwrap().len(), 11); // ten maps and the root lock
    }
    #[test]
    fn wire_identity_shapes_and_marker_sync_failure_are_conservative() {
        assert!(serde_json::from_str::<Control>(r#"{"documentId":"x","documentId":"y","writerId":"z","epoch":0,"status":"active","saved":null}"#).is_err());
        let (_temp, root, mut store, mut c) = setup();
        let mut wire = serde_json::to_value(&c).unwrap();
        wire.as_object_mut().unwrap().remove("saved");
        assert!(serde_json::from_value::<Control>(wire).is_err());
        let state = serde_json::to_value(store.state(&c.document_id).unwrap()).unwrap();
        for key in ["saved", "resolvedThrough", "restoredFrom"] {
            let mut missing = state.clone();
            missing.as_object_mut().unwrap().remove(key);
            assert!(serde_json::from_value::<State>(missing).is_err());
        }
        publish(&mut store, &c, 1);
        c.epoch = 1;
        c.status = Status::Resolved;
        assert!(store
            .control(c.clone(), &mut fail(Stage::ParentSync))
            .is_err());
        assert!(root
            .join(&c.document_id)
            .join("1/project.tilewright")
            .exists());
        assert_eq!(
            store.state(&c.document_id).unwrap().status,
            Status::Resolved
        );
        c.epoch = 2;
        store.control(c.clone(), &mut |_| Ok(())).unwrap();
        assert!(!root.join(&c.document_id).exists());
        c.status = Status::Active;
        c.epoch = 3;
        c.document_id = "../explicit".into();
        assert!(store.control(c, &mut |_| Ok(())).is_err());
    }
}
