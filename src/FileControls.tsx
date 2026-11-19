import { restoreFocus } from "./editor/focus";
import { useEffect, useRef } from "react";
import { ShortcutHint } from "./ShortcutHint";
import type {
  DocumentAction,
  DocumentLifecycle,
} from "./editor/document-lifecycle";
import type { ProjectFiles } from "./editor/project-files";
import { useStore } from "./editor/useStore";
import type { ApplicationActions } from "./editor/application-actions";

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
    const opener = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      restoreFocus(opener);
    };
  }, []);
  const title =
    action === "new"
      ? "Create another map"
      : action === "open"
        ? "Open another project"
        : action === "restore"
          ? "Restore recovered map"
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

export function FileControls({ actions }: { actions: ApplicationActions }) {
  useStore(actions.menu);
  const files = actions.lifecycle.files;
  const title = files.available
    ? undefined
    : "Local project files are available in the Tilewright desktop app.";
  return (
    <span className="file-controls" title={title}>
      <button
        type="button"
        disabled={!actions.state("open").enabled}
        onClick={() => actions.perform("open")}
      >
        Open…
        <ShortcutHint action="open" />
      </button>
      <button
        type="button"
        disabled={!actions.state("save").enabled}
        onClick={() => actions.perform("save")}
      >
        Save
        <ShortcutHint action="save" />
      </button>
      <button
        type="button"
        disabled={!actions.state("save-as").enabled}
        onClick={() => actions.perform("save-as")}
      >
        Save As…
        <ShortcutHint action="save-as" />
      </button>
      <button
        type="button"
        disabled={!actions.state("export-agent").enabled}
        onClick={() => actions.perform("export-agent")}
      >
        Export for Agent…
        <ShortcutHint action="export-agent" />
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
  if (busy && !prompt && action !== "export")
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

export function RecoveryFeedback({
  recovery,
}: {
  recovery: import("./editor/recovery").RecoveryCoordinator;
}) {
  const { pending, lastCapture, error, warning } = useStore(recovery.state);
  if (!recovery.bridge.available) return null;
  return (
    <div
      className={`feedback ${error ? "error" : "info"}`}
      role={error ? "alert" : "status"}
      aria-label="Recovery feedback"
    >
      {error ||
        warning ||
        (pending
          ? "Recovery pending."
          : lastCapture
            ? "Recovery checkpoint ready."
            : "Recovery ready.")}
      {lastCapture !== null &&
        ` Last capture: ${new Date(lastCapture).toLocaleTimeString()}.`}
      {error && (
        <button type="button" onClick={() => recovery.retry()}>
          Retry recovery
        </button>
      )}
    </div>
  );
}

export function AgentExportFeedback({
  exports,
}: {
  exports: import("./editor/agent-export").AgentExports;
}) {
  const { message, busy, cancelable, error } = useStore(exports.state);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const button = cancelButton.current;
    return () => {
      if (
        button &&
        (!document.activeElement ||
          document.activeElement === button ||
          document.activeElement === document.body)
      )
        restoreFocus();
    };
  }, [busy]);
  if (!message) return null;
  return (
    <div
      className={`feedback ${error ? "error" : "info"}`}
      role={error ? "alert" : "status"}
      aria-label="Agent export feedback"
    >
      {busy && <progress aria-label="Agent export progress" />} {message}{" "}
      {busy && (
        <button
          type="button"
          ref={cancelButton}
          disabled={!cancelable}
          onClick={() => {
            exports.cancel();
            restoreFocus();
          }}
        >
          Cancel export
          <ShortcutHint action="cancel" />
        </button>
      )}
    </div>
  );
}
