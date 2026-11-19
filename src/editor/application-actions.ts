import type { DocumentLifecycle } from "./document-lifecycle.ts";
import type { FocusOwner, KeyInput } from "./session.ts";
import { Store } from "./store.ts";

export const applicationActionIds = [
  "new",
  "open",
  "save",
  "save-as",
  "export-agent",
  "undo",
  "redo",
  "cut",
  "copy",
  "paste",
] as const;
export type ApplicationAction = (typeof applicationActionIds)[number];
export type EditAction = "undo" | "redo" | "cut" | "copy" | "paste";
export interface MenuActionState {
  readonly id: ApplicationAction;
  readonly label: string;
  readonly enabled: boolean;
}
export interface ActionContext {
  readonly owner: FocusOwner;
  readonly modal: boolean;
}
const fileLabels = {
  new: "New…",
  open: "Open…",
  save: "Save",
  "save-as": "Save As…",
  "export-agent": "Export for Agent…",
};
export function isEditAction(id: ApplicationAction): id is EditAction {
  return !(id in fileLabels);
}

/** Menu, keyboard and file buttons resolve the current session at invocation. */
export class ApplicationActions {
  readonly lifecycle: DocumentLifecycle;
  readonly newDialog = new Store(false);
  readonly menu = new Store<readonly MenuActionState[]>([]);
  #context: ActionContext = { owner: "outside", modal: false };
  #unsubscribe: (() => void)[] = [];
  #sessionSubscriptions: (() => void)[] = [];
  #closed = false;

  constructor(lifecycle: DocumentLifecycle) {
    this.lifecycle = lifecycle;
    const refresh = () => this.#refresh();
    this.#unsubscribe = [
      lifecycle.state.subscribe(refresh),
      lifecycle.files.state.subscribe(refresh),
      this.newDialog.subscribe(refresh),
      ...(lifecycle.agentExport
        ? [lifecycle.agentExport.state.subscribe(refresh)]
        : []),
      lifecycle.files.workspace.state.subscribe(() => this.#bindSession()),
    ];
    this.#bindSession();
  }
  #bindSession() {
    this.#sessionSubscriptions.forEach((stop) => stop());
    const s = this.lifecycle.files.workspace.state.getSnapshot().session;
    this.#sessionSubscriptions = [
      s.historyState,
      s.selection.state,
      s.selection.preview,
      s.selection.clipboard,
      s.canvasState,
      s.viewport,
      s.activeLayer,
      s.hiddenLayers,
      s.registry,
      s.drawing.preview,
      s.fill.progress,
    ].map((store) => store.subscribe(() => this.#refresh()));
    this.#refresh();
  }
  setContext(context: ActionContext) {
    this.#context = context;
    this.#refresh();
  }
  #refresh() {
    if (this.#closed) return;
    const next = applicationActionIds.map((id) => this.state(id));
    if (JSON.stringify(next) !== JSON.stringify(this.menu.getSnapshot()))
      this.menu.set(next);
  }
  #modal() {
    return (
      this.#context.modal ||
      this.newDialog.getSnapshot() ||
      !!this.lifecycle.state.getSnapshot().prompt
    );
  }
  #fileBlocked() {
    return (
      this.#closed ||
      this.#modal() ||
      this.lifecycle.state.getSnapshot().busy ||
      this.lifecycle.files.state.getSnapshot().busy ||
      !!this.lifecycle.agentExport?.state.getSnapshot().busy
    );
  }
  state(id: ApplicationAction): MenuActionState {
    const modal = this.#modal();
    if (!isEditAction(id))
      return {
        id,
        label: fileLabels[id],
        enabled:
          !this.#fileBlocked() &&
          (id === "new" ||
            (id === "export-agent"
              ? !!this.lifecycle.agentExport?.available
              : this.lifecycle.files.available)),
      };
    // Native text edits are handled by the first responder, never map history or
    // the tile clipboard. This remains true inside a modal's editable fields.
    if (this.#context.owner === "text")
      return {
        id,
        label: id[0].toUpperCase() + id.slice(1),
        enabled: !this.#closed,
      };
    const action = this.lifecycle.files.workspace.state
      .getSnapshot()
      .session.action(id);
    return {
      id,
      label: action.label,
      enabled: !this.#closed && !modal && !action.reason,
    };
  }
  perform(id: ApplicationAction): boolean {
    // File buttons stay disabled in browser development, but a shortcut should
    // still reach the file coordinator's actionable "desktop required" feedback.
    if (isEditAction(id) ? !this.state(id).enabled : this.#fileBlocked())
      return false;
    if (id === "new") this.newDialog.set(true);
    else if (id === "export-agent") void this.lifecycle.exportForAgent();
    else if (id === "open") void this.lifecycle.open();
    else if (id === "save" || id === "save-as")
      void this.lifecycle.save(id === "save-as");
    else {
      if (this.#context.owner === "text") return false;
      return this.lifecycle.files.workspace.state
        .getSnapshot()
        .session.perform(id);
    }
    return true;
  }
  createMap(width: number, height: number) {
    this.newDialog.set(false);
    void this.lifecycle.newMap(width, height);
  }
  routeKey(input: KeyInput): boolean {
    if (
      !input.defaultPrevented &&
      !input.isComposing &&
      !input.altKey &&
      !input.metaKey &&
      !input.ctrlKey &&
      input.key === "Escape" &&
      !this.#modal() &&
      this.#context.owner !== "text" &&
      this.lifecycle.agentExport?.state.getSnapshot().cancelable
    ) {
      this.lifecycle.agentExport.cancel();
      return true;
    }
    if (
      input.defaultPrevented ||
      input.isComposing ||
      input.altKey ||
      !(input.metaKey || input.ctrlKey)
    )
      return false;
    const key = input.key.toLowerCase();
    const id =
      key === "e" && input.shiftKey
        ? "export-agent"
        : key === "s"
          ? input.shiftKey
            ? "save-as"
            : "save"
          : key === "z"
            ? input.shiftKey
              ? "redo"
              : "undo"
            : !input.shiftKey
              ? (
                  {
                    n: "new",
                    o: "open",
                    x: "cut",
                    c: "copy",
                    v: "paste",
                  } as Partial<Record<string, ApplicationAction>>
                )[key]
              : undefined;
    if (!id || (isEditAction(id) && this.#context.owner === "text"))
      return false;
    this.perform(id);
    // Consume even disabled shortcuts: no browser Save, stale map action or
    // second handler behind a modal/pending operation.
    return true;
  }
  dispose() {
    this.#closed = true;
    this.#unsubscribe.forEach((stop) => stop());
    this.#sessionSubscriptions.forEach((stop) => stop());
  }
}
