import type { ElevationOptions, ElevationResult } from './elevation.js';
import type { PanelLayoutResult } from './types.js';

export interface PhysicalOptions {
  /** Caller-supplied representative daylight values, not annual irradiation divided by 8760. */
  ambientTemperatureC?: number;
  representativePoaWm2?: number;
  noctC?: number;
  /** NMOT is module temperature: a separate module-to-cell delta must be supplied. */
  nmotC?: number;
  moduleToCellDeltaC?: number;
  temperatureCoefficientPerC?: number;
  /** Retained-energy factors in [0,1]. */
  inverterEfficiency?: number;
  wiringFactor?: number;
  mismatchFactor?: number;
  availabilityFactor?: number;
  soilingFactor?: number;
  shadingFactor?: number;
  /** Only adjust temperature for altitude when source climate elevation is known. */
  climateReferenceElevationM?: number;
  lapseRateCPerM?: number;
  source?: string;
  elevation?: ElevationOptions;
}
export interface PhysicalResult {
  annualElectricalKwh: number;
  poaKwhPerM2PerYear: number;
  installedDcCapacityKw: number;
  moduleCoveredAreaM2: number;
  equivalentStcHours: number;
  ambientTemperatureC: number;
  cellTemperatureC: number;
  elevationTemperatureAdjustmentC: number;
  elevationIrradiationFactor: 1;
  temperatureFactor: number;
  baselineFactor: number;
  soilingFactor: number;
  shadingFactor: number;
  performanceRatio: number;
  factors: { inverter: number; wiring: number; mismatch: number; availability: number };
  inputs: { representativePoaWm2: number; nominalCellOperatingTemperatureC: number; temperatureCoefficientPerC: number };
  uncertainty: { status: 'provisional'; energyScenarioEnvelopeKwh: [number, number]; orientationAllowance: number;
    physicalAllowance: number; elevationAllowance: number;
    /** Upstream interval scaled with ALL downstream inputs fixed, not total system CI. */
    radiationOnlyConditionalIntervalKwh: [number, number];
    calibrationStatus: 'not-empirically-calibrated';
    components: { id: string; basis: 'upstream-model' | 'provisional-allowance'; description: string }[];
  };
  inputProvenance: { parameter: string; value: number; basis: 'caller-supplied' | 'reference-assumption'; source: string }[];
  assumptions: string[];
  warnings: string[];
  sources: string[];
}
export function validatePhysical(options: PhysicalOptions): void {
  if (options.source !== undefined && typeof options.source !== 'string') throw new Error('INVALID_PHYSICAL_INPUT: source');
  const ranges: Record<string, [number, number]> = {
    ambientTemperatureC: [-80, 70], representativePoaWm2: [1, 1500], noctC: [20, 80], nmotC: [20, 80],
    moduleToCellDeltaC: [0, 20], temperatureCoefficientPerC: [-0.01, 0],
    climateReferenceElevationM: [-500, 9000], lapseRateCPerM: [-0.02, 0.02],
    inverterEfficiency: [0, 1], wiringFactor: [0, 1], mismatchFactor: [0, 1], availabilityFactor: [0, 1],
    soilingFactor: [0, 1], shadingFactor: [0, 1],
  };
  for (const [key, [low, high]] of Object.entries(ranges)) {
    const value = options[key as keyof PhysicalOptions];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high)) throw new Error(`INVALID_PHYSICAL_INPUT: ${key}`);
  }
  if (options.nmotC !== undefined && (options.noctC !== undefined || options.moduleToCellDeltaC === undefined)) throw new Error('NMOT_REQUIRES_CELL_DELTA_AND_NO_NOCT');
  if (options.moduleToCellDeltaC !== undefined && options.nmotC === undefined) throw new Error('CELL_DELTA_REQUIRES_NMOT');
  if ((options.climateReferenceElevationM === undefined) !== (options.lapseRateCPerM === undefined)) throw new Error('ELEVATION_TEMPERATURE_REQUIRES_REFERENCE_AND_LAPSE_RATE');
  if (options.climateReferenceElevationM !== undefined && options.ambientTemperatureC === undefined) throw new Error('ELEVATION_TEMPERATURE_REQUIRES_CLIMATE_INPUT');
  if (options.elevation?.google && (!options.elevation.google.apiKey || options.elevation.google.quotaCapConfirmed !== true)) throw new Error('GOOGLE_QUOTA_CONFIRMATION_REQUIRED');
}

