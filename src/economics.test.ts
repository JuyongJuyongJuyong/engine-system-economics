import { expect, it } from 'vitest';
import { calculateEconomics, type EconomicsOptions } from './economics';
import { calculatePhysicalEnergy } from './physical';
import type { PanelLayoutResult } from './types';
const physical = calculatePhysicalEnergy({ installedDcCapacityKw: 4, moduleCoveredAreaM2: 20 } as PanelLayoutResult,
  { kWh_per_m2_per_year: 1500, uncertainty_ci_90: [1300, 1700] },
  { meters: null, source: null, status: 'unavailable', cached: false, lookupLocation: { lat: 0, lng: 0 }, attempts: [], warnings: [] });
const source = 'Synthetic test fixture';
const base: EconomicsOptions = { tariff: { value: 0.2, currency: 'USD', unit: 'currency/kWh', source },
  compensatedFraction: { value: 0.5, source }, degradation: { value: 0, source }, tariffEscalation: { value: 0, source }, lifetimeYears: 10 };
const run = (o: EconomicsOptions = base) => calculateEconomics(physical, o);
it('handles absent optional inputs independently and discloses defaults', () => {
  const r = run({}); expect(r.firstYearSavings).toBeNull(); expect(r.firstYearCo2).toBeNull(); expect(r.roiPercent).toBeNull();
  expect(r.annual).toHaveLength(25); expect(r.compensatedFraction).toBeNull();
  expect(r.uncertainty.economicInputs.degradation!.range).toEqual([0.005, 0.008]);
  expect(r.provenance.every(p => p.description.length > 0)).toBe(true);
});
it.each([0, 0.2, 0.4])('scales savings proportionally with tariff %s', value => {
  const r = run({ ...base, tariff: { ...base.tariff!, value } });
  expect(r.firstYearSavings!.value).toBeCloseTo(physical.annualElectricalKwh * 0.5 * value);
  expect(r.firstYearSavings!.unit).toBe('USD');
});
it('models degradation and escalation separately by year', () => {
  const r = run({ ...base, degradation: { value: 0.01, source }, tariffEscalation: { value: 0.03, source } });
  expect(r.annual[1]!.energy.value).toBeCloseTo(physical.annualElectricalKwh * 0.99);
  expect(r.annual[1]!.savings!.value).toBeCloseTo(r.firstYearSavings!.value * 0.99 * 1.03);
  expect(r.lifetimeSavings!.value).toBeCloseTo(r.annual.reduce((s, r) => s + r.savings!.value, 0));
});
it.each([['mostly-out', 0.3], ['mixed', 0.5], ['mostly-home', 0.7]] as const)('discloses category %s', (category, value) => {
  const r = calculateEconomics(physical, { tariff: base.tariff }, undefined, category);
  expect(r.compensatedFraction!.value).toBe(value); expect(r.compensatedFraction!.source).toContain('Provisional');
  expect(r.firstYearSavings!.value).toBeCloseTo(physical.annualElectricalKwh * value * 0.2);
});
it('verified 1:1 compensation overrides both category and explicit fraction', () => {
  const r = calculateEconomics(physical, { ...base, netMetering: { kind: 'true-one-to-one', verified: true, source } }, undefined, 'mostly-out');
  expect(r.compensatedFraction!.value).toBe(1); expect(r.firstYearSavings!.value).toBeCloseTo(physical.annualElectricalKwh * 0.2);
  expect(() => calculateEconomics(physical, { ...base, netMetering: { kind: 'true-one-to-one', verified: true, source } }, undefined, undefined, 'no-power')).toThrow('NET_METERING');
});
it('calculates interpolated payback and undiscounted horizon ROI', () => {
  const saving = run().firstYearSavings!.value;
  const r = run({ ...base, systemCost: { value: saving * 2.5, currency: 'USD', unit: 'currency', source } });
  expect(r.payback!.years).toBeCloseTo(2.5); expect(r.roiPercent!.value).toBeCloseTo(300);
});
it('non-payback is null, not Infinity; free installation pays back immediately with undefined ROI', () => {
  const cost = { value: 1e9, currency: 'USD', unit: 'currency' as const, source };
  const r = run({ ...base, systemCost: cost });
  expect(r.payback!.years).toBeNull(); expect(r.payback!.status).toBe('not-within-horizon');
  expect(r.payback!.scenarioYears).toEqual([null, null]);
  const zero = run({ ...base, systemCost: { ...cost, value: 0 } });
  expect(zero.payback!.years).toBe(0); expect(zero.roiPercent).toBeNull();
  expect(run({ ...base, tariff: { ...base.tariff!, value: 0 }, systemCost: cost }).payback!.years).toBeNull();
});
it('CO2 scales with all generation, independently of tariff and self-consumption', () => {
  const co2 = (value: number) => calculateEconomics(physical, { lifetimeYears: 2, degradation: { value: 0.01, source } }, { gridFactor: { value, unit: 'kgCO2e/kWh', source } });
  const a = co2(0.4), b = co2(0.8);
  expect(a.firstYearSavings).toBeNull(); expect(a.firstYearCo2!.value).toBeCloseTo(physical.annualElectricalKwh * 0.4);
  expect(b.firstYearCo2!.value).toBeCloseTo(a.firstYearCo2!.value * 2);
  expect(a.lifetimeCo2!.value).toBeCloseTo(a.firstYearCo2!.value * 1.99);
  expect(co2(0).firstYearCo2!.scenarioEnvelope).toEqual([0, 0]);
});
it('propagates separate physical and economic endpoint scenarios without claiming a CI', () => {
  const r = calculateEconomics(physical, { ...base,
    tariff: { ...base.tariff!, range: [0.1, 0.3] }, compensatedFraction: { value: 0.5, range: [0.4, 0.6], source },
    degradation: { value: 0.01, range: [0, 0.02], source }, tariffEscalation: { value: 0, range: [-0.01, 0.01], source },
    systemCost: { value: 1000, range: [900, 1100], unit: 'currency', currency: 'USD', source } },
    { gridFactor: { value: 0.4, range: [0.3, 0.5], unit: 'kgCO2e/kWh', source } });
  const s = r.firstYearSavings!;
  expect(s.scenarioEnvelope[0]).toBeCloseTo(physical.uncertainty.energyScenarioEnvelopeKwh[0] * 0.1 * 0.4);
  expect(s.scenarioEnvelope[1]).toBeCloseTo(physical.uncertainty.energyScenarioEnvelopeKwh[1] * 0.3 * 0.6);
  expect(r.annual[1]!.savings!.scenarioEnvelope[0]).toBeCloseTo(s.scenarioEnvelope[0] * 0.98 * 0.99);
  expect(s.radiationOnlyConditionalInterval[0]).toBeCloseTo(physical.uncertainty.radiationOnlyConditionalIntervalKwh[0] * 0.1);
  expect(s.physicalOnlyScenarioEnvelope[0]).toBeGreaterThan(s.scenarioEnvelope[0]);
  expect(r.uncertainty.physical).toEqual(physical.uncertainty); expect(r.uncertainty.confidenceLevel).toBeNull();
  expect(r.firstYearCo2!.scenarioEnvelope[1]).toBeCloseTo(physical.uncertainty.energyScenarioEnvelopeKwh[1] * 0.5);
  expect(r.roiPercent!.scenarioEnvelope[0]).toBeCloseTo((r.lifetimeSavings!.scenarioEnvelope[0] / 1100 - 1) * 100);
  expect(JSON.parse(JSON.stringify(r))).toEqual(r);
});
it.each([NaN, Infinity, -1])('rejects invalid tariffs %s', value => {
  expect(() => run({ ...base, tariff: { ...base.tariff!, value } })).toThrow();
});
it('validates ranges, currency, source and horizon', () => {
  expect(() => run({ ...base, tariff: { ...base.tariff!, range: [0.3, 0.4] } })).toThrow();
  expect(() => run({ ...base, tariff: { ...base.tariff!, source: '' } })).toThrow();
  expect(() => run({ ...base, systemCost: { value: 100, currency: 'EUR', unit: 'currency', source } })).toThrow('CURRENCY');
  expect(() => run({ ...base, lifetimeYears: 101 })).toThrow('LIFETIME');
  expect(() => run({ ...base, lifetimeYears: 1.5 })).toThrow('LIFETIME');
  expect(run()).toEqual(run());
});
it('preserves inputs, handles zero generation and rejects arithmetic overflow', () => {
  const before = JSON.stringify({ physical, base }); run();
  expect(JSON.stringify({ physical, base })).toBe(before);
  const zero = calculateEconomics({ ...physical, annualElectricalKwh: 0, uncertainty: { ...physical.uncertainty,
    energyScenarioEnvelopeKwh: [0, 0], radiationOnlyConditionalIntervalKwh: [0, 0] } }, base);
  expect(zero.firstYearSavings!.scenarioEnvelope).toEqual([0, 0]);
  expect(() => run({ ...base, tariff: { ...base.tariff!, value: Number.MAX_VALUE } })).toThrow('OVERFLOW');
});
