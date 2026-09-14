export type GeoPoint = [number, number];
export type LocalPoint = [number, number];

/** Roof-centered first-order WGS84 tangent metric. East/north meters; roof-scale only. */
export function createLocalProjection(polygon: GeoPoint[]) {
  const lat = polygon.reduce((s, p) => s + p[0], 0) / polygon.length;
  const lng = polygon.reduce((s, p) => s + p[1], 0) / polygon.length;
  const phi = lat * Math.PI / 180;
  const a = 6378137;
  const e2 = 6.6943799901413165e-3;
  const w = Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const xScale = a / w * Math.cos(phi) * Math.PI / 180;
  const yScale = a * (1 - e2) / w ** 3 * Math.PI / 180;
  return {
    origin: { lat, lng },
    forward: (p: GeoPoint): LocalPoint => [(p[1] - lng) * xScale, (p[0] - lat) * yScale],
    inverse: (p: LocalPoint): GeoPoint => [lat + p[1] / yScale, lng + p[0] / xScale],
  };
}
