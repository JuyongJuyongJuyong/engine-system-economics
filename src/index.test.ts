import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRadiationEstimate } from 'engine-radiation-uncertainty';
import { getSystemEconomics, type SystemEconomicsInput } from './index';
vi.mock('./elevation', () => ({ resolveElevation: vi.fn(async () => ({
  meters: null, source: null, status: 'unavailable', cached: false, lookupLocation: { lat: 37.5, lng: 127 },
  attempts: [], warnings: ['Elevation unavailable'],
})) }));

vi.mock('engine-radiation-uncertainty', () => ({ getRadiationEstimate: vi.fn() }));
const mock = vi.mocked(getRadiationEstimate);
const radiation = { kWh_per_m2_per_year: 1500, uncertainty_ci_90: [1300, 1700] as [number, number] };
function input(): SystemEconomicsInput {
  return {
    roofPolygon: [[37.5, 127], [37.5001, 127], [37.5001, 127.0002], [37.5, 127.0002]],
    location: { lat: 37.50005, lng: 127.0001 }, radiationTier: 1,
    roofMetadata: { shape: 'flat', material: 'concrete', shadingTap: 0 }, powerAccess: 'grid-tied',
  };
}
beforeEach(() => { mock.mockReset(); mock.mockResolvedValue(radiation); });

