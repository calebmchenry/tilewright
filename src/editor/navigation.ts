import type { EditorSession } from "./session";
import { containsTile, type Bounds } from "../domain/coordinates";
import { rectangleBetween } from "./measurement";
import { focusOwner } from "./focus";
import {
  canEditTiles,
  OVERVIEW_MESSAGE,
  screenToTile,
  type Point,
  type Viewport,
} from "./viewport";

type GestureInput = Event & { scale: number; clientX: number; clientY: number };

/** One canvas owns all navigation listeners; disposal also releases pointer capture. */
export function bindNavigation(
  host: HTMLElement,
  session: EditorSession,
): () => void {
  let space = false;
  let lastPointer: Point | null = null;
  let drag: { id: number; x: number; y: number } | null = null;
  let drawing: number | null = null;
  let measure: { id: number; start: Point; previous: Bounds | null } | null =
    null;
  let gesture: { view: Viewport; anchor: Point } | null = null;
  const ready = () => session.canvasState.getSnapshot() === "ready";
  const canvasTarget = (target: EventTarget | null) =>
    target === host ||
    (target instanceof HTMLCanvasElement && target.parentElement === host);
  const local = (point: Point): Point => {
    const rect = host.getBoundingClientRect();
    return { x: point.x - rect.left, y: point.y - rect.top };
  };
  const updatePointer = () => {
    if (!lastPointer || !ready()) {
      session.pointer.set(null);
      session.drawing.hover(null);
      return;
    }
    const point = local(lastPointer),
      rect = host.getBoundingClientRect();
    if (
      point.x < 0 ||
      point.y < 0 ||
      point.x >= rect.width ||
      point.y >= rect.height
    ) {
      session.pointer.set(null);
      session.drawing.hover(null);
      return;
    }
    const tile = screenToTile(point.x, point.y, session.viewport.getSnapshot());
    const previous = session.pointer.getSnapshot();
    if (tile.x !== previous?.x || tile.y !== previous?.y)
      session.pointer.set(tile);
    session.drawing.hover(drag || measure || space || gesture ? null : point);
  };
  const cursor = () => {
    host.dataset.navigation = drag
      ? "dragging"
      : space || session.activeTool.getSnapshot() === "pan"
        ? "pan"
        : "inspect";
  };
  const finishDrag = () => {
    const id = drag?.id;
    drag = null;
    if (id !== undefined && host.hasPointerCapture(id))
      host.releasePointerCapture(id);
    cursor();
  };
  const finishMeasure = (cancel: boolean) => {
    const current = measure;
    measure = null;
    if (!current) return;
    if (cancel) {
      const previous = current.previous,
        bounds = session.document.bounds;
      session.setRectangle(
        previous &&
          containsTile(bounds, previous.minX, previous.minY) &&
          containsTile(bounds, previous.maxX - 1, previous.maxY - 1)
          ? previous
          : null,
      );
    }
    if (host.hasPointerCapture(current.id))
      host.releasePointerCapture(current.id);
  };
  const finishDrawing = (point?: Point) => {
    const id = drawing;
    drawing = null;
    if (id === null) return;
    try {
      if (point) session.drawing.commit(id, local(point));
      else session.drawing.cancel(id);
    } finally {
      if (host.hasPointerCapture(id)) host.releasePointerCapture(id);
    }
  };
  const reset = () => {
    space = false;
    gesture = null;
    lastPointer = null;
    finishDrag();
    finishMeasure(true);
    finishDrawing();
    updatePointer();
  };
  const down = (event: PointerEvent) => {
    if (
      !ready() ||
      drag ||
      measure ||
      drawing !== null ||
      gesture ||
      !event.isPrimary ||
      !canvasTarget(event.target)
    )
      return;
    host.focus({ preventScroll: true });
    lastPointer = { x: event.clientX, y: event.clientY };
    if (
      event.button === 1 ||
      (event.button === 0 &&
        (space || session.activeTool.getSnapshot() === "pan"))
    ) {
      event.preventDefault();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      host.setPointerCapture(event.pointerId);
      cursor();
    } else if (
      event.button === 0 &&
      !canEditTiles(session.viewport.getSnapshot())
    )
      session.report(OVERVIEW_MESSAGE);
    else if (
      event.button === 0 &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      if (session.drawing.tool(session.activeTool.getSnapshot())) {
        event.preventDefault();
        if (session.drawing.begin(event.pointerId, local(lastPointer))) {
          drawing = event.pointerId;
          try {
            host.setPointerCapture(event.pointerId);
          } catch (error) {
            finishDrawing();
            session.reportError(
              error,
              "Drawing canceled: pointer capture failed",
            );
          }
        }
      } else if (session.activeTool.getSnapshot() === "inspect") {
        const start = session.editableTileAt(local(lastPointer));
        if (start) {
          event.preventDefault();
          measure = {
            id: event.pointerId,
            start,
            previous: session.rectangle.getSnapshot(),
          };
          session.setRectangle(rectangleBetween(start, start));
          host.setPointerCapture(event.pointerId);
        }
      }
    }
    updatePointer();
  };
  const move = (event: PointerEvent) => {
    if (!event.isPrimary) return;
    lastPointer = { x: event.clientX, y: event.clientY };
    if (drag && drag.id === event.pointerId) {
      session.pan(event.clientX - drag.x, event.clientY - drag.y);
      drag = { ...drag, x: event.clientX, y: event.clientY };
    }
    if (measure?.id === event.pointerId) {
      const end = session.editableTileAt(local(lastPointer));
      if (end) session.setRectangle(rectangleBetween(measure.start, end));
    }
    if (drawing === event.pointerId) {
      if (!(event.buttons & 1)) finishDrawing();
      else {
        const samples = event.getCoalescedEvents?.() ?? [];
        for (const sample of [...samples, event]) {
          if (drawing === null) break;
          session.drawing.sample(
            drawing,
            local({ x: sample.clientX, y: sample.clientY }),
          );
        }
      }
    }
    updatePointer();
  };
  const up = (event: PointerEvent) => {
    if (drawing === event.pointerId && event.button === 0)
      finishDrawing({ x: event.clientX, y: event.clientY });
    if (drag?.id === event.pointerId) finishDrag();
    if (measure?.id === event.pointerId) finishMeasure(false);
    updatePointer();
  };
  const leave = () => {
    if (!drag && !measure && drawing === null) {
      lastPointer = null;
      updatePointer();
    }
  };
  const wheel = (event: WheelEvent) => {
    if (!ready() || !canvasTarget(event.target)) return;
    event.preventDefault();
    if (gesture || drag || measure || drawing !== null) return;
    lastPointer = { x: event.clientX, y: event.clientY };
    const units =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? session.canvasSize.getSnapshot().height
          : 1;
    const dx = event.deltaX * units,
      dy = event.deltaY * units;
    if (event.ctrlKey || event.metaKey)
      session.setZoom(
        session.viewport.getSnapshot().zoom *
          Math.exp(-Math.max(-1000, Math.min(1000, dy)) * 0.002),
        local(lastPointer),
      );
    else
      session.pan(
        event.shiftKey && dx === 0 ? -dy : -dx,
        event.shiftKey && dx === 0 ? 0 : -dy,
      );
    updatePointer();
  };
  const keyDown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      focusOwner(event.target) !== "canvas" ||
      !ready()
    )
      return;
    if (event.code === "Space" || event.key === " ") {
      event.preventDefault();
      space = true;
      finishDrawing();
      cursor();
      updatePointer();
    } else if (event.key === "Escape") {
      event.preventDefault();
      reset();
      session.setRectangle(null);
    }
  };
  const keyUp = (event: KeyboardEvent) => {
    if (event.code === "Space" || event.key === " ") {
      space = false;
      cursor();
      updatePointer();
    }
  };
  // WebKit delivers cumulative scale relative to gesturestart, not per-event scale.
  const gestureStart = (event: Event) => {
    if (!ready() || !canvasTarget(event.target)) return;
    event.preventDefault();
    finishDrag();
    finishMeasure(true);
    finishDrawing();
    const input = event as GestureInput;
    const point = { x: input.clientX, y: input.clientY };
    if (![point.x, point.y].every(Number.isFinite)) return;
    lastPointer = point;
    gesture = { view: session.viewport.getSnapshot(), anchor: local(point) };
  };
  const gestureChange = (event: Event) => {
    if (!gesture) return;
    event.preventDefault();
    const scale = (event as GestureInput).scale;
    if (Number.isFinite(scale) && scale > 0)
      session.setZoom(gesture.view.zoom * scale, gesture.anchor, gesture.view);
    updatePointer();
  };
  const gestureEnd = (event: Event) => {
    if (gesture) event.preventDefault();
    gesture = null;
  };
  const cancel = () => {
    finishDrag();
    finishMeasure(true);
    finishDrawing();
    lastPointer = null;
    updatePointer();
  };
  const listeners: [string, EventListener][] = [
    ["pointerdown", down as EventListener],
    ["pointermove", move as EventListener],
    ["pointerup", up as EventListener],
    ["pointerleave", leave],
    [
      "pointercancel",
      (event) => {
        // A secondary pointer cannot cancel the captured drawing pointer.
        if (drawing === null || (event as PointerEvent).pointerId === drawing)
          cancel();
      },
    ],
    [
      "lostpointercapture",
      (event) => {
        // Releasing a completed drag also emits this event. Keep its cursor readout.
        if (drag || measure || drawing === (event as PointerEvent).pointerId)
          cancel();
        else updatePointer();
      },
    ],
    ["wheel", wheel as EventListener],
    ["keydown", keyDown as EventListener],
    ["blur", reset],
    ["gesturestart", gestureStart],
    ["gesturechange", gestureChange],
    ["gestureend", gestureEnd],
  ];
  for (const [type, listener] of listeners)
    host.addEventListener(type, listener, { passive: false });
  window.addEventListener("keyup", keyUp);
  window.addEventListener("blur", reset);
  const stops = [
    session.drawing.preview.subscribe(() => {
      if (drawing !== null && session.drawing.pointerId === null)
        finishDrawing();
    }),
    session.viewport.subscribe(() => {
      finishMeasure(true);
      updatePointer();
    }),
    session.canvasSize.subscribe(updatePointer),
    session.pencilSize.subscribe(updatePointer),
    session.bounds.subscribe(() => finishMeasure(true)),
    session.activeTool.subscribe(() => {
      finishMeasure(true);
      cursor();
      updatePointer();
    }),
    session.canvasState.subscribe(() => {
      if (!ready()) reset();
    }),
  ];
  cursor();
  return () => {
    for (const [type, listener] of listeners)
      host.removeEventListener(type, listener);
    window.removeEventListener("keyup", keyUp);
    window.removeEventListener("blur", reset);
    for (const stop of stops) stop();
    reset();
    delete host.dataset.navigation;
  };
}
