import { useId, useState } from "react";
import { areaTiers } from "./domain/annotations";
import type { Bounds } from "./domain/coordinates";
import { useStore, useStoreField } from "./editor/useStore";
import type { EditorSession } from "./editor/session";
import { canEditTiles } from "./editor/viewport";

export function AnnotationPanel({ session }: { session: EditorSession }) {
  const annotations = useStore(session.annotations);
  const areas = session.areas;
  const selected = useStore(areas.selected);
  const draft = useStore(areas.draft);
  const errors = useStore(areas.errors);
  const drawing = useStore(areas.drawingBounds);
  const preview = useStore(areas.preview);
  useStoreField(session.viewport, canEditTiles);
  useStore(session.canvasState);
  const [query, setQuery] = useState("");
  const formId = useId();
  const entries = annotations.filter(([id, record]) =>
    String(record.name ?? id)
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const bounds = preview ?? areas.overlayBounds();
  const reason = areas.drawReason();
  const record = annotations.find(([id]) => id === selected)?.[1];
  const feedback = (field: keyof typeof errors) =>
    errors[field] && (
      <p className="form-feedback" id={`${formId}-${field}`}>
        {errors[field]}
      </p>
    );
  return (
    <section className="panel area-panel" aria-label="Annotations">
      <h2>
        Named areas <span className="panel-value">{annotations.length}</span>
      </h2>
      <label>
        Find an area
        <input
          type="search"
          value={query}
          placeholder="Search named areas"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {entries.length ? (
        <ul className="area-list">
          {entries.map(([id, record]) => (
            <li key={id}>
              <button
                type="button"
                aria-pressed={selected === id}
                onClick={() => areas.select(id)}
              >
                {typeof record.name === "string" ? record.name : id}
                <small>
                  {typeof record.tier === "string"
                    ? record.tier
                    : "Unknown tier"}{" "}
                  · {id}
                </small>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-state">
          {query ? "No matching areas." : "No named areas yet."}
        </p>
      )}
      <button type="button" onClick={() => areas.newArea()}>
        New area
      </button>
      {draft ? (
        <form
          className="area-form"
          onSubmit={(event) => {
            event.preventDefault();
            areas.apply();
          }}
        >
          <h3>{draft.id ? "Edit area" : "New area"}</h3>
          <label>
            Area name
            <input
              value={draft.name}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? `${formId}-name` : undefined}
              onChange={(event) => areas.update({ name: event.target.value })}
            />
          </label>
          {feedback("name")}
          <label>
            Description
            <textarea
              aria-label="Description"
              rows={4}
              value={draft.description}
              aria-invalid={!!errors.description}
              aria-describedby={
                errors.description ? `${formId}-description` : undefined
              }
              onChange={(event) =>
                areas.update({ description: event.target.value })
              }
            />
          </label>
          {feedback("description")}
          <label>
            Tier
            <select
              aria-label="Tier"
              value={draft.tier}
              aria-invalid={!!errors.tier}
              aria-describedby={errors.tier ? `${formId}-tier` : undefined}
              onChange={(event) => areas.update({ tier: event.target.value })}
            >
              {areaTiers.map((tier) => (
                <option key={tier} value={tier}>
                  {tier[0].toUpperCase() + tier.slice(1)}
                </option>
              ))}
            </select>
          </label>
          {feedback("tier")}
          <fieldset
            className="area-bounds"
            aria-describedby={`${formId}-bounds-help${errors.bounds ? ` ${formId}-bounds` : ""}`}
          >
            <legend>Bounds · tiles</legend>
            {(
              [
                ["minX", "Minimum X"],
                ["minY", "Minimum Y"],
                ["maxX", "Maximum X"],
                ["maxY", "Maximum Y"],
              ] as [keyof Bounds, string][]
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  inputMode="numeric"
                  value={draft.bounds[key]}
                  aria-invalid={!!errors.bounds}
                  onChange={(event) =>
                    areas.update({
                      bounds: { ...draft.bounds, [key]: event.target.value },
                    })
                  }
                />
              </label>
            ))}
          </fieldset>
          <p className="hint" id={`${formId}-bounds-help`}>
            Maximums are exclusive. Bounds must stay inside the map.
          </p>
          {feedback("bounds")}
          <output aria-label="Area dimensions">
            {bounds
              ? `${bounds.maxX - bounds.minX} × ${bounds.maxY - bounds.minY} tiles`
              : "Enter valid bounds."}
          </output>
          <button
            type="button"
            disabled={!!reason}
            title={reason ?? undefined}
            aria-describedby={reason ? `${formId}-draw-reason` : undefined}
            aria-pressed={drawing}
            onClick={() => areas.draw()}
          >
            {draft.id ? "Redraw bounds" : "Draw bounds"}
          </button>
          {reason && (
            <p className="hint" id={`${formId}-draw-reason`}>
              {reason}
            </p>
          )}
          {drawing && (
            <p className="hint">
              Drag on the map to set bounds. Release updates this draft; Apply
              saves it.
            </p>
          )}
          <p className="hint">
            Label placement: center. Description may be empty.
          </p>
          {feedback("label")}
          {feedback("form")}
          <div className="selection-actions">
            <button type="submit">Apply area</button>
            <button type="button" onClick={() => areas.cancelDraft()}>
              Cancel area edit
            </button>
          </div>
        </form>
      ) : (
        record && (
          <div className="area-details">
            <h3>{String(record.name)}</h3>
            <p className="area-description">
              {String(record.description ?? "") || "No description."}
            </p>
            <p>Tier: {String(record.tier)}</p>
            {bounds && (
              <p>
                X [{bounds.minX}, {bounds.maxX}) · Y [{bounds.minY},{" "}
                {bounds.maxY})
              </p>
            )}
            <button type="button" onClick={() => areas.select(selected!)}>
              Edit area
            </button>
          </div>
        )
      )}
      {selected && (
        <div className="selection-actions area-actions">
          <button type="button" onClick={() => areas.remove()}>
            Delete area
          </button>
          <button type="button" onClick={() => areas.deselect()}>
            Deselect area
          </button>
        </div>
      )}
      {!draft && feedback("form")}
      <p className="hint">
        Areas are independent of tiles. Moving, cutting or transforming tiles
        keeps their areas in place.
      </p>
    </section>
  );
}
