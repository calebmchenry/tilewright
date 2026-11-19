import { restoreFocus } from "./editor/focus";
import { useEffect, useRef, useState } from "react";
import {
  recoveryAge,
  type RecoveryBrowser,
  type ReviewedEntry,
} from "./editor/recovery-discovery";
import { useStore } from "./editor/useStore";

const time = (value: number) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
};
export function RecoveryPanel({ browser }: { browser: RecoveryBrowser }) {
  const reviewButton = useRef<HTMLButtonElement>(null);
  const state = useStore(browser.state);
  const lifecycle = useStore(browser.lifecycle.state);
  if (!browser.bridge.available) return null;
  return (
    <>
      <div className="recovery-entrypoint">
        <button
          ref={reviewButton}
          type="button"
          disabled={lifecycle.busy || state.busy}
          onClick={() => void browser.review()}
        >
          Review recovery…
        </button>
        {state.busy && !state.open && (
          <span role="status">Checking recovery…</span>
        )}
        {!state.open && state.entries.length > 0 && (
          <span>
            {state.entries.length} recovery{" "}
            {state.entries.length === 1 ? "map" : "maps"} available
          </span>
        )}
        {!state.open && state.error && <span role="alert">{state.error}</span>}
        {!state.open &&
          state.warnings.map((warning, index) => (
            <span key={index}>{warning}</span>
          ))}
      </div>
      {state.open && (
        <RecoveryDialog browser={browser} opener={reviewButton.current} />
      )}
    </>
  );
}
function RecoveryDialog({
  browser,
  opener,
}: {
  browser: RecoveryBrowser;
  opener: HTMLElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const state = useStore(browser.state);
  useStore(browser.lifecycle.files.workspace.state);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      restoreFocus(opener, true);
    };
  }, []);
  const groups = new Map<string, ReviewedEntry[]>();
  for (const entry of state.entries) {
    const source =
      entry.saved?.path ??
      entry.generations.find((g) => g.metadata)?.metadata?.saved?.path ??
      "Untitled unsaved work";
    groups.set(source, [...(groups.get(source) ?? []), entry]);
  }
  return (
    <dialog
      ref={dialog}
      className="canvas-dialog recovery-dialog"
      aria-label="Recover unsaved work"
      onCancel={(event) => {
        event.preventDefault();
        browser.dismiss();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <h2>Recover unsaved work</h2>
      <p>
        Restore a captured checkpoint as an editable, unsaved copy. Your saved
        project stays separate. Changes after the capture may be missing.
      </p>
      <div className="dialog-actions">
        <button type="button" autoFocus onClick={() => browser.dismiss()}>
          Not now
        </button>
        <button
          type="button"
          disabled={state.busy}
          onClick={() => void browser.refresh()}
        >
          Refresh recovery
        </button>
      </div>
      {state.busy && <p role="status">Checking recovery…</p>}
      {state.error && <p role="alert">{state.error}</p>}
      {state.warnings.map((warning, index) => (
        <p key={index}>{warning}</p>
      ))}
      {!state.busy && !state.entries.length && (
        <p>No unresolved recovery work.</p>
      )}
      {[...groups].map(([path, entries]) => (
        <section key={path} className="recovery-group" aria-label={path}>
          <h3>{path}</h3>
          {entries.length > 1 && (
            <p>
              {entries.length} separate maps with this source. Choose each
              independently.
            </p>
          )}
          {entries.map((entry) => (
            <RecoveryRow
              key={entry.documentId}
              entry={entry}
              browser={browser}
            />
          ))}
        </section>
      ))}
    </dialog>
  );
}
function RecoveryRow({
  entry,
  browser,
}: {
  entry: ReviewedEntry;
  browser: RecoveryBrowser;
}) {
  const { busy } = useStore(browser.state);
  const [selected, select] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const generation =
    entry.generations.find((g) => g.sequence === selected) ??
    entry.generations.find((g) => !g.error && g.metadata) ??
    entry.generations[0];
  const meta = generation?.metadata;
  const name =
    meta?.displayName ??
    entry.generations.find((g) => g.metadata)?.metadata?.displayName ??
    "Unavailable recovery";
  const current =
    entry.current || entry.documentId === browser.currentDocumentId;
  return (
    <article
      className="recovery-row"
      aria-label={`${name} — ${entry.documentId}`}
    >
      <h4>{name}</h4>
      <p className="recovery-identity">Map identity: {entry.documentId}</p>
      {current && (
        <p>
          Currently open — use Save or the document’s Discard changes action.
        </p>
      )}
      {entry.error && <p role="alert">Recovery unavailable: {entry.error}</p>}
      {generation && (
        <>
          {entry.generations.length > 1 && (
            <label>
              Checkpoint
              <select
                aria-label={`Checkpoint for ${entry.documentId}`}
                value={generation.sequence}
                disabled={busy || confirm}
                onChange={(event) => select(Number(event.target.value))}
              >
                {entry.generations.map((g) => (
                  <option key={g.sequence} value={g.sequence}>
                    {`Capture ${g.sequence} — ${g.metadata ? time(g.metadata.capturedAt) : "unknown time"}${g.error ? " — unavailable" : ""}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {generation !== entry.generations[0] &&
            entry.generations[0].error && (
              <p>
                The newer checkpoint could not be read. This is an older
                fallback.
              </p>
            )}
          {meta && (
            <>
              <p>
                Capture: {time(meta.capturedAt)} ·{" "}
                {recoveryAge(meta.capturedAt, meta.completedAt)}
              </p>
              <p>{generation.context}</p>
              {meta.saved && (
                <p>
                  Source at capture: {meta.saved.path}
                  <br />
                  Save known at capture: {time(meta.saved.savedAt)}
                </p>
              )}
              {entry.saved && (
                <p>
                  Latest known saved destination: {entry.saved.path}
                  <br />
                  Last known explicit save: {time(entry.saved.savedAt)}
                </p>
              )}
              <p className="hint">
                Saved-file checks are advisory and can change. Restore never
                writes to that file.
              </p>
            </>
          )}
          {generation.error && (
            <p role="alert">Recovery unavailable: {generation.error}</p>
          )}
        </>
      )}
      {confirm ? (
        <div
          className="recovery-confirm"
          role="group"
          aria-label="Confirm recovery discard"
        >
          <p>
            Discard recovery for <strong>{name}</strong> ({entry.documentId})?
          </p>
          <p>
            Captures:{" "}
            {entry.generations
              .map((g) =>
                g.metadata
                  ? time(g.metadata.capturedAt)
                  : `capture ${g.sequence} (time unavailable)`,
              )
              .join("; ") || "unavailable"}
            .
          </p>
          <p>
            Only this map’s recovery generations will be removed. The saved
            project and other recovery maps will remain.
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Keep recovery
            </button>
            <button
              type="button"
              disabled={busy || current}
              onClick={() => void browser.discard(entry)}
            >
              Discard this recovery
            </button>
          </div>
        </div>
      ) : (
        <div className="dialog-actions">
          <button
            type="button"
            disabled={
              busy || current || !meta || !!generation.error || !!entry.error
            }
            onClick={() => void browser.restore(entry, generation)}
          >
            Restore as unsaved copy
          </button>
          <button
            type="button"
            disabled={busy || current || !entry.discardable}
            onClick={() => setConfirm(true)}
          >
            Discard recovery…
          </button>
        </div>
      )}
    </article>
  );
}
