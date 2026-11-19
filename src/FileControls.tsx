import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectFiles } from "./editor/project-files";
import { useStore } from "./editor/useStore";

function ConfirmOpen({ files, close }: { files: ProjectFiles; close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="canvas-dialog"
      aria-label="Open another project"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <h2>Open another project</h2>
      <p>
        Opening another project discards the current unsaved map and its undo
        history. Cancel and Save first to keep your changes.
      </p>
      <div className="dialog-actions">
        <button type="button" autoFocus onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            close();
            void files.open();
          }}
        >
          Discard and choose project…
        </button>
      </div>
    </dialog>
  );
}

export function FileControls({ files }: { files: ProjectFiles }) {
  const { busy } = useStore(files.state);
  const [confirm, setConfirm] = useState(false);
  const open = useCallback(() => {
    if (files.state.getSnapshot().busy || !files.available) return;
    if (files.workspace.state.getSnapshot().session.history.state.dirty)
      setConfirm(true);
    else void files.open();
  }, [files]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (files.routeKey(event, open)) event.preventDefault();
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [files, open]);
  const disabled = busy || !files.available;
  const title = files.available
    ? undefined
    : "Local project files are available in the Tilewright desktop app.";
  return (
    <span className="file-controls" title={title}>
      <button type="button" disabled={disabled} onClick={open}>
        Open…
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => void files.save()}
      >
        Save
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => void files.save(true)}
      >
        Save As…
      </button>
      {confirm && <ConfirmOpen files={files} close={() => setConfirm(false)} />}
    </span>
  );
}
export function FileFeedback({ files }: { files: ProjectFiles }) {
  const { error, message } = useStore(files.state);
  return message ? (
    <div
      className={`feedback ${error ? "error" : "info"}`}
      role={error ? "alert" : "status"}
      aria-label="Project file feedback"
    >
      {message}
    </div>
  ) : null;
}
