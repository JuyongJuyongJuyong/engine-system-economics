import type { GeoPoint } from './projection.js';

/** Isolated spherical geographic area provider. Replace with ellipsoidal geodesics
 * without changing layout: layout area uses its own local metric and is labeled.
 * Mean-Earth spherical area can differ from WGS84 by roughly 0.5%; no survey claim.
 */
export function geographicFootprintArea(polygon: GeoPoint[]): number {
  const rad = Math.PI / 180;
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
    sum += (b[1] - a[1]) * rad * (Math.sin(a[0] * rad) + Math.sin(b[0] * rad));
  }
  return Math.abs(sum) * 6371008.8 ** 2 / 2;
}
