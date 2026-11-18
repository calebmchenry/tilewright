import { useEffect, useId, useState } from "react";
import { MapCanvas } from "./MapCanvas";
import { focusOwner } from "./editor/focus";
import { type ActionId, type EditorSession } from "./editor/session";
import { canEditTiles } from "./editor/viewport";
import { useStore, useStoreField } from "./editor/useStore";

type Props = { session: EditorSession };

function ActionButton({ session, action }: Props & { action: ActionId }) {
  useStoreField(session.historyState, (state) =>
    action === "undo"
      ? state.undoLabel
      : action === "redo"
        ? state.redoLabel
        : null,
  );
  useStoreField(session.canvasState, (state) =>
    ["inspect", "pan", "fit-map"].includes(action) ? state : null,
  );
  useStoreField(session.viewport, canEditTiles);
  const activeTool = useStore(session.activeTool);
  const state = session.action(action);
  const id = useId();
  return (
    <span className="action" title={state.reason ?? state.label}>
      <button
        type="button"
        disabled={!!state.reason}
        aria-describedby={state.reason ? id : undefined}
        aria-pressed={
          action === "inspect" || action === "pan"
            ? action === activeTool
            : undefined
        }
        onClick={() => session.perform(action)}
      >
        {state.label}
      </button>
      {state.reason && (
        <span className="sr-only" id={id}>
          {state.reason}
        </span>
      )}
    </span>
  );
}

function DocumentStatus({ session }: Props) {
  const state = useStore(session.historyState);
  return (
    <span className="document-status">
      {state.dirty ? "● Unsaved" : "Saved"}
    </span>
  );
}

export function ToolPanel({ session }: Props) {
  const tool = useStore(session.activeTool);
  return (
    <section className="panel tools" aria-label="Tools">
      <h2>
        Tools{" "}
        <span className="panel-value">
          {tool === "inspect" ? "Inspect" : "Pan"}
        </span>
      </h2>
      <div className="tool-grid">
        {(
          [
            "inspect",
            "pan",
            "pencil",
            "eraser",
            "eyedropper",
            "fill",
            "line",
            "rectangle",
            "select",
          ] as const
        ).map((action) => (
          <ActionButton key={action} session={session} action={action} />
        ))}
      </div>
      <p className="hint">
        Scroll to pan. Pinch or Cmd-scroll to zoom. Space-drag pans temporarily.
        H: Pan · I: Inspect · F: Fit map. Drawing tools are not available yet.
      </p>
    </section>
  );
}

export function ColorPanel({ session }: Props) {
  const color = useStore(session.color);
  const entries = useStore(session.registry);
  const [draft, setDraft] = useState(color);
  useEffect(() => setDraft(color), [color]);
  return (
    <section className="panel" aria-label="Color controls">
      <h2>
        Color <span className="panel-value">Current</span>
      </h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (session.setColor(draft)) setDraft(session.color.getSnapshot());
        }}
      >
        <div className="color-row">
          <input
            type="color"
            aria-label="Current color"
            value={color}
            onChange={(event) => session.setColor(event.target.value)}
          />
          <label>
            Hex color
            <input
              aria-label="Hex color"
              value={draft}
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
        </div>
        <button type="submit">Apply color</button>
      </form>
      <div className="current-color">
        <i style={{ background: color }} />
        {color.toUpperCase()}
      </div>
      <h3>
        Named colors <span>{entries.length}</span>
      </h3>
      {entries.length ? (
        <ul className="record-list">
          {entries.map(([id, entry]) => (
            <li key={id}>{typeof entry.name === "string" ? entry.name : id}</li>
          ))}
        </ul>
      ) : (
        <p className="hint">No named colors in this map.</p>
      )}
      <ActionButton session={session} action="register-color" />
      <p className="hint">Named color editing is not available yet.</p>
    </section>
  );
}

function LayerName({
  session,
  id,
  name,
}: Props & {
  id: ReturnType<EditorSession["activeLayer"]["getSnapshot"]>;
  name: string;
}) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  return (
    <form
      className="layer-name"
      onSubmit={(event) => {
        event.preventDefault();
        session.execute("Rename layer", [
          { kind: "rename-layer", id, name: draft.trim() },
        ]);
      }}
    >
      <label>
        Layer name
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <button
        type="submit"
        disabled={!draft.trim() || draft.trim() === name}
        title={
          !draft.trim()
            ? "Enter a layer name."
            : draft.trim() === name
              ? "Change the name to rename this layer."
              : "Rename active layer"
        }
      >
        Rename
      </button>
    </form>
  );
}

