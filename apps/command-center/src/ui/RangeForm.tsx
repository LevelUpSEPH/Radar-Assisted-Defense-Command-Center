import { useState, type FormEvent } from "react";

/** Min/max range inputs in km; sends meters. */
export function RangeForm({
  minRangeM,
  maxRangeM,
  disabled,
  onSubmit,
  onCancel,
}: {
  minRangeM: number;
  maxRangeM: number;
  disabled: boolean;
  onSubmit(ranges: { minRangeM: number; maxRangeM: number }): void;
  onCancel(): void;
}) {
  const [min, setMin] = useState(String(minRangeM / 1000));
  const [max, setMax] = useState(String(maxRangeM / 1000));
  const minKm = Number(min);
  const maxKm = Number(max);
  const problem =
    min.trim() === "" || max.trim() === "" || !Number.isFinite(minKm) || !Number.isFinite(maxKm)
      ? "Enter both ranges in km."
      : minKm < 0
        ? "Min range can't be negative."
        : minKm >= maxKm
          ? "Min range must be below max range."
          : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem) return;
    onSubmit({ minRangeM: Math.round(minKm * 1000), maxRangeM: Math.round(maxKm * 1000) });
  };

  return (
    <form className="range-form" onSubmit={submit}>
      <div className="field-row">
        <label className="field">
          <span>Min (km)</span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Max (km)</span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
        </label>
      </div>
      {problem && <span className="small warn">{problem}</span>}
      <div className="key-entry-actions">
        <button type="submit" disabled={disabled || problem !== null}>
          Apply
        </button>
        <button type="button" className="link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
