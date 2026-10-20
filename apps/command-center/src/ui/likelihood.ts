// How drone likelihood is shown: three bands, each with a color and a word.

export interface LikelihoodBand {
  label: string;
  color: string;
}

const LIKELY: LikelihoodBand = { label: "Likely drone", color: "#ef4444" };
const UNSURE: LikelihoodBand = { label: "Unsure", color: "#f59e0b" };
const UNLIKELY: LikelihoodBand = { label: "Unlikely", color: "#94a3b8" };

export const LIKELIHOOD_BANDS = [LIKELY, UNSURE, UNLIKELY];

export function likelihoodBand(likelihood: number): LikelihoodBand {
  if (likelihood >= 0.7) return LIKELY;
  if (likelihood >= 0.4) return UNSURE;
  return UNLIKELY;
}
