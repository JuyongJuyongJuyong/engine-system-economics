import { expect, it } from 'vitest';
import { calculatePanelLayout } from './layout';
import { createLocalProjection } from './projection';
import type { PanelLayoutOptions } from './types';
const p = createLocalProjection([[37, 127]]);
const rectangle = (w: number, h: number): [number, number][] => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
const options: PanelLayoutOptions = { panel: { widthM: 1, lengthM: 2, ratedPowerW: 400 }, edgeClearanceM: 0 };
const fixtures = [
  { name: 'exact 10×10', roof: rectangle(10, 10), count: 50 },
  { name: 'near-fit 10.001×10.001', roof: rectangle(10.001, 10.001), count: 50 },
  { name: 'undersized 9.999×10', roof: rectangle(9.999, 10), count: 45 },
  { name: 'narrow 0.8×10', roof: rectangle(0.8, 10), count: 0 },
  { name: 'rotation needed 2×1', roof: rectangle(2, 1), count: 1 },
  { name: 'convex trapezoid', roof: [[-5, -5], [5, -5], [3, 5], [-3, 5]], count: 34 },
  { name: 'concave notch', roof: [[-5, -5], [5, -5], [5, 0], [0, 0], [0, 5], [-5, 5]], count: 35 },
  { name: 'central obstacle', roof: rectangle(10, 10), obstacle: rectangle(2, 2), count: 48 },
  { name: 'edge obstacle', roof: rectangle(10, 10), obstacle: [[3, -1], [4.9, -1], [4.9, 1], [3, 1]], count: 48 },
];
it.each(fixtures)('calibration: $name', fixture => {
  const roof = fixture.roof as [number, number][];
  const obstacle = fixture.obstacle as [number, number][] | undefined;
  const config = { ...options, keepOutZones: obstacle ? [{ polygon: obstacle.map(p.inverse) }] : [] };
  const r = calculatePanelLayout(roof.map(p.inverse), config);
  expect(calculatePanelLayout(roof.map(p.inverse), config)).toEqual(r);
  if (fixture.count !== undefined) expect(r.panelCount).toBe(fixture.count);
  else expect(r.panelCount).toBeGreaterThan(0);
  // Independent winding test, with explicit tiny boundary tolerance.
  const inside = (point: [number, number], polygon: [number, number][]) => {
    let winding = false;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
      const cross = (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0]);
      if (Math.abs(cross) < 1e-4 && point[0] >= Math.min(a[0], b[0]) - 1e-5 && point[0] <= Math.max(a[0], b[0]) + 1e-5 &&
          point[1] >= Math.min(a[1], b[1]) - 1e-5 && point[1] <= Math.max(a[1], b[1]) + 1e-5) return true;
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) winding = !winding;
    }
    return winding;
  };
  for (const placement of r.placements) {
    const corners = placement.corners.map(p.forward);
    for (let i = 0; i < 4; i++) for (let t = 0; t <= 8; t++) {
      const a = corners[i]!, b = corners[(i + 1) % 4]!;
      expect(inside([a[0] + (b[0] - a[0]) * t / 8, a[1] + (b[1] - a[1]) * t / 8], roof)).toBe(true);
    }
  }
  console.log(`${fixture.name}: ${r.panelCount} panels, rotation ${r.placements[0]?.rotationDeg ?? 'none'}, usable ${r.usableAreaM2.toFixed(3)} m²`);
});
