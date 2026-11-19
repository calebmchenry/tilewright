//! Read-only discovery and narrowly scoped lineage actions. No source path grants.
use super::*;
use tauri::ipc::Response;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Generation {
    sequence: u64,
    metadata: Option<Metadata>,
    error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    document_id: String,
    saved: Option<SavedContext>,
    generations: Vec<Generation>,
    error: Option<String>,
    discardable: bool,
    current: bool,
}
#[derive(Serialize)]
pub struct Discovery {
    entries: Vec<Entry>,
    warnings: Vec<String>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Selection {
    document_id: String,
    sequence: u64,
    sha256: String,
}
impl RecoveryStore {
    fn sequences(&self, id: &str) -> io::Result<Vec<u64>> {
        if !uuid(id) {
            return Err(invalid("Invalid recovery identity"));
        }
        let mut sequences = Vec::new();
        for name in self.root.child(id, false)?.names()? {
            if let Ok(n) = name.parse::<u64>() {
                if n > 0 && n < SAFE && n.to_string() == name {
                    sequences.push(n);
                    continue;
                }
            }
            if name != "state.json"
                && !name.strip_prefix(".state-").is_some_and(uuid)
                && !name.strip_prefix(".pending-").is_some_and(uuid)
            {
                return Err(invalid(
                    "Unsupported recovery lineage layout; left untouched",
                ));
            }
        }
        sequences.sort_unstable_by(|a, b| b.cmp(a));
        Ok(sequences)
    }
    fn generation(&self, id: &str, sequence: u64) -> io::Result<(Metadata, Vec<u8>)> {
        if !uuid(id) || sequence == 0 || sequence >= SAFE {
            return Err(invalid("Invalid recovery identity or sequence"));
        }
        let dir = self
            .root
            .child(id, false)?
            .child(&sequence.to_string(), false)?;
        let meta: Metadata = serde_json::from_slice(&dir.read("metadata.json", RECORD)?)?;
        if meta.format != "tilewright-recovery"
            || meta.version != 1
            || meta.document_id != id
            || meta.sequence != sequence
            || !uuid(&meta.writer_id)
            || !meta.dirty
            || meta.display_name.len() > 4096
            || meta.project_format != "tilewright-project"
            || meta.project_version != 1
            || meta.byte_length > PAYLOAD
            || [
                meta.epoch,
                meta.captured_at,
                meta.completed_at,
                meta.history_revision,
                meta.document_version,
                meta.saved_revision.unwrap_or(0),
            ]
            .iter()
            .any(|n| *n > SAFE)
        {
            return Err(invalid("Unsupported or invalid recovery metadata"));
        }
        if let Some(saved) = &meta.saved {
            saved.validate()?;
        }
        let bytes = dir.read("project.tilewright", PAYLOAD)?;
        if meta.byte_length != bytes.len() as u64 || meta.sha256 != hash(&bytes) {
            return Err(invalid(
                "Recovery payload length or checksum does not match",
            ));
        }
        Ok((meta, bytes))
    }
    fn selected(&self, selection: &Selection) -> io::Result<(Metadata, Vec<u8>, State)> {
        if !uuid(&selection.document_id) {
            return Err(invalid("Invalid recovery identity"));
        }
        let state = self.state(&selection.document_id)?;
        if state.status != Status::Active
            || state
                .resolved_through
                .is_some_and(|n| selection.sequence <= n)
        {
            return Err(invalid("Recovery was already resolved or discarded"));
        }
        let (meta, bytes) = self.generation(&selection.document_id, selection.sequence)?;
        if meta.sha256 != selection.sha256 {
            return Err(invalid("Recovery changed; review it again"));
        }
        Ok((meta, bytes, state))
    }
    fn discover(&mut self) -> io::Result<Discovery> {
        self.startup_warning = self.cleanup().err().map(|e| e.to_string());
        let mut result = Discovery {
            entries: Vec::new(),
            warnings: self.startup_warning.iter().cloned().collect(),
        };
        // Other store versions are never cleaned or traversed as v1.
        let parent = Directory(File::from(fd::openat(
            &self.root.0,
            "..",
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW,
            Mode::empty(),
        )?));
        for name in parent.names()? {
            if name != "v1" {
                result
                    .warnings
                    .push(format!("Unsupported recovery store {name}; left untouched"));
            }
        }
        for id in self.root.names()? {
            if id == ".lock" {
                continue;
            }
            if !uuid(&id) {
                result
                    .warnings
                    .push(format!("Unsupported recovery entry {id}; left untouched"));
                continue;
            }
            let state = self.state(&id);
            let sequences = self.sequences(&id);
            // Unknown versions/layouts are never overwritten, even by discard.
            let version_known = self
                .root
                .child(&id, false)
                .and_then(|dir| dir.read("state.json", RECORD))
                .ok()
                .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
                .is_none_or(|v| v.get("version").is_none_or(|n| n == 1));
            let mut entry = Entry {
                document_id: id.clone(),
                saved: state.as_ref().ok().and_then(|s| s.saved.clone()),
                generations: Vec::new(),
                error: state.as_ref().err().map(ToString::to_string),
                discardable: sequences.is_ok() && version_known,
                current: self.live.contains(&id),
            };
            if let Ok(s) = &state {
                if s.status != Status::Active {
                    continue;
                }
            }
            match sequences {
                Err(e) => entry.error = Some(e.to_string()),
                Ok(sequences) => {
                    for sequence in sequences {
                        if state
                            .as_ref()
                            .is_ok_and(|s| s.resolved_through.is_some_and(|n| sequence <= n))
                        {
                            continue;
                        }
                        let (metadata, error) = match self.generation(&id, sequence) {
                            Ok((metadata, _)) => (Some(metadata), None),
                            Err(e) => (None, Some(e.to_string())),
                        };
                        entry.generations.push(Generation {
                            sequence,
                            metadata,
                            error,
                        });
                    }
                }
            }
            if !entry.generations.is_empty() || entry.error.is_some() {
                result.entries.push(entry);
            }
        }
        Ok(result)
    }
    fn source(&self, selection: &Selection) -> io::Result<Vec<u8>> {
        let (_, _, state) = self.selected(selection)?;
        let saved = state
            .saved
            .ok_or_else(|| invalid("No known explicit project path"))?;
        let path = Path::new(&saved.path);
        let mut dir = Directory(File::open("/")?);
        for component in path
            .parent()
            .ok_or_else(|| invalid("Invalid source path"))?
            .components()
        {
            match component {
                Component::RootDir => (),
                Component::Normal(name) => {
                    dir = dir.child(
                        name.to_str()
                            .ok_or_else(|| invalid("Invalid source path"))?,
                        false,
                    )?
                }
                _ => return Err(invalid("Invalid source path")),
            }
        }
        // Bounded regular-file read, no symlinks, no creation and no write grant.
        dir.read(
            path.file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| invalid("Invalid source filename"))?,
            PAYLOAD,
        )
    }
    fn claim(&mut self, selection: &Selection, writer: &str) -> io::Result<()> {
        if !uuid(writer) || self.live.contains(&selection.document_id) {
            return Err(invalid("Recovery is currently open or writer is invalid"));
        }
        let (_, _, mut state) = self.selected(selection)?;
        state.writer_id = writer.to_owned();
        state.epoch = 0; // epochs belong to the fresh writer; old writers are fenced
        state.restored_from = Some(selection.sequence);
        state.next_sequence = state.next_sequence.max(
            self.sequences(&selection.document_id)?
                .first()
                .copied()
                .unwrap_or(0)
                + 1,
        );
        self.write_state(&state, &mut |_| Ok(()))?;
        self.live.insert(selection.document_id.clone());
        Ok(())
    }
    fn discard(
        &mut self,
        id: &str,
        check: &mut impl FnMut(Stage) -> io::Result<()>,
    ) -> io::Result<Option<String>> {
        if !uuid(id) || self.live.contains(id) {
            return Err(invalid("Recovery is currently open or identity is invalid"));
        }
        let listing = self.discover()?;
        let entry = listing
            .entries
            .iter()
            .find(|e| e.document_id == id && e.discardable)
            .ok_or_else(|| {
                invalid("Recovery is unavailable or has an unsupported layout; left untouched")
            })?;
        let through = entry
            .generations
            .iter()
            .map(|g| g.sequence)
            .max()
            .unwrap_or(0);
        let mut state = self.state(id).unwrap_or_else(|_| State {
            format: "tilewright-recovery".into(),
            version: 1,
            document_id: id.to_owned(),
            writer_id: Uuid::new_v4().to_string(),
            epoch: 0,
            next_sequence: through + 1,
            status: Status::Active,
            saved: None,
            resolved_through: None,
            restored_from: None,
        });
        state.epoch += 1;
        state.status = Status::Discarded;
        state.next_sequence = state.next_sequence.max(through + 1);
        state.resolved_through = Some(state.next_sequence - 1);
        self.write_state(&state, check)?;
        Ok(check(Stage::Cleanup)
            .and_then(|_| self.cleanup())
            .err()
            .map(|e| format!("Recovery discarded; cleanup pending: {e}")))
    }
}
#[tauri::command]
pub async fn discover_recovery(app: tauri::AppHandle) -> Result<Discovery, String> {
    access(app, |store| store.discover()).await
}
#[tauri::command]
pub async fn read_recovery(
    app: tauri::AppHandle,
    selection: Selection,
    source: bool,
) -> Result<Response, String> {
    access(app, move |store| {
        let bytes = if source {
            store.source(&selection)?
        } else {
            store.selected(&selection)?.1
        };
        Ok(Response::new(bytes))
    })
    .await
}
#[tauri::command]
pub async fn claim_recovery(
    app: tauri::AppHandle,
    selection: Selection,
    writer: String,
) -> Result<(), String> {
    access(app, move |store| store.claim(&selection, &writer)).await
}
#[tauri::command]
pub async fn release_recovery(
    app: tauri::AppHandle,
    document_id: String,
    writer: String,
) -> Result<(), String> {
    access(app, move |store| {
        if !uuid(&document_id) || store.state(&document_id)?.writer_id != writer {
            return Err(invalid("Invalid recovery writer"));
        }
        store.live.remove(&document_id);
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn discard_recovery(
    app: tauri::AppHandle,
    document_id: String,
) -> Result<Option<String>, String> {
    access(app, move |store| {
        store.discard(&document_id, &mut |_| Ok(()))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    const PROJECT: &[u8] = include_bytes!("../../tests/fixtures/project-v1.canonical.tilewright");
    fn publish(store: &mut RecoveryStore, id: &str, source: Option<&Path>) -> Selection {
        let saved = source.map(|p| SavedContext {
            path: p.to_str().unwrap().into(),
            saved_at: 1,
            byte_hash: hash(PROJECT),
            canonical_hash: hash(PROJECT),
        });
        let writer = Uuid::new_v4().to_string();
        store
            .control(
                Control {
                    document_id: id.into(),
                    writer_id: writer.clone(),
                    epoch: 0,
                    status: Status::Active,
                    saved: saved.clone(),
                },
                &mut |_| Ok(()),
            )
            .unwrap();
        let ticket = store
            .prepare(
                Capture {
                    document_id: id.into(),
                    writer_id: writer,
                    epoch: 0,
                    captured_at: 1,
                    history_revision: 3,
                    document_version: 3,
                    saved_revision: Some(5),
                    dirty: true,
                    display_name: "Map 地図".into(),
                    saved,
                },
                PROJECT,
                &mut |_| Ok(()),
            )
            .unwrap();
        store.commit(ticket.clone(), &mut |_| Ok(())).unwrap();
        Selection {
            document_id: id.into(),
            sequence: ticket.sequence,
            sha256: hash(PROJECT),
        }
    }
    #[test]
    fn relaunch_claim_retains_snapshot_and_selected_discard_preserves_source_and_other_map() {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().canonicalize().unwrap();
        let root = base.join("recovery/v1");
        let source = base.join("source.tilewright");
        fs::write(&source, PROJECT).unwrap();
        let mut store = RecoveryStore::open(&root).unwrap();
        let a = publish(&mut store, &Uuid::new_v4().to_string(), Some(&source));
        let b = publish(&mut store, &Uuid::new_v4().to_string(), None);
        assert!(store.discard(&a.document_id, &mut |_| Ok(())).is_err());
        drop(store); // process lock and in-memory live identities disappear
        let mut store = RecoveryStore::open(&root).unwrap();
        assert_eq!(store.discover().unwrap().entries.len(), 2);
        assert_eq!(store.source(&a).unwrap(), PROJECT);
        let writer = Uuid::new_v4().to_string();
        store.claim(&a, &writer).unwrap();
        assert_eq!(
            store.state(&a.document_id).unwrap().restored_from,
            Some(a.sequence)
        );
        assert_eq!(store.selected(&a).unwrap().1, PROJECT);
        assert!(store.claim(&a, &Uuid::new_v4().to_string()).is_err());
        assert!(store.discard(&a.document_id, &mut |_| Ok(())).is_err());
        drop(store); // crash immediately after restore, without another capture
        let mut store = RecoveryStore::open(&root).unwrap();
        assert_eq!(store.selected(&a).unwrap().1, PROJECT);
        // Failed marker must not delete either candidate.
        assert!(store
            .discard(&a.document_id, &mut |stage| if stage == Stage::Rename {
                Err(invalid("injected marker failure"))
            } else {
                Ok(())
            })
            .is_err());
        assert_eq!(store.discover().unwrap().entries.len(), 2);
        let warning = store
            .discard(&a.document_id, &mut |stage| {
                if stage == Stage::Cleanup {
                    Err(invalid("injected cleanup failure"))
                } else {
                    Ok(())
                }
            })
            .unwrap();
        assert!(warning.is_some());
        assert_eq!(store.discover().unwrap().entries.len(), 1);
        assert!(store.selected(&a).is_err());
        assert_eq!(store.selected(&b).unwrap().1, PROJECT);
        assert_eq!(fs::read(&source).unwrap(), PROJECT);
        drop(store);
        assert_eq!(
            RecoveryStore::open(&root)
                .unwrap()
                .discover()
                .unwrap()
                .entries
                .len(),
            1
        );
    }
    #[test]
    fn corrupt_newest_fallback_missing_source_and_bad_state_do_not_block_discovery() {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().canonicalize().unwrap();
        let root = base.join("recovery/v1");
        let mut store = RecoveryStore::open(&root).unwrap();
        let a = publish(
            &mut store,
            &Uuid::new_v4().to_string(),
            Some(&base.join("missing.tilewright")),
        );
        let dir = root.join(&a.document_id);
        // A complete previous generation, followed by a damaged newer pair.
        fs::create_dir(dir.join("2")).unwrap();
        let mut meta: Metadata =
            serde_json::from_slice(&fs::read(dir.join("1/metadata.json")).unwrap()).unwrap();
        meta.sequence = 2;
        fs::write(
            dir.join("2/metadata.json"),
            serde_json::to_vec(&meta).unwrap(),
        )
        .unwrap();
        fs::write(dir.join("2/project.tilewright"), b"partial").unwrap();
        drop(store);
        let mut store = RecoveryStore::open(&root).unwrap();
        let listing = store.discover().unwrap();
        assert!(!listing.warnings.is_empty());
        assert_eq!(listing.entries[0].generations[0].sequence, 2);
        assert!(listing.entries[0].generations[0].error.is_some());
        assert!(listing.entries[0].generations[1].metadata.is_some());
        assert!(store.source(&a).is_err());
        assert_eq!(store.selected(&a).unwrap().1, PROJECT);
        // Malformed state remains visible and explicitly discardable, never auto removed.
        fs::write(dir.join("state.json"), b"{broken").unwrap();
        let listing = store.discover().unwrap();
        assert!(listing.entries[0].error.is_some());
        assert!(listing.entries[0].discardable);
        store.discard(&a.document_id, &mut |_| Ok(())).unwrap();
        assert!(store.discover().unwrap().entries.is_empty());
    }
    #[test]
    fn unsupported_versions_and_source_symlinks_are_left_untouched() {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().canonicalize().unwrap();
        let root = base.join("recovery/v1");
        let target = base.join("target.tilewright");
        let link = base.join("link.tilewright");
        fs::write(&target, PROJECT).unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let mut store = RecoveryStore::open(&root).unwrap();
        let a = publish(&mut store, &Uuid::new_v4().to_string(), Some(&link));
        assert!(store.source(&a).is_err());
        let path = root.join(&a.document_id).join("state.json");
        let mut state: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        state["version"] = 2.into();
        let original = serde_json::to_vec(&state).unwrap();
        fs::write(&path, &original).unwrap();
        drop(store);
        fs::create_dir(base.join("recovery/v2")).unwrap();
        let mut store = RecoveryStore::open(&root).unwrap();
        let listing = store.discover().unwrap();
        assert!(listing.warnings.iter().any(|s| s.contains("v2")));
        assert!(!listing.entries[0].discardable);
        assert!(store.discard(&a.document_id, &mut |_| Ok(())).is_err());
        assert_eq!(fs::read(path).unwrap(), original);
        assert_eq!(fs::read(target).unwrap(), PROJECT);
        assert!(store
            .selected(&Selection {
                document_id: "../target".into(),
                ..a
            })
            .is_err());
    }
}