describe('v1 foundation contract', () => {
  it('integrates sourced economics without changing Radiation forwarding or physical provenance', async () => {
    const result = await getSystemEconomics({ ...input(), selfConsumption: 'mixed', layout: {
      panel: { widthM: 1, lengthM: 2, ratedPowerW: 400 }, edgeClearanceM: 0.2,
    }, economics: { tariff: { value: 0.2, currency: 'USD', unit: 'currency/kWh', source: 'fixture' } },
    emissions: { gridFactor: { value: 0.4, unit: 'kgCO2e/kWh', source: 'fixture' } } });
    expect(result.savings!.value).toBeCloseTo(result.kWh! * 0.1);
    expect(result.co2!.value).toBeCloseTo(result.kWh! * 0.4);
    expect(result.status).toBe('economics-estimate');
    expect(result.uncertainty_ci_90).toBeNull();
    expect(result.economics!.uncertainty.physical).toEqual(result.physical!.uncertainty);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith({ ...input().location, tier: 1 });
  });
  it('rejects invalid economics before network calls', async () => {
    await expect(getSystemEconomics({ ...input(), economics: { lifetimeYears: 0 } })).rejects.toThrow('LIFETIME');
    expect(mock).not.toHaveBeenCalled();
  });
  it('calculates optional layout while preserving the one canonical Radiation call', async () => {
    const value = input();
    const result = await getSystemEconomics({ ...value, layout: {
      panel: { widthM: 1, lengthM: 2, ratedPowerW: 400 }, edgeClearanceM: 0.2,
    } });
    expect(result.layout!.panelCount).toBeGreaterThan(0);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith({ ...value.location, tier: 1 });
    expect(result.kWh).toBeGreaterThan(0);
    expect(result.physical!.uncertainty.status).toBe('provisional');
  });
  it('rejects invalid layout before Radiation', async () => {
    await expect(getSystemEconomics({ ...input(), layout: {
      panel: { widthM: 0, lengthM: 2, ratedPowerW: 400 }, edgeClearanceM: 0,
    } })).rejects.toThrow('INVALID_LAYOUT_OPTIONS');
    expect(mock).not.toHaveBeenCalled();
  });
  it('returns a Promise and forwards exactly one canonical call, including the supplied location', async () => {
    const value = input();
    const result = getSystemEconomics(value);
    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith({ lat: value.location.lat, lng: value.location.lng, tier: 1 });
  });
  it.each([1, 2, 3] as const)('forwards radiationTier %s independently of dataTier', async tier => {
    const result = await getSystemEconomics({ ...input(), radiationTier: tier, dataTier: 3 });
    expect(mock.mock.calls[0]![0]).toEqual({ ...input().location, tier });
    expect(result.dataTier).toBe(3);
  });
  it('keeps absent dataTier unspecified and does not fabricate final metrics', async () => {
    const result = await getSystemEconomics(input());
    expect(result.dataTier).toBeNull();
    expect([result.kWh, result.savings, result.co2, result.uncertainty_ci_90]).toEqual([null, null, null, null]);
    expect(result.radiation).toEqual(radiation);
  });
  it.each(['flat', 'gable', 'unknown'] as const)('shape %s never generates planes or changes Radiation arguments', async shape => {
    const value = input(); value.roofMetadata.shape = shape;
    const result = await getSystemEconomics(value);
    expect(mock.mock.calls[0]![0]).toEqual({ ...value.location, tier: 1 });
    expect(result).not.toHaveProperty('planes');
    expect(result.assumptions.some(a => a.id === 'canonical-surface')).toBe(true);
  });
  it('widens the irradiation envelope without relabeling it as a calibrated system CI', async () => {
    const r = await getSystemEconomics(input());
    expect(r.uncertainty.orientationAdjustedIrradiationEnvelope[0]).toBeLessThan(1300);
    expect(r.uncertainty.orientationAdjustedIrradiationEnvelope[1]).toBeGreaterThan(1700);
    expect(r.uncertainty.status).toBe('provisional');
    expect(r.provenance.length).toBeGreaterThan(0);
  });
  it('propagates upstream failures without retrying', async () => {
    mock.mockRejectedValue(new Error('NASA unavailable'));
    await expect(getSystemEconomics(input())).rejects.toThrow('NASA unavailable');
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it.each([[NaN, 1700], [1800, 1700], [-1, 1700]])('rejects unusable upstream intervals %s', async (low, high) => {
    mock.mockResolvedValue({ ...radiation, uncertainty_ci_90: [low, high] });
    await expect(getSystemEconomics(input())).rejects.toThrow('INVALID_RADIATION_OUTPUT');
  });
});

describe('validation before network requests', () => {
  it('rejects a distant location without silently replacing it with a centroid', async () => {
    await expect(getSystemEconomics({ ...input(), location: { lat: 0, lng: 0 } })).rejects.toThrow('LOCATION_MISMATCH');
    expect(mock).not.toHaveBeenCalled();
  });
  it('accepts a boundary location', async () => {
    await expect(getSystemEconomics({ ...input(), location: { lat: 37.5, lng: 127 } })).resolves.toBeDefined();
  });
  it.each([NaN, Infinity, 91])('rejects invalid latitude %s', async lat => {
    await expect(getSystemEconomics({ ...input(), location: { lat, lng: 127 } })).rejects.toThrow('INVALID_COORDINATE');
    expect(mock).not.toHaveBeenCalled();
  });
  it('rejects invalid tiers at runtime', async () => {
    await expect(getSystemEconomics({ ...input(), radiationTier: 4 } as unknown as SystemEconomicsInput)).rejects.toThrow('INVALID_TIER');
    expect(mock).not.toHaveBeenCalled();
  });
  it('rejects self-intersections before area processing', async () => {
    const value = input();
    const [a, b, c, d] = value.roofPolygon;
    value.roofPolygon = [a!, c!, b!, d!];
    await expect(getSystemEconomics(value)).rejects.toThrow('SELF_INTERSECTION');
    expect(mock).not.toHaveBeenCalled();
  });
  it('accepts closed rings and never mutates caller coordinates', async () => {
    const value = input(); value.roofPolygon.push([...value.roofPolygon[0]!]);
    const before = JSON.stringify(value);
    const r = await getSystemEconomics(value);
    expect(r.geometry.polygon).toHaveLength(4);
    expect(JSON.stringify(value)).toBe(before);
  });
  it('area is invariant to winding and plausible for a roughly 11m by 18m footprint', async () => {
    const value = input();
    const a = await getSystemEconomics(value);
    const b = await getSystemEconomics({ ...value, roofPolygon: [...value.roofPolygon].reverse() });
    expect(a.geometry.footprintAreaM2).toBeCloseTo(b.geometry.footprintAreaM2, 4);
    expect(a.geometry.footprintAreaM2).toBeGreaterThan(190);
    expect(a.geometry.footprintAreaM2).toBeLessThan(205);
    expect(a.geometry.longestEdgeBearingDeg).toBeGreaterThanOrEqual(0);
    expect(a.geometry.longestEdgeBearingDeg).toBeLessThan(360);
  });
  it.each([
    { polygon: [[0, 0], [0, 0.001]] },
    { polygon: [[0, 0], [0, 0.001], [0, 0.002]] },
    { polygon: [[0, 0], [0, 0.001], [0.001, 0], [0, 0.001]] },
  ])('rejects degenerate polygons', async ({ polygon }) => {
    await expect(getSystemEconomics({ ...input(), roofPolygon: polygon as [number, number][] })).rejects.toThrow('INVALID_POLYGON');
    expect(mock).not.toHaveBeenCalled();
  });
});
