import type { WeaponState } from "@tdts/shared";
import { useState } from "react";
import type { UiToServer, UnitView } from "../protocol";
import { RangeForm } from "./RangeForm";

const km = (m: number) => `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;

type WeaponUnit = Extract<UnitView, { unitType: "weapon" }>;

/** A weapon's ranges in use: as last reported, else as registered. */
export function liveRanges(u: WeaponUnit): { minRangeM: number; maxRangeM: number } {
  const s = u.weaponStatus ?? u.capabilities;
  return { minRangeM: s.minRangeM, maxRangeM: s.maxRangeM };
}

export function UnitsPanel({
  units,
  disabled,
  send,
}: {
  units: UnitView[];
  disabled: boolean;
  send(msg: UiToServer): void;
}) {
  return (
    <section>
      <h2>Units</h2>
      {units.length === 0 ? (
        <p className="muted">No radars or weapons have connected yet.</p>
      ) : (
        <ul className="list">
          {units.map((u) => (
            <li key={u.unitId ?? u.key} className="row">
              <div className="row-main">
                <span>
                  {u.unitId ? <strong>{u.unitId}</strong> : <code className="key">{u.key}</code>} ·{" "}
                  {u.name}
                </span>
                <span className="muted small">{describe(u)}</span>
                {u.unitType === "weapon" && u.weaponStatus && (
                  <span className="small">
                    <span className={`pill ${WEAPON_PILL[u.weaponStatus.state]}`}>
                      {u.weaponStatus.state}
                    </span>{" "}
                    {u.weaponStatus.ammo} rounds left
                    {u.weaponStatus.engagementId && ` · ${u.weaponStatus.engagementId}`}
                  </span>
                )}
                {u.unitType === "weapon" && u.unitId && u.status === "ONLINE" && (
                  <RangeEditor unit={u} unitId={u.unitId} disabled={disabled} send={send} />
                )}
                {u.deviceId && (
                  <span className="muted small" title="Fingerprint of the unit's device key">
                    device <code className="fingerprint">{u.deviceId}</code>
                  </span>
                )}
                {u.status === "PENDING" && u.distanceM !== undefined && (
                  <>
                    <span className="warn small">
                      Connected {km(u.distanceM)} from where it's expected; waiting for approval.
                    </span>
                    <span className="decision">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => send({ type: "approveUnit", payload: { key: u.key } })}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={disabled}
                        onClick={() => send({ type: "rejectUnit", payload: { key: u.key } })}
                      >
                        Reject
                      </button>
                    </span>
                  </>
                )}
              </div>
              <span className={`pill ${PILL[u.status]}`}>{u.status}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const PILL: Record<UnitView["status"], string> = {
  ONLINE: "pill-ok",
  OFFLINE: "",
  PENDING: "pill-warn",
};

const WEAPON_PILL: Record<WeaponState, string> = {
  IDLE: "pill-ok",
  READY: "pill-ok",
  PREPARING: "pill-warn",
  FIRING: "pill-warn",
  RELOADING: "pill-warn",
  EMPTY: "pill-bad",
};

/** Change an online weapon's min/max range; the weapon applies it and reports it back. */
function RangeEditor({
  unit,
  unitId,
  disabled,
  send,
}: {
  unit: WeaponUnit;
  unitId: string;
  disabled: boolean;
  send(msg: UiToServer): void;
}) {
  const [editing, setEditing] = useState(false);
  const ranges = liveRanges(unit);
  if (!editing) {
    return (
      <span className="small">
        <button type="button" className="link" disabled={disabled} onClick={() => setEditing(true)}>
          Change ranges
        </button>
      </span>
    );
  }
  return (
    <RangeForm
      {...ranges}
      disabled={disabled}
      onSubmit={(r) => {
        send({ type: "setWeaponRanges", payload: { unitId, ...r } });
        setEditing(false);
      }}
      onCancel={() => setEditing(false)}
    />
  );
}

function describe(u: UnitView): string {
  const where = `${u.position.lat.toFixed(4)}, ${u.position.lon.toFixed(4)}`;
  if (u.unitType === "radar") return `radar · ${km(u.capabilities.rangeM)} range · ${where}`;
  const r = liveRanges(u);
  return `weapon · ${km(r.minRangeM)}–${km(r.maxRangeM)} · ${u.capabilities.ammo} rounds · ${where}`;
}
