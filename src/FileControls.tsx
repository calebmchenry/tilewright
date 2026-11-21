import { restoreFocus } from "./editor/focus";
import { useEffect, useRef, useState } from "react";
import { ShortcutHint } from "./ShortcutHint";
import type {
  DocumentAction,
  DocumentLifecycle,
} from "./editor/document-lifecycle";
import type { ProjectFiles } from "./editor/project-files";
import { useStore } from "./editor/useStore";

export function BrowserAvailability() {
  return (
    <div
      className="feedback info platform-availability"
      role="status"
      aria-label="Browser availability"
    >
      Browser preview: open or drop a project, then download an editable copy.
      Agent export and recovery are not available yet. Download before leaving
      this page and check your browser downloads. Navigation warnings are best
      effort, not recovery.
    </div>
  );
}

export function BrowserFileControls({
  lifecycle,
  onNewMap,
}: {
  lifecycle: DocumentLifecycle;
  onNewMap: () => void;
}) {
  const state = useStore(lifecycle.state);
  const fileState = useStore(lifecycle.files.state);
  const [dropMessage, setDropMessage] = useState("");
  useEffect(() => {
    const isFile = (event: DragEvent) =>
      event.dataTransfer?.types.includes("Files");
    const dragover = (event: DragEvent) => {
      if (!isFile(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const drop = (event: DragEvent) => {
      if (!isFile(event)) return;
      // Guard the whole page, including dialogs and panels, against navigation.
      event.preventDefault();
      event.stopPropagation();
      if (
        document.querySelector("dialog[open]") ||
        lifecycle.state.getSnapshot().busy ||
        lifecycle.files.state.getSnapshot().busy ||
        lifecycle.agentExport?.state.getSnapshot().busy
      ) {
        setDropMessage(
          "Finish the current action or dialog, then drop one project again.",
        );
        return;
      }
      setDropMessage("");
      void lifecycle.open(Array.from(event.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragover", dragover, true);
    window.addEventListener("drop", drop, true);
    return () => {
      window.removeEventListener("dragover", dragover, true);
      window.removeEventListener("drop", drop, true);
    };
  }, [lifecycle]);
  const exportState = useStore<{ readonly busy: boolean }>(
    lifecycle.agentExport?.state ?? lifecycle.state,
  );
  const busy = state.busy || fileState.busy || exportState.busy;
  return (
    <div
      className="browser-file-controls"
      role="region"
      aria-label="Project files"
    >
      <span className="project-drop-hint">Drop one .tilewright file here</span>
      <button type="button" disabled={busy} onClick={onNewMap}>
        New map
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setDropMessage("");
          void lifecycle.open();
        }}
      >
        Open…
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setDropMessage("");
          void lifecycle.save();
        }}
      >
        Download project
      </button>
      {dropMessage && <span role="alert">{dropMessage}</span>}
    </div>
  );
}

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
  const browserStatus = useStore(lifecycle.files.browserStatus);
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
        {lifecycle.files.browser
          ? "A download request does not confirm a file was saved. Downloading keeps this map open. Check your browser downloads, then retry this action and deliberately continue or discard."
          : "Save changes to the current map before continuing?"}{" "}
        {lifecycle.files.browser
          ? "Continuing discards this map and its undo history."
          : "Discarding loses unsaved changes and clears its undo history."}
      </p>
      {lifecycle.files.browser && (
        <p>
          <BrowserDocumentStatus files={lifecycle.files} />
        </p>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          autoFocus
          onClick={() => lifecycle.choose("cancel")}
        >
          Cancel
        </button>
        <button type="button" onClick={() => lifecycle.choose("discard")}>
          {lifecycle.files.browser &&
          browserStatus.changesSinceDownload === false
            ? "Continue without another download"
            : "Discard changes"}
        </button>
        <button
          type="button"
          disabled={!lifecycle.files.available}
          onClick={() => lifecycle.choose("save")}
        >
          {lifecycle.files.browser
            ? "Download project and stay"
            : "Save and continue"}
        </button>
      </div>
      {!lifecycle.files.available && (
        <p>Saving requires the Tilewright desktop app.</p>
      )}
    </dialog>
  );
}

export function BrowserDocumentStatus({ files }: { files: ProjectFiles }) {
  const { changesSinceDownload, workAtRisk } = useStore(files.browserStatus);
  return (
    <span
      className="document-status"
      title="Downloads are requests only; saving to disk is not confirmed."
    >
      {changesSinceDownload === null
        ? workAtRisk
          ? "Not downloaded"
          : "Opened file · no changes"
        : changesSinceDownload
          ? "Changes since download request"
          : "No changes since download request"}
    </span>
  );
}

export function DownloadTimestamp({ files }: { files: ProjectFiles }) {
  const requested = useStore(files.lastDownload);
  return (
    <span className="save-timestamp" data-testid="download-timestamp">
      {requested && (
        <time
          dateTime={new Date(requested.at).toISOString()}
          title={`Download requested: ${requested.filename} · ${new Date(requested.at).toLocaleString()}. Check browser downloads; disk save is not confirmed.`}
        >
          Download requested {new Date(requested.at).toLocaleTimeString()}
        </time>
      )}
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
        className="feedback info busy"
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
      {files.browser && (
        <button
          type="button"
          aria-label="Dismiss project file notification"
          onClick={() =>
            files.state.set({ ...files.state.getSnapshot(), message: "" })
          }
        >
          ×
        </button>
      )}
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
      className={`feedback ${error || warning ? "error" : "info"}`}
      role={error || warning ? "alert" : "status"}
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

export function SaveTimestamp({ files }: { files: ProjectFiles }) {
  const saved = useStore(files.lastSave);
  const { session } = useStore(files.workspace.state);
  return (
    <span className="save-timestamp" data-testid="save-timestamp">
      {saved?.kind === "native-save" && saved.session === session ? (
        <time
          dateTime={new Date(saved.at).toISOString()}
          title={new Date(saved.at).toLocaleString()}
        >
          Saved {new Date(saved.at).toLocaleTimeString()}
        </time>
      ) : (
        ""
      )}
    </span>
  );
}
