import type { Page } from "@playwright/test";

export async function trackGpu(page: Page) {
  await page.addInitScript(() => {
    const contexts = new Map<
      WebGL2RenderingContext,
      { textures: Set<WebGLTexture>; buffers: Set<WebGLBuffer> }
    >();
    const owned = (gl: WebGL2RenderingContext) => {
      if (
        !(gl.canvas instanceof HTMLCanvasElement) ||
        gl.canvas.getAttribute("aria-label") !== "Map workspace preview"
      )
        return;
      if (!contexts.has(gl))
        contexts.set(gl, { textures: new Set(), buffers: new Set() });
      return contexts.get(gl)!;
    };
    const proto = WebGL2RenderingContext.prototype;
    const createTexture = proto.createTexture,
      deleteTexture = proto.deleteTexture;
    const createBuffer = proto.createBuffer,
      deleteBuffer = proto.deleteBuffer;
    proto.createTexture = function () {
      const result = createTexture.call(this);
      if (result) owned(this)?.textures.add(result);
      return result;
    };
    proto.deleteTexture = function (texture) {
      if (texture) owned(this)?.textures.delete(texture);
      deleteTexture.call(this, texture);
    };
    proto.createBuffer = function () {
      const result = createBuffer.call(this);
      if (result) owned(this)?.buffers.add(result);
      return result;
    };
    proto.deleteBuffer = function (buffer) {
      if (buffer) owned(this)?.buffers.delete(buffer);
      deleteBuffer.call(this, buffer);
    };
    window.gpuProbe = () => {
      const live = [...contexts].filter(([gl]) => !gl.isContextLost());
      return {
        contexts: live.length,
        textures: live.reduce((n, [, state]) => n + state.textures.size, 0),
        buffers: live.reduce((n, [, state]) => n + state.buffers.size, 0),
      };
    };
  });
}
