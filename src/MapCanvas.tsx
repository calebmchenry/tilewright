import { useEffect, useRef, useState } from "react";
import { mountRenderer } from "./renderer/mountRenderer";
import type { EditorSession } from "./editor/session";
import { bindNavigation } from "./editor/navigation";
import { canEditTiles, OVERVIEW_MESSAGE } from "./editor/viewport";
import { useStoreField } from "./editor/useStore";

export function MapCanvas({ session }: { session: EditorSession }) {
  const host = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [detail, setDetail] = useState("");

  const editable = useStoreField(session.viewport, canEditTiles);
  useEffect(() => bindNavigation(host.current!, session), [session]);

  useEffect(() => {
    setStatus("loading");
    session.canvasState.set("loading");
    return mountRenderer(
      host.current!,
      () => {
        setStatus("ready");
        session.canvasState.set("ready");
        session.report(
          "Canvas ready. Scroll to pan; pinch or Cmd-scroll to zoom. F fits the map.",
        );
      },
      (error) => {
        console.error("Tilewright could not initialize WebGL", error);
        setDetail(error instanceof Error ? error.message : String(error));
        setStatus("error");
        session.canvasState.set("error");
        session.reportError(error, "Canvas unavailable");
      },
      session,
    );
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
        middle-drag to pan. H selects Pan; I selects Inspect. F fits the map; 0
        resets to 100%; plus/minus zoom; arrows pan. Drawing tools are not
        available yet.
      </p>
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
