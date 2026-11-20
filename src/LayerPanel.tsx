import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { LayerId } from "./domain/values";
import type { EditorSession } from "./editor/session";
import { useStore } from "./editor/useStore";

type Props = { session: EditorSession };

function LayerIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function LayerName({
  session,
  id,
  name,
  active,
  hidden,
}: Props & {
  id: LayerId;
  name: string;
  active: boolean;
  hidden: boolean;
}) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== name && session.renameLayer(id, next)) setDraft(next);
    else setDraft(name);
  };
  return (
    <input
      className="layer-name"
      aria-label={active ? "Layer name" : `Layer name: ${name}`}
      aria-description={`${active ? "Active layer. " : ""}${hidden ? "Hidden layer. " : ""}Edit to rename; Enter saves, Escape cancels.`}
      title={`${name}${hidden ? " (hidden)" : ""} — click to select and rename`}
      value={draft}
      spellCheck={false}
      onFocus={() => session.selectLayer(id)}
      onClick={() => session.selectLayer(id)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Enter") commit();
          else setDraft(name);
        }
      }}
    />
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
    const panel = element.closest("section");
    element.showModal();
    return () => {
      element.close();
      // React can detach a dialog before effect cleanup, so native close alone
      // cannot always return focus. Removal can also disable its former opener.
      queueMicrotask(() => {
        const target =
          opener instanceof HTMLElement &&
          opener.isConnected &&
          !opener.matches(":disabled")
            ? opener
            : panel?.querySelector<HTMLElement>(
                '[data-active="true"] .layer-name',
              );
        target?.focus({ preventScroll: true });
      });
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

type LayerDrop = { id: LayerId; before: LayerId | null };

export function LayerPanel({ session }: Props) {
  const layers = useStore(session.layers);
  const active = useStore(session.activeLayer);
  const hidden = useStore(session.hiddenLayers);
  const [removing, setRemoving] = useState<LayerId | null>(null);
  const [drop, setDrop] = useState<LayerDrop | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: LayerId;
    pointer: number;
    x: number;
    y: number;
    moving: boolean;
  } | null>(null);
  const reorderHelp = useId();
  const removeHelp = useId();
  const clearDrag = () => {
    drag.current = null;
    setDrop(null);
  };
  const dropAt = (event: PointerEvent<HTMLButtonElement>): LayerDrop | null => {
    const gesture = drag.current;
    const element = list.current;
    if (!gesture || !element) return null;
    const bounds = element.getBoundingClientRect();
    const sidebar = element.closest(".right-sidebar");
    const visible = sidebar?.getBoundingClientRect() ?? bounds;
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < Math.max(bounds.top, visible.top) ||
      event.clientY > Math.min(bounds.bottom, visible.bottom)
    )
      return null;
    const rows = [...element.querySelectorAll<HTMLElement>("[data-layer-id]")];
    const before = rows.find(
      (row) =>
        row.dataset.layerId !== gesture.id &&
        event.clientY <
          row.getBoundingClientRect().top +
            row.getBoundingClientRect().height / 2,
    );
    return {
      id: gesture.id,
      before: (before?.dataset.layerId as LayerId | undefined) ?? null,
    };
  };
  return (
    <section className="panel layers-panel" aria-label="Layers">
      <div className="layer-heading">
        <h2>
          Layers <span className="panel-value">{layers.length}</span>
        </h2>
        <button
          type="button"
          className="layer-icon-button"
          aria-label="Add layer"
          title="Add layer"
          onClick={() => session.perform("add-layer")}
        >
          <LayerIcon>
            <path d="M12 5v14M5 12h14" />
          </LayerIcon>
        </button>
      </div>
      <span className="sr-only" id={reorderHelp}>
        Drag to reorder. Use the Up and Down arrow keys to move a layer, or Home
        and End to move it to the top or bottom.
      </span>
      <span className="sr-only" id={removeHelp}>
        Keep at least one layer in the map.
      </span>
      <div
        ref={list}
        className="layer-list"
        role="group"
        aria-label="Active layer"
        data-drop-end={drop?.before === null || undefined}
      >
        {[...layers].reverse().map((item) => {
          const isHidden = hidden.includes(item.id);
          return (
            <div
              key={item.id}
              className="layer-row"
              data-layer-id={item.id}
              data-active={item.id === active}
              data-hidden={isHidden}
              data-dragging={drop?.id === item.id || undefined}
              data-drop-before={drop?.before === item.id || undefined}
            >
              <button
                type="button"
                className="layer-icon-button layer-drag-handle"
                aria-label={`Reorder ${item.name}`}
                aria-describedby={reorderHelp}
                title="Drag to reorder · ↑ / ↓ to move"
                disabled={layers.length === 1}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.currentTarget.focus({ preventScroll: true });
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = {
                    id: item.id,
                    pointer: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    moving: false,
                  };
                }}
                onPointerMove={(event) => {
                  const gesture = drag.current;
                  if (!gesture || gesture.pointer !== event.pointerId) return;
                  if (
                    !gesture.moving &&
                    Math.hypot(
                      event.clientX - gesture.x,
                      event.clientY - gesture.y,
                    ) < 4
                  )
                    return;
                  gesture.moving = true;
                  const sidebar = list.current?.closest(".right-sidebar");
                  if (sidebar) {
                    const bounds = sidebar.getBoundingClientRect();
                    if (event.clientY < bounds.top + 28)
                      sidebar.scrollTop -= 16;
                    else if (event.clientY > bounds.bottom - 28)
                      sidebar.scrollTop += 16;
                  }
                  setDrop(dropAt(event));
                }}
                onPointerUp={(event) => {
                  const gesture = drag.current;
                  if (!gesture || gesture.pointer !== event.pointerId) return;
                  const target = gesture.moving ? dropAt(event) : null;
                  clearDrag();
                  event.currentTarget.releasePointerCapture(event.pointerId);
                  if (!target) return;
                  const remaining = session.document.layers.filter(
                    (layer) => layer.id !== target.id,
                  );
                  const index =
                    target.before === null
                      ? 0
                      : remaining.findIndex(
                          (layer) => layer.id === target.before,
                        ) + 1;
                  session.moveLayerTo(target.id, index);
                }}
                onPointerCancel={clearDrag}
                onLostPointerCapture={clearDrag}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    clearDrag();
                  } else if (
                    ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    clearDrag();
                    if (event.key === "Home" || event.key === "End")
                      session.moveLayerTo(
                        item.id,
                        event.key === "Home" ? layers.length - 1 : 0,
                      );
                    else
                      session.moveLayer(
                        item.id,
                        event.key === "ArrowUp" ? "up" : "down",
                      );
                  }
                }}
              >
                <LayerIcon>
                  <path
                    d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"
                    strokeWidth="3"
                  />
                </LayerIcon>
              </button>
              <LayerName
                session={session}
                id={item.id}
                name={item.name}
                active={item.id === active}
                hidden={isHidden}
              />
              <button
                type="button"
                className="layer-icon-button layer-visibility-button"
                aria-label={`${isHidden ? "Show" : "Hide"} ${item.name}`}
                aria-pressed={!isHidden}
                title={`${isHidden ? "Show" : "Hide"} layer`}
                onClick={() => session.setLayerVisible(item.id, isHidden)}
              >
                <LayerIcon>
                  {isHidden ? (
                    <>
                      <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.5 5.3A11 11 0 0 1 12 5c7 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.2 6.2C3.4 8.2 2 12 2 12s3 7 10 7a10 10 0 0 0 5-1.3" />
                    </>
                  ) : (
                    <>
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  )}
                </LayerIcon>
              </button>
              <button
                type="button"
                className="layer-icon-button layer-remove-button"
                aria-label={`Remove ${item.name}`}
                title={
                  layers.length === 1
                    ? "Keep at least one layer in the map."
                    : "Remove layer"
                }
                disabled={layers.length === 1}
                aria-describedby={layers.length === 1 ? removeHelp : undefined}
                onClick={(event) => {
                  event.currentTarget.focus({ preventScroll: true });
                  if (session.layerHasContent(item.id)) setRemoving(item.id);
                  else if (session.removeLayer(item.id))
                    queueMicrotask(() =>
                      list.current
                        ?.querySelector<HTMLInputElement>(
                          '[data-active="true"] .layer-name',
                        )
                        ?.focus({ preventScroll: true }),
                    );
                }}
              >
                <LayerIcon>
                  <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
                </LayerIcon>
              </button>
            </div>
          );
        })}
      </div>
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
