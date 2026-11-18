// This Pixi entry point installs CSP-safe shader/uniform implementations.
// It avoids requiring 'unsafe-eval' in the desktop content security policy.
import "pixi.js/unsafe-eval";
import { Container, Graphics, WebGLRenderer } from "pixi.js";
import type { EditorSession } from "../editor/session";
import type { CanvasInvalidation } from "../editor/invalidation";
import { TileScene } from "./tileScene";
import { MapDocument } from "../domain/document";
import { CANVAS_INSET, TILE_PIXELS } from "../editor/viewport";

export interface CanvasRenderer {
  resize(): void;
  invalidate(change: CanvasInvalidation): void;
  destroy(): void;
  snapshot(): ReturnType<TileScene["snapshot"]> & { renders: number };
}

/** Disposable rendering only: no document or editing state lives here. */
export async function createRenderer(
  host: HTMLElement,
  session?: EditorSession,
): Promise<CanvasRenderer> {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-label", "Map workspace preview");
  // Acquire WebGL explicitly so unsupported hardware fails before Pixi creates
  // event systems. Neither WebGPU nor Canvas2D is a fallback for this editor.
  const options = { alpha: false, antialias: false, stencil: true };
  const context = canvas.getContext("webgl2", options);
  if (!context || !(context instanceof WebGL2RenderingContext))
    throw new Error("macOS did not provide a WebGL 2 graphics context.");

  let renderer: WebGLRenderer | undefined;
  const stage = new Container();
  let destroyed = false;
  let tiles: TileScene | undefined;
  let renders = 0;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    tiles?.destroy();
    stage.destroy({ children: true, context: true });
    try {
      renderer?.destroy({ removeView: true });
    } finally {
      context.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    }
  };

  try {
    renderer = new WebGLRenderer();
    await renderer.init({
      canvas,
      context,
      background: "#151b25",
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      // Render only on view/document changes; no per-frame tile iteration.
      eventMode: "none",
      eventFeatures: {
        move: false,
        globalMove: false,
        click: false,
        wheel: false,
      },
    });
    canvas.dataset.renderer = "webgl";
    canvas.dataset.webglVersion = String(renderer.context.webGLVersion);

    // Background below ordered tile layers.
    const preview = new Graphics();
    stage.addChild(preview);
    tiles = new TileScene(session?.document ?? new MapDocument());
    stage.addChild(tiles.container);
    const resize = () => {
      if (destroyed || !renderer) return;
      const { width, height } = host.getBoundingClientRect();
      const resolution = window.devicePixelRatio || 1;
      if (
        renderer.screen.width !== Math.max(1, width) ||
        renderer.screen.height !== Math.max(1, height) ||
        renderer.resolution !== resolution
      )
        renderer.resize(Math.max(1, width), Math.max(1, height), resolution);
      const view = session?.viewport.getSnapshot() ?? { x: 0, y: 0, zoom: 1 };
      const bounds = session?.document.bounds ?? {
        minX: 0,
        minY: 0,
        maxX: 256,
        maxY: 256,
      };
      const scale = TILE_PIXELS * view.zoom;
      const left = CANVAS_INSET + (bounds.minX - view.x) * scale;
      const top = CANVAS_INSET + (bounds.minY - view.y) * scale;
      preview
        .clear()
        .rect(
          left,
          top,
          (bounds.maxX - bounds.minX) * scale,
          (bounds.maxY - bounds.minY) * scale,
        )
        .fill("#1d2732")
        .stroke({ color: "#586d80", width: 1 });
      tiles!.sync(view, width, height, session?.hiddenLayers.getSnapshot());
      renderer.render(stage);
      renders++;
    };
    // The caller decides whether an async initialization is still current.
    // Keep the canvas detached until that decision has been made.
    return {
      resize() {
        if (destroyed) return;
        if (canvas.parentNode !== host) host.appendChild(canvas);
        resize();
      },
      invalidate(change) {
        if (tiles?.invalidate(change)) resize();
      },
      snapshot: () => ({ ...tiles!.snapshot(), renders }),
      destroy,
    };
  } catch (error) {
    try {
      destroy();
    } catch (cleanupError) {
      console.error("Renderer cleanup failed", cleanupError);
    }
    throw error;
  }
}
