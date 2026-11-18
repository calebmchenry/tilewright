import type { EditorSession } from "./session";
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
  let gesture: { view: Viewport; anchor: Point } | null = null;
  const ready = () => session.canvasState.getSnapshot() === "ready";
  const local = (point: Point): Point => {
    const rect = host.getBoundingClientRect();
    return { x: point.x - rect.left, y: point.y - rect.top };
  };
  const updatePointer = () => {
    if (!lastPointer || !ready()) {
      session.pointer.set(null);
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
      return;
    }
    const tile = screenToTile(point.x, point.y, session.viewport.getSnapshot());
    const previous = session.pointer.getSnapshot();
    if (tile.x !== previous?.x || tile.y !== previous?.y)
      session.pointer.set(tile);
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
  const reset = () => {
    space = false;
    gesture = null;
    lastPointer = null;
    finishDrag();
    updatePointer();
  };
  const down = (event: PointerEvent) => {
    if (!ready() || drag || !event.isPrimary) return;
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
    updatePointer();
  };
  const move = (event: PointerEvent) => {
    lastPointer = { x: event.clientX, y: event.clientY };
    if (drag && drag.id === event.pointerId) {
      session.pan(event.clientX - drag.x, event.clientY - drag.y);
      drag = { ...drag, x: event.clientX, y: event.clientY };
    }
    updatePointer();
  };
  const up = (event: PointerEvent) => {
    if (drag?.id === event.pointerId) finishDrag();
    updatePointer();
  };
  const leave = () => {
    if (!drag) {
      lastPointer = null;
      updatePointer();
    }
  };
  const wheel = (event: WheelEvent) => {
    if (!ready()) return;
    event.preventDefault();
    if (gesture || drag) return;
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
      !ready()
    )
      return;
    if (event.code === "Space" || event.key === " ") {
      event.preventDefault();
      space = true;
      cursor();
    } else if (event.key === "Escape") {
      event.preventDefault();
      reset();
    }
  };
  const keyUp = (event: KeyboardEvent) => {
    if (event.code === "Space" || event.key === " ") {
      space = false;
      cursor();
    }
  };
  // WebKit delivers cumulative scale relative to gesturestart, not per-event scale.
  const gestureStart = (event: Event) => {
    if (!ready()) return;
    event.preventDefault();
    finishDrag();
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
    lastPointer = null;
    updatePointer();
  };
  const listeners: [string, EventListener][] = [
    ["pointerdown", down as EventListener],
    ["pointermove", move as EventListener],
    ["pointerup", up as EventListener],
    ["pointerleave", leave],
    ["pointercancel", cancel],
    ["lostpointercapture", up as EventListener],
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
    session.viewport.subscribe(updatePointer),
    session.canvasSize.subscribe(updatePointer),
    session.activeTool.subscribe(cursor),
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
