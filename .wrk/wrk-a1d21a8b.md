---
id: wrk-a1d21a8b
title: 'TW-001: Define map coordinates, canvas rules, and implementation boundaries'
status: done
created_at: 2026-11-18T16:49:41Z
priority: high
labels:
  - v1
  - foundation
  - decision
fields:
  sequence: 1
  source: INTENT.md
---
## Outcome

Establish the domain conventions needed by every subsequent implementation task.

## Source and scope

**Source:** INTENT.md — Project goal; INTENT.md — Map size and navigation; INTENT.md — Chosen technology; INTENT.md — Remaining implementation decisions.

**Execution order:** 01 of 54. Phase: foundation.

Start here. This is the only initially ready ticket in the sequential v1 backlog.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Record coordinate origin and axis directions, integer tile addressing, rectangle endpoint conventions, and empty-cell semantics.
- Choose conventional initial dimensions, permitted growth directions and increments, and how coordinates remain stable or transform when growing.
- Describe the boundary between the TypeScript document, command/history layer, PixiJS renderer, React UI, and Rust native integration.

## Acceptance criteria

- [x] Document concrete choices and alternatives in repository documentation, explicitly distinguishing implementation choices from confirmed requirements.
- [x] A tile is one game tile; visual chunks are exactly 64 by 64 tiles. Internal storage partitioning must not restrict editing across chunk boundaries.
- [x] Map bounds are fixed until explicit growth; painting never grows the map. Include edge and chunk-boundary coordinate examples.
- [x] Use Tilewright as the product name and tilewright as the directory. Preserve macOS/local/offline scope and all listed deferred features.

## Validation

- Walk through creating a map, crossing a chunk boundary, and growing in each supported direction; show where existing tiles and annotations end up.
- Check decisions against INTENT.md without introducing a game importer, cloud service, 3D preview, or browser-release requirement.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-002: Bootstrap the macOS Tauri, React, TypeScript, Vite, and PixiJS application](wrk-ffd4eb5c.md).

## Working through this backlog

All 54 tickets are actionable steps in one dependency chain, from implementation decisions through final release acceptance. There are no separate umbrella tickets that can accidentally appear ready. Every ticket carries the `v1` label, a phase label, a work-kind label, and an integer `sequence` field. The TW number is the human reading order; WRK IDs are the CLI identifiers.

From the tilewright directory:

```sh
wrk list --ready --label v1
wrk show <id>
wrk update <id> --status in-progress
# Complete the ticket and record actual evidence in its body with wrk update --body-file.
wrk update <id> --status done
wrk list --ready --label v1
```

`wrk list --all --label v1` shows the full backlog. `wrk validate` checks ticket references and graph validity. Dependencies are real WRK `depends_on` links, not just prose. Marking a prerequisite done unlocks the next ticket. A blocked or canceled prerequisite does not satisfy readiness; resolve/replan it explicitly instead of bypassing required work. The numbering is the intended serial delivery order, including integration gates; it does not claim every adjacent pair is an unavoidable technical dependency.

## Ordered ticket index


### Foundation

1. [TW-001: Define map coordinates, canvas rules, and implementation boundaries](wrk-a1d21a8b.md)
2. [TW-002: Bootstrap the macOS Tauri, React, TypeScript, Vite, and PixiJS application](wrk-ffd4eb5c.md)
3. [TW-003: Establish domain tests, representative fixtures, and performance budgets](wrk-d831f7e0.md)
4. [TW-004: Implement the sparse, layered TypeScript map document](wrk-4d23646a.md)
5. [TW-005: Add transactional commands, undo/redo, and saved-revision tracking](wrk-4a5fb526.md)
6. [TW-006: Build the editor shell and isolate document state from React UI state](wrk-fbc58697.md)

### Canvas

