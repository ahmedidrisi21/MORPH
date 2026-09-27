export type PctChangeBucket = "large_decline" | "decline" | "flat" | "growth" | "strong_growth";

/** ≤ -15 large_decline, (-15, -5] decline, (-5, 5) flat, [5, 15) growth, ≥ 15 strong_growth. */
export function pctChangeBucket(p: number): PctChangeBucket {
  if (p <= -15) return "large_decline";
  if (p <= -5) return "decline";
  if (p < 5) return "flat";
  if (p < 15) return "growth";
  return "strong_growth";
}

export type ZScoreBucket = "normal" | "anomaly_low" | "anomaly_high";

/** |z| > 2 is an anomaly. */
export function zScoreBucket(z: number): ZScoreBucket {
  if (z > 2) return "anomaly_high";
  if (z < -2) return "anomaly_low";
  return "normal";
}

export type ShareBucket = "minor" | "notable" | "major" | "dominant";

/** Share of a total, in percent: < 10 minor, < 30 notable, < 60 major, else dominant. */
export function shareBucket(pct: number): ShareBucket {
  const a = Math.abs(pct);
  if (a < 10) return "minor";
  if (a < 30) return "notable";
  if (a < 60) return "major";
  return "dominant";
}

export function bucketLabel(bucket: string): string {
  return bucket.replace(/_/g, " ");
}
