//! End-to-end native recovery publication, restart and retention fault matrix.
use super::*;
use std::{fs, os::unix::process::ExitStatusExt, process::Command};

const SAVED: &[u8] = include_bytes!("../../tests/fixtures/project-v1.canonical.tilewright");

fn edited(name: &str) -> Vec<u8> {
    let mut project: serde_json::Value = serde_json::from_slice(SAVED).unwrap();
    project["document"]["registry"][0]["rgba"] = serde_json::json!("#127844ff");
    project["document"]["layers"][1]["name"] = serde_json::json!(name);
    serde_json::to_vec(&project).unwrap()
}
fn capture(c: &Control) -> Capture {
    Capture {
        document_id: c.document_id.clone(),
        writer_id: c.writer_id.clone(),
        epoch: c.epoch,
        captured_at: 1000,
        history_revision: 3,
        document_version: 5,
        saved_revision: Some(0),
        dirty: true,
        display_name: "Fault campaign".into(),
        saved: c.saved.clone(),
    }
}
fn setup() -> (
    tempfile::TempDir,
    std::path::PathBuf,
    RecoveryStore,
    Control,
) {
    let temp = tempfile::tempdir().unwrap();
    let base = temp.path().canonicalize().unwrap();
    let root = base.join("recovery/v1");
    let source = base.join("saved.tilewright");
    fs::write(&source, SAVED).unwrap();
    let mut store = RecoveryStore::open(&root).unwrap();
    let c = Control {
        document_id: Uuid::new_v4().to_string(),
        writer_id: Uuid::new_v4().to_string(),
        epoch: 0,
        status: Status::Active,
        saved: Some(SavedContext {
            path: source.to_str().unwrap().into(),
            saved_at: 900,
            byte_hash: hash(SAVED),
            canonical_hash: hash(SAVED),
        }),
    };
    store.control(c.clone(), &mut |_| Ok(())).unwrap();
    let ticket = store
        .prepare(capture(&c), &edited("Complete B"), &mut |_| Ok(()))
        .unwrap();
    store.commit(ticket, &mut |_| Ok(())).unwrap();
    (temp, root, store, c)
}
fn verify(store: &mut RecoveryStore, c: &Control, expected: &[u8], sequence: u64) {
    let discovery = store.discover().unwrap();
    assert!(discovery.warnings.is_empty(), "{:?}", discovery.warnings);
    assert_eq!(discovery.entries.len(), 1);
    let entry = &discovery.entries[0];
    assert_eq!(entry.document_id, c.document_id);
    assert_eq!(entry.generations[0].sequence, sequence);
    let selected = Selection {
        document_id: c.document_id.clone(),
        sequence,
        sha256: hash(expected),
    };
    let (meta, bytes, _) = store.selected(&selected).unwrap();
    assert_eq!(bytes, expected);
    assert_eq!(meta.byte_length, expected.len() as u64);
    // All runs, overlapping layers, registry IDs/colors, independent areas and preferences.
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
        serde_json::from_slice::<serde_json::Value>(expected).unwrap()
    );
    assert_eq!(store.source(&selected).unwrap(), SAVED);
    assert_eq!(fs::read(&c.saved.as_ref().unwrap().path).unwrap(), SAVED);
}

#[test]
fn every_prepare_failure_preserves_full_checkpoint_and_explicit_bytes() {
    // Occurrences distinguish state reservation, payload and metadata writes.
    for (stage, occurrence) in [
        (Stage::PartialWrite, 1),
        (Stage::Sync, 1),
        (Stage::Rename, 1),
        (Stage::ParentSync, 1),
        (Stage::PartialWrite, 2),
        (Stage::Sync, 2),
        (Stage::PartialWrite, 3),
        (Stage::Sync, 3),
        (Stage::PendingSync, 1),
    ] {
        let (_temp, root, mut store, c) = setup();
        let mut hits = 0;
        assert!(
            store
                .prepare(capture(&c), &edited("Incomplete C"), &mut |at| {
                    if at == stage {
                        hits += 1;
                        if hits == occurrence {
                            return Err(invalid("injected I/O failure"));
                        }
                    }
                    Ok(())
                })
                .is_err(),
            "{stage:?}/{occurrence}"
        );
        assert_eq!(hits, occurrence);
        verify(&mut store, &c, &edited("Complete B"), 1);
        drop(store);
        let mut restarted = RecoveryStore::open(&root).unwrap();
        verify(&mut restarted, &c, &edited("Complete B"), 1);
        let next = restarted
            .prepare(capture(&c), &edited("Complete C"), &mut |_| Ok(()))
            .unwrap();
        restarted.commit(next.clone(), &mut |_| Ok(())).unwrap();
        verify(&mut restarted, &c, &edited("Complete C"), next.sequence);
        assert_eq!(
            restarted.discover().unwrap().entries[0].generations.len(),
            2
        );
    }
}

