/** An explicit same-origin mount path, never a hostname or an inferred owner. */
export function webBase(value = process.env.TILEWRIGHT_WEB_BASE): string {
  if (
    !value ||
    !/^\/(?:[A-Za-z0-9._-]+\/)*$/.test(value) ||
    value.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error(
      "Set TILEWRIGHT_WEB_BASE to / for a root/custom domain or /repository-name/ for a project site (include both slashes).",
    );
  }
  return value;
}
