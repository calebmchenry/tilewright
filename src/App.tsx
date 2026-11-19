import { useEffect, useId, useState } from "react";
import { MapCanvas } from "./MapCanvas";
import { focusOwner } from "./editor/focus";
import { type ActionId, type EditorSession } from "./editor/session";
import { canEditTiles } from "./editor/viewport";
import { useStore, useStoreField } from "./editor/useStore";
import { VISUAL_CHUNK_SIZE, visualChunkAt } from "./domain/coordinates";
import { gridScale } from "./renderer/grid";
import { CanvasControls, CanvasDialog } from "./CanvasControls";
import type { ApplicationActions } from "./editor/application-actions";
import type { EditorWorkspace } from "./editor/workspace";
import { LayerPanel } from "./LayerPanel";
import { RegistryControls } from "./RegistryControls";
import { AnnotationPanel } from "./AnnotationPanel";
export { AnnotationPanel } from "./AnnotationPanel";
import {
  FileControls,
  FileFeedback,
  UnsavedChanges,
  LifecycleFeedback,
} from "./FileControls";
import type { DocumentLifecycle } from "./editor/document-lifecycle";
import { SelectionPanel } from "./SelectionPanel";
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
    ["inspect", "pan", "fit-map", "eyedropper", "fill", "select"].includes(
      action,
    ) || session.drawing.tool(action)
      ? state
      : null,
  );
  useStoreField(session.hiddenLayers, () =>
    session.drawing.tool(action) || action === "fill" || action === "select"
      ? session.editableLayerIds().length > 0
      : null,
  );
  useStoreField(session.activeLayer, () =>
    session.drawing.tool(action) || action === "fill" || action === "select"
      ? session.editableLayerIds().length > 0
      : null,
  );
  useStoreField(session.fill.progress, (state) =>
    action === "fill" ? !!state : null,
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
          action === "eyedropper" ||
          action === "fill" ||
          action === "select" ||
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
  const pencilSize = useStore(session.pencilSize);
  const rectangleMode = useStore(session.rectangleMode);
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
      {(tool === "pencil" || tool === "eraser") && (
        <label>
          {tool === "eraser" ? "Eraser size" : "Pencil size"}
          <select
            aria-label={tool === "eraser" ? "Eraser size" : "Pencil size"}
            value={pencilSize}
            onChange={(event) =>
              session.setPencilSize(Number(event.target.value))
            }
          >
            {Array.from({ length: 32 }, (_, i) => i + 1).map((size) => (
              <option key={size} value={size}>
                {size} × {size} tiles
              </option>
            ))}
          </select>
        </label>
      )}
      {tool === "rectangle" && (
        <label>
          Rectangle style
          <select
            aria-label="Rectangle style"
            value={rectangleMode}
            onChange={(event) =>
              session.setRectangleMode(
                event.target.value === "outline" ? "outline" : "filled",
              )
            }
          >
            <option value="filled">Filled</option>
            <option value="outline">Outline</option>
          </select>
        </label>
      )}
      {(tool === "line" || tool === "rectangle") && (
        <p className="hint">
          Both endpoint tiles included. Lines and outlines are one tile thick;
          brush size does not apply.
        </p>
      )}
      <p className="hint">
        Scroll to pan. Pinch or Cmd-scroll to zoom. Space-drag pans temporarily.
        B: Pencil · E: Eraser · D: Eyedropper · G: Fill · L: Line · R: Rectangle
        · V: Select · [ / ]: Brush size · H: Pan · I: Inspect · F: Fit map. Drag
        with Inspect to measure a rectangle; Escape clears it.{" "}
        {session.drawing.tool(tool)
          ? "Drag to preview; release to apply; Escape cancels drawing."
          : tool === "area"
            ? "Edit named areas in the Areas panel. Draw bounds explicitly, then Apply. Escape cancels the draft."
            : tool === "select"
              ? "Drag to select tiles, then choose included layers. Escape cancels a drag or deselects."
              : tool === "fill"
                ? "Click to fill connected tiles on the active layer. Matching uses exact color or named identity; corners do not connect. Escape cancels a running fill."
                : tool === "eyedropper"
                  ? "Click to sample the topmost visible tile. Empty cells keep the current paint. B returns to Pencil."
                  : "Choose Pencil to paint the active layer."}
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

export function Workspace({
  workspace,
  lifecycle,
  actions,
}: {
  workspace: EditorWorkspace;
  lifecycle: DocumentLifecycle;
  actions: ApplicationActions;
}) {
  const { session, generation, savedPath } = useStore(workspace.state);
  const state = useStore(lifecycle.state);
  const newDialog = useStore(actions.newDialog);
  return (
    <>
      <App
        key={generation}
        session={session}
        lifecycle={lifecycle}
        actions={actions}
        savedPath={savedPath}
        lifecycleBusy={state.busy}
        onCreateMap={(width, height) => {
          void lifecycle.newMap(width, height);
        }}
      />
      <UnsavedChanges lifecycle={lifecycle} />
      {newDialog && (
        <CanvasDialog
          session={session}
          onCreateMap={(width, height) => actions.createMap(width, height)}
          close={() => actions.newDialog.set(false)}
        />
      )}
    </>
  );
}

export function App({
  session,
  onCreateMap,
  lifecycle,
  actions,
  lifecycleBusy = false,
  savedPath,
}: Props & {
  onCreateMap?: (width: number, height: number) => void;
  lifecycle?: DocumentLifecycle;
  actions?: ApplicationActions;
  lifecycleBusy?: boolean;
  savedPath?: string | null;
}) {
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
        <div className="document-title" title={savedPath ?? undefined}>
          <span className="project-filename">
            {savedPath?.split("/").pop() ?? "Untitled map"}
          </span>{" "}
          <DocumentStatus session={session} />
        </div>
        <div className="history-controls">
          {actions ? (
            <button
              type="button"
              disabled={lifecycleBusy}
              onClick={() => actions.perform("new")}
            >
              New map
            </button>
          ) : (
            onCreateMap && (
              <CanvasControls
                session={session}
                onCreateMap={onCreateMap}
                disabled={lifecycleBusy}
              />
            )
          )}
          <ActionButton session={session} action="undo" />
          <ActionButton session={session} action="redo" />
          {actions ? (
            <FileControls actions={actions} />
          ) : (
            <ActionButton session={session} action="save" />
          )}
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
          <SelectionPanel session={session} />
          <AnnotationPanel session={session} />
        </aside>
      </div>
      <footer>
        <Readout session={session} />
        <Feedback session={session} />
        {lifecycle && (
          <>
            <FileFeedback files={lifecycle.files} />
            <LifecycleFeedback lifecycle={lifecycle} />
          </>
        )}
      </footer>
    </main>
  );
}
