import { useEffect, useId, useState } from "react";
import { MapCanvas } from "./MapCanvas";
import { focusOwner } from "./editor/focus";
import { type ActionId, type EditorSession } from "./editor/session";
import { canEditTiles } from "./editor/viewport";
import { useStore, useStoreField } from "./editor/useStore";
import { VISUAL_CHUNK_SIZE, visualChunkAt } from "./domain/coordinates";
import { gridScale } from "./renderer/grid";
import { CanvasControls } from "./CanvasControls";
import type { EditorWorkspace } from "./editor/workspace";
import { LayerPanel } from "./LayerPanel";
import { RegistryControls } from "./RegistryControls";
import {
  parseRgbFields,
  rgbChannels,
  type ColorInput,
  type PaintColor,
} from "./domain/colors";
export { LayerPanel } from "./LayerPanel";

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
    ["inspect", "pan", "fit-map"].includes(action) ||
    session.drawing.tool(action)
      ? state
      : null,
  );
  useStoreField(session.hiddenLayers, () =>
    session.drawing.tool(action) ? session.editableLayerIds().length > 0 : null,
  );
  useStoreField(session.activeLayer, () =>
    session.drawing.tool(action) ? session.editableLayerIds().length > 0 : null,
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
          action === "inspect" ||
          action === "pan" ||
          session.drawing.tool(action)
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
        Tools <span className="panel-value">{session.action(tool).label}</span>
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
        H: Pan · I: Inspect · F: Fit map. Drag with Inspect to measure a
        rectangle; Escape clears it.{" "}
        {session.drawing.tool(tool)
          ? "Drag to preview; release to apply; Escape cancels drawing."
          : "Drawing tools are not available yet."}
      </p>
    </section>
  );
}

export function ColorPanel({ session }: Props) {
  const color = useStore(session.color);
  const selected = useStore(session.selectedRegistryId);
  const entries = useStore(session.registry);
  const selectedEntry = entries.find(([id]) => id === selected)?.[1];
  const [draft, setDraft] = useState(color.slice(0, 7));
  const [rgbDraft, setRgbDraft] = useState(() =>
    rgbChannels(color).map(String),
  );
  const [hexError, setHexError] = useState(false);
  const [rgbError, setRgbError] = useState(false);
  const id = useId();
  const matches = entries.filter(
    ([, entry]) =>
      typeof entry.rgba === "string" && entry.rgba.toLowerCase() === color,
  );
  function syncDrafts(next: PaintColor) {
    setDraft(next.slice(0, 7));
    setRgbDraft(rgbChannels(next).map(String));
    setHexError(false);
    setRgbError(false);
  }
  useEffect(() => syncDrafts(color), [color]);
  function apply(input: ColorInput) {
    if (!session.setColor(input)) return false;
    // Reset even if the canonical value did not change (e.g. #ABC -> #aabbcc).
    syncDrafts(session.color.getSnapshot());
    return true;
  }
  return (
    <section className="panel" aria-label="Color controls">
      <h2>
        Color <span className="panel-value">Current</span>
      </h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setHexError(!apply(draft));
        }}
      >
        <div className="color-row">
          <input
            type="color"
            aria-label="Current color"
            value={color.slice(0, 7)}
            onChange={(event) => apply(event.target.value)}
          />
          <label>
            Hex color
            <input
              aria-label="Hex color"
              value={draft}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={hexError}
              aria-describedby={hexError ? `${id}-hex-error` : undefined}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
        </div>
        <button type="submit">Apply color</button>
        {hexError && (
          <p className="form-feedback" id={`${id}-hex-error`}>
            Use #RGB or #RRGGBB. Alpha, if included, must be F or FF (fully
            opaque).
          </p>
        )}
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const next = parseRgbFields(rgbDraft);
          if (next) apply(next);
          else {
            setRgbError(true);
            session.report(
              "Enter Red, Green and Blue as whole numbers from 0 to 255.",
              "error",
            );
          }
        }}
      >
        <fieldset
          className="rgb-fields"
          aria-describedby={rgbError ? `${id}-rgb-error` : undefined}
        >
          <legend>RGB · 0–255</legend>
          {["Red", "Green", "Blue"].map((channel, index) => (
            <label key={channel}>
              {channel}
              <input
                aria-label={channel}
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                value={rgbDraft[index]}
                aria-invalid={rgbError}
                aria-describedby={rgbError ? `${id}-rgb-error` : undefined}
                onChange={(event) =>
                  setRgbDraft(
                    rgbDraft.map((value, at) =>
                      at === index ? event.target.value : value,
                    ),
                  )
                }
              />
            </label>
          ))}
        </fieldset>
        <button type="submit">Apply RGB</button>
        {rgbError && (
          <p className="form-feedback" id={`${id}-rgb-error`}>
            Each channel must be a whole number from 0 to 255.
          </p>
        )}
      </form>
      <output className="current-color" aria-label="Selected color">
        <i style={{ background: color }} aria-hidden="true" />
        {color.slice(0, 7).toUpperCase()}
      </output>
      <p className="hint">Opaque sRGB · Erasing reveals lower layers.</p>
      <p className="color-association" data-testid="color-association">
        {selectedEntry
          ? `Named color · ${selectedEntry.name}`
          : "Raw color · Not linked to a named entry."}
      </p>
      <p className="hint color-match" data-testid="color-match">
        {matches.length
          ? `Named ${matches.length === 1 ? "match" : "matches"}: ${matches.map(([id, entry]) => (typeof entry.name === "string" ? entry.name : id)).join(", ")}`
          : "Unregistered color · No named match."}
      </p>
      <RegistryControls session={session} />
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
      <span className="map-dimensions" data-testid="map-dimensions">
        {bounds.maxX - bounds.minX} × {bounds.maxY - bounds.minY} tiles
        <small>
          {(bounds.maxX - bounds.minX) / VISUAL_CHUNK_SIZE} ×{" "}
          {(bounds.maxY - bounds.minY) / VISUAL_CHUNK_SIZE} chunks
        </small>
      </span>
      <CanvasControls session={session} />
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
  const rectangle = useStore(session.rectangle);
  const view = useStore(session.viewport);
  const scale = gridScale(view);
  const chunk = pointer ? visualChunkAt(pointer.x, pointer.y) : null;
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
      <span data-testid="chunk-readout">
        {chunk
          ? `Chunk ${chunk.chunkX}, ${chunk.chunkY} · Local ${chunk.localX}, ${chunk.localY}`
          : "Chunk —, —"}
      </span>
      <span data-testid="rectangle-readout">
        {rectangle
          ? `Rectangle ${rectangle.maxX - rectangle.minX} × ${rectangle.maxY - rectangle.minY} tiles`
          : "Rectangle —"}
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
      <span className="grid-scale" data-testid="grid-scale">
        1 chunk = 64 × 64 tiles · {scale.tileAlpha > 0 ? "Tile grid · " : ""}
        {scale.chunkStride === 1
          ? "64-tile chunk lines"
          : `Grid every ${scale.chunkStride} chunks (${64 * scale.chunkStride} tiles)`}
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

export function Workspace({ workspace }: { workspace: EditorWorkspace }) {
  const { session, generation } = useStore(workspace.state);
  return (
    <App
      key={generation}
      session={session}
      onCreateMap={(width, height) => workspace.createMap(width, height)}
    />
  );
}

export function App({
  session,
  onCreateMap,
}: Props & { onCreateMap?: (width: number, height: number) => void }) {
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
          {onCreateMap && (
            <CanvasControls session={session} onCreateMap={onCreateMap} />
          )}
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
