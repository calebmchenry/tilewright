import { projectDisplayName, type ProjectSource } from "./editor/persistence";
import type { PlatformServices } from "./platform/services";
import { RecoveryPanel } from "./RecoveryPanel";
import type {
  RecoveryBrowser,
  RecoveredProject,
} from "./editor/recovery-discovery";
import { useEffect, useId, useRef, useState } from "react";
import { MapCanvas } from "./MapCanvas";
import { ShortcutHint } from "./ShortcutHint";
import { focusOwner, restoreFocus } from "./editor/focus";
import { type ActionId, type EditorSession } from "./editor/session";
import { canEditTiles } from "./editor/viewport";
import { useStore, useStoreField } from "./editor/useStore";
import { VISUAL_CHUNK_SIZE, visualChunkAt } from "./domain/coordinates";
import { CanvasControls, CanvasDialog } from "./CanvasControls";
import type { ApplicationActions } from "./editor/application-actions";
import type { EditorWorkspace } from "./editor/workspace";
import { LayerPanel } from "./LayerPanel";
import { RegistryControls } from "./RegistryControls";
import { AnnotationPanel } from "./AnnotationPanel";
export { AnnotationPanel } from "./AnnotationPanel";
import {
  AgentExportFeedback,
  BrowserAvailability,
  BrowserFileControls,
  FileFeedback,
  SaveTimestamp,
  DownloadTimestamp,
  BrowserDocumentStatus,
  RecoveryFeedback,
  UnsavedChanges,
  LifecycleFeedback,
} from "./FileControls";
import type { DocumentLifecycle } from "./editor/document-lifecycle";
import { SelectionPanel } from "./SelectionPanel";
import { normalizePaintColor } from "./domain/colors";
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
          action === "area" ||
          session.drawing.tool(action)
            ? action === activeTool
            : undefined
        }
        onClick={() => session.perform(action)}
      >
        {state.label}
        <ShortcutHint action={action} />
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
            "area",
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
    </section>
  );
}

export function ColorPanel({ session }: Props) {
  const color = useStore(session.color);
  const [draft, setDraft] = useState(color.slice(0, 7));
  const [hexError, setHexError] = useState(false);
  const draftColor = useRef(color);
  const id = useId();
  useEffect(() => {
    // External changes (named colors, sampling) replace the draft. Live typing
    // keeps its text and caret until blur, including at shorthand lengths.
    if (draftColor.current === color) return;
    draftColor.current = color;
    setDraft(color.slice(0, 7));
    setHexError(false);
  }, [color]);
  function updateHex(value: string) {
    setDraft(value);
    setHexError(false);
    const next = normalizePaintColor(value);
    if (next && session.setColor(next)) draftColor.current = next;
  }
  function finishHex() {
    const next = normalizePaintColor(draft);
    setHexError(!next);
    if (next) setDraft(next.slice(0, 7));
    else
      session.report(
        "Use #RGB or #RRGGBB. Alpha, if included, must be F or FF (fully opaque).",
        "error",
      );
  }
  return (
    <section className="panel" aria-label="Color controls">
      <h2>Color</h2>
      <div className="color-row">
        <input
          type="color"
          aria-label="Current color"
          value={color.slice(0, 7)}
          onChange={(event) => {
            updateHex(event.target.value);
          }}
        />
        <input
          aria-label="Hex color"
          value={draft}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={hexError}
          aria-describedby={hexError ? `${id}-hex-error` : undefined}
          onChange={(event) => updateHex(event.target.value)}
          onBlur={finishHex}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              finishHex();
            }
          }}
        />
      </div>
      {hexError && (
        <p className="form-feedback" id={`${id}-hex-error`}>
          Use #RGB or #RRGGBB. Alpha, if included, must be F or FF (fully
          opaque).
        </p>
      )}
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
  const pointer = useStore(session.pointer);
  const bounds = useStore(session.bounds);
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
      {feedback.kind === "error" && (
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={() => session.report("")}
        >
          ×
        </button>
      )}
    </div>
  );
}

