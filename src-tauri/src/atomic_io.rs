use std::{
    fs::File,
    io::{self, Write},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Stage {
    PartialWrite,
    Sync,
    PendingSync,
    Rename,
    ParentSync,
    Cleanup,
}

/// Shared explicit-save/recovery write and fault boundary. Caller owns publication.
pub(crate) fn write_synced(
    file: &mut File,
    bytes: &[u8],
    check: &mut impl FnMut(Stage) -> io::Result<()>,
) -> io::Result<()> {
    let middle = bytes.len() / 2;
    file.write_all(&bytes[..middle])?;
    check(Stage::PartialWrite)?;
    file.write_all(&bytes[middle..])?;
    check(Stage::Sync)?;
    file.sync_all()
}
