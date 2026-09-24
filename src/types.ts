import type { PhysicalOptions, PhysicalResult } from './physical.js';
import type { ElevationResult } from './elevation.js';
import type { EconomicsOptions, EmissionsOptions, EconomicsResult, ScenarioMetric } from './economics.js';
export interface RoofMetadata {
  shape: 'flat' | 'gable' | 'unknown';
  material: string;
  shadingTap: number;
}

export interface SystemEconomicsInput {
  roofPolygon: [number, number][];
  roofMetadata: RoofMetadata;
  location: { lat: number; lng: number };
  radiationTier: 1 | 2 | 3;
  dataTier?: 1 | 2 | 3;
  powerAccess: 'grid-tied' | 'generator-dependent' | 'no-power';
  selfConsumption?: 'mostly-out' | 'mixed' | 'mostly-home';
  /** Optional geometric layout; no module defaults or physical roof planes inferred. */
  layout?: PanelLayoutOptions;
  physical?: PhysicalOptions;
  economics?: EconomicsOptions;
  emissions?: EmissionsOptions;
}

export interface Assumption {
  id: string;
  description: string;
  source: string;
}

export interface SystemEconomicsOutput {
  status: 'foundations-only' | 'physical-estimate' | 'economics-estimate';
  /** Annual post-loss electrical estimate when layout exists. Never solar irradiation. */
  kWh: number | null;
  /** First-year gross savings; metric includes currency and scenario ranges. */
  savings: ScenarioMetric | null;
  /** First-year avoided grid emissions in kgCO2e, not lifecycle carbon. */
  co2: ScenarioMetric | null;
  economics: EconomicsResult | null;
  /** Reserved for final savings CI. */
  uncertainty_ci_90: null;
  radiationTier: 1 | 2 | 3;
  dataTier: 1 | 2 | 3 | null;
  radiation: {
    kWh_per_m2_per_year: number;
    uncertainty_ci_90: [number, number];
    clearnessIndex?: number;
    transpositionFactor?: number;
  };
  geometry: {
    warnings: { code: string; message: string }[];
    polygon: [number, number][];
    /** Horizontal footprint approximation, NOT sloped roof or installed panel area. */
    footprintAreaM2: number;
    areaMethod: 'mean-earth-sphere';
    longestEdgeBearingDeg: number;
  };
  layout: PanelLayoutResult | null;
  physical: PhysicalResult | null;
  elevation: ElevationResult | null;
  uncertainty: {
    status: 'provisional';
    /** kWh/m²/year scenario envelope, NOT a calibrated system 90% CI. */
    orientationAdjustedIrradiationEnvelope: [number, number];
    orientationRelativeAllowance: number;
    pending: string[];
  };
  assumptions: Assumption[];
  provenance: { id: string; description: string }[];
  warnings: { code: string; message: string }[];
}

export interface KeepOutZone {
  polygon: [number, number][];
}

export interface PanelLayoutOptions {
  panel: { widthM: number; lengthM: number; ratedPowerW: number };
  keepOutZones?: KeepOutZone[];
  edgeClearanceM: number;
  allowRotation?: boolean;
}

export interface PanelLayoutResult {
  panelCount: number;
  installedDcCapacityKw: number;
  moduleCoveredAreaM2: number;
  usableAreaM2: number;
  unusedAreaM2: number;
  placements: { id: number; rotationDeg: 0 | 90; corners: [number, number][]; localCornersM: [number, number][] }[];
  warnings: { code: string; message: string }[];
  diagnostics: { algorithm: 'bounded-grid-v1'; candidatesTested: number; candidateLimit: number;
    truncated: boolean; areaMethod: 'local-WGS84-tangent-metric'; origin: { lat: number; lng: number } };
}
