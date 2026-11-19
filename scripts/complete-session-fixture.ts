import { writeFile } from "node:fs/promises";
import { encodeProjectSnapshot } from "../src/domain/project.ts";
import { createDrawingSession } from "../tests/fixtures/complete-session.ts";

// A normal editable project for repeating TW-048 in the packaged desktop app.
const destination = process.argv[2];
if (!destination)
  throw new Error(
    "Usage: node scripts/complete-session-fixture.ts <output.tilewright>",
  );
const { session } = await createDrawingSession();
try {
  await writeFile(
    destination,
    await encodeProjectSnapshot(session.captureProjectSnapshot()),
    { flag: "wx" },
  );
  console.log(`Wrote TW-048 walkthrough fixture: ${destination}`);
} finally {
  session.dispose();
}