/** NOCT reference conditions (800 W/m², 20 C ambient) and linear Pmp temperature
 * scaling: https://pvpmc.sandia.gov/modeling-guide/2-dc-module-iv/point-value-models/pvwatts/
 * This annual representative-condition approximation is NOT full hourly PVWatts.
 */
export function calculatePhysicalEnergy(layout: PanelLayoutResult, radiation: { kWh_per_m2_per_year: number; uncertainty_ci_90: [number, number] },
  elevation: ElevationResult, options: PhysicalOptions = {}): PhysicalResult {
  validatePhysical(options);
  const assumptions: string[] = [];
  const inputProvenance: PhysicalResult['inputProvenance'] = [];
  function supplied(value: number | undefined, fallback: number, label: string): number {
    if (value === undefined) assumptions.push(`${label}: assumed ${fallback}; engineering reference scenario, not observed local data.`);
    inputProvenance.push({ parameter: label, value: value ?? fallback,
      basis: value === undefined ? 'reference-assumption' : 'caller-supplied',
      source: value === undefined ? 'Economics engineering reference scenario; not local or manufacturer data'
        : options.source?.trim() || 'Caller supplied; source and measurement accuracy unverified' });
    return value ?? fallback;
  }
  const ambient = supplied(options.ambientTemperatureC, 20, 'Ambient temperature C');
  const poa = supplied(options.representativePoaWm2, 800, 'Representative operating POA W/m²');
  const nominal = options.nmotC !== undefined ? options.nmotC + options.moduleToCellDeltaC! : supplied(options.noctC, 45, 'NOCT C');
  if (options.nmotC !== undefined) {
    supplied(options.nmotC, 0, 'NMOT C');
    supplied(options.moduleToCellDeltaC, 0, 'Nominal module-to-cell delta C');
  }
  if (options.climateReferenceElevationM !== undefined) {
    supplied(options.climateReferenceElevationM, 0, 'Climate reference elevation m');
    supplied(options.lapseRateCPerM, 0, 'Climate lapse rate C/m');
  }
  const gamma = supplied(options.temperatureCoefficientPerC, -0.004, 'Module Pmp fractional temperature coefficient /C');
  const factors = {
    inverter: supplied(options.inverterEfficiency, 0.96, 'Inverter efficiency'),
    wiring: supplied(options.wiringFactor, 0.98, 'Wiring retained fraction'),
    mismatch: supplied(options.mismatchFactor, 0.98, 'Mismatch retained fraction'),
    availability: supplied(options.availabilityFactor, 0.99, 'Availability retained fraction'),
  };
  const soil = supplied(options.soilingFactor, 1, 'Soiling retained fraction (unknown aridity/cleaning; no inferred local loss)'),
    shade = supplied(options.shadingFactor, 1, 'Shading retained fraction (tap mapping unavailable)');
  const adjustment = elevation.meters !== null && options.climateReferenceElevationM !== undefined
    ? (elevation.meters - options.climateReferenceElevationM) * options.lapseRateCPerM! : 0;
  const cell = ambient + adjustment + (nominal - 20) * poa / 800;
  const tempFactor = Math.max(0, 1 + gamma * (cell - 25));
  const baseline = Object.values(factors).reduce((p, f) => p * f, 1);
  const pr = baseline * tempFactor * soil * shade;
  const kwh = radiation.kWh_per_m2_per_year * layout.installedDcCapacityKw * pr;
  // Provisional scenario expansions, not independent statistical sigmas or a calibrated 90% CI.
  const physicalAllowance = assumptions.length ? 0.30 : 0.10;
  const elevationAllowance = elevation.meters === null ? 0.10 : 0.02;
  const orientationAllowance = 0.25;
  assumptions.push('Scenario allowances are uncalibrated engineering choices: 25% orientation; 30% physical if any default is used, otherwise 10%; elevation 10% unresolved or 2% resolved. These are not measured errors or statistical confidence levels.');
  const conversion = layout.installedDcCapacityKw * pr;
  return { annualElectricalKwh: kwh, poaKwhPerM2PerYear: radiation.kWh_per_m2_per_year,
    installedDcCapacityKw: layout.installedDcCapacityKw, moduleCoveredAreaM2: layout.moduleCoveredAreaM2,
    equivalentStcHours: radiation.kWh_per_m2_per_year / 1, ambientTemperatureC: ambient, cellTemperatureC: cell,
    elevationTemperatureAdjustmentC: adjustment, elevationIrradiationFactor: 1,
    temperatureFactor: tempFactor, baselineFactor: baseline, soilingFactor: soil, shadingFactor: shade,
    performanceRatio: pr, factors, inputs: { representativePoaWm2: poa, nominalCellOperatingTemperatureC: nominal, temperatureCoefficientPerC: gamma },
    inputProvenance,
    uncertainty: { status: 'provisional', calibrationStatus: 'not-empirically-calibrated',
      radiationOnlyConditionalIntervalKwh: [radiation.uncertainty_ci_90[0] * conversion, radiation.uncertainty_ci_90[1] * conversion],
      components: [
        { id: 'radiation', basis: 'upstream-model', description: 'Upstream p5/p95 propagated with fixed capacity and PR. Upstream model uncertainty is not empirical coverage validation.' },
        { id: 'orientation', basis: 'provisional-allowance', description: '25% allowance: actual roof orientation is still unknown.' },
        { id: 'physical', basis: 'provisional-allowance', description: '30% with reference defaults, 10% otherwise. Input completeness is not evidence of measurement precision; neither allowance is calibrated.' },
        { id: 'elevation', basis: 'provisional-allowance', description: '10% unresolved or 2% resolved; source resolution and datum errors have not been calibrated.' },
      ],
      orientationAllowance, physicalAllowance, elevationAllowance,
      energyScenarioEnvelopeKwh: [radiation.uncertainty_ci_90[0] * conversion * (1 - orientationAllowance) * (1 - physicalAllowance) * (1 - elevationAllowance),
        radiation.uncertainty_ci_90[1] * conversion * (1 + orientationAllowance) * (1 + physicalAllowance) * (1 + elevationAllowance)] },
    assumptions, warnings: ['Annual representative-condition thermal approximation; monthly/hourly climate is unavailable.',
      'No additional irradiation elevation uplift: all-sky source terrain effects must not be counted twice.',
      ...(options.climateReferenceElevationM === undefined ? ['No source climate elevation/lapse rate supplied; altitude temperature adjustment is skipped.'] : []),
      ...(options.soilingFactor === undefined ? ['Aridity/soiling unknown; neutral central factor and wider provisional envelope.'] : []),
      ...(options.shadingFactor === undefined ? ['shadingTap is descriptive until a validated mapping exists; explicit shadingFactor is supported.'] : []),
      'No battery, inverter clipping, hourly dispatch, panel aging, or roof-plane validation.'],
    sources: [options.source?.trim() || 'Caller values without external verification; unspecified values use disclosed engineering assumptions.',
      'https://pvpmc.sandia.gov/modeling-guide/2-dc-module-iv/point-value-models/pvwatts/',
      'https://pvpmc.sandia.gov/app/uploads/sites/243/2022/10/2010_PVMC-Workshop-Report_SAND2011-3419.pdf'],
  };
}
