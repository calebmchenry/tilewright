import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { MapCanvas } from "../src/MapCanvas";
import { mountRenderer } from "../src/renderer/mountRenderer";
import "../src/styles.css";
import { EditorSession } from "../src/editor/session";

const session = new EditorSession();

function Harness() {
  const [mounted, setMounted] = useState(false);
  return (
    <>
      <button onClick={() => setMounted((value) => !value)}>
        Toggle canvas
      </button>
      <button
        onClick={() => {
          // Cancellation within the same task guarantees init is still pending.
          const host = document.createElement("div");
          document.body.appendChild(host);
          const dispose = mountRenderer(
            host,
            () => {
              throw new Error("Canceled renderer reported ready");
            },
            (error) => {
              throw error;
            },
          );
          dispose();
          dispose();
          host.remove();
        }}
      >
        Cancel pending canvas
      </button>
      <div style={{ height: 500, display: "grid" }}>
        {mounted && <MapCanvas session={session} />}
      </div>
    </>
  );
}
createRoot(document.getElementById("harness")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