7. [TW-007: Render visible sparse tiles and ordered layers with PixiJS WebGL](wrk-c92d1a4b.md)
8. [TW-008: Implement pan, anchored zoom, fit-to-map, and coordinate conversion](wrk-58cdb442.md)
9. [TW-009: Add tile grids, emphasized 64-tile chunk boundaries, and scale readouts](wrk-bba25a4a.md)
10. [TW-010: Implement cached overview rendering and coherent cache invalidation](wrk-c22d70cf.md)
11. [TW-011: Record the early populated-map rendering baseline](wrk-02942808.md)
12. [TW-012: Add fixed-size map creation and explicit canvas growth](wrk-20574578.md)

### Painting

13. [TW-013: Implement layer creation, naming, ordering, visibility, and removal](wrk-d8320912.md)
14. [TW-014: Provide arbitrary color selection and distinguish empty cells from painted colors](wrk-2357ea93.md)
15. [TW-015: Decide registry identity, existing-color adoption, and collision behavior](wrk-e811af32.md)
16. [TW-016: Implement the named color registry and stable tile associations](wrk-230b4c1d.md)
17. [TW-017: Recolor registered entries across layers, history, and overview caches](wrk-8110dbc9.md)
18. [TW-018: Build the drawing gesture pipeline and tool previews](wrk-13e3ba6a.md)
19. [TW-019: Implement the adjustable-size pencil](wrk-8e1860da.md)
20. [TW-020: Implement erasing and color/registry eyedropper sampling](wrk-c712564c.md)
21. [TW-021: Implement straight lines and filled/outlined rectangles](wrk-d37ece28.md)
22. [TW-022: Implement bounded, responsive flood fill](wrk-3af2d9eb.md)

### Selection

23. [TW-023: Define selection, clipboard, transform, and out-of-bounds semantics](wrk-7cd74024.md)
24. [TW-024: Implement rectangular selections and explicit multi-layer inclusion](wrk-0b310dfe.md)
25. [TW-025: Implement overlap-safe selection dragging and whole-tile nudging](wrk-9bab6495.md)
26. [TW-026: Implement cut, copy, paste, and repeated selection placement](wrk-54aa1866.md)
27. [TW-027: Implement 90-degree rotation and horizontal/vertical flips](wrk-286859eb.md)
28. [TW-028: Verify selection invariants and large multi-layer operations](wrk-ebb7c04f.md)

### Annotations

29. [TW-029: Decide named-area geometry, label placement, and zoom thresholds](wrk-353fa9ca.md)
30. [TW-030: Implement named-area creation, descriptions, tiers, and explicit editing](wrk-0d9194dc.md)
31. [TW-031: Render zoom-dependent labels and annotation overlays](wrk-dfb3bfaf.md)
32. [TW-032: Add named-area browsing and scale inspection](wrk-efb169f5.md)

### Projects

33. [TW-033: Specify the versioned editable-project schema and persisted settings](wrk-eef53dd9.md)
34. [TW-034: Implement deterministic project encoding and snapshot extraction](wrk-0b0f3b9b.md)
35. [TW-035: Implement validated project decoding and safe load failures](wrk-4ccae787.md)
36. [TW-036: Implement native local file dialogs and atomic project reads/writes](wrk-16de7b43.md)
37. [TW-037: Implement document lifecycle and unsaved-change protection](wrk-2b769ca2.md)
38. [TW-038: Wire macOS File/Edit actions and Cmd+S to the document workflow](wrk-5e7adb66.md)

### Recovery

39. [TW-039: Define recovery cadence, identity, retention, and restore policy](wrk-dbdc0004.md)
40. [TW-040: Write atomic local recovery snapshots without touching project files](wrk-ff878665.md)
41. [TW-041: Implement startup recovery discovery, restore, and deliberate discard](wrk-cd70e4f4.md)
42. [TW-042: Verify crash recovery and persistence under interruption and failure](wrk-9b478f1c.md)

### Export

