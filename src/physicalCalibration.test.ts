import { describe, expect, it } from 'vitest';
import { calculatePhysicalEnergy, type PhysicalOptions } from './physical';
import { createElevationResolver, type ElevationResult } from './elevation';
import type { PanelLayoutResult } from './types';

const layout = { installedDcCapacityKw: 4, moduleCoveredAreaM2: 20 } as PanelLayoutResult;
const radiation = { kWh_per_m2_per_year: 1500, uncertainty_ci_90: [1300, 1700] as [number, number] };
const elevation: ElevationResult = { meters: 100, source: 'synthetic fixture', status: 'resolved', cached: false,
  lookupLocation: { lat: 0, lng: 0 }, attempts: [], warnings: [] };
// Synthetic stress scenarios, not regional climate datasets or calibrated panel presets.
// Humidity is a label, not an independently modeled physical input.
const base: PhysicalOptions = { inverterEfficiency: 0.96, wiringFactor: 0.98, mismatchFactor: 0.98,
  availabilityFactor: 0.99, shadingFactor: 0.98, source: 'Synthetic calibration fixture; not observations' };
const scenarios = [
  { name: 'hot/humid reference', ambientTemperatureC: 32, representativePoaWm2: 700, noctC: 45,
    temperatureCoefficientPerC: -0.004, soilingFactor: 0.98, expectedCell: 53.875 },
  { name: 'hot/dry reference', ambientTemperatureC: 40, representativePoaWm2: 900, noctC: 48,
    temperatureCoefficientPerC: -0.0035, soilingFactor: 0.90, expectedCell: 71.5 },
  { name: 'temperate reference', ambientTemperatureC: 20, representativePoaWm2: 700, noctC: 42,
    temperatureCoefficientPerC: -0.003, soilingFactor: 0.97, expectedCell: 39.25 },
  { name: 'cool reference', ambientTemperatureC: 5, representativePoaWm2: 600, noctC: 40,
    temperatureCoefficientPerC: -0.004, soilingFactor: 0.99, expectedCell: 20 },
];
const run = (o: PhysicalOptions, capacity = 4, e = elevation) => calculatePhysicalEnergy(
  { ...layout, installedDcCapacityKw: capacity }, radiation, e, o);

describe('representative physical calibration (synthetic, not coverage validation)', () => {
  it.each(scenarios)('$name: arithmetic, deterministic results and no inferred defaults', scenario => {
    const options = { ...base, ...scenario };
    const result = run(options);
    expect(result.cellTemperatureC).toBeCloseTo(scenario.expectedCell, 10);
    const expected = 6000 * 0.96 * 0.98 * 0.98 * 0.99 * 0.98 * scenario.soilingFactor *
      (1 + scenario.temperatureCoefficientPerC * (scenario.expectedCell - 25));
    expect(result.annualElectricalKwh).toBeCloseTo(expected, 8);
    expect(run(options)).toEqual(result);
    expect(result.inputProvenance.every(p => p.basis === 'caller-supplied')).toBe(true);
    expect(result.uncertainty.calibrationStatus).toBe('not-empirically-calibrated');
    console.log(`${scenario.name}: Tcell=${result.cellTemperatureC.toFixed(3)} C, PR=${result.performanceRatio.toFixed(4)}, annual=${result.annualElectricalKwh.toFixed(1)} kWh`);
  });
  it.each(scenarios)('$name: increasing temperature/NOCT never increases energy', scenario => {
    for (const gamma of [-0.005, -0.004, -0.003, 0]) {
      const options = { ...base, ...scenario, temperatureCoefficientPerC: gamma };
      for (const temperature of [-10, 0, 20, 40, 60]) {
        expect(run({ ...options, ambientTemperatureC: temperature + 5 }).annualElectricalKwh)
          .toBeLessThanOrEqual(run({ ...options, ambientTemperatureC: temperature }).annualElectricalKwh);
      }
      for (const noct of [35, 40, 45, 50, 60]) {
        expect(run({ ...options, noctC: noct + 1 }).annualElectricalKwh)
          .toBeLessThanOrEqual(run({ ...options, noctC: noct }).annualElectricalKwh);
      }
    }
  });
  it.each(scenarios)('$name: more loss reduces PR and energy; capacity scales exactly', scenario => {
    const options = { ...base, ...scenario };
    for (const factor of ['soilingFactor', 'shadingFactor', 'wiringFactor', 'inverterEfficiency'] as const) {
      for (const retained of [0, 0.2, 0.8, 0.95]) {
        const lower = run({ ...options, [factor]: retained }), upper = run({ ...options, [factor]: 1 });
        expect(lower.performanceRatio).toBeCloseTo(upper.performanceRatio * retained, 10);
        expect(lower.annualElectricalKwh).toBeCloseTo(upper.annualElectricalKwh * retained, 8);
      }
    }
    for (const capacity of [0, 0.5, 2, 8, 20]) {
      const r = run(options, capacity), ref = run(options);
      expect(r.annualElectricalKwh).toBeCloseTo(ref.annualElectricalKwh * capacity / 4, 8);
      expect(r.uncertainty.energyScenarioEnvelopeKwh[1]).toBeCloseTo(ref.uncertainty.energyScenarioEnvelopeKwh[1] * capacity / 4, 8);
    }
  });
  it('NOCT and NMOT-plus-explicit-cell-delta agree for equivalent nominal cell temperatures', () => {
    for (const nominal of [35, 40, 45, 50, 55]) {
      expect(run({ ...base, noctC: nominal }).annualElectricalKwh)
        .toBe(run({ ...base, nmotC: nominal - 3, moduleToCellDeltaC: 3 }).annualElectricalKwh);
    }
  });
});

