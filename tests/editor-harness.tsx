import { Profiler, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  App,
  ToolPanel,
  ColorPanel,
  LayerPanel,
  AnnotationPanel,
  ViewControls,
} from "../src/App";
import { EditorSession } from "../src/editor/session";
import { MapDocument } from "../src/domain/document";
import { layerId, rawColor } from "../src/domain/values";
import { bindDocument } from "../src/renderer/bindDocument";
import type { CanvasInvalidation } from "../src/editor/invalidation";
import "../src/styles.css";
import { populatedDocument } from "./fixtures/populated";

const fixture = new URLSearchParams(location.search).get("fixture");
const session = new EditorSession(
  fixture
    ? populatedDocument(fixture === "heartland" ? 1 : 0)
    : new MapDocument({
        layers: [
          { id: layerId("terrain"), name: "Terrain" },
          { id: layerId("buildings"), name: "Buildings" },
        ],
      }),
);
const renders: Record<string, number> = {};
const invalidations: CanvasInvalidation[] = [];
const unbind = bindDocument(session, (change) => invalidations.push(change));
const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <App session={session} />
  </StrictMode>,
);
const probes = createRoot(document.getElementById("probes")!);
probes.render(
  <>
    {Object.entries({
      tools: ToolPanel,
      colors: ColorPanel,
      layers: LayerPanel,
      annotations: AnnotationPanel,
      view: ViewControls,
    }).map(([id, Component]) => (
      <Profiler
        key={id}
        id={id}
        onRender={() => {
          renders[id] = (renders[id] ?? 0) + 1;
        }}
      >
        <Component session={session} />
      </Profiler>
    ))}
  </>,
);
Object.assign(window, {
  editorProbe: {
    session,
    renders,
    invalidations,
    edit: () =>
      session.execute("Small edit", [
        {
          kind: "tiles",
          writes: [
            {
              layerId: layerId("buildings"),
              x: 3,
              y: 4,
              length: 2,
              value: rawColor("#123456ff"),
            },
          ],
        },
      ]),
    reset: () => {
      for (const key of Object.keys(renders)) renders[key] = 0;
      invalidations.length = 0;
    },
    dispose: () => {
      root.unmount();
      probes.unmount();
      unbind();
      session.dispose();
    },
  },
});
