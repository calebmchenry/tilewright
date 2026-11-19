import {
  selectionTransforms,
  type SelectionTransform,
} from "./domain/selection";
import type { EditorSession } from "./editor/session";
import { useStore } from "./editor/useStore";

export function SelectionPanel({ session }: { session: EditorSession }) {
  const selection = useStore(session.selection.state);
  const preview = useStore(session.selection.preview);
  const layers = useStore(session.layers);
  const hidden = useStore(session.hiddenLayers);
  const active = useStore(session.activeLayer);
  useStore(session.selection.clipboard);
  useStore(session.canvasState);
  useStore(session.viewport);
  useStore(session.registry);
  useStore(session.drawing.preview);
  useStore(session.fill.progress);
  const bounds = preview?.bounds ?? selection?.bounds;
  const ids =
    preview?.layerIds ?? selection?.layers.map((layer) => layer.layerId) ?? [];
  const placement = preview?.paste ?? preview?.transform;
  const placementName = preview?.paste ? "paste" : "transform";
  const transformReason = session.selection.transformReason();
  return (
    <section className="panel selection-panel" aria-label="Tile selection">
      <h2>Tile selection</h2>
      <div className="selection-actions">
        {(["copy", "cut", "paste"] as const).map((id) => {
          const action = session.action(id);
          return (
            <button
              key={id}
              type="button"
              disabled={!!action.reason}
              title={action.reason ?? undefined}
              aria-describedby={`selection-${id}-reason`}
              onClick={() => session.perform(id)}
            >
              {action.label}
            </button>
          );
        })}
      </div>
      {(["copy", "cut", "paste"] as const).map((id) => (
        <p
          key={id}
          id={`selection-${id}-reason`}
          className={id === "paste" ? "hint" : "sr-only"}
        >
          {session.action(id).reason}
        </p>
      ))}
      <div className="selection-actions">
        {(Object.keys(selectionTransforms) as SelectionTransform[]).map(
          (id) => (
            <button
              key={id}
              type="button"
              disabled={!!transformReason}
              title={transformReason ?? undefined}
              aria-describedby="selection-transform-reason"
              onClick={() => session.perform(id)}
            >
              {selectionTransforms[id]}
            </button>
          ),
        )}
      </div>
      <p id="selection-transform-reason" className="hint">
        {transformReason}
      </p>
      {bounds ? (
        <>
          <p data-testid="selection-dimensions">
            {bounds.maxX - bounds.minX} × {bounds.maxY - bounds.minY} tiles ·{" "}
            {(
              (bounds.maxX - bounds.minX) *
              (bounds.maxY - bounds.minY)
            ).toLocaleString()}{" "}
            positions
          </p>
          <p className="hint" data-testid="selection-bounds">
            X [{bounds.minX}, {bounds.maxX}) · Y [{bounds.minY}, {bounds.maxY})
            · end excluded
          </p>
          {preview ? (
            <p className="hint" role="status" aria-label="Selection preview">
              {preview.paste
                ? (preview.paste.reason ??
                  "Paste preview. Pointer sets the top-left; arrows nudge. Click, Enter or Apply paste to commit; Escape cancels.")
                : preview.transform
                  ? (preview.transform.reason ??
                    "Transform preview. Arrows reposition; rotate or flip again to compose. Enter or Apply transform commits; Escape cancels.")
                  : preview.move
                    ? (preview.move.reason ??
                      `Move ${preview.move.dx}, ${preview.move.dy} tiles. Release to apply; Escape cancels.`)
                    : "Release to capture tiles; Escape cancels."}
            </p>
          ) : (
            <>
              <fieldset className="selection-layers">
                <legend>Included layers</legend>
                {layers.map((layer) => {
                  const payload = selection!.layers.find(
                    (item) => item.layerId === layer.id,
                  );
                  const isHidden = hidden.includes(layer.id);
                  const last = !!payload && ids.length === 1;
                  return (
                    <label
                      key={layer.id}
                      className="checkbox-label"
                      title={
                        last
                          ? "Keep at least one included layer."
                          : isHidden
                            ? "Show this layer before including it."
                            : undefined
                      }
                    >
                      <input
                        type="checkbox"
                        aria-label={`Include ${layer.name} (${layer.id})`}
                        checked={!!payload}
                        disabled={isHidden || last}
                        onChange={(event) =>
                          session.selection.setIncluded(
                            layer.id,
                            event.target.checked,
                          )
                        }
                      />
                      <span>
                        {layer.name}
                        <small>
                          {layer.id}
                          {isHidden ? " · Hidden" : ""}
                          {payload
                            ? ` · ${payload.occupiedCount.toLocaleString()} occupied`
                            : " · Excluded"}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
              <button
                type="button"
                onClick={() => session.selection.deselect()}
              >
                Deselect
              </button>
            </>
          )}
          {placement && (
            <div
              className="selection-actions"
              onKeyDown={(event) => {
                if (
                  event.isDefaultPrevented() ||
                  event.nativeEvent.isComposing ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.altKey
                )
                  return;
                if (event.key === "Escape") {
                  event.preventDefault();
                  session.selection.cancel();
                }
              }}
            >
              <button
                type="button"
                disabled={!!placement.reason}
                title={placement.reason ?? undefined}
                onClick={() => session.selection.commitPlacement()}
              >
                Apply {placementName}
              </button>
              <button type="button" onClick={() => session.selection.cancel()}>
                Cancel {placementName}
              </button>
            </div>
          )}
          <p className="hint">
            Drag inside to move, including from a hole. Arrows nudge one tile;
            Shift+arrow nudges ten. Deselect to start a rectangle inside this
            one.
          </p>
          <p className="hint">
            Layer choices stay fixed when the active layer changes. Named areas
            and labels are excluded.
          </p>
        </>
      ) : (
        <p className="hint">
          Choose Select (V), then drag a rectangle. Starts on{" "}
          {layers.find((layer) => layer.id === active)?.name ??
            "the active layer"}
          ; add other layers here after selecting.
        </p>
      )}
      <p className="hint">
        Canvas Cmd/Ctrl+C copies, X cuts, V previews paste. Paste again to place
        another copy in this map. Text fields keep their own clipboard.
      </p>
    </section>
  );
}
