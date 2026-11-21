import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { webBase } from "./web-base.ts";

// Development/validation tooling only. Pages serves these files itself.
// Strict mounting catches root-absolute asset leaks that Vite preview can mask.
const base = webBase();
const root = resolve("dist-web");
const html = await readFile(resolve(root, "index.html"), "utf8");
if (!html.includes(`src="${base}assets/`))
  throw new Error(
    "Preview base differs from the build; rebuild with TILEWRIGHT_WEB_BASE.",
  );
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1:4173");
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end();
      return;
    }
    if (base !== "/" && url.pathname === base.slice(0, -1)) {
      response.writeHead(301, { Location: base + url.search }).end();
      return;
    }
    if (!url.pathname.startsWith(base)) throw new Error("Outside mount");
    const path =
      decodeURIComponent(url.pathname.slice(base.length)) || "index.html";
    const file = resolve(root, path);
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile())
      throw new Error("Not an artifact file");
    const bytes = await readFile(file);
    response.writeHead(200, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
      "Content-Length": bytes.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : bytes);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(4173, "127.0.0.1", () => {
  console.log(`Production artifact: http://127.0.0.1:4173${base}`);
});
