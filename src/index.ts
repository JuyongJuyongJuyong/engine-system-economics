import { getRadiationEstimate } from 'engine-radiation-uncertainty';
import { deriveGeometry } from './geometry.js';
import { calculatePanelLayout } from './layout.js';
import { calculatePhysicalEnergy, validatePhysical } from './physical.js';
import { resolveElevation } from './elevation.js';
import { calculateEconomics, validateEconomics } from './economics.js';
export { calculateEconomics } from './economics.js';
export type { EconomicsOptions, EmissionsOptions, EconomicsResult, SourcedValue, ScenarioMetric, AnnualEconomics } from './economics.js';
export type { PhysicalOptions, PhysicalResult } from './physical.js';
export type { ElevationOptions, ElevationResult } from './elevation.js';
export { calculatePanelLayout } from './layout.js';
export type { KeepOutZone, PanelLayoutOptions, PanelLayoutResult } from './types.js';
import type { SystemEconomicsInput, SystemEconomicsOutput } from './types.js';
export type { RoofMetadata, SystemEconomicsInput, SystemEconomicsOutput, Assumption } from './types.js';

/** Foundation API: exactly one canonical Radiation request after local validation. */
export async function getSystemEconomics(input: SystemEconomicsInput): Promise<SystemEconomicsOutput> {
  if (!input || !input.location || !input.roofMetadata) throw new Error('INVALID_INPUT: missing required fields');
  if (![1, 2, 3].includes(input.radiationTier) ||
      (input.dataTier !== undefined && ![1, 2, 3].includes(input.dataTier))) throw new Error('INVALID_TIER');
  if (!['flat', 'gable', 'unknown'].includes(input.roofMetadata.shape) ||
      typeof input.roofMetadata.material !== 'string' || !Number.isFinite(input.roofMetadata.shadingTap) ||
      !['grid-tied', 'generator-dependent', 'no-power'].includes(input.powerAccess) ||
      (input.selfConsumption !== undefined && !['mostly-out', 'mixed', 'mostly-home'].includes(input.selfConsumption))) {
    throw new Error('INVALID_METADATA');
  }
  const geometry = deriveGeometry(input);
  const layout = input.layout ? calculatePanelLayout(geometry.polygon, input.layout) : null;
  if (input.physical && !layout) throw new Error('PHYSICAL_MODEL_REQUIRES_LAYOUT');
  if (layout) validatePhysical(input.physical ?? {});
  validateEconomics(input.economics, input.emissions, input.powerAccess);
  const radiation = await getRadiationEstimate({
    lat: input.location.lat, lng: input.location.lng, tier: input.radiationTier,
  });
  const ci = radiation.uncertainty_ci_90;
  if (!Number.isFinite(radiation.kWh_per_m2_per_year) || radiation.kWh_per_m2_per_year <= 0 ||
      !Array.isArray(ci) || ci.length !== 2 || !ci.every(Number.isFinite) ||
      ci[0] < 0 || ci[0] > radiation.kWh_per_m2_per_year || ci[1] < radiation.kWh_per_m2_per_year) {
    throw new Error('INVALID_RADIATION_OUTPUT');
  }
  // Engineering scenario allowance only; no calibrated orientation distribution exists yet.
  // Separate from the upstream CI so it cannot masquerade as a system confidence interval.
  const allowance = 0.25;
  const elevation = layout ? await resolveElevation(input.location, input.radiationTier, input.physical?.elevation) : null;
  const physical = layout && elevation ? calculatePhysicalEnergy(layout, radiation, elevation, input.physical) : null;
  const economics = physical ? calculateEconomics(physical, input.economics, input.emissions, input.selfConsumption, input.powerAccess) : null;
  return {
    status: economics?.firstYearSavings || economics?.firstYearCo2 ? 'economics-estimate' : physical ? 'physical-estimate' : 'foundations-only',
    kWh: physical?.annualElectricalKwh ?? null, savings: economics?.firstYearSavings ?? null, co2: economics?.firstYearCo2 ?? null, uncertainty_ci_90: null,
    physical, elevation, economics,
    radiationTier: input.radiationTier, dataTier: input.dataTier ?? null, radiation, geometry, layout,
    uncertainty: {
      status: 'provisional', orientationRelativeAllowance: allowance,
      orientationAdjustedIrradiationEnvelope: [ci[0] * (1 - allowance), ci[1] * (1 + allowance)],
      pending: ['orientation calibration', ...(layout ? ['layout field validation'] : ['layout']),
        ...(physical ? ['thermal/climate calibration', 'system uncertainty calibration'] : ['physical model requires layout']),
        ...(elevation?.status === 'resolved' ? [] : ['elevation unresolved']),
        ...(economics?.firstYearSavings ? [] : ['tariff/compensation inputs']), ...(economics?.firstYearCo2 ? [] : ['CO2 factors'])],
    },
    assumptions: [
      ...(economics?.assumptions.map((description, i) => ({ id: `economics-${i}`, description, source: 'Disclosed deterministic economics scenario policy' })) ?? []),
      ...(physical?.assumptions.map((description, i) => ({ id: `physical-${i}`, description, source: 'Disclosed engineering reference scenario; not measured climate' })) ?? []),
      { id: 'canonical-surface', description: 'Radiation uses latitude tilt capped at 60 degrees and equator-facing azimuth; actual roof orientation is unknown.', source: 'engine-radiation-uncertainty@0.1.2 defaultSurfaceForLatitude' },
      { id: 'orientation-envelope', description: 'Expand upstream bounds by 25% on each side as a provisional scenario allowance, not a calibrated 90% confidence interval or guaranteed bound.', source: 'Economics v1 engineering assumption; requires validation' },
      { id: 'geometry-policy', description: 'Spherical horizontal footprint; shape is descriptive. Location must be within the polygon. No fabricated roof planes.', source: 'Finalized Economics v1 contract and foundation validation policy' },
    ],
    provenance: [
      ...(economics?.provenance.map(p => ({ id: `economics-${p.id}`, description: p.description })) ?? []),
      ...(physical?.inputProvenance.map((p, i) => ({ id: `physical-input-${i}`, description: `${p.parameter}: ${p.value}; ${p.basis}; ${p.source}` })) ?? []),
      ...(physical?.sources.map((description, i) => ({ id: `physical-${i}`, description })) ?? []),
      ...(elevation ? [{ id: 'elevation', description: `Source: ${elevation.source ?? 'unavailable'}; rounded location: ${elevation.lookupLocation.lat},${elevation.lookupLocation.lng}; cached: ${elevation.cached}` }] : []),
      { id: 'roof', description: 'Caller-supplied geographic polygon; measurement accuracy unknown.' },
      { id: 'radiation', description: 'engine-radiation-uncertainty@0.1.2; actual source/fallback metadata is not exported upstream.' },
    ],
    warnings: [
      ...(economics?.warnings.map(message => ({ code: 'ECONOMICS_LIMITATION', message })) ?? []),
      ...(physical?.warnings.map(message => ({ code: 'PHYSICAL_MODEL_LIMITATION', message })) ?? []),
      ...(elevation?.warnings.map(message => ({ code: 'ELEVATION_LIMITATION', message })) ?? []),
      ...geometry.warnings,
      ...(layout?.warnings ?? []),
      { code: 'CANONICAL_SURFACE', message: 'Irradiation describes a reference surface, not the actual roof.' },
      { code: 'INCOMPLETE_MODELS', message: 'Calibrated system confidence intervals are unavailable; energy requires layout and economics requires explicit data.' },
      { code: 'UNVALIDATED_UNCERTAINTY', message: 'The orientation envelope is provisional; system accuracy targets are not established by this result.' },
    ],
  };
}
