import { newMapBounds } from "../domain/canvas.ts";
import { MapDocument } from "../domain/document.ts";
import { EditorSession } from "./session.ts";
import { Store } from "./store.ts";

/** Application lifetime owner. Replacement always gets fresh history and view state. */
export class EditorWorkspace {
  readonly state: Store<
    Readonly<{ session: EditorSession; generation: number }>
  >;
  #closed = false;

  constructor(session = new EditorSession()) {
    this.state = new Store(Object.freeze({ session, generation: 0 }));
  }

  createMap(width: number, height: number): void {
    if (this.#closed) throw new Error("This workspace is closed.");
    const bounds = newMapBounds(width, height);
    const previous = this.state.getSnapshot();
    const session = new EditorSession(new MapDocument({ bounds }));
    try {
      this.state.set(
        Object.freeze({ session, generation: previous.generation + 1 }),
      );
    } finally {
      previous.session.dispose();
    }
  }

  dispose(): void {
    this.#closed = true;
    this.state.getSnapshot().session.dispose();
  }
}
