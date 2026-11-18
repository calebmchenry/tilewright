import type { EditorSession } from "../editor/session.ts";
import {
  canvasInvalidation,
  hasInvalidation,
  type CanvasInvalidation,
} from "../editor/invalidation.ts";

/** Imperative content seam. Tile changes never pass through React. */
export function bindDocument(
  session: EditorSession,
  invalidate: (change: CanvasInvalidation) => void,
): () => void {
  return session.document.subscribe((change) => {
    const dirty = canvasInvalidation(change);
    if (hasInvalidation(dirty)) invalidate(dirty);
  });
}
