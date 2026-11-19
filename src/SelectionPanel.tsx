import type { EditorSession } from "./editor/session";
import { useStore } from "./editor/useStore";

export function SelectionPanel({ session }: { session: EditorSession }) {
  const selection = useStore(session.selection.state);
  const preview = useStore(session.selection.preview);
  const layers = useStore(session.layers);
  const hidden = useStore(session.hiddenLayers);
  const active = useStore(session.activeLayer);
  const bounds = preview?.bounds ?? selection?.bounds;
  const ids =
    preview?.layerIds ?? selection?.layers.map((layer) => layer.layerId) ?? [];
  return (
    <section className="panel selection-panel" aria-label="Tile selection">
      <h2>Tile selection</h2>
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
            <p className="hint">Release to capture tiles; Escape cancels.</p>
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
    </section>
  );
}
