/**
 * engine-system-economics — public entry point.
 *
 * See CLAUDE.md for the full spec: thermal performance ratio, elevation
 * correction, roof-polygon bin-packing + geodesic area/azimuth, ROI
 * amortization with degradation + tariff escalation, savings, CO2.
 *
 * Consumes engine-radiation-uncertainty's output (in-process function call,
 * not a network request — see ARCHITECTURE.md "packages, not services").
 * Exported here is consumed by app-rooftop-solar. Any change to either
 * shape needs a version bump + a coordinated PR on the affected side.
 */

import type { RadiationOutput } from 'engine-radiation-uncertainty';

export interface RoofMetadata {
  shape: 'flat' | 'gable' | 'unknown';
  material: string;
  shadingTap: number;
}

export interface SystemEconomicsInput {
  /** [lat, lng] pairs forming the roof polygon. */
  roofPolygon: [number, number][];
  roofMetadata: RoofMetadata;
  powerAccess: 'grid-tied' | 'generator-dependent' | 'no-power';
  selfConsumption?: 'mostly-out' | 'mixed' | 'mostly-home';
  radiation: RadiationOutput;
}

export interface SystemEconomicsOutput {
  kWh: number;
  savings: number;
  co2: number;
  uncertainty_ci_90: [number, number];
}

/**
 * TODO(Owner B) — implement per CLAUDE.md:
 *  1. Geodesic polygon area + azimuth (longest-edge bearing), self-intersection fix.
 *  2. 2D bin-packing panel layout minus keep-out zones.
 *  3. Thermal performance ratio from local temperature + aridity.
 *  4. Elevation correction (AWS/Mapzen Terrain Tiles primary + fallback pool).
 *  5. ROI amortization (degradation ~0.5-0.8%/yr + tariff escalation), savings, CO2.
 */
export function getSystemEconomics(_input: SystemEconomicsInput): SystemEconomicsOutput {
  throw new Error('Not implemented yet — see CLAUDE.md for the spec.');
}
