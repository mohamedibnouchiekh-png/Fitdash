// GPX route → per-km splits. Pure functions (no I/O) so they can be unit-tested with synthetic routes.
export interface TrackPoint { t: number; lat: number; lon: number; ele: number | null } // t = epoch ms (absolute)
export interface HrSample { t: number; hr: number } // t = epoch ms (absolute)
export interface BuiltSplit { km: number; distKm: number; paceSec: number; hr: number | null; elevGain: number }
export interface RouteResult {
  splits: BuiltSplit[];
  rawDistanceKm: number;       // straight GPS distance
  distanceKm: number;          // after calibration to the distance Apple reported (if any)
  scale: number;               // calibration factor applied to GPS distance
  movingSec: number;           // GPS time with long stationary gaps (pauses) removed
  elevGain: number;            // metres, hysteresis-filtered
}

const TRKPT = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g;
const ATTR = (s: string, name: string): number | null => {
  const m = new RegExp(`${name}="([^"]+)"`).exec(s);
  return m ? Number(m[1]) : null;
};

export function parseGpx(xml: string): TrackPoint[] {
  const out: TrackPoint[] = [];
  TRKPT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TRKPT.exec(xml))) {
    const lat = ATTR(m[1], "lat"), lon = ATTR(m[1], "lon");
    const time = /<time>([^<]+)<\/time>/.exec(m[2]);
    const ele = /<ele>([^<]+)<\/ele>/.exec(m[2]);
    if (lat === null || lon === null || !time || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const t = Date.parse(time[1]);
    if (!Number.isFinite(t)) continue;
    const e = ele ? Number(ele[1]) : NaN;
    out.push({ t, lat, lon, ele: Number.isFinite(e) ? e : null });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cumulative climb using a hysteresis threshold so GPS/barometer noise is not counted as climbing. */
export function cumulativeGain(ele: (number | null)[], threshold = 1.5): number[] {
  const out: number[] = [];
  let ref: number | null = null, gain = 0;
  for (const e of ele) {
    if (e !== null) {
      if (ref === null) ref = e;
      else if (e - ref > threshold) { gain += e - ref; ref = e; }
      else if (ref - e > threshold) ref = e;
    }
    out.push(gain);
  }
  return out;
}

function smooth(values: (number | null)[], radius = 3): (number | null)[] {
  return values.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) { const v = values[j]; if (v !== null) { s += v; n++; } }
    return n ? s / n : null;
  });
}

export const PAUSE_GAP_SEC = 20;       // a gap longer than this…
export const PAUSE_MAX_SPEED_MS = 0.5; // …covering less than 0.5 m/s is treated as a pause and removed from moving time

export function buildRoute(points: TrackPoint[], opts: { reportedDistanceKm?: number | null; hr?: HrSample[] } = {}): RouteResult | null {
  if (points.length < 2) return null;
  const n = points.length;
  const D: number[] = [0];   // raw cumulative metres
  const T: number[] = [0];   // cumulative moving seconds
  for (let i = 1; i < n; i++) {
    const d = haversineM(points[i - 1], points[i]);
    const dt = (points[i].t - points[i - 1].t) / 1000;
    const paused = dt > PAUSE_GAP_SEC && d / dt < PAUSE_MAX_SPEED_MS;
    D.push(D[i - 1] + d);
    T.push(T[i - 1] + (paused || dt < 0 ? 0 : dt));
  }
  const rawM = D[n - 1];
  if (rawM < 50) return null;
  let scale = 1;
  const rep = opts.reportedDistanceKm;
  if (rep && rep > 0) { const f = (rep * 1000) / rawM; if (f >= 0.9 && f <= 1.1) scale = f; }
  const totalM = rawM * scale;
  const S = D.map((x) => x * scale);
  const smoothedEle = smooth(points.map((p) => p.ele));
  const gain = cumulativeGain(smoothedEle);

  // interpolate time / abs time / gain at a given scaled distance (metres)
  const at = (x: number) => {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (S[mid] <= x) lo = mid; else hi = mid; }
    const span = S[hi] - S[lo];
    const f = span > 0 ? Math.min(1, Math.max(0, (x - S[lo]) / span)) : 0;
    return {
      moving: T[lo] + (T[hi] - T[lo]) * f,
      abs: points[lo].t + (points[hi].t - points[lo].t) * f,
      gain: gain[lo] + (gain[hi] - gain[lo]) * f,
    };
  };

  const hr = [...(opts.hr ?? [])].sort((a, b) => a.t - b.t);
  const hrMean = (t0: number, t1: number): number | null => {
    let s = 0, c = 0;
    for (const h of hr) { if (h.t >= t0 && h.t < t1) { s += h.hr; c++; } else if (h.t >= t1) break; }
    return c ? s / c : null;
  };

  const splits: BuiltSplit[] = [];
  const nFull = Math.floor(totalM / 1000);
  const rem = totalM - nFull * 1000;
  const bounds: number[] = [];
  for (let k = 0; k <= nFull; k++) bounds.push(k * 1000);
  if (rem >= 50) bounds.push(totalM);
  for (let k = 1; k < bounds.length; k++) {
    const a = at(bounds[k - 1]), b = at(bounds[k]);
    const distKm = (bounds[k] - bounds[k - 1]) / 1000;
    const dt = b.moving - a.moving;
    if (dt <= 0) continue;
    const h = hrMean(a.abs, b.abs + (k === bounds.length - 1 ? 1 : 0));
    splits.push({
      km: k, distKm: Math.round(distKm * 100) / 100, paceSec: Math.round(dt / distKm),
      hr: h === null ? null : Math.round(h), elevGain: Math.max(0, Math.round(b.gain - a.gain)),
    });
  }
  return { splits, rawDistanceKm: rawM / 1000, distanceKm: totalM / 1000, scale, movingSec: T[n - 1], elevGain: gain[n - 1] };
}
