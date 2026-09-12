import { describe, expect, it } from 'vitest';
import { calculatePanelLayout } from './layout';
import { createLocalProjection, type GeoPoint } from './projection';
import { deriveGeometry } from './geometry';
import type { PanelLayoutOptions } from './types';

const projection = createLocalProjection([[37, 127]]);
const geo = (points: [number, number][]): GeoPoint[] => points.map(projection.inverse);
const rect = (x: number, y: number, w: number, h: number) => geo([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
const options: PanelLayoutOptions = { panel: { widthM: 1, lengthM: 2, ratedPowerW: 400 }, edgeClearanceM: 0 };

describe('projection and conservative repair', () => {
  it('round trips geographic coordinates through roof-centered WGS84 meters', () => {
    const p = createLocalProjection(rect(0, 0, 10, 20));
    const point: GeoPoint = [37.0001, 127.0001];
    expect(p.inverse(p.forward(point))[0]).toBeCloseTo(point[0], 12);
    expect(p.inverse(p.forward(point))[1]).toBeCloseTo(point[1], 12);
  });
  it('repairs a retraced self-overlapping spike with a visible warning', () => {
    const roof = geo([[0, 0], [10.1, 0], [12, 2], [10.1, 0], [10.1, 10.1], [0, 10.1]]);
    const before = JSON.stringify(roof);
    const result = calculatePanelLayout(roof, options);
    expect(result.panelCount).toBe(50);
    expect(result.warnings.some(w => w.code === 'POLYGON_REPAIRED')).toBe(true);
    expect(JSON.stringify(roof)).toBe(before);
  });
  it('rejects bow ties instead of selecting one lobe or filling a convex hull', () => {
    expect(() => calculatePanelLayout(geo([[0, 0], [10, 10], [0, 10], [10, 0]]), options)).toThrow('SELF_INTERSECTION');
  });
  it('rejects two lobes sharing a repeated vertex', () => {
    expect(() => calculatePanelLayout(geo([[0, 0], [4, 0], [4, 4], [0, 0], [-4, 4], [-4, 0]]), options)).toThrow('INVALID_POLYGON');
  });
  it('keeps geographic area independent of local layout area', () => {
    const roof = rect(0, 0, 10.1, 10.1);
    const g = deriveGeometry({ roofPolygon: roof, location: { lat: roof[0]![0], lng: roof[0]![1] },
      roofMetadata: { shape: 'unknown', material: '', shadingTap: 0 }, radiationTier: 1, powerAccess: 'no-power' });
    expect(g.areaMethod).toBe('mean-earth-sphere');
    expect(calculatePanelLayout(roof, options).diagnostics.areaMethod).toBe('local-WGS84-tangent-metric');
    expect(g.footprintAreaM2).toBeGreaterThan(100);
  });
});

describe('bounded panel packing', () => {
  it('fits a known rectangular count and derives capacity and module area', () => {
    const r = calculatePanelLayout(rect(0, 0, 10.1, 10.1), options);
    expect(r.panelCount).toBe(50);
    expect(r.installedDcCapacityKw).toBe(20);
    expect(r.moduleCoveredAreaM2).toBe(100);
    expect(r.usableAreaM2).toBeGreaterThan(100);
    expect(r.unusedAreaM2).toBeCloseTo(r.usableAreaM2 - 100, 8);
  });
  it('respects edge clearance', () => {
    const r = calculatePanelLayout(rect(0, 0, 10.1, 10.1), { ...options, edgeClearanceM: 1 });
    expect(r.panelCount).toBe(32);
    for (const p of r.placements) for (const corner of p.corners) {
      const [x, y] = projection.forward(corner);
      expect(x).toBeGreaterThanOrEqual(0.999);
      expect(y).toBeGreaterThanOrEqual(0.999);
      expect(x).toBeLessThanOrEqual(9.101);
      expect(y).toBeLessThanOrEqual(9.101);
    }
  });
  it('rotates panels where required', () => {
    const roof = rect(0, 0, 2.1, 1.1);
    expect(calculatePanelLayout(roof, { ...options, allowRotation: false }).panelCount).toBe(0);
    const result = calculatePanelLayout(roof, options);
    expect(result.panelCount).toBe(1);
    expect(result.placements[0]!.rotationDeg).toBe(90);
  });
  it('subtracts overlapping keep-outs once and rejects panels crossing them', () => {
    const roof = rect(0, 0, 10.1, 10.1);
    const one = calculatePanelLayout(roof, { ...options, keepOutZones: [{ polygon: rect(3, 3, 4, 4) }] });
    const duplicate = calculatePanelLayout(roof, { ...options, keepOutZones: [{ polygon: rect(3, 3, 4, 4) }, { polygon: rect(3, 3, 4, 4) }] });
    expect(duplicate.usableAreaM2).toBeCloseTo(one.usableAreaM2, 6);
    expect(one.panelCount).toBeLessThan(50);
    for (const p of one.placements) {
      const corners = p.corners.map(projection.forward);
      const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
      expect(Math.max(...xs) <= 3.001 || Math.min(...xs) >= 6.999 || Math.max(...ys) <= 3.001 || Math.min(...ys) >= 6.999).toBe(true);
    }
  });
  it('rejects keep-outs outside the roof and malformed keep-outs', () => {
    expect(() => calculatePanelLayout(rect(0, 0, 10, 10), { ...options, keepOutZones: [{ polygon: rect(9, 9, 2, 2) }] })).toThrow('KEEP_OUT_OUTSIDE_ROOF');
    expect(() => calculatePanelLayout(rect(0, 0, 10, 10), { ...options, keepOutZones: [{ polygon: geo([[1, 1], [3, 3], [1, 3], [3, 1]]) }] })).toThrow('SELF_INTERSECTION');
  });
  it('packs a concave L without spanning the missing corner', () => {
    const r = calculatePanelLayout(geo([[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]]), options);
    expect(r.panelCount).toBeGreaterThan(0);
    for (const p of r.placements) {
      const xy = p.corners.map(projection.forward);
      expect(Math.max(...xy.map(v => v[0])) <= 4.001 || Math.max(...xy.map(v => v[1])) <= 4.001).toBe(true);
    }
  });
  it.each([0.5, 0.1])('returns clear no-fit results for a narrow roof %s meters wide', width => {
    const r = calculatePanelLayout(rect(0, 0, width, 10), options);
    expect(r.panelCount).toBe(0);
    expect(r.warnings.some(w => w.code === 'NO_PANELS_FIT')).toBe(true);
  });
  it('handles fully excluded and fully inset roofs', () => {
    const roof = rect(0, 0, 10, 10);
    expect(calculatePanelLayout(roof, { ...options, keepOutZones: [{ polygon: roof }] }).usableAreaM2).toBe(0);
    expect(calculatePanelLayout(roof, { ...options, edgeClearanceM: 20 }).panelCount).toBe(0);
  });
  it('reports usable components split by an explicit keep-out strip', () => {
    const r = calculatePanelLayout(rect(0, 0, 10.1, 10.1), { ...options,
      keepOutZones: [{ polygon: rect(4, 0, 2, 10.1) }] });
    expect(r.panelCount).toBeGreaterThan(0);
    expect(r.warnings.some(w => w.code === 'USABLE_SPACE_SPLIT')).toBe(true);
    for (const p of r.placements) {
      const xs = p.corners.map(c => projection.forward(c)[0]);
      expect(Math.max(...xs) <= 4.001 || Math.min(...xs) >= 5.999).toBe(true);
    }
  });
  it('is repeatable and accepted placements never overlap', () => {
    const roof = rect(0, 0, 10.1, 10.1);
    const a = calculatePanelLayout(roof, options);
    expect(calculatePanelLayout(roof, options)).toEqual(a);
    for (let i = 0; i < a.placements.length; i++) for (let j = i + 1; j < a.placements.length; j++) {
      const p = a.placements[i]!.localCornersM, q = a.placements[j]!.localCornersM;
      expect(p[1]![0] <= q[0]![0] + 1e-9 || q[1]![0] <= p[0]![0] + 1e-9 || p[2]![1] <= q[0]![1] + 1e-9 || q[2]![1] <= p[0]![1] + 1e-9).toBe(true);
    }
  });
  it('bounds pathological small-module work', () => {
    const r = calculatePanelLayout(rect(0, 0, 10, 10), { ...options, panel: { widthM: 0.02, lengthM: 0.02, ratedPowerW: 1 } });
    expect(r.diagnostics.candidatesTested).toBeLessThanOrEqual(20000);
    expect(r.diagnostics.truncated).toBe(true);
  });
});
