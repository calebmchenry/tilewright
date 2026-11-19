import { shortcutHints } from "./editor/shortcuts";

export function ShortcutHint({
  action,
}: {
  action: keyof typeof shortcutHints;
}) {
  const hint = shortcutHints[action];
  return hint ? (
    <kbd className="shortcut-hint" aria-hidden="true">
      {hint}
    </kbd>
  ) : null;
}
