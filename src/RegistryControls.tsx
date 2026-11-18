import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  normalizePaintColor,
  parseRgbFields,
  rgbChannels,
} from "./domain/colors";
import {
  RegistryCollisionError,
  registryEntry,
  type RegistryPlan,
} from "./domain/registry";
import type { RegistryId } from "./domain/values";
import type { EditorSession } from "./editor/session";
import { useStore } from "./editor/useStore";

type Mode =
  | { kind: "add"; version: number }
  | { kind: "edit" | "adopt" | "remove"; id: RegistryId; version: number };
type Props = { session: EditorSession };

function Swatch({ color }: { color: string }) {
  return (
    <i
      className="registry-swatch"
      style={{ background: color }}
      aria-hidden="true"
    />
  );
}

function RegistryDialog({
  session,
  mode,
  close,
  changeMode,
}: Props & {
  mode: Mode;
  close: () => void;
  changeMode: (mode: Mode) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId(),
    feedback = useId();
  const initial =
    mode.kind === "add" ? null : session.document.getRegistryEntry(mode.id);
  const initialColor =
    typeof initial?.rgba === "string"
      ? normalizePaintColor(initial.rgba)
      : null;
  const [name, setName] = useState(
    typeof initial?.name === "string" ? initial.name : "",
  );
  const [hex, setHex] = useState(
    (initialColor ?? session.color.getSnapshot()).slice(0, 7),
  );
  const [rgb, setRgb] = useState(() =>
    rgbChannels(initialColor ?? session.color.getSnapshot()).map(String),
  );
  const [inputMode, setInputMode] = useState("hex");
  const [adopt, setAdopt] = useState(false);
  const [version, setVersion] = useState(mode.version);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState("");
  // Only an open preview subscribes to revisions. Ordinary tile edits do not
  // rerender the registry panel or scan the document for counts.
  const history = useStore(session.historyState);
  const preview = useMemo(() => {
    try {
      const color = inputMode === "hex" ? hex : (parseRgbFields(rgb) ?? "");
      const request =
        mode.kind === "add"
          ? { kind: "add" as const, name, color, adopt }
          : mode.kind === "edit"
            ? { kind: "edit" as const, id: mode.id, name, color }
            : { kind: mode.kind, id: mode.id };
      return {
        plan: session.registryCommands.prepare(request, version),
        error: null,
      };
    } catch (error) {
      return { plan: null, error };
    }
  }, [
    session,
    mode,
    name,
    hex,
    rgb,
    inputMode,
    adopt,
    version,
    history,
    attempt,
  ]);
  const plan = preview.plan;
  const editing = mode.kind === "add" || mode.kind === "edit";
  const labels = {
    add: "Register color",
    edit: "Edit named color",
    adopt: "Adopt matching raw tiles",
    remove: "Remove named color",
  };
  const cancel = () => {
    if (plan) session.registryCommands.cancel(plan);
    close();
  };
  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement;
    const fallback = opener
      ?.closest(".registry-controls")
      ?.querySelector<HTMLElement>("[data-register-color]");
    element.showModal();
    return () => {
      element.close();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
      else if (fallback?.isConnected) fallback.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="canvas-dialog registry-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <form
        noValidate
        onChange={() => setFailure("")}
        onSubmit={(event) => {
          event.preventDefault();
          if (!plan) return;
          if (session.commitRegistry(plan)) close();
          else {
            setFailure(session.feedback.getSnapshot().message);
            setAttempt((n) => n + 1);
          }
        }}
      >
        <h2 id={title}>{labels[mode.kind]}</h2>
        {editing && (
          <>
            <label>
              Name
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-describedby={feedback}
              />
            </label>
            <div className="registry-color-input">
              <label>
                Swatch
                <input
                  type="color"
                  aria-label="Named color swatch"
                  value={(
                    (inputMode === "hex"
                      ? normalizePaintColor(hex)
                      : parseRgbFields(rgb)) ??
                    initialColor ??
                    session.color.getSnapshot()
                  ).slice(0, 7)}
                  onChange={(e) => {
                    setHex(e.target.value);
                    setRgb(
                      rgbChannels(normalizePaintColor(e.target.value)!).map(
                        String,
                      ),
                    );
                    setInputMode("hex");
                  }}
                />
              </label>
              <label>
                Color input
                <select
                  value={inputMode}
                  onChange={(e) => {
                    const color =
                      inputMode === "hex"
                        ? normalizePaintColor(hex)
                        : parseRgbFields(rgb);
                    if (color) {
                      setHex(color.slice(0, 7));
                      setRgb(rgbChannels(color).map(String));
                    }
                    setInputMode(e.target.value);
                  }}
                >
                  <option value="hex">Hex</option>
                  <option value="rgb">RGB</option>
                </select>
              </label>
            </div>
            {inputMode === "hex" ? (
              <label>
                Named color hex
                <input
                  value={hex}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => setHex(e.target.value)}
                  aria-describedby={feedback}
                />
              </label>
            ) : (
              <fieldset className="rgb-fields">
                <legend>RGB · 0–255</legend>
                {["Red", "Green", "Blue"].map((channel, index) => (
                  <label key={channel}>
                    {channel}
                    <input
                      aria-label={`Named color ${channel}`}
                      value={rgb[index]}
                      inputMode="numeric"
                      autoComplete="off"
                      onChange={(e) =>
                        setRgb(
                          rgb.map((v, i) => (i === index ? e.target.value : v)),
                        )
                      }
                      aria-describedby={feedback}
                    />
                  </label>
                ))}
              </fieldset>
            )}
            {mode.kind === "add" && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={adopt}
                  onChange={(e) => setAdopt(e.target.checked)}
                />
                Adopt matching raw tiles on all layers
              </label>
            )}
          </>
        )}
        {plan && (
          <div className="registry-preview" aria-live="polite">
            <span>
              <Swatch color={plan.entry.rgba} />
              {plan.entry.name} · {plan.entry.rgba.slice(0, 7).toUpperCase()}
            </span>
            {mode.kind !== "edit" && (
              <p data-testid="registry-counts">
                {plan.cellCount}{" "}
                {mode.kind === "remove" ? "linked" : "matching raw"} tiles on{" "}
                {plan.layerCount} layers, including hidden and covered tiles.
              </p>
            )}
            {mode.kind === "remove" && (
              <p>
                Tiles keep their current appearance as raw colors. Their named
                association is removed. Undo restores the entry and its linked
                tiles.
              </p>
            )}
            {mode.kind === "adopt" && (
              <p>
                Link these raw tiles to this entry. Other named associations
                stay unchanged.
              </p>
            )}
            {mode.kind === "add" && (
              <p>
                {adopt
                  ? "The matching raw tiles will be linked to this new entry."
                  : "Existing tiles stay unchanged. The new entry becomes your paint selection."}
              </p>
            )}
          </div>
        )}
        <p className="form-feedback" id={feedback} role="alert">
          {failure ||
            (preview.error instanceof Error ? preview.error.message : "")}
        </p>
        {preview.error instanceof RegistryCollisionError && (
          <div className="registry-collision">
            {preview.error.owners.map(([id, entry]) => (
              <div key={id}>
                <span title={id}>
                  <Swatch color={entry.rgba} />
                  {entry.name} · {entry.rgba.slice(0, 7).toUpperCase()}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (session.selectRegisteredColor(id)) close();
                  }}
                >
                  Choose {entry.name}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    changeMode({
                      kind: "adopt",
                      id,
                      version: session.document.version,
                    })
                  }
                >
                  Adopt into {entry.name}
                </button>
              </div>
            ))}
          </div>
        )}
        {version !== session.document.version && (
          <button
            type="button"
            onClick={() => {
              setVersion(session.document.version);
              setFailure("");
            }}
          >
            Refresh preview
          </button>
        )}
        <div className="dialog-actions">
          <button type="button" autoFocus={!editing} onClick={cancel}>
            Cancel
          </button>
          <button type="submit" disabled={!plan}>
            {labels[mode.kind]}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function RegistryControls({ session }: Props) {
  const entries = useStore(session.registry);
  const selected = useStore(session.selectedRegistryId);
  const [mode, setMode] = useState<Mode | null>(null);
  const open = (kind: "edit" | "adopt" | "remove", id: RegistryId) => {
    try {
      if (kind === "remove") {
        const plan: RegistryPlan = session.registryCommands.prepare({
          kind,
          id,
        });
        if (!plan.cellCount) {
          session.commitRegistry(plan);
          return;
        }
        session.registryCommands.cancel(plan);
      }
      setMode({ kind, id, version: session.document.version });
    } catch (error) {
      session.reportError(error, "Named color");
    }
  };
  return (
    <div className="registry-controls">
      <h3>
        Named colors <span>{entries.length}</span>
      </h3>
      {entries.length ? (
        <ul className="registry-list">
          {entries.map(([id, record]) => {
            let valid = true;
            try {
              registryEntry(session.document, id);
            } catch {
              valid = false;
            }
            const name =
              typeof record.name === "string" && record.name ? record.name : id;
            return (
              <li key={id} data-registry-id={id}>
                <button
                  type="button"
                  className="registry-choice"
                  aria-label={`Paint with ${name}`}
                  aria-pressed={selected === id}
                  disabled={!valid}
                  title={
                    valid ? `${name} · ${id}` : `Invalid named color: ${id}`
                  }
                  onClick={() => session.selectRegisteredColor(id)}
                >
                  <Swatch color={valid ? String(record.rgba) : "#ff00ff"} />
                  <span>{name}</span>
                </button>
                <div className="registry-actions">
                  <button
                    type="button"
                    disabled={!valid}
                    onClick={() => open("edit", id)}
                    aria-label={`Edit ${name}`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={!valid}
                    onClick={() => open("adopt", id)}
                    aria-label={`Adopt raw tiles into ${name}`}
                  >
                    Adopt
                  </button>
                  <button
                    type="button"
                    disabled={!valid}
                    onClick={() => open("remove", id)}
                    aria-label={`Remove ${name}`}
                  >
                    Remove
                  </button>
                </div>
                {!valid && <p className="hint">Invalid named color record.</p>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="hint">No named colors in this map.</p>
      )}
      <button
        type="button"
        data-register-color
        onClick={() =>
          setMode({ kind: "add", version: session.document.version })
        }
      >
        Register color
      </button>
      {mode && (
        <RegistryDialog
          key={mode.kind === "add" ? "add" : `${mode.kind}/${mode.id}`}
          session={session}
          mode={mode}
          close={() => setMode(null)}
          changeMode={setMode}
        />
      )}
    </div>
  );
}
