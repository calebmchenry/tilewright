import { restoreFocus } from "./editor/focus";
import type { EditorSession } from "./editor/session";
import { useStore } from "./editor/useStore";

export function SelectionPanel({ session }: { session: EditorSession }) {
  const selection = useStore(session.selection.state);
  const preview = useStore(session.selection.preview);
  const layers = useStore(session.layers);
  const hidden = useStore(session.hiddenLayers);
  const bounds = preview?.bounds ?? selection?.bounds;
  const ids =
    preview?.layerIds ?? selection?.layers.map((layer) => layer.layerId) ?? [];
  const placement = preview?.paste ?? preview?.transform;
  const placementName = preview?.paste ? "paste" : "transform";
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
            <p className="hint" role="status" aria-label="Selection preview">
              {preview.paste
                ? (preview.paste.reason ?? "Paste preview.")
                : preview.transform
                  ? (preview.transform.reason ?? "Transform preview.")
                  : preview.move
                    ? (preview.move.reason ??
                      `Move ${preview.move.dx}, ${preview.move.dy} tiles.`)
                    : "Selecting tiles."}
            </p>
          ) : (
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
                      aria-label={`Include ${layer.name}`}
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
                        {isHidden
                          ? "Hidden"
                          : payload
                            ? `${payload.occupiedCount.toLocaleString()} occupied`
                            : "Excluded"}
                      </small>
                    </span>
                  </label>
                );
              })}
            </fieldset>
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
                  session.perform("cancel");
                  restoreFocus();
                }
              }}
            >
              <button
                type="button"
                disabled={!!placement.reason}
                title={placement.reason ?? undefined}
                onClick={() => {
                  session.selection.commitPlacement();
                  restoreFocus();
                }}
              >
                Apply {placementName}
              </button>
              <button
                type="button"
                onClick={() => {
                  session.perform("cancel");
                  restoreFocus();
                }}
              >
                Cancel {placementName}
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="hint">No tiles selected.</p>
      )}
    </section>
  );
}