43. [TW-043: Specify a separate whole-map agent-export schema](wrk-eeabc6ef.md)
44. [TW-044: Implement whole-map agent export with complete semantic content](wrk-5e43190b.md)
45. [TW-045: Add native agent-export action, progress, and reliable output writes](wrk-ae1f5f2b.md)
46. [TW-046: Verify agent-export completeness with an independent consumer fixture](wrk-d0e8e734.md)

### Release

47. [TW-047: Finish editor shortcut, focus, feedback, and usability integration](wrk-d8dced1c.md)
48. [TW-048: Validate the complete drawing, rearrangement, and annotation session](wrk-74cf177c.md)
49. [TW-049: Meet final populated-map rendering and navigation budgets](wrk-6e0d23e5.md)
50. [TW-050: Meet final large-edit and undo memory/latency budgets](wrk-e61b329b.md)
51. [TW-051: Meet large-project save, load, recovery, and export budgets](wrk-7eef1f66.md)
52. [TW-052: Produce and verify a self-contained offline macOS release build](wrk-9d52b8c7.md)
53. [TW-053: Document editing workflows, file formats, recovery, and maintenance commands](wrk-c8f24c53.md)
54. [TW-054: Accept Tilewright v1 against every intent success criterion](wrk-8a0ffb09.md)

## Intent coverage

