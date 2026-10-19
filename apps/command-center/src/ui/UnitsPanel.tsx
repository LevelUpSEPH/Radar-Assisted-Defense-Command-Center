import type { UnitView } from "../protocol";

const km = (m: number) => `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;

export function UnitsPanel({ units }: { units: UnitView[] }) {
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
                {u.status === "PENDING" && u.distanceM !== undefined && (
                  <span className="warn small">
                    Connected {km(u.distanceM)} from the key's position; waiting for approval.
                  </span>
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

function describe(u: UnitView): string {
  const where = `${u.position.lat.toFixed(4)}, ${u.position.lon.toFixed(4)}`;
  if (u.unitType === "radar") return `radar · ${km(u.capabilities.rangeM)} range · ${where}`;
  const c = u.capabilities;
  return `weapon · ${km(c.minRangeM)}–${km(c.maxRangeM)} · ${c.ammo} rounds · ${where}`;
}