export function Workspace({
  platform,
  workspace,
  lifecycle,
  actions,
  recoveryBrowser,
}: {
  recoveryBrowser?: RecoveryBrowser;
  platform?: PlatformServices;
  workspace: EditorWorkspace;
  lifecycle: DocumentLifecycle;
  actions: ApplicationActions;
}) {
  const { session, generation, source, savedPath, recovered } = useStore(
    workspace.state,
  );
  const newDialog = useStore(actions.newDialog);
  return (
    <>
      <App
        key={generation}
        nativeWindow={platform?.kind === "tauri"}
        browserPreview={platform?.kind === "browser"}
        session={session}
        lifecycle={lifecycle}
        source={source}
        savedPath={savedPath}
        recovered={recovered}
        recoveryBrowser={recoveryBrowser}
        onNewMap={() => actions.perform("new")}
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
  nativeWindow = false,
  browserPreview = false,
  session,
  lifecycle,
  source,
  savedPath,
  recovered,
  recoveryBrowser,
  onNewMap,
}: Props & {
  nativeWindow?: boolean;
  browserPreview?: boolean;
  lifecycle?: DocumentLifecycle;
  source?: ProjectSource | null;
  savedPath?: string | null;
  recovered?: RecoveredProject | null;
  recoveryBrowser?: RecoveryBrowser;
  onNewMap?: () => void;
}) {
  useEffect(() => {
    const blur = () => session.focus.set("outside");
    const focus = () => {
      session.focus.set(focusOwner(document.activeElement));
      restoreFocus();
    };
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
    };
  }, [session]);
  return (
    <main
      className="editor"
      data-editor-root
      onPointerDownCapture={(event) => {
        // WKWebView does not focus buttons on mouse clicks by default. Give
        // deliberate panel clicks ownership so subsequent keys cannot keep
        // editing the previous text field or disappear at the webview root.
        const button = (event.target as Element).closest("button");
        if (event.button === 0 && button && !button.disabled)
          button.focus({ preventScroll: true });
      }}
      onClickCapture={(event) => {
        // Accessibility activation can emit a click without pointer events.
        // Explicit buttons own focus; implicit form submission from a text
        // field keeps the field's caret and native undo stack.
        const button = (event.target as Element).closest("button");
        if (
          button &&
          !button.disabled &&
          (button.type === "button" ||
            event.detail > 0 ||
            focusOwner(document.activeElement) !== "text")
        )
          button.focus({ preventScroll: true });
      }}
      onFocusCapture={(event) => session.focus.set(focusOwner(event.target))}
      onBlurCapture={(event) =>
        session.focus.set(focusOwner(event.relatedTarget))
      }
      onKeyDown={(event) => {
        if ((event.target as Element).closest("dialog[open]")) return;
        if (session.routeKey(event.nativeEvent, focusOwner(event.target))) {
          event.preventDefault();
          restoreFocus();
        }
      }}
    >
      <header
        className={`app-header${browserPreview ? " browser-header" : ""}${nativeWindow && /Mac/.test(navigator.platform) ? " native-titlebar" : ""}`}
        data-tauri-drag-region
      >
        <div
          className="document-title"
          data-tauri-drag-region
          title={
            savedPath ??
            (recovered
              ? `Captured ${new Date(recovered.capturedAt).toLocaleString()}`
              : undefined)
          }
        >
          <span className="project-filename" data-tauri-drag-region>
            {projectDisplayName(source ?? null) ??
              savedPath?.split("/").pop() ??
              (recovered
                ? `Recovered — ${recovered.displayName}`
                : "Untitled map")}
          </span>{" "}
          {browserPreview && lifecycle ? (
            <BrowserDocumentStatus files={lifecycle.files} />
          ) : (
            <DocumentStatus session={session} />
          )}
        </div>
        {recoveryBrowser && <RecoveryPanel browser={recoveryBrowser} />}
        {browserPreview && lifecycle && onNewMap && (
          <BrowserFileControls lifecycle={lifecycle} onNewMap={onNewMap} />
        )}
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
        {lifecycle && <SaveTimestamp files={lifecycle.files} />}
        {browserPreview && lifecycle && (
          <DownloadTimestamp files={lifecycle.files} />
        )}
      </footer>
      <div className="notifications">
        {browserPreview && <BrowserAvailability />}
        <Feedback session={session} />
        {lifecycle && (
          <>
            <FileFeedback files={lifecycle.files} />
            {lifecycle.agentExport && (
              <AgentExportFeedback exports={lifecycle.agentExport} />
            )}
            <LifecycleFeedback lifecycle={lifecycle} />
            {lifecycle.files.recovery && (
              <RecoveryFeedback recovery={lifecycle.files.recovery} />
            )}
          </>
        )}
      </div>
    </main>
  );
}