| Intent requirement | Primary implementation and validation tickets |
| --- | --- |
| 1. Fixed-size creation and explicit growth | [TW-001](wrk-a1d21a8b.md), [TW-004](wrk-4d23646a.md), [TW-009](wrk-bba25a4a.md), [TW-012](wrk-20574578.md), [TW-048](wrk-74cf177c.md) |
| 2. Layered terrain/buildings, arbitrary colors, optional meanings | [TW-013](wrk-d8320912.md), [TW-014](wrk-2357ea93.md), [TW-015](wrk-e811af32.md), [TW-016](wrk-230b4c1d.md), [TW-018](wrk-13e3ba6a.md), [TW-019](wrk-8e1860da.md), [TW-020](wrk-c712564c.md), [TW-021](wrk-d37ece28.md), [TW-022](wrk-3af2d9eb.md), [TW-048](wrk-74cf177c.md) |
| 3. 8 by 8 house moved three tiles, chosen layers, destination-restoring undo | [TW-005](wrk-4a5fb526.md), [TW-023](wrk-7cd74024.md), [TW-024](wrk-0b310dfe.md), [TW-025](wrk-9bab6495.md), [TW-028](wrk-ebb7c04f.md), [TW-048](wrk-74cf177c.md) |
| 4. Cut/copy/paste/nudge/rotate/flip and independent annotations | [TW-023](wrk-7cd74024.md), [TW-024](wrk-0b310dfe.md), [TW-025](wrk-9bab6495.md), [TW-026](wrk-54aa1866.md), [TW-027](wrk-286859eb.md), [TW-028](wrk-ebb7c04f.md), [TW-030](wrk-0d9194dc.md), [TW-048](wrk-74cf177c.md) |
| 5. Area names/descriptions and Detail/Locality/Region labels | [TW-029](wrk-353fa9ca.md), [TW-030](wrk-0d9194dc.md), [TW-031](wrk-dfb3bfaf.md), [TW-032](wrk-efb169f5.md), [TW-048](wrk-74cf177c.md) |
| 6. Registered grass recolor across the map with identity preserved | [TW-015](wrk-e811af32.md), [TW-016](wrk-230b4c1d.md), [TW-017](wrk-8110dbc9.md), [TW-048](wrk-74cf177c.md) |
| 7. Cmd+S, full project reopen, separate crash recovery | [TW-033](wrk-eef53dd9.md), [TW-034](wrk-0b0f3b9b.md), [TW-035](wrk-4ccae787.md), [TW-036](wrk-16de7b43.md), [TW-037](wrk-2b769ca2.md), [TW-038](wrk-5e7adb66.md), [TW-039](wrk-dbdc0004.md), [TW-040](wrk-ff878665.md), [TW-041](wrk-cd70e4f4.md), [TW-042](wrk-9b478f1c.md), [TW-051](wrk-7eef1f66.md) |
| 8. Whole-map agent export: coordinates, layer order, underlying content, color meanings, area descriptions | [TW-043](wrk-eeabc6ef.md), [TW-044](wrk-5e43190b.md), [TW-045](wrk-ae1f5f2b.md), [TW-046](wrk-d0e8e734.md), [TW-051](wrk-7eef1f66.md) |
| Visible cells, emphasized 64 by 64 chunk boundaries, scale inspection | [TW-007](wrk-c92d1a4b.md), [TW-008](wrk-58cdb442.md), [TW-009](wrk-bba25a4a.md), [TW-012](wrk-20574578.md), [TW-024](wrk-0b310dfe.md), [TW-032](wrk-efb169f5.md) |
| Target-scale sparse data, viewport rendering, cached overviews, populated overlapping layers | [TW-003](wrk-d831f7e0.md), [TW-004](wrk-4d23646a.md), [TW-007](wrk-c92d1a4b.md), [TW-008](wrk-58cdb442.md), [TW-010](wrk-c22d70cf.md), [TW-011](wrk-02942808.md), [TW-028](wrk-ebb7c04f.md), [TW-049](wrk-6e0d23e5.md), [TW-050](wrk-e61b329b.md), [TW-051](wrk-7eef1f66.md) |
| Chosen Tauri/TypeScript/React/Vite/PixiJS WebGL/Rust boundaries and offline macOS delivery | [TW-001](wrk-a1d21a8b.md), [TW-002](wrk-ffd4eb5c.md), [TW-006](wrk-fbc58697.md), [TW-007](wrk-c92d1a4b.md), [TW-036](wrk-16de7b43.md), [TW-047](wrk-d8dced1c.md), [TW-052](wrk-9d52b8c7.md) |
| Open decisions: coordinates/growth, controls/performance, layer management, registry collisions | [TW-001](wrk-a1d21a8b.md), [TW-003](wrk-d831f7e0.md), [TW-008](wrk-58cdb442.md), [TW-011](wrk-02942808.md), [TW-012](wrk-20574578.md), [TW-013](wrk-d8320912.md), [TW-015](wrk-e811af32.md), [TW-023](wrk-7cd74024.md) |
| Open decisions: area geometry/placement/thresholds, settings, schemas, unlabeled exports, recovery | [TW-029](wrk-353fa9ca.md), [TW-033](wrk-eef53dd9.md), [TW-039](wrk-dbdc0004.md), [TW-043](wrk-eeabc6ef.md) |
| Documentation, deferred-scope guardrails, and complete release acceptance | [TW-001](wrk-a1d21a8b.md), [TW-052](wrk-9d52b8c7.md), [TW-053](wrk-c8f24c53.md), [TW-054](wrk-8a0ffb09.md) |


## TW-001 execution record — 2026-11-18

Completed the foundation phase with Strategy A in this session. Preconditions:
no dependency blockers; read AGENTS.md, README.md, INTENT.md,
docs/ticket-runner.md, its referenced runner script, and the sprint-execute skill.
Used WRK state instead of a sprint ledger. No commits were requested or required.

### Implementation and decision locations

- [Foundation decisions](../docs/foundation-decisions.md): authority and confirmed
  requirements; world coordinates and rectangle endpoints; empty cells and canvas
  edges; visual chunks and storage; creation and explicit growth; component
  ownership; alternatives and rationale; validation walkthrough.
- [README.md](../README.md): entry point to the new decision document.
- INTENT.md is unchanged. No application code or other ticket was changed.

### Completed work and acceptance evidence

- [x] Coordinate origin, axes, integer tile addresses, half-open rectangles, and
  absence-based empty-cell semantics are documented. The initial top-left is the
  fixed world origin, x increases right, and y increases down. Implementation
  choices are explicitly separated from confirmed requirements, with eight
  decision/alternative/rationale comparisons.
