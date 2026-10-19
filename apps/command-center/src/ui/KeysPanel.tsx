import type { UnitType } from "@tdts/shared";
import { useState, type FormEvent } from "react";
import type { KeyRecord, KeyRequest, UiToServer } from "../protocol";

type Mode = KeyRequest["mode"];

export function KeysPanel({
  keys,
  disabled,
  send,
}: {
  keys: KeyRecord[];
  disabled: boolean;
  send(msg: UiToServer): void;
}) {
  return (
    <section>
      <h2>Registration keys</h2>
      <KeyForm disabled={disabled} send={send} />
      {keys.length === 0 ? (
        <p className="muted">No keys issued yet.</p>
      ) : (
        <ul className="list">
          {keys.map((k) => (
            <KeyRow key={k.key} record={k} disabled={disabled} send={send} />
          ))}
        </ul>
      )}
    </section>
  );
}

function KeyForm({ disabled, send }: { disabled: boolean; send(msg: UiToServer): void }) {
  const [unitType, setUnitType] = useState<UnitType>("radar");
  const [mode, setMode] = useState<Mode>("auto");
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const payload: KeyRequest =
      mode === "auto"
        ? { mode, unitType }
        : { mode, unitType, name, expectedPosition: { lat: Number(lat), lon: Number(lon) } };
    send({ type: "generateKey", payload });
    setName("");
    setLat("");
    setLon("");
  };

  const manualIncomplete = mode === "manual" && (!name.trim() || lat === "" || lon === "");

  return (
    <form className="key-form" onSubmit={submit}>
      <div className="segmented" role="group" aria-label="Unit type">
        {(["radar", "weapon"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={unitType === t ? "on" : ""}
            aria-pressed={unitType === t}
            onClick={() => setUnitType(t)}
          >
            {t === "radar" ? "Radar" : "Weapon"}
          </button>
        ))}
      </div>
      <div className="segmented" role="group" aria-label="Registration mode">
        {(["auto", "manual"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={mode === m ? "on" : ""}
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
          >
            {m === "auto" ? "Automatic" : "Manual"}
          </button>
        ))}
      </div>
      <p className="muted small">
        {mode === "auto"
          ? "The unit registers with whatever name and position it reports."
          : "The unit must connect within 2 km of this position, or it waits for approval."}
      </p>

      {mode === "manual" && (
        <>
          <label className="field">
            <span>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Radar North"
            />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Latitude</span>
              <input
                type="number"
                step="any"
                min={-90}
                max={90}
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="47.45"
              />
            </label>
            <label className="field">
              <span>Longitude</span>
              <input
                type="number"
                step="any"
                min={-180}
                max={180}
                value={lon}
                onChange={(e) => setLon(e.target.value)}
                placeholder="8.55"
              />
            </label>
          </div>
        </>
      )}

      <button type="submit" className="full" disabled={disabled || manualIncomplete}>
        Generate key
      </button>
    </form>
  );
}

function KeyRow({
  record,
  disabled,
  send,
}: {
  record: KeyRecord;
  disabled: boolean;
  send(msg: UiToServer): void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(record.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Clipboard can be unavailable (e.g. insecure context); the key is still selectable.
    }
  };

  const details = [
    record.unitId && `used by ${record.unitId}`,
    record.unitType,
    record.mode,
    record.name,
    record.expectedPosition &&
      `${record.expectedPosition.lat.toFixed(4)}, ${record.expectedPosition.lon.toFixed(4)}`,
  ].filter(Boolean);

  return (
    <li className="row">
      <div className="row-main">
        <code className="key">{record.key}</code>
        <span className="muted small">{details.join(" · ")}</span>
      </div>
      <div className="row-actions">
        <span className="pill">{record.status}</span>
        {confirming ? (
          <span className="confirm">
            Delete?
            <button
              type="button"
              className="link danger-link"
              disabled={disabled}
              onClick={() => send({ type: "deleteKey", payload: { key: record.key } })}
            >
              Yes
            </button>
            <button type="button" className="link" onClick={() => setConfirming(false)}>
              No
            </button>
          </span>
        ) : (
          <span className="actions">
            <button type="button" className="link" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              className="link danger-link"
              disabled={disabled}
              onClick={() => setConfirming(true)}
            >
              Delete
            </button>
          </span>
        )}
      </div>
    </li>
  );
}
