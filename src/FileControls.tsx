import { useEffect, useRef } from "react";
import type {
  DocumentAction,
  DocumentLifecycle,
} from "./editor/document-lifecycle";
import type { ProjectFiles } from "./editor/project-files";
import { useStore } from "./editor/useStore";

export function UnsavedChanges({
  lifecycle,
}: {
  lifecycle: DocumentLifecycle;
}) {
  const { prompt } = useStore(lifecycle.state);
  return prompt ? (
    <UnsavedDialog lifecycle={lifecycle} action={prompt} />
  ) : null;
}

function UnsavedDialog({
  lifecycle,
  action,
}: {
  lifecycle: DocumentLifecycle;
  action: DocumentAction;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  const title =
    action === "new"
      ? "Create another map"
      : action === "open"
        ? "Open another project"
        : "Close Tilewright";
  return (
    <dialog
      ref={dialog}
      className="canvas-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        lifecycle.choose("cancel");
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <h2>{title}</h2>
      <p>
        Save changes to the current map before continuing? Discarding loses
        unsaved changes and clears its undo history.
      </p>
      <div className="dialog-actions">
        <button
          type="button"
          autoFocus
          onClick={() => lifecycle.choose("cancel")}
        >
          Cancel
        </button>
        <button type="button" onClick={() => lifecycle.choose("discard")}>
          Discard changes
        </button>
        <button
          type="button"
          disabled={!lifecycle.files.available}
          onClick={() => lifecycle.choose("save")}
        >
          Save and continue
        </button>
      </div>
      {!lifecycle.files.available && (
        <p>Saving requires the Tilewright desktop app.</p>
      )}
    </dialog>
  );
}

export function FileControls({ lifecycle }: { lifecycle: DocumentLifecycle }) {
  const { busy } = useStore(lifecycle.state);
  const files = lifecycle.files;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (lifecycle.routeKey(event)) event.preventDefault();
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [lifecycle]);
  const disabled = busy || !files.available;
  const title = files.available
    ? undefined
    : "Local project files are available in the Tilewright desktop app.";
  return (
    <span className="file-controls" title={title}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => void lifecycle.open()}
      >
        Open…
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => void lifecycle.save()}
      >
        Save
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => void lifecycle.save(true)}
      >
        Save As…
      </button>
    </span>
  );
}
export function LifecycleFeedback({
  lifecycle,
}: {
  lifecycle: DocumentLifecycle;
}) {
  const { error, busy, action, prompt } = useStore(lifecycle.state);
  if (error)
    return (
      <div
        className="feedback error"
        role="alert"
        aria-label="Document workflow feedback"
      >
        {error}
      </div>
    );
  if (busy && !prompt)
    return (
      <div
        className="feedback info"
        role="status"
        aria-label="Document workflow feedback"
      >
        {action === "close"
          ? "Finishing before closing…"
          : "Finishing document action…"}{" "}
        Please wait before starting another action.
      </div>
    );
  return null;
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