- [x] A tile is one game tile; visual chunks remain exactly 64 by 64 tiles,
  anchored to the fixed origin. Mathematical floor defines negative chunk
  addresses. Internal storage partitions impose no edit boundary. Eight chunk
  coordinate examples cover positive and negative boundaries.
- [x] Default creation is 256 by 256, with custom positive whole-tile dimensions.
  Growth is explicit, in 64-tile increments on any of the four edges. Left/top
  growth introduces negative coordinates without relocating tiles or annotations.
  Painting clips candidates to the fixed map and never grows it. The walkthrough
  covers map edges, partial chunks, a house spanning four chunks, all growth
  directions, combined growth, and repeated growth.
- [x] Component ownership covers the TypeScript document and commands/history,
  PixiJS WebGL rendering, React UI, Rust/Tauri native integration, and Vite assets.
  The product/directory names, local offline macOS delivery, separate recovery and
  whole-map export, and every deferred feature from INTENT.md remain intact.

### Actual validation evidence

All checks below completed successfully on 2026-11-18:

1. Ran an inline Python 3 arithmetic/fixture verification against the documented
   examples, parsing the chunk and growth tables directly from the decision file.
   It verified:
   - Default and custom map edge inclusion/exclusion, clipping a four-cell stroke
     to two cells, an outside-only stroke, and custom right growth to 165 by 130.
   - All eight chunk/local-coordinate rows, including -1, -64, and -65, with
     round-trip coordinates and local values in 0 through 63.
   - A reversed 8 by 8 drag contains 64 cells, 16 in each of four visual chunks;
     a three-tile move yields [63, 71) by [60, 68). The target canvas area is
     40,960,000 positions per layer.
   - All four growth-table rows have the correct bounds, dimensions, newly valid
     and still-outside samples. Original tile and annotation fixture coordinates
     remain unchanged; new samples have no tile content on either fixture layer.
     Combined growth yields [-64, 320) on both axes (384 by 384), with tile/anchor
     offsets (127, 127)/(128, 128). Another left increment yields minX = -128.
   Output: `PASS creation/edges`, `PASS chunk table`, `PASS rectangles/scale`,
   and `PASS growth table` (each with the above case details). These are decision
   arithmetic checks, not runtime tests of a future application.
2. The same Python run resolved all **5 local links** in README.md and the new
   document and checked balanced code fences, final newlines, and no trailing
   whitespace. Output: `PASS documentation: 5 local links resolve; balanced
   fences and no trailing whitespace`.
3. Ran a separate inline Python comparison against INTENT.md: all **6 deferred
   scope bullets** match (with the explicit game-importer clarification), all
   **6 chosen technologies** have ownership entries, and product/directory naming
   and the implementation-choice disclaimer are present. Output:
   `PASS intent comparison: all 6 deferred-scope items retained; all 6 chosen
   technologies have explicit ownership; naming and choice authority retained`.
   Also manually reviewed the decisions against Project goal, Map size and
   navigation, Local operation, Chosen technology, and Remaining implementation
   decisions: no game importer, cloud service, 3D preview, or browser delivery was
   introduced as a requirement. Later schema, registry, annotation, recovery, and
   performance decisions remain with their existing tickets.
4. `wrk validate` exited 0: `Valid project: 56 tickets`.
5. `git diff --check` exited 0 with no output. The initial repository files were
   untracked, so the explicit file-content whitespace check above also covered
   the new/modified documentation. SHA-256 baseline comparison confirmed that
   INTENT.md, other existing files, and all ticket bodies remained unchanged by
   documentation work (before this ticket's evidence update).

Build, application test suite, and configured lint/format commands are not
available yet: this repository has documentation and the runner only, with no
application/package manifests. Bootstrap and test tooling belong to TW-002 and
TW-003. No runtime or performance validation is claimed for this decision ticket.

No blockers or scope deviations. The original ticket body is preserved with its
four acceptance checkboxes marked complete; this execution record is appended.
