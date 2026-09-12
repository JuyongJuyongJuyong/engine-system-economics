import type { GeoPoint } from './projection';

/** Only zero-area drawing artifacts have unambiguous automatic repairs.
 * Proper crossings (including bow ties), touching lobes and disconnected regions
 * still reach strict validation. Never choose a largest lobe or a convex hull.
 */
export function repairDrawingArtifacts(raw: GeoPoint[]) {
  const points = raw.map(p => [...p] as GeoPoint);
  const same = (a: GeoPoint, b: GeoPoint) => a[0] === b[0] && a[1] === b[1];
  if (points.length > 1 && same(points[0]!, points.at(-1)!)) points.pop();
  let repaired = false;
  let changed = true;
  while (changed && points.length >= 3) {
    changed = false;
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!, b = points[(i + 1) % points.length]!, c = points[(i + 2) % points.length]!;
      if (same(a, b)) {
        points.splice(i, 1); changed = repaired = true; break;
      }
      if (same(a, c)) {
        // Rotate so the retraced A-B-A spike can be removed without index wrapping.
        const rotated = [...points.slice(i), ...points.slice(0, i)];
        rotated.splice(1, 2);
        points.splice(0, points.length, ...rotated);
        changed = repaired = true; break;
      }
    }
  }
  return { points, repaired };
}