export function LayerPanel({ session }: Props) {
  const layers = useStore(session.layers);
  const active = useStore(session.activeLayer);
  const layer = layers.find((item) => item.id === active);
  const hidden = useStore(session.hiddenLayers);
  return (
    <section className="panel" aria-label="Layers">
      <h2>
        Layers <span className="panel-value">{layers.length}</span>
      </h2>
      <div className="layer-list" role="group" aria-label="Active layer">
        {[...layers].reverse().map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={item.id === active}
            onClick={() => session.selectLayer(item.id)}
          >
            <span className="layer-symbol" aria-hidden="true">
              ▱
            </span>
            <span>{item.name}</span>
            {item.id === active && <small>Active</small>}
          </button>
        ))}
      </div>
      {layer && (
        <>
          <label className="layer-visibility">
            <input
              type="checkbox"
              checked={!hidden.includes(layer.id)}
              onChange={(event) =>
                session.setLayerVisible(layer.id, event.target.checked)
              }
            />
            Show active layer
          </label>
          <LayerName
            key={layer.id}
            session={session}
            id={layer.id}
            name={layer.name}
          />
        </>
      )}
      <ActionButton session={session} action="add-layer" />
      <p className="hint">
        Top layers appear above lower layers. Creating layers is not available
        yet.
      </p>
    </section>
  );
}

export function AnnotationPanel({ session }: Props) {
  const annotations = useStore(session.annotations);
  const [query, setQuery] = useState("");
  const entries = annotations.filter(([id, record]) =>
    String(record.name ?? id)
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section className="panel" aria-label="Annotations">
      <h2>
        Named areas <span className="panel-value">{annotations.length}</span>
      </h2>
      <label>
        Find an area
        <input
          type="search"
          value={query}
          placeholder="Search named areas"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {entries.length ? (
        <ul className="record-list">
          {entries.map(([id, record]) => (
            <li key={id}>
              {typeof record.name === "string" ? record.name : id}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-state">
          {query ? "No matching areas." : "No named areas yet."}
        </p>
      )}
      <ActionButton session={session} action="add-annotation" />
      <p className="hint">
        Detail · Locality · Region
        <br />
        Named area editing is not available yet.
      </p>
    </section>
  );
}

export function ViewControls({ session }: Props) {
  const view = useStore(session.viewport);
  const bounds = useStore(session.bounds);
  return (
    <div className="workspace-toolbar">
      <span>
        {bounds.maxX - bounds.minX} × {bounds.maxY - bounds.minY} tiles
      </span>
      <ActionButton session={session} action="fit-map" />
      <label>
        Zoom{" "}
        <select
          aria-label="Zoom"
          value={view.zoom}
          onChange={(event) => session.setZoom(Number(event.target.value))}
        >
          {![0.125, 0.25, 0.5, 1, 2, 4, 8].includes(view.zoom) && (
            <option value={view.zoom}>{(view.zoom * 100).toFixed(2)}%</option>
          )}
          {[0.125, 0.25, 0.5, 1, 2, 4, 8].map((zoom) => (
            <option key={zoom} value={zoom}>
              {zoom * 100}%
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function Readout({ session }: Props) {
  const focus = useStore(session.focus),
    pointer = useStore(session.pointer);
  const layer = useStore(session.activeLayer),
    layers = useStore(session.layers);
  const bounds = useStore(session.bounds);
  const inside =
    pointer &&
    pointer.x >= bounds.minX &&
    pointer.y >= bounds.minY &&
    pointer.x < bounds.maxX &&
    pointer.y < bounds.maxY;
  return (
    <div className="readout">
      <span data-testid="coordinate-readout">
        {pointer
          ? `Tile ${pointer.x}, ${pointer.y}${inside ? "" : " · Outside map"}`
          : "Tile —, —"}
      </span>
      <span>
        Layer: {layers.find((item) => item.id === layer)?.name ?? "—"}
      </span>
      <span data-testid="focus-readout">
        {focus === "text"
          ? "Text editing"
          : focus === "canvas"
            ? "Canvas keyboard"
            : focus === "panel"
              ? "Panel controls"
              : "Workspace inactive"}
      </span>
    </div>
  );
}

function Feedback({ session }: Props) {
  const feedback = useStore(session.feedback);
  return (
    <div
      className={`feedback ${feedback.kind}`}
      role={feedback.kind === "error" ? "alert" : "status"}
      aria-label="Action feedback"
    >
      {feedback.message}
    </div>
  );
}

export function App({ session }: Props) {
  useEffect(() => {
    const blur = () => session.focus.set("outside");
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, [session]);
  return (
    <main
      className="editor"
      data-editor-root
      onFocusCapture={(event) => session.focus.set(focusOwner(event.target))}
      onBlurCapture={(event) =>
        session.focus.set(focusOwner(event.relatedTarget))
      }
      onKeyDown={(event) => {
        if (session.routeKey(event.nativeEvent, focusOwner(event.target)))
          event.preventDefault();
      }}
    >
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ▦
          </span>
          <h1>Tilewright</h1>
        </div>
        <div className="document-title">
          Untitled map <DocumentStatus session={session} />
        </div>
        <div className="history-controls">
          <ActionButton session={session} action="undo" />
          <ActionButton session={session} action="redo" />
          <ActionButton session={session} action="save" />
        </div>
      </header>
      <div className="editor-body">
        <aside className="left-sidebar">
          <ToolPanel session={session} />
          <ColorPanel session={session} />
        </aside>
        <div className="canvas-column">
          <ViewControls session={session} />
          <MapCanvas session={session} />
        </div>
        <aside className="right-sidebar">
          <LayerPanel session={session} />
          <AnnotationPanel session={session} />
        </aside>
      </div>
      <footer>
        <Readout session={session} />
        <Feedback session={session} />
      </footer>
    </main>
  );
}