describe('uncertainty interpretation and source disclosures', () => {
  it('does not silently ignore a cell-temperature delta without NMOT', () => {
    expect(() => run({ moduleToCellDeltaC: 3 })).toThrow('CELL_DELTA_REQUIRES_NMOT');
  });
  it.each(scenarios)('$name: isolates conditional radiation propagation from provisional additions', scenario => {
    const r = run({ ...base, ...scenario });
    const u = r.uncertainty;
    expect(u.radiationOnlyConditionalIntervalKwh).toEqual([1300 * 4 * r.performanceRatio, 1700 * 4 * r.performanceRatio]);
    expect(u.energyScenarioEnvelopeKwh[0]).toBeLessThan(u.radiationOnlyConditionalIntervalKwh[0]);
    expect(u.energyScenarioEnvelopeKwh[1]).toBeGreaterThan(u.radiationOnlyConditionalIntervalKwh[1]);
    expect(u.components.map(c => c.basis)).toEqual(['upstream-model', 'provisional-allowance', 'provisional-allowance', 'provisional-allowance']);
  });
  it('removing each supplied default-equivalent input preserves central energy and discloses/widens assumptions', () => {
    const explicit: PhysicalOptions = { ambientTemperatureC: 20, representativePoaWm2: 800, noctC: 45,
      temperatureCoefficientPerC: -0.004, inverterEfficiency: 0.96, wiringFactor: 0.98, mismatchFactor: 0.98,
      availabilityFactor: 0.99, soilingFactor: 1, shadingFactor: 1 };
    const reference = run(explicit);
    for (const key of Object.keys(explicit) as (keyof PhysicalOptions)[]) {
      const omitted = { ...explicit }; delete omitted[key];
      const r = run(omitted);
      expect(r.annualElectricalKwh).toBe(reference.annualElectricalKwh);
      expect(r.inputProvenance.filter(p => p.basis === 'reference-assumption')).toHaveLength(1);
      expect(r.assumptions.filter(a => a.includes('engineering reference scenario'))).toHaveLength(1);
      expect(r.uncertainty.energyScenarioEnvelopeKwh[1]).toBeGreaterThan(reference.uncertainty.energyScenarioEnvelopeKwh[1]);
    }
  });
  it('records every fallback independently and does not attribute defaults to a caller citation', () => {
    const r = run({ source: 'A supplied citation without any supplied values' });
    expect(r.inputProvenance).toHaveLength(10);
    expect(r.inputProvenance.every(p => p.basis === 'reference-assumption' && !p.source.includes('supplied citation'))).toBe(true);
  });
  it('failed elevation provider chain returns finite energy and a wider relative envelope', async () => {
    const missing = await createElevationResolver({ fetch: async () => new Response('', { status: 503 }) })({ lat: 37, lng: 127 }, 3);
    expect(missing.status).toBe('unavailable');
    for (const scenario of scenarios) {
      const options = { ...base, ...scenario, climateReferenceElevationM: 0, lapseRateCPerM: -0.0065 };
      const good = run(options), failed = run(options, 4, missing);
      const width = (r: ReturnType<typeof run>) => (r.uncertainty.energyScenarioEnvelopeKwh[1] - r.uncertainty.energyScenarioEnvelopeKwh[0]) / r.annualElectricalKwh;
      expect(Number.isFinite(failed.annualElectricalKwh)).toBe(true);
      expect(width(failed)).toBeGreaterThan(width(good));
      expect(failed.elevationTemperatureAdjustmentC).toBe(0);
    }
  });
  it('cold cells can exceed reference power without an artificial PR clamp', () => {
    const r = run({ ...base, ambientTemperatureC: -10, representativePoaWm2: 100, noctC: 35, temperatureCoefficientPerC: -0.005,
      inverterEfficiency: 1, wiringFactor: 1, mismatchFactor: 1, availabilityFactor: 1, soilingFactor: 1, shadingFactor: 1 });
    expect(r.temperatureFactor).toBeGreaterThan(1);
  });
});
