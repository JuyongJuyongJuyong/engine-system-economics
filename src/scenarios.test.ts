import { beforeEach, expect, it, vi } from 'vitest';
import { getRadiationEstimate } from 'engine-radiation-uncertainty';
import { resolveElevation } from './elevation';
import { getSystemEconomics, type SystemEconomicsInput, type SystemEconomicsOutput } from './index';
import { createLocalProjection } from './projection';

// Boundary fixtures only: geometry, layout, physical model and economics are real.
// Not live-provider reliability or empirical climate/financial calibration.
vi.mock('engine-radiation-uncertainty', () => ({ getRadiationEstimate: vi.fn() }));
vi.mock('./elevation', () => ({ resolveElevation: vi.fn() }));
const projection = createLocalProjection([[37, 127]]);
const source = 'Synthetic end-to-end scenario; not regional data';
function input(w = 10, h = 10): SystemEconomicsInput {
  return {
    roofPolygon: ([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as [number, number][]).map(projection.inverse),
    location: { lat: 37, lng: 127 }, radiationTier: 2, dataTier: 3,
    roofMetadata: { shape: 'unknown', material: 'unspecified', shadingTap: 0 }, powerAccess: 'grid-tied', selfConsumption: 'mixed',
    layout: { panel: { widthM: 1, lengthM: 2, ratedPowerW: 400 }, edgeClearanceM: 0.2 },
    physical: { ambientTemperatureC: 20, representativePoaWm2: 800, noctC: 45, temperatureCoefficientPerC: -0.004,
      inverterEfficiency: 0.96, wiringFactor: 0.98, mismatchFactor: 0.98, availabilityFactor: 0.99, soilingFactor: 0.98, shadingFactor: 0.98, source },
    economics: { tariff: { value: 0.2, currency: 'USD', unit: 'currency/kWh', source },
      systemCost: { value: 10000, currency: 'USD', unit: 'currency', source }, lifetimeYears: 25,
      degradation: { value: 0.0065, source }, tariffEscalation: { value: 0.02, source } },
    emissions: { gridFactor: { value: 0.4, unit: 'kgCO2e/kWh', source } },
  };
}
beforeEach(() => {
  vi.mocked(getRadiationEstimate).mockReset().mockResolvedValue({ kWh_per_m2_per_year: 1500, uncertainty_ci_90: [1300, 1700] });
  vi.mocked(resolveElevation).mockReset().mockResolvedValue({ status: 'resolved', meters: 100, source: 'Synthetic elevation',
    cached: false, lookupLocation: { lat: 37, lng: 127 }, attempts: [], warnings: [] });
});
function finiteTree(value: unknown) {
  if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
  else if (Array.isArray(value)) value.forEach(finiteTree);
  else if (value && typeof value === 'object') Object.values(value).forEach(finiteTree);
}
function sanity(r: SystemEconomicsOutput) {
  finiteTree(r);
  expect(r.kWh).toBeGreaterThanOrEqual(0); expect(r.savings!.value).toBeGreaterThanOrEqual(0); expect(r.co2!.value).toBeGreaterThanOrEqual(0);
  expect(r.layout!.moduleCoveredAreaM2).toBeLessThanOrEqual(r.layout!.usableAreaM2 + 1e-5);
  expect(r.layout!.unusedAreaM2).toBeGreaterThanOrEqual(0);
  expect(r.savings!.unit).toBe('USD'); expect(r.co2!.unit).toBe('kgCO2e');
  expect(r.economics!.annual.every(y => y.energy.unit === 'kWh' && y.savings!.unit === 'USD')).toBe(true);
  expect(r.uncertainty_ci_90).toBeNull(); expect(r.economics!.uncertainty.confidenceLevel).toBeNull();
  expect(r.economics!.uncertainty.physical).toEqual(r.physical!.uncertainty);
  for (const row of r.economics!.annual) for (const m of [row.energy, row.savings!, row.avoidedEmissions!]) {
    expect(m.scenarioEnvelope[0]).toBeLessThanOrEqual(m.value); expect(m.scenarioEnvelope[1]).toBeGreaterThanOrEqual(m.value);
  }
  expect(r.economics!.lifetimeSavings!.value).toBeCloseTo(r.economics!.annual.reduce((s, y) => s + y.savings!.value, 0));
}
it.each([
  { name: 'small/hot-humid', w: 4, h: 6, temp: 32, soil: 0.98, count: 6 },
  { name: 'medium/hot-dry', w: 10, h: 10, temp: 40, soil: 0.9, count: 36 },
  { name: 'large/cool', w: 20, h: 20, temp: 5, soil: 0.98, count: 171 },
  { name: 'no-fit', w: 0.8, h: 10, temp: 20, soil: 0.98, count: 0 },
])('complete scenario: $name', async f => {
  const i = input(f.w, f.h); i.physical = { ...i.physical, ambientTemperatureC: f.temp, soilingFactor: f.soil };
  const before = JSON.stringify(i), r = await getSystemEconomics(i);
  sanity(r); expect(JSON.stringify(i)).toBe(before); expect(await getSystemEconomics(i)).toEqual(r);
  expect(r.layout!.panelCount).toBe(f.count);
  expect(r.layout!.installedDcCapacityKw).toBeCloseTo(f.count * 0.4);
  // Independent rectangular boundary/clearance and pairwise non-overlap checks.
  const boxes = r.layout!.placements.map(p => {
    const corners = p.corners.map(projection.forward);
    const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
    const b = { l: Math.min(...xs), r: Math.max(...xs), b: Math.min(...ys), t: Math.max(...ys) };
    expect(b.l).toBeGreaterThanOrEqual(-f.w / 2 + 0.2 - 1e-5); expect(b.r).toBeLessThanOrEqual(f.w / 2 - 0.2 + 1e-5);
    expect(b.b).toBeGreaterThanOrEqual(-f.h / 2 + 0.2 - 1e-5); expect(b.t).toBeLessThanOrEqual(f.h / 2 - 0.2 + 1e-5);
    expect((b.r - b.l) * (b.t - b.b)).toBeCloseTo(2); return b;
  });
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
    const x = boxes[a]!, y = boxes[b]!;
    expect(Math.min(x.r, y.r) - Math.max(x.l, y.l) <= 1e-5 || Math.min(x.t, y.t) - Math.max(x.b, y.b) <= 1e-5).toBe(true);
  }
  if (f.count) {
    // Broad engineering screening under this fixed 1500 kWh/m² POA fixture, not empirical bounds.
    expect(r.kWh! / r.layout!.installedDcCapacityKw).toBeGreaterThan(900);
    expect(r.kWh! / r.layout!.installedDcCapacityKw).toBeLessThan(1500);
  } else { expect(r.kWh).toBe(0); expect(r.economics!.payback!.years).toBeNull(); expect(r.economics!.roiPercent!.value).toBe(-100); }
  expect(r.economics!.roiPercent!.value).toBeCloseTo((r.economics!.lifetimeSavings!.value / 10000 - 1) * 100);
  const p = r.economics!.payback!.years;
  if (p !== null) {
    const complete = Math.floor(p), rows = r.economics!.annual;
    const cumulative = rows.slice(0, complete).reduce((s, y) => s + y.savings!.value, 0);
    expect(cumulative + (p - complete) * (rows[complete]?.savings?.value ?? 0)).toBeCloseTo(10000);
  }
  expect(vi.mocked(getRadiationEstimate).mock.calls).toEqual([[{ lat: 37, lng: 127, tier: 2 }], [{ lat: 37, lng: 127, tier: 2 }]]);
  console.log(JSON.stringify({ scenario: f.name, panels: r.layout!.panelCount, kWp: r.layout!.installedDcCapacityKw,
    kWh: r.kWh, savingsUSD: r.savings!.value, co2Kg: r.co2!.value, roiPercent: r.economics!.roiPercent!.value, paybackYears: p }));
});
it('nested rectangular scale increases panel count, capacity and energy proportionally', async () => {
  const results = await Promise.all([4, 10, 20].map(w => getSystemEconomics(input(w, w))));
  for (let n = 1; n < results.length; n++) {
    const a = results[n - 1]!, b = results[n]!;
    expect(b.layout!.usableAreaM2).toBeGreaterThan(a.layout!.usableAreaM2);
    expect(b.layout!.panelCount).toBeGreaterThan(a.layout!.panelCount);
    expect(b.layout!.installedDcCapacityKw).toBeGreaterThan(a.layout!.installedDcCapacityKw);
    expect(b.kWh).toBeGreaterThan(a.kWh!);
    expect(b.kWh! / a.kWh!).toBeCloseTo(b.layout!.installedDcCapacityKw / a.layout!.installedDcCapacityKw);
  }
});
it.each([{ shadingFactor: 0.4 }, { soilingFactor: 0.7 }, { ambientTemperatureC: 40 }])('physical loss monotonicity %j', async change => {
  const i = input(), a = await getSystemEconomics(i), b = await getSystemEconomics({ ...i, physical: { ...i.physical, ...change } });
  expect(b.kWh).toBeLessThan(a.kWh!); expect(b.savings!.value).toBeLessThan(a.savings!.value);
});
it('elevation failure preserves energy without reference-altitude correction but widens all downstream envelopes', async () => {
  const a = await getSystemEconomics(input());
  vi.mocked(resolveElevation).mockResolvedValue({ status: 'unavailable', meters: null, source: null, cached: false,
    lookupLocation: { lat: 37, lng: 127 }, attempts: [], warnings: ['Synthetic exhausted provider pool'] });
  const b = await getSystemEconomics(input()); sanity(b); expect(b.kWh).toBe(a.kWh);
  for (const key of ['savings', 'co2'] as const) {
    expect(b[key]!.scenarioEnvelope[0]).toBeLessThan(a[key]!.scenarioEnvelope[0]);
    expect(b[key]!.scenarioEnvelope[1]).toBeGreaterThan(a[key]!.scenarioEnvelope[1]);
  }
  expect(b.warnings.some(w => w.code === 'ELEVATION_LIMITATION')).toBe(true);
});
it('zero/low/high tariffs scale savings without affecting physical energy', async () => {
  const results: SystemEconomicsOutput[] = [];
  for (const value of [0, 0.1, 0.4]) { const i = input(); i.economics!.tariff!.value = value; results.push(await getSystemEconomics(i)); }
  expect(results[0]!.savings!.value).toBe(0); expect(results[0]!.economics!.payback!.years).toBeNull();
  expect(results[2]!.savings!.value).toBeCloseTo(results[1]!.savings!.value * 4);
  expect(results.every(r => r.kWh === results[0]!.kWh)).toBe(true);
});
it('higher cost worsens ROI/payback; zero cost has undefined ROI and immediate payback', async () => {
  const results: SystemEconomicsOutput[] = [];
  for (const value of [0, 5000, 10000, 1e6]) { const i = input(); i.economics!.systemCost!.value = value; results.push(await getSystemEconomics(i)); }
  expect(results[0]!.economics!.roiPercent).toBeNull(); expect(results[0]!.economics!.payback!.years).toBe(0);
  expect(results[2]!.economics!.roiPercent!.value).toBeLessThan(results[1]!.economics!.roiPercent!.value);
  expect(results[2]!.economics!.payback!.years).toBeGreaterThan(results[1]!.economics!.payback!.years!);
  expect(results[3]!.economics!.payback!.years).toBeNull(); results.forEach(sanity);
});
it('category compensation and verified net metering do not alter generation', async () => {
  const results: SystemEconomicsOutput[] = [];
  for (const selfConsumption of ['mostly-out', 'mixed', 'mostly-home'] as const) results.push(await getSystemEconomics({ ...input(), selfConsumption }));
  const i = input(); i.economics!.netMetering = { kind: 'true-one-to-one', verified: true, source };
  results.push(await getSystemEconomics(i));
  results.forEach((r, n) => { expect(r.savings!.value).toBeCloseTo(r.kWh! * 0.2 * [0.3, 0.5, 0.7, 1][n]!); expect(r.kWh).toBe(results[0]!.kWh); });
});
it('zero/nonzero emissions factors scale CO2 independently of savings', async () => {
  const results: SystemEconomicsOutput[] = [];
  for (const value of [0, 0.2, 0.8]) { const i = input(); i.emissions!.gridFactor.value = value; results.push(await getSystemEconomics(i)); }
  expect(results[0]!.co2!.value).toBe(0); expect(results[2]!.co2!.value).toBeCloseTo(results[1]!.co2!.value * 4);
  expect(results.every(r => r.savings!.value === results[0]!.savings!.value)).toBe(true);
});
