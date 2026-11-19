import { restoreFocus } from "./editor/focus";
import { useEffect, useRef, useState } from "react";
import { mountRenderer } from "./renderer/mountRenderer";
import type { CanvasRenderer } from "./renderer/createRenderer";
import type { EditorSession } from "./editor/session";
import { bindNavigation } from "./editor/navigation";
import { canEditTiles, OVERVIEW_MESSAGE } from "./editor/viewport";
import { useStore, useStoreField } from "./editor/useStore";

export function MapCanvas({ session }: { session: EditorSession }) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<CanvasRenderer | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [detail, setDetail] = useState("");

  const editable = useStoreField(session.viewport, canEditTiles);
  const tool = useStore(session.activeTool);
  const fill = useStore(session.fill.progress);
  const drawing = !!session.drawing.tool(tool);
  useEffect(
    () =>
      bindNavigation(
        host.current!,
        session,
        (point) => renderer.current?.areaAt(point) ?? null,
      ),
    [session],
  );

  useEffect(() => {
    setStatus("loading");
    session.canvasState.set("loading");
    const dispose = mountRenderer(
      host.current!,
      (created) => {
        renderer.current = created;
        setStatus("ready");
        session.canvasState.set("ready");
        session.report(
          "Canvas ready. Scroll to pan; pinch or Cmd-scroll to zoom. F fits the map.",
        );
        restoreFocus();
      },
      (error) => {
        renderer.current = null;
        console.error("Tilewright could not initialize WebGL", error);
        setDetail(error instanceof Error ? error.message : String(error));
        setStatus("error");
        session.canvasState.set("error");
        session.reportError(error, "Canvas unavailable");
      },
      session,
    );
    return () => {
      renderer.current = null;
      dispose();
    };
  }, [attempt, session]);

  return (
    <section className="workspace" aria-label="Map canvas">
      <div
        ref={host}
        className="canvas-host"
        tabIndex={0}
        role="region"
        aria-label="Canvas keyboard input"
        data-focus-owner="canvas"
        aria-describedby="canvas-help"
      />
      <p className="sr-only" id="canvas-help">
        Scroll to pan. Pinch or Cmd/Ctrl-scroll to zoom. Space-drag or
        middle-drag to pan. B selects Pencil; E selects Eraser; brackets change
        their shared size. D selects Eyedropper. G selects Fill. L selects Line;
        R selects Rectangle. V selects tiles. Shapes include both endpoints;
        lines and outlines are one tile thick. H selects Pan; I selects Inspect.
        A selects Areas. Area bounds are drawn explicitly from the Named areas
        panel. F fits the map; 0 resets to 100%; plus/minus zoom; arrows pan or
        nudge a Select selection. Drag with Inspect to measure a rectangle;
        Escape clears it.{" "}
        {drawing
          ? "Drag to preview; release to apply; Escape cancels drawing."
          : tool === "area"
            ? "Click a label to select its area, or edit in the Areas panel. Draw bounds explicitly, then Apply. Escape cancels the draft."
            : tool === "select"
              ? "Drag a rectangle and choose layers; drag inside to move. Arrows nudge one tile, Shift ten. Cmd/Ctrl+C copies, X cuts, V previews paste. For paste, move the pointer or use arrows; click or Enter applies. Rotate and flip in Tile selection; arrows reposition the transform, Enter applies. Escape cancels a preview or deselects."
              : tool === "fill"
                ? "Click to fill a connected region on the active layer. Escape cancels a running fill. Pan and zoom remain available."
                : tool === "eyedropper"
                  ? "Click to sample the topmost visible tile. Empty cells keep the current paint. B returns to Pencil."
                  : "Choose Pencil to paint the active layer."}
      </p>
      {fill && (
        <div className="fill-progress" aria-label="Fill progress" role="status">
          <progress aria-label="Filling connected region" />
          <span>Filling… {fill.cells.toLocaleString()} tiles</span>
          <button
            type="button"
            onClick={() => {
              session.perform("cancel");
              restoreFocus();
            }}
          >
            Cancel fill
          </button>
        </div>
      )}
      {status === "ready" && !editable && (
        <p
          className="overview-notice"
          role="status"
          aria-label="Editing availability"
        >
          {OVERVIEW_MESSAGE}
        </p>
      )}
      {status === "error" ? (
        <div className="canvas-message" role="alert">
          <h2>The map canvas could not start</h2>
          <p>
            Tilewright requires WebGL. Retry the canvas, or quit and reopen
            Tilewright. If this continues, update macOS and restart your Mac to
            reset its graphics service.
          </p>
          <details>
            <summary>Technical details</summary>
            <pre>{detail}</pre>
          </details>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry canvas
          </button>
        </div>
      ) : (
        <p className="canvas-caption" role="status" aria-label="Canvas status">
          {status === "ready" ? "Canvas ready" : "Starting canvas…"}
        </p>
      )}
    </section>
  );
}
