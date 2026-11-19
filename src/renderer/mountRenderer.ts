import { createRenderer } from "./createRenderer";
import type { CanvasRenderer } from "./createRenderer";
import type { EditorSession } from "../editor/session";
import { bindDocument } from "./bindDocument";

/** Returns cleanup immediately, including while the asynchronous GPU init runs. */
export function mountRenderer(
  host: HTMLElement,
  onReady: () => void,
  onError: (error: unknown) => void,
  session?: EditorSession,
): () => void {
  let disposed = false;
  let renderer: CanvasRenderer | undefined;
  let stopDocument: (() => void) | undefined;
  let stopVisibility: (() => void) | undefined;
  let stopViewport: (() => void) | undefined;
  let stopRectangle: (() => void) | undefined;
  let stopDrawing: (() => void) | undefined;
  let stopFootprint: (() => void) | undefined;
  let stopSelection: (() => void) | undefined;
  let stopSelectionPreview: (() => void) | undefined;
  let density: MediaQueryList | undefined;
  const measure = () => {
    const { width, height } = host.getBoundingClientRect();
    session?.setCanvasSize(width, height);
  };
  const resize = () => {
    try {
      measure();
      renderer?.resize();
    } catch (error) {
      dispose();
      onError(error);
    }
  };
  const observer = new ResizeObserver(resize);
  const watchDensity = () => {
    density?.removeEventListener("change", densityChanged);
    density = window.matchMedia(
      `(resolution: ${window.devicePixelRatio || 1}dppx)`,
    );
    density.addEventListener("change", densityChanged);
  };
  const densityChanged = () => {
    resize();
    if (!disposed) watchDensity();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    density?.removeEventListener("change", densityChanged);
    stopDocument?.();
    stopViewport?.();
    stopVisibility?.();
    stopRectangle?.();
    stopDrawing?.();
    stopFootprint?.();
    stopSelection?.();
    stopSelectionPreview?.();
    renderer?.destroy();
    renderer = undefined;
  };

  void createRenderer(host, session, (error) => {
    if (disposed) return;
    dispose();
    onError(error);
  })
    .then((created) => {
      if (disposed) {
        created.destroy();
        return;
      }
      renderer = created;
      measure();
      renderer.resize();
      observer.observe(host);
      watchDensity();
      if (session) {
        stopDocument = bindDocument(session, (change) => {
          try {
            renderer?.invalidate(change);
          } catch (error) {
            dispose();
            onError(error);
          }
        });
        stopVisibility = session.hiddenLayers.subscribe(resize);
        stopViewport = session.viewport.subscribe(resize);
        stopRectangle = session.rectangle.subscribe(resize);
        stopDrawing = session.drawing.preview.subscribe(resize);
        stopFootprint = session.drawing.footprint.subscribe(resize);
        stopSelection = session.selection.state.subscribe(resize);
        stopSelectionPreview = session.selection.preview.subscribe(resize);
      }
      onReady();
    })
    .catch((error: unknown) => {
      if (disposed) return;
      dispose();
      onError(error);
    });

  return dispose;
}
