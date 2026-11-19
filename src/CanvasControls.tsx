import { restoreFocus } from "./editor/focus";
import { useEffect, useId, useRef, useState } from "react";
import {
  canvasInteger,
  DEFAULT_MAP_SIZE,
  GROWTH_EDGES,
  grownMapBounds,
  newMapBounds,
  type GrowthCounts,
} from "./domain/canvas";
import type { Bounds } from "./domain/coordinates";
import type { EditorSession } from "./editor/session";
import { useStore } from "./editor/useStore";

type Props = {
  session: EditorSession;
  onCreateMap?: (width: number, height: number) => void;
  disabled?: boolean;
};

function SizePreview({ bounds }: { bounds: Bounds }) {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  return (
    <div className="size-preview" aria-live="polite">
      <strong>
        {width} × {height} tiles
      </strong>
      <span>
        {width / 64} × {height / 64} chunks · 1 chunk = 64 × 64 tiles
      </span>
      <span>
        World bounds: [{bounds.minX}, {bounds.maxX}) × [{bounds.minY},{" "}
        {bounds.maxY})
      </span>
    </div>
  );
}

export function CanvasDialog({
  session,
  onCreateMap,
  close,
}: Props & { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const feedbackId = useId();
  const isNew = !!onCreateMap;
  const bounds = useStore(session.bounds);
  const [width, setWidth] = useState(String(DEFAULT_MAP_SIZE));
  const [height, setHeight] = useState(String(DEFAULT_MAP_SIZE));
  const [selected, setSelected] = useState({
    left: false,
    right: false,
    top: false,
    bottom: false,
  });
  const [drafts, setDrafts] = useState({
    left: "1",
    right: "1",
    top: "1",
    bottom: "1",
  });
  const [failure, setFailure] = useState("");
  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      restoreFocus(opener);
    };
  }, []);

  let preview: Bounds | undefined;
  let counts: GrowthCounts | undefined;
  let error = "";
  try {
    if (isNew)
      preview = newMapBounds(
        canvasInteger(width, "Width", 1),
        canvasInteger(height, "Height", 1),
      );
    else {
      counts = Object.fromEntries(
        GROWTH_EDGES.map((edge) => [
          edge,
          selected[edge] ? canvasInteger(drafts[edge], edge, 1) : 0,
        ]),
      ) as unknown as GrowthCounts;
      preview = grownMapBounds(bounds, counts);
      if (!GROWTH_EDGES.some((edge) => selected[edge]))
        error = "Choose at least one edge to grow.";
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  return (
    <dialog
      ref={dialog}
      className="canvas-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <form
        noValidate
        onChange={() => setFailure("")}
        onSubmit={(event) => {
          event.preventDefault();
          if (error || !preview) return;
          try {
            if (onCreateMap) onCreateMap(preview.maxX, preview.maxY);
            else if (!session.growCanvas(counts!)) {
              setFailure(session.feedback.getSnapshot().message);
              return;
            }
            close();
          } catch (cause) {
            setFailure(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <h2 id={titleId}>{isNew ? "New map" : "Grow canvas"}</h2>
        {isNew ? (
          <>
            <p>
              Start with 256 × 256 tiles (4 × 4 chunks), or choose a custom
              size. Partial chunks are allowed.
            </p>
            <div className="dimension-fields">
              <label>
                Width (tiles)
                <input
                  autoFocus
                  inputMode="numeric"
                  value={width}
                  onChange={(event) => setWidth(event.target.value)}
                  aria-describedby={feedbackId}
                />
              </label>
              <label>
                Height (tiles)
                <input
                  inputMode="numeric"
                  value={height}
                  onChange={(event) => setHeight(event.target.value)}
                  aria-describedby={feedbackId}
                />
              </label>
            </div>
            <p className="hint">
              Each dimension must be 1–65,536 tiles. Drawing never expands the
              map.
            </p>
          </>
        ) : (
          <>
            <p>
              Add space in 64-tile increments. Existing tiles and named areas
              keep their world positions. The view stays in place.
            </p>
            <div className="growth-fields">
              {GROWTH_EDGES.map((edge) => (
                <div key={edge}>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={selected[edge]}
                      onChange={(event) =>
                        setSelected({
                          ...selected,
                          [edge]: event.target.checked,
                        })
                      }
                    />
                    {edge[0].toUpperCase() + edge.slice(1)} edge
                  </label>
                  <label>
                    {edge[0].toUpperCase() + edge.slice(1)} increments
                    <input
                      inputMode="numeric"
                      disabled={!selected[edge]}
                      value={drafts[edge]}
                      onChange={(event) =>
                        setDrafts({ ...drafts, [edge]: event.target.value })
                      }
                      aria-describedby={feedbackId}
                    />
                  </label>
                </div>
              ))}
            </div>
            <p className="hint">
              Choose one or more edges. Each selected edge starts at 1 increment
              = 64 tiles. Growth is undoable.
            </p>
          </>
        )}
        {preview && <SizePreview bounds={preview} />}
        <p id={feedbackId} className="form-feedback" role="status">
          {failure || error}
        </p>
        {isNew && (
          <p>
            This replaces the current map and clears its undo history. Unsaved
            changes can be saved before continuing.
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" disabled={!!error}>
            {isNew ? "Create map" : "Apply growth"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function CanvasControls(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => setOpen(true)}
      >
        {props.onCreateMap ? "New map" : "Grow canvas"}
      </button>
      {open && <CanvasDialog {...props} close={() => setOpen(false)} />}
    </>
  );
}