#[test]
fn sigkill_at_publication_and_resolution_boundaries_recovers_only_complete_work() {
    const ROOT: &str = "TW042_RECOVERY_CHILD_ROOT";
    const POINT: &str = "TW042_RECOVERY_CHILD_POINT";
    if let Ok(root) = std::env::var(ROOT) {
        let point = std::env::var(POINT).unwrap();
        let mut store = RecoveryStore::open(Path::new(&root)).unwrap();
        let id = store.discover().unwrap().entries[0].document_id.clone();
        let state = store.state(&id).unwrap();
        let mut c = Control {
            document_id: id,
            writer_id: state.writer_id,
            epoch: state.epoch,
            status: Status::Active,
            saved: state.saved,
        };
        let mut writes = 0;
        let mut kill = |at| -> io::Result<()> {
            if at == Stage::PartialWrite {
                writes += 1;
            }
            let reached = match point.as_str() {
                "state" => at == Stage::PartialWrite && writes == 1,
                "payload" => at == Stage::PartialWrite && writes == 2,
                "metadata" => at == Stage::PartialWrite && writes == 3,
                "pending-sync" => at == Stage::PendingSync,
                "before-publish" => at == Stage::Rename,
                "after-publish" => at == Stage::ParentSync,
                "after-resolve" => at == Stage::Cleanup,
                _ => panic!("unknown fault point"),
            };
            if reached {
                // SIGKILL skips Rust destructors and the normal close/save handshake.
                unsafe {
                    libc::kill(libc::getpid(), libc::SIGKILL);
                }
                unreachable!("SIGKILL must terminate the child");
            }
            Ok(())
        };
        if point == "after-resolve" {
            c.epoch += 1;
            c.status = Status::Discarded;
            store.control(c, &mut kill).unwrap();
        } else if point == "before-publish" || point == "after-publish" {
            let ticket = store
                .prepare(capture(&c), &edited("Complete C"), &mut |_| Ok(()))
                .unwrap();
            store.commit(ticket, &mut kill).unwrap();
        } else {
            store
                .prepare(capture(&c), &edited("Incomplete C"), &mut kill)
                .unwrap();
        }
        panic!("fault point was never reached");
    }
    for point in [
        "state",
        "payload",
        "metadata",
        "pending-sync",
        "before-publish",
        "after-publish",
        "after-resolve",
    ] {
        let (_temp, root, store, c) = setup();
        drop(store);
        let status = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "recovery::discovery::fault_tests::sigkill_at_publication_and_resolution_boundaries_recovers_only_complete_work"])
            .env(ROOT, &root).env(POINT, point).output().unwrap().status;
        assert_eq!(status.signal(), Some(libc::SIGKILL), "{point}");
        let mut restarted = RecoveryStore::open(&root).unwrap();
        if point == "after-resolve" {
            assert!(restarted.discover().unwrap().entries.is_empty());
            assert!(!root.join(&c.document_id).exists());
        } else {
            let (name, sequence) = if point == "after-publish" {
                ("Complete C", 2)
            } else {
                ("Complete B", 1)
            };
            verify(&mut restarted, &c, &edited(name), sequence);
            assert!(fs::read_dir(root.join(&c.document_id)).unwrap().all(|e| !e
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with('.')));
            let ticket = restarted
                .prepare(capture(&c), &edited("Next D"), &mut |_| Ok(()))
                .unwrap();
            assert!(ticket.sequence > sequence);
            restarted.commit(ticket.clone(), &mut |_| Ok(())).unwrap();
            verify(&mut restarted, &c, &edited("Next D"), ticket.sequence);
            assert_eq!(
                restarted.discover().unwrap().entries[0].generations.len(),
                2
            );
        }
        assert_eq!(fs::read(c.saved.unwrap().path).unwrap(), SAVED);
    }
}
