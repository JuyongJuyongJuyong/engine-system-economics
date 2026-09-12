import { expect, it } from 'vitest';
import { calculatePhysicalEnergy, type PhysicalOptions } from './physical';
import type { PanelLayoutResult } from './types';
import type { ElevationResult } from './elevation';
const layout = { installedDcCapacityKw: 4, moduleCoveredAreaM2: 20 } as PanelLayoutResult;
const radiation = { kWh_per_m2_per_year: 1500, uncertainty_ci_90: [1300, 1700] as [number, number] };
const elevation: ElevationResult = { meters: 100, source: 'fixture', status: 'resolved', cached: false,
  lookupLocation: { lat: 0, lng: 0 }, attempts: [], warnings: [] };
const physical: PhysicalOptions = { ambientTemperatureC: 20, representativePoaWm2: 800, noctC: 45,
  temperatureCoefficientPerC: -0.004, inverterEfficiency: 1, wiringFactor: 1, mismatchFactor: 1,
  availabilityFactor: 1, soilingFactor: 1, shadingFactor: 1 };
it('implements NOCT conditions and rated-capacity scaling without double-counting efficiency', () => {
  const r = calculatePhysicalEnergy(layout, radiation, elevation, physical);
  expect(r.cellTemperatureC).toBe(45); expect(r.performanceRatio).toBeCloseTo(0.92);
  expect(r.annualElectricalKwh).toBeCloseTo(5520);
});
it('temperature, shading and explicit soiling reduce generation', () => {
  const base = calculatePhysicalEnergy(layout, radiation, elevation, physical);
  expect(calculatePhysicalEnergy(layout, radiation, elevation, { ...physical, ambientTemperatureC: 30 }).annualElectricalKwh).toBeLessThan(base.annualElectricalKwh);
  expect(calculatePhysicalEnergy(layout, radiation, elevation, { ...physical, shadingFactor: 0.5 }).annualElectricalKwh).toBeCloseTo(base.annualElectricalKwh / 2);
  expect(calculatePhysicalEnergy(layout, radiation, elevation, { ...physical, soilingFactor: 0.9 }).annualElectricalKwh).toBeCloseTo(base.annualElectricalKwh * 0.9);
});
it('resolves NMOT using an explicit module-to-cell offset', () => {
  expect(calculatePhysicalEnergy(layout, radiation, elevation, { nmotC: 42, moduleToCellDeltaC: 3 }).cellTemperatureC).toBe(45);
  expect(() => calculatePhysicalEnergy(layout, radiation, elevation, { nmotC: 42 })).toThrow('NMOT');
});
it('only applies elevation to climate with explicit reference and lapse rate', () => {
  const r = calculatePhysicalEnergy(layout, radiation, elevation, { ...physical, climateReferenceElevationM: 0, lapseRateCPerM: -0.0065 });
  expect(r.elevationTemperatureAdjustmentC).toBe(-0.65);
  expect(r.elevationIrradiationFactor).toBe(1);
  expect(calculatePhysicalEnergy(layout, radiation, elevation, physical).elevationTemperatureAdjustmentC).toBe(0);
});
it('missing elevation widens uncertainty and preserves a finite estimate', () => {
  const a = calculatePhysicalEnergy(layout, radiation, elevation, physical);
  const b = calculatePhysicalEnergy(layout, radiation, { ...elevation, meters: null, status: 'unavailable' }, physical);
  expect(b.annualElectricalKwh).toBe(a.annualElectricalKwh);
  expect(b.uncertainty.energyScenarioEnvelopeKwh[0]).toBeLessThan(a.uncertainty.energyScenarioEnvelopeKwh[0]);
  expect(b.uncertainty.energyScenarioEnvelopeKwh[1]).toBeGreaterThan(a.uncertainty.energyScenarioEnvelopeKwh[1]);
});
it('missing climate is explicit and widens the provisional envelope', () => {
  const r = calculatePhysicalEnergy(layout, radiation, elevation);
  expect(r.assumptions.some(a => a.includes('Ambient'))).toBe(true);
  expect(r.uncertainty.physicalAllowance).toBeGreaterThan(calculatePhysicalEnergy(layout, radiation, elevation, physical).uncertainty.physicalAllowance);
  expect(r.uncertainty.orientationAllowance).toBe(0.25);
});
it('zero capacity and zero retained factor produce zero energy', () => {
  expect(calculatePhysicalEnergy({ ...layout, installedDcCapacityKw: 0 }, radiation, elevation).annualElectricalKwh).toBe(0);
  expect(calculatePhysicalEnergy(layout, radiation, elevation, { shadingFactor: 0 }).annualElectricalKwh).toBe(0);
});
it('rejects invalid physical factors', () => {
  expect(() => calculatePhysicalEnergy(layout, radiation, elevation, { shadingFactor: 1.1 })).toThrow('INVALID_PHYSICAL_INPUT');
  expect(() => calculatePhysicalEnergy(layout, radiation, elevation, { ambientTemperatureC: NaN })).toThrow('INVALID_PHYSICAL_INPUT');
});
