import C from 'clipper-lib';
import { deriveGeometry } from './geometry';
import { createLocalProjection, type GeoPoint } from './projection';
import type { PanelLayoutOptions, PanelLayoutResult } from './types';

// Micrometer clipping avoids losing entire rows to artificial millimeter setbacks.
// Boundary contact is accepted at this numerical resolution; no installation tolerance inferred.
const SCALE = 1_000_000;
const LIMIT = 20000;
const area = (paths: C.Paths) => Math.abs(paths.reduce((s, p) => s + C.Clipper.Area(p), 0)) / SCALE ** 2;
function clip(subject: C.Paths, cutters: C.Paths, operation: C.ClipType): C.Paths {
  const engine = new C.Clipper();
  engine.StrictlySimple = true;
  engine.AddPaths(subject, C.PolyType.ptSubject, true);
  engine.AddPaths(cutters, C.PolyType.ptClip, true);
  const result: C.Paths = [];
  engine.Execute(operation, result, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return result;
}

/** Pure footprint layout. Rack tilt, row shading and sloped roof planes are not modeled. */
export function calculatePanelLayout(roofPolygon: GeoPoint[], options: PanelLayoutOptions): PanelLayoutResult {
  if (!options || !options.panel || ![options.panel.widthM, options.panel.lengthM, options.panel.ratedPowerW]
    .every(v => Number.isFinite(v) && v > 0) || options.panel.widthM < 0.01 || options.panel.lengthM < 0.01 ||
    options.panel.widthM > 10000 || options.panel.lengthM > 10000 || options.panel.ratedPowerW > 1e9 ||
    !Number.isFinite(options.edgeClearanceM) || options.edgeClearanceM < 0 ||
    (options.allowRotation !== undefined && typeof options.allowRotation !== 'boolean')) throw new Error('INVALID_LAYOUT_OPTIONS');
  const validate = (polygon: GeoPoint[]) => deriveGeometry({ roofPolygon: polygon,
    location: { lat: polygon?.[0]?.[0] ?? NaN, lng: polygon?.[0]?.[1] ?? NaN },
    roofMetadata: { shape: 'unknown', material: '', shadingTap: 0 }, radiationTier: 1, powerAccess: 'no-power' });
  const roof = validate(roofPolygon);
  const projection = createLocalProjection(roof.polygon);
  const path = (polygon: GeoPoint[]): C.Path => {
    const p = polygon.map(point => { const [x, y] = projection.forward(point); return { X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }; });
    if (!C.Clipper.Orientation(p)) p.reverse();
    return p;
  };
  const boundary = path(roof.polygon);
  const zones = options.keepOutZones ?? [];
  if (!Array.isArray(zones) || zones.length > 100) throw new Error('INVALID_KEEP_OUTS: maximum 100 zones');
  if (zones.reduce((sum, zone) => sum + (zone?.polygon?.length ?? 0), roof.polygon.length) > 4000) {
    throw new Error('LAYOUT_COMPLEXITY_LIMIT: at most 4000 combined input vertices');
  }
  const warnings = [...roof.warnings];
  const obstacles = zones.map(zone => {
    const valid = validate(zone?.polygon);
    warnings.push(...valid.warnings);
    const obstacle = path(valid.polygon);
    if (area(clip([obstacle], [boundary], C.ClipType.ctDifference)) > 1e-8) {
      throw new Error('KEEP_OUT_OUTSIDE_ROOF: zones must lie wholly within the roof');
    }
    return obstacle;
  });
  // Quantization is now micrometer-scale. Boundary contact is allowed.
  const obstacleOffset = new C.ClipperOffset();
  obstacleOffset.AddPaths(obstacles, C.JoinType.jtMiter, C.EndType.etClosedPolygon);
  const protectedObstacles: C.Paths = [];
  obstacleOffset.Execute(protectedObstacles, 0);
  const offset = new C.ClipperOffset();
  offset.AddPath(boundary, C.JoinType.jtMiter, C.EndType.etClosedPolygon);
  const inset: C.Paths = [];
  offset.Execute(inset, -Math.ceil(options.edgeClearanceM * SCALE));
  // Nonzero fill unions overlapping obstacles, avoiding double subtraction.
  const usable = clip(inset, protectedObstacles, C.ClipType.ctDifference);
  if (usable.filter(p => C.Clipper.Orientation(p)).length > 1) {
    warnings.push({ code: 'USABLE_SPACE_SPLIT', message: 'Explicit keep-outs or setbacks split usable space; panels are tested within each component.' });
  }
  const usableAreaM2 = area(usable);
  let tested = 0;
  let truncated = false;
  let best: PanelLayoutResult['placements'] = [];
  const bounds = C.JS.BoundsOfPaths(usable);
  // Use the actual quantized bounds, without artificial row/column padding.
  const minX = bounds.left / SCALE, maxX = bounds.right / SCALE;
  const minY = bounds.top / SCALE, maxY = bounds.bottom / SCALE;
  const rotations: (0 | 90)[] = options.allowRotation === false ? [0] : [0, 90];
  // Eight runs maximum: two axis-aligned rotations × four half-cell translations.
  // Non-overlap is guaranteed by the grid. Equal counts keep the earlier run.
  if (usableAreaM2 > 0) {
    for (const rotation of rotations) {
      const width = Math.ceil((rotation === 0 ? options.panel.widthM : options.panel.lengthM) * SCALE) / SCALE;
      const length = Math.ceil((rotation === 0 ? options.panel.lengthM : options.panel.widthM) * SCALE) / SCALE;
      for (const [fx, fy] of [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]]) {
        const placed: PanelLayoutResult['placements'] = [];
        const columns = Math.max(0, Math.floor((maxX - minX - fx! * width) / width + 1e-10));
        const rows = Math.max(0, Math.floor((maxY - minY - fy! * length) / length + 1e-10));
        for (let row = 0; row < rows && tested < LIMIT; row++) {
          for (let col = 0; col < columns && tested < LIMIT; col++) {
            tested++;
            const x = minX + (col + fx!) * width, y = minY + (row + fy!) * length;
            const local: [number, number][] = [[x, y], [x + width, y], [x + width, y + length], [x, y + length]];
            // Grid pitch is rounded upward; test its quantized rectangle.
            const rectangle = local.map(([cx, cy]) => ({ X: Math.round(cx * SCALE), Y: Math.round(cy * SCALE) }));
            if (area(clip([rectangle], usable, C.ClipType.ctDifference)) < 1e-8) {
              placed.push({ id: placed.length + 1, rotationDeg: rotation, localCornersM: local, corners: local.map(projection.inverse) });
            }
          }
        }
        if (placed.length > best.length) best = placed;
        if (tested >= LIMIT) { truncated = true; break; }
      }
      if (truncated) break;
    }
  }
  if (truncated) warnings.push({ code: 'LAYOUT_SEARCH_LIMIT', message: 'Candidate limit reached; layout is a partial heuristic result.' });
  if (best.length === 0) warnings.push({ code: 'NO_PANELS_FIT', message: 'No placement found by the bounded grid search; this is not an optimality proof.' });
  warnings.push({ code: 'FOOTPRINT_LAYOUT_ONLY', message: 'Flat footprint packing; no measured pitch, rack row spacing or structural feasibility modeled.' });
  const moduleCoveredAreaM2 = best.length * options.panel.widthM * options.panel.lengthM;
  return { panelCount: best.length, installedDcCapacityKw: best.length * options.panel.ratedPowerW / 1000,
    moduleCoveredAreaM2, usableAreaM2, unusedAreaM2: Math.max(0, usableAreaM2 - moduleCoveredAreaM2),
    placements: best, warnings, diagnostics: { algorithm: 'bounded-grid-v1', candidatesTested: tested,
      candidateLimit: LIMIT, truncated, areaMethod: 'local-WGS84-tangent-metric', origin: projection.origin } };
}
