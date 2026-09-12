import type { SystemEconomicsInput, SystemEconomicsOutput } from './types';
import { repairDrawingArtifacts } from './repair';
import { geographicFootprintArea } from './footprintArea';

// IUGG mean Earth radius (2a+b)/3. Spherical foundation, not survey accuracy.
const rad = Math.PI / 180;
type Point = [number, number];
const equal = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
const cross = (a: Point, b: Point, c: Point) =>
  (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
const onSegment = (a: Point, b: Point, p: Point) =>
  Math.abs(cross(a, b, p)) < 1e-14 &&
  p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) &&
  p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);

export function validateCoordinate(p: unknown): asserts p is Point {
  if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) ||
      Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180) {
    throw new Error('INVALID_COORDINATE: expected finite [lat, lng] in geographic bounds');
  }
}

export function deriveGeometry(input: SystemEconomicsInput): SystemEconomicsOutput['geometry'] {
  const raw = input.roofPolygon;
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 1000) {
    throw new Error('INVALID_POLYGON: expected 3–1000 vertices');
  }
  raw.forEach(validateCoordinate);
  const { points, repaired } = repairDrawingArtifacts(raw);
  if (equal(points[0]!, points[points.length - 1]!)) points.pop();
  if (points.length < 3 || new Set(points.map(p => p.join(','))).size !== points.length) {
    throw new Error('INVALID_POLYGON: fewer than three unique vertices or repeated vertex');
  }
  const first = points[0]!;
  // Explicit roof-scale support bound; no silent polar or dateline approximations.
  if (points.some(p => Math.abs(p[0]) >= 85 || Math.abs(p[0] - first[0]) > 0.02 ||
      Math.abs(p[1] - first[1]) > 0.02)) {
    throw new Error('UNSUPPORTED_POLYGON: polar, antimeridian, or non-roof-scale extent');
  }
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i]!, b = points[(i + 1) % n]!;
    if (Math.abs(cross(points[(i + n - 1) % n]!, a, b)) < 1e-14) {
      throw new Error('INVALID_POLYGON: collinear or overlapping adjacent edges');
    }
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const c = points[j]!, d = points[(j + 1) % n]!;
      if ((cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
          onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) {
        throw new Error('SELF_INTERSECTION: ambiguous crossing or touching components; redraw the roof polygon');
      }
    }
  }
  const loc: Point = [input.location.lat, input.location.lng];
  validateCoordinate(loc);
  let inside = false;
  let boundary = false;
  let longest = -1, bearing = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i]!, b = points[(i + 1) % n]!;
    boundary ||= onSegment(a, b, loc);
    if ((a[0] > loc[0]) !== (b[0] > loc[0]) &&
        loc[1] < (b[1] - a[1]) * (loc[0] - a[0]) / (b[0] - a[0]) + a[1]) inside = !inside;
    // Spherical surface integral using geographic coordinates, never Web Mercator.
    const dl = (b[1] - a[1]) * rad;
    const h = Math.sin((b[0] - a[0]) * rad / 2) ** 2 +
      Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dl / 2) ** 2;
    if (h > longest) {
      longest = h;
      bearing = (Math.atan2(Math.sin(dl) * Math.cos(b[0] * rad),
        Math.cos(a[0] * rad) * Math.sin(b[0] * rad) -
        Math.sin(a[0] * rad) * Math.cos(b[0] * rad) * Math.cos(dl)) / rad + 360) % 360;
    }
  }
  if (!inside && !boundary) throw new Error('LOCATION_MISMATCH: location must lie inside or on the roof polygon');
  const area = geographicFootprintArea(points);
  if (!Number.isFinite(area) || area < 0.01) throw new Error('INVALID_POLYGON: degenerate area');
  return { polygon: points, footprintAreaM2: area, areaMethod: 'mean-earth-sphere', longestEdgeBearingDeg: bearing,
    warnings: repaired ? [{ code: 'POLYGON_REPAIRED', message: 'Removed exact duplicate vertices or zero-area retraced spikes; verify the repaired outline.' }] : [] };
}
