/** Shared local JSON download transport for editable projects and agent maps. */
export function downloadBrowserJson(filename: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes.slice().buffer], { type: "application/json" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  let handedOff = false;
  try {
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    handedOff = true;
  } finally {
    link.remove();
    // Preserve the existing project-download lifetime across asynchronous browser
    // handoff. Cleanup is bounded and independent of editor/controller disposal.
    if (handedOff) setTimeout(() => URL.revokeObjectURL(url), 1_000);
    else URL.revokeObjectURL(url);
  }
}
