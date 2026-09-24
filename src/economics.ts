import type { PhysicalResult } from './physical.js';

/** Bounds are caller-justified scenarios, not a probability distribution or CI. */
export interface SourcedValue { value: number; source: string; range?: [number, number] }
export interface EconomicsOptions {
  tariff?: SourcedValue & { currency: string; unit: 'currency/kWh' };
  systemCost?: SourcedValue & { currency: string; unit: 'currency' };
  compensatedFraction?: SourcedValue;
  netMetering?: { kind: 'true-one-to-one'; verified: true; source: string };
  lifetimeYears?: number;
  degradation?: SourcedValue;
  tariffEscalation?: SourcedValue;
}
export interface EmissionsOptions {
  gridFactor: SourcedValue & { unit: 'kgCO2e/kWh' };
}
export interface ScenarioMetric {
  value: number;
  unit: string;
  scenarioEnvelope: [number, number];
  radiationOnlyConditionalInterval: [number, number];
  physicalOnlyScenarioEnvelope: [number, number];
}
export interface AnnualEconomics {
  year: number;
  energy: ScenarioMetric;
  savings: ScenarioMetric | null;
  avoidedEmissions: ScenarioMetric | null;
}
export interface EconomicsResult {
  firstYearSavings: ScenarioMetric | null;
  firstYearCo2: ScenarioMetric | null;
  lifetimeSavings: ScenarioMetric | null;
  lifetimeCo2: ScenarioMetric | null;
  annual: AnnualEconomics[];
  roiPercent: { value: number; scenarioEnvelope: [number, number] } | null;
  payback: { years: number | null; status: 'within-horizon' | 'not-within-horizon'; scenarioYears: [number | null, number | null] } | null;
  compensatedFraction: SourcedValue | null;
  uncertainty: { status: 'provisional'; method: 'deterministic-endpoint-scenarios'; physical: PhysicalResult['uncertainty']; economicInputs: Record<string, SourcedValue>; confidenceLevel: null };
  assumptions: string[];
  provenance: { id: string; description: string }[];
  warnings: string[];
}
function check(x: SourcedValue | undefined, name: string, min: number, max = Number.MAX_VALUE) {
  if (!x) return;
  if (!Number.isFinite(x.value) || x.value < min || x.value > max || typeof x.source !== 'string' || !x.source.trim() ||
      (x.range !== undefined && (!Array.isArray(x.range) || x.range.length !== 2 || !x.range.every(Number.isFinite) || x.range[0] < min || x.range[1] > max || x.range[0] > x.value || x.range[1] < x.value))) throw new Error(`INVALID_ECONOMICS_${name}`);
}
export function validateEconomics(o: EconomicsOptions = {}, emissions?: EmissionsOptions, powerAccess = 'grid-tied') {
  check(o.tariff, 'TARIFF', 0); check(o.systemCost, 'COST', 0);
  check(o.compensatedFraction, 'FRACTION', 0, 1); check(o.degradation, 'DEGRADATION', 0, 1);
  check(o.tariffEscalation, 'ESCALATION', -1, 1); check(emissions?.gridFactor, 'EMISSIONS', 0);
  if (emissions && (!emissions.gridFactor || emissions.gridFactor.unit !== 'kgCO2e/kWh')) throw new Error('INVALID_EMISSIONS_UNIT');
  if (o.tariff && (o.tariff.unit !== 'currency/kWh' || !/^[A-Z]{3}$/.test(o.tariff.currency))) throw new Error('INVALID_TARIFF_UNIT');
  if (o.systemCost && (o.systemCost.unit !== 'currency' || !/^[A-Z]{3}$/.test(o.systemCost.currency))) throw new Error('INVALID_COST_UNIT');
  if (o.tariff && o.systemCost && o.tariff.currency !== o.systemCost.currency) throw new Error('CURRENCY_MISMATCH');
  if (o.lifetimeYears !== undefined && (!Number.isInteger(o.lifetimeYears) || o.lifetimeYears < 1 || o.lifetimeYears > 100)) throw new Error('INVALID_LIFETIME');
  if (o.netMetering && (o.netMetering.kind !== 'true-one-to-one' || o.netMetering.verified !== true || !o.netMetering.source?.trim() || powerAccess !== 'grid-tied')) throw new Error('INVALID_NET_METERING');
}
const bounds = (v: SourcedValue): [number, number] => v.range ?? [v.value, v.value];
const categoryValues = { 'mostly-out': 0.3, mixed: 0.5, 'mostly-home': 0.7 };
/** Pure, provider-independent annual cash-flow scenarios; no network calls. */
export function calculateEconomics(physical: PhysicalResult, options: EconomicsOptions = {}, emissions?: EmissionsOptions,
  category?: keyof typeof categoryValues, powerAccess = 'grid-tied'): EconomicsResult {
  validateEconomics(options, emissions, powerAccess);
  const assumptions = ['Undiscounted gross bill offsets: no financing, maintenance, replacement, tax, incentives, fixed charges or time-of-use modeling.',
    'Uncompensated exports have zero monetary value. Fraction is an annual energy-weighted assumption, not an hourly load simulation.',
    'Grid-displacement emissions use all generated electricity and a constant factor; no curtailment or lifecycle embodied-carbon accounting.'];
  const warnings = ['Scenario envelopes are provisional, not calibrated confidence intervals; absent input ranges mean held fixed, not known exactly.'];
  const years = options.lifetimeYears ?? 25;
  const degradation = options.degradation ?? { value: 0.0065, range: [0.005, 0.008] as [number, number], source: 'Project 0.5–0.8%/year assumption; midpoint, not module-specific calibration' };
  const escalation = options.tariffEscalation ?? { value: 0, source: 'Flat nominal tariff scenario; no regional escalation evidence supplied' };
  if (options.lifetimeYears === undefined) assumptions.push('Analysis horizon defaults to 25 years, an analysis choice rather than a service-life guarantee.');
  if (!options.degradation) assumptions.push(degradation.source);
  if (!options.tariffEscalation) assumptions.push(escalation.source);
  let fraction: SourcedValue | null = options.compensatedFraction ?? null;
  if (options.netMetering) {
    fraction = { value: 1, source: options.netMetering.source };
    assumptions.push('Caller verifies unlimited true annual 1:1 compensation for all generation; overrides self-consumption. Caps/expiry must be ruled out by caller.');
  } else if (!fraction && category) {
    const value = categoryValues[category];
    fraction = { value, range: [value - 0.1, value + 0.1], source: `Provisional category mapping ${category}; illustrative ±0.10 scenario, not measured household behavior` };
    assumptions.push(fraction.source);
  }
  if (powerAccess !== 'grid-tied') warnings.push('No grid displacement or bill offset is verified for this power-access mode; explicit inputs do not establish a real counterfactual.');
  if (!options.tariff || !fraction) warnings.push('Savings unavailable: supply tariff and a compensated fraction/category or verified net metering.');
  if (!emissions) warnings.push('CO2 unavailable: no explicit grid-emissions factor.');
  if (!options.systemCost) warnings.push('ROI/payback unavailable: no explicit system cost.');
  const inputs: Record<string, SourcedValue> = { degradation, tariffEscalation: escalation };
  if (fraction) inputs.compensatedFraction = fraction;
  if (options.tariff) inputs.tariff = options.tariff;
  if (options.systemCost) inputs.systemCost = options.systemCost;
  if (emissions) inputs.emissionsFactor = emissions.gridFactor;
  const d = bounds(degradation), e = bounds(escalation);
  const energy = physical.annualElectricalKwh;
  const envelope = physical.uncertainty.energyScenarioEnvelopeKwh;
  const radiation = physical.uncertainty.radiationOnlyConditionalIntervalKwh;
  function metric(multiplier: number, low: number, high: number, unit: string): ScenarioMetric {
    const result: ScenarioMetric = { value: energy * multiplier, unit,
      scenarioEnvelope: [envelope[0] * low, envelope[1] * high],
      radiationOnlyConditionalInterval: [radiation[0] * multiplier, radiation[1] * multiplier],
      physicalOnlyScenarioEnvelope: [envelope[0] * multiplier, envelope[1] * multiplier] };
    if (![result.value, ...result.scenarioEnvelope, ...result.radiationOnlyConditionalInterval, ...result.physicalOnlyScenarioEnvelope].every(Number.isFinite)) throw new Error('ECONOMICS_NUMERIC_OVERFLOW');
    return result;
  }
  const annual: AnnualEconomics[] = [];
  for (let y = 0; y < years; y++) {
    const decay = (1 - degradation.value) ** y, dl = (1 - d[1]) ** y, dh = (1 - d[0]) ** y;
    let savings: ScenarioMetric | null = null;
    if (options.tariff && fraction) {
      const t = bounds(options.tariff), f = bounds(fraction);
      savings = metric(decay * options.tariff.value * fraction.value * (1 + escalation.value) ** y,
        dl * t[0] * f[0] * (1 + e[0]) ** y, dh * t[1] * f[1] * (1 + e[1]) ** y, options.tariff.currency);
    }
    const g = emissions ? bounds(emissions.gridFactor) : null;
    annual.push({ year: y + 1, energy: metric(decay, dl, dh, 'kWh'), savings,
      avoidedEmissions: emissions && g ? metric(decay * emissions.gridFactor.value, dl * g[0], dh * g[1], 'kgCO2e') : null });
  }
  function total(key: 'savings' | 'avoidedEmissions'): ScenarioMetric | null {
    const first = annual[0]![key];
    if (!first) return null;
    const result: ScenarioMetric = { value: 0, unit: first.unit, scenarioEnvelope: [0, 0], radiationOnlyConditionalInterval: [0, 0], physicalOnlyScenarioEnvelope: [0, 0] };
    for (const row of annual) {
      const m = row[key]!; result.value += m.value;
      for (const k of ['scenarioEnvelope', 'radiationOnlyConditionalInterval', 'physicalOnlyScenarioEnvelope'] as const) {
        result[k][0] += m[k][0]; result[k][1] += m[k][1];
      }
    }
    if (![result.value, ...result.scenarioEnvelope].every(Number.isFinite)) throw new Error('ECONOMICS_NUMERIC_OVERFLOW');
    return result;
  }
  const lifetimeSavings = total('savings');
  let roiPercent: EconomicsResult['roiPercent'] = null, payback: EconomicsResult['payback'] = null;
  if (options.systemCost && lifetimeSavings) {
    const cost = options.systemCost, c = bounds(cost);
    function crossing(target: number, mode: 'central' | 'low' | 'high'): number | null {
      if (target === 0) return 0;
      let cumulative = 0;
      for (const row of annual) {
        const s = row.savings!, value = mode === 'central' ? s.value : s.scenarioEnvelope[mode === 'low' ? 0 : 1];
        if (value > 0 && cumulative + value >= target) return row.year - 1 + (target - cumulative) / value;
        cumulative += value;
      }
      return null;
    }
    const p = crossing(cost.value, 'central');
    payback = { years: p, status: p === null ? 'not-within-horizon' : 'within-horizon', scenarioYears: [crossing(c[0], 'high'), crossing(c[1], 'low')] };
    if (c[0] > 0) {
      roiPercent = { value: (lifetimeSavings.value / cost.value - 1) * 100,
        scenarioEnvelope: [(lifetimeSavings.scenarioEnvelope[0] / c[1] - 1) * 100, (lifetimeSavings.scenarioEnvelope[1] / c[0] - 1) * 100] };
      if (![roiPercent.value, ...roiPercent.scenarioEnvelope].every(Number.isFinite)) throw new Error('ECONOMICS_NUMERIC_OVERFLOW');
    } else warnings.push('ROI undefined when system-cost central value or scenario lower bound is zero.');
  }
  return { firstYearSavings: annual[0]!.savings, firstYearCo2: annual[0]!.avoidedEmissions, lifetimeSavings, lifetimeCo2: total('avoidedEmissions'), annual,
    roiPercent, payback, compensatedFraction: fraction, assumptions, warnings,
    provenance: Object.entries(inputs).map(([id, v]) => ({ id, description: `${v.value}; ${v.source}; scenario bounds: ${bounds(v).join(', ')}` })),
    uncertainty: { status: 'provisional', method: 'deterministic-endpoint-scenarios', physical: physical.uncertainty, economicInputs: inputs, confidenceLevel: null } };
}
