import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { LayerId } from "./domain/values";
import type { EditorSession } from "./editor/session";
import { useStore } from "./editor/useStore";

type Props = { session: EditorSession };

function LayerButton({
  reason,
  onClick,
  children,
}: {
  reason?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <span className="action" title={reason}>
      <button
        type="button"
        disabled={!!reason}
        aria-describedby={reason ? id : undefined}
        onClick={onClick}
      >
        {children}
      </button>
      {reason && (
        <span className="sr-only" id={id}>
          {reason}
        </span>
      )}
    </span>
  );
}

function LayerName({
  session,
  id,
  name,
}: Props & { id: LayerId; name: string }) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  return (
    <form
      className="layer-name"
      onSubmit={(event) => {
        event.preventDefault();
        session.renameLayer(id, draft);
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

function RemoveLayerDialog({
  session,
  id,
  close,
}: Props & { id: LayerId; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId(),
    description = useId();
  const layers = useStore(session.layers);
  const layer = layers.find((item) => item.id === id);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      // React can detach a dialog before effect cleanup, so native close alone
      // cannot always return focus. Removal can also disable its former opener.
      if (opener instanceof HTMLElement && opener.isConnected) {
        const target = opener.matches(":disabled")
          ? opener
              .closest("section")
              ?.querySelector<HTMLElement>('button[aria-pressed="true"]')
          : opener;
        target?.focus({ preventScroll: true });
      }
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="canvas-dialog"
      aria-labelledby={title}
      aria-describedby={description}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <h2 id={title}>Remove layer?</h2>
      <p id={description} className="removal-description">
        Remove “{layer?.name ?? "Unavailable layer"}” and all its tiles,
        including hidden content? Undo restores the layer, its tiles, and its
        stack position.
      </p>
      <p className="form-feedback" role="alert">
        {failure}
      </p>
      <div className="dialog-actions">
        <button type="button" autoFocus onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            if (session.removeLayer(id, true)) close();
            else setFailure(session.feedback.getSnapshot().message);
          }}
        >
          Remove layer
        </button>
      </div>
    </dialog>
  );
}

export function LayerPanel({ session }: Props) {
  const layers = useStore(session.layers);
  const active = useStore(session.activeLayer);
  const hidden = useStore(session.hiddenLayers);
  const index = layers.findIndex((item) => item.id === active);
  const layer = layers[index];
  const [removing, setRemoving] = useState<LayerId | null>(null);
  return (
    <section className="panel" aria-label="Layers">
      <h2>
        Layers <span className="panel-value">{layers.length}</span>
      </h2>
      <p className="layer-order">Top → bottom</p>
      <div className="layer-list" role="group" aria-label="Active layer">
        {[...layers].reverse().map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={item.id === active}
            onClick={() => session.selectLayer(item.id)}
          >
            <span className="layer-symbol" aria-hidden="true">
              {hidden.includes(item.id) ? "◌" : "▱"}
            </span>
            <span title={item.name}>{item.name}</span>
            <span className="layer-badges">
              {item.id === active && <small>Active</small>}
              {hidden.includes(item.id) && <small>Hidden</small>}
            </span>
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
          {hidden.includes(layer.id) && (
            <p className="hint">
              Show this layer before drawing or selecting its tiles.
            </p>
          )}
          <LayerName
            key={layer.id}
            session={session}
            id={layer.id}
            name={layer.name}
          />
          <div className="layer-actions">
            <LayerButton
              reason={
                index === layers.length - 1
                  ? "This layer is already at the top."
                  : undefined
              }
              onClick={() => session.moveLayer(layer.id, "up")}
            >
              Move layer up
            </LayerButton>
            <LayerButton
              reason={
                index === 0 ? "This layer is already at the bottom." : undefined
              }
              onClick={() => session.moveLayer(layer.id, "down")}
            >
              Move layer down
            </LayerButton>
          </div>
          <div className="layer-actions">
            <LayerButton onClick={() => session.perform("add-layer")}>
              Add layer
            </LayerButton>
            <LayerButton
              reason={
                layers.length === 1
                  ? "Keep at least one layer in the map."
                  : undefined
              }
              onClick={() => {
                if (session.layerHasContent(layer.id)) setRemoving(layer.id);
                else session.removeLayer(layer.id);
              }}
            >
              Remove layer
            </LayerButton>
          </div>
        </>
      )}
      <p className="hint">
        Top layers appear above lower layers. New layers start above the active
        layer. Hiding keeps tiles stored; drawing and selection target visible
        layers only.
      </p>
      {layers.length === 1 && (
        <p className="hint">Keep at least one layer in the map.</p>
      )}
      {removing && (
        <RemoveLayerDialog
          session={session}
          id={removing}
          close={() => setRemoving(null)}
        />
      )}
    </section>
  );
}
