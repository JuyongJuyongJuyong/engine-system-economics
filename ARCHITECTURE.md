# Multi-repo split — how the three repos fit together

This project is split into three repositories, one per owner/domain, matching CODEOWNERS 1:1:

| Repo | Owner | Scope |
|---|---|---|
| `app-rooftop-solar` | A + B (joint) | Map interaction, tap-based question flow, i18n, PDF report generation |
| `engine-radiation-uncertainty` | Owner A | Solar geometry, GHI→POA transposition, dust/aerosol correction, irradiance ensembling, Monte Carlo uncertainty validation |
| `engine-system-economics` | Owner B | PR/thermal modeling, elevation correction, roof-polygon geometry (bin-packing, geodesic calcs), ROI, savings, CO2 |

## Important: these are packages, not services

The project's non-negotiable constraint is **no backend server** — everything runs in the user's browser. Splitting into three repos does **not** mean three servers calling each other over the network at runtime. Instead:

- `engine-radiation-uncertainty` and `engine-system-economics` are each published as a standalone JS/TS package, referenced via a **git-tag dependency** pinned to a GitHub Release rather than published to npm — e.g. `"engine-radiation-uncertainty": "github:JuyongJuyongJuyong/engine-radiation-uncertainty#v0.1.0"` in `package.json`. This needs no npm registry account, no publish-time authentication/2FA, and stays entirely within GitHub, which both collaborators already have an authenticated session for. To bump a version: tag a new GitHub Release (`vX.Y.Z`, pre-release until the exported API is stable) on the producing repo, then update the pinned tag in the consuming repo's `package.json`.
- `engine-system-economics` depends on `engine-radiation-uncertainty` as a package dependency and calls its exported functions directly in-process to obtain annual incident POA in kWh/m²/year and its uncertainty interval, not electrical kWh. Economics adds layout, physical losses and economics.
- `app-rooftop-solar` depends on `engine-system-economics` (which transitively pulls in `engine-radiation-uncertainty`) as a package dependency, imports its functions, and bundles everything into one static site at build time.
- At runtime, packages execute in the browser; bundlers may split assets into multiple chunks. The three-repo split is a *source code / ownership* boundary, not a service boundary. External data fetches do not change the zero-backend-server architecture.

## Interface contracts (the part that must not silently drift between repos)

**Canonical architecture: App → Economics → Radiation.** The app supplies no precomputed Radiation output to `getSystemEconomics`.

- **`engine-radiation-uncertainty` v0.1.2 exports**: async `getRadiationEstimate({ lat, lng, tier, tiltDeg?, azimuthDeg? })`, returning `{ kWh_per_m2_per_year, uncertainty_ci_90, clearnessIndex?, transpositionFactor? }`. Economics v1 deliberately omits surface overrides.
- **`engine-system-economics` v1 exports**: async `getSystemEconomics(input)`, taking the geographic roof polygon, descriptive roof metadata, explicit `location: { lat, lng }`, `radiationTier`, optional independent `dataTier`, power access, optional self-consumption tap, and optional layout/physical/economics/emissions inputs. After successful validation it makes exactly one internal Radiation v0.1.2 call with `{ lat: location.lat, lng: location.lng, tier: radiationTier }`, with no retries. Invalid inputs may reject before that call. No surface overrides or fabricated roof planes are used. See src/types.ts and README.md for the implemented output.
- **`app-rooftop-solar` calls**: only `engine-system-economics` directly — it never needs to know `engine-radiation-uncertainty` exists, keeping the UI's dependency surface to one package.

Economics 0.4.0 adds optional physical-model parameters. With layout, annual
electrical kWh is returned, alongside explicit physical factors and elevation
provider diagnostics; without layout, the foundation-only result remains.
Economics 0.5.0 adds optional sourced `economics` and `emissions` inputs, annual
cash flows, scenario metrics, ROI and payback. No external tariff/emissions
providers are called. Final savings confidence intervals remain unavailable;
provisional physical labels are preserved. See ECONOMICS_MODEL.md. This
preserves the Radiation call while extending the foundation output.

### App-integration contract details

- Location must be inside or on the validated roof polygon, not merely nearby. The app must supply it explicitly; Economics does not derive it. For concave outlines, a simple vertex average may lie outside the roof.
- `radiationTier` and `dataTier` have no implicit mapping. Omitted dataTier returns null; neither roof metadata nor country silently assigns it.
- No public `planes`, `capacityFraction`, `tiltDeg` or `azimuthDeg`. Shape is descriptive; longest-edge bearing is diagnostic, not roof-facing azimuth. Multi-plane support requires real geometry and a future coordinated API change.
- `kWh` is annual electrical generation or null without layout. `savings` and `co2` are first-year metric objects with value, unit and scenario ranges, or null when required inputs are missing. ROI/payback and annual/lifetime results are under `economics`; non-payback within the horizon has null years. See ECONOMICS_MODEL.md for zero-cost ROI and missing-input handling.
- Raw upstream `radiation.uncertainty_ci_90` is retained. Physical and economic envelopes include provisional allowances for unknown orientation and other assumptions. They are not calibrated confidence intervals. Top-level `uncertainty_ci_90` remains null; no Tier target is enforced by clipping ranges.

### Cross-repo documentation reconciliation (2026-09-22)

Fetched app main at `5db2fff842b3e9ba28f5903b16b1f1404190c8c9` and
Radiation main at `436b0cfd101dff37cac3c9e529522880f7412511`.
Their ARCHITECTURE.md files now agree on App → Economics → Radiation, explicit
location, separate tiers and the no-plane v1 scope. The app's obsolete
precomputed-radiation input statement has been corrected. Economics-specific
model/version notes and the actual 0.5.0 result types are retained here.

Remaining sibling-documentation differences to fix during app integration:

- Both architecture files still instruct Economics to widen final `uncertainty_ci_90`. In implemented 0.5.0, widening is exposed as provisional scenario envelopes and the final CI stays null. Do not relabel scenario bounds as calibrated confidence intervals.
- App CLAUDE.md still says gable shape splits azimuth 50/50. That contradicts its own canonical architecture and is not implemented: shape remains descriptive for every v1 call.
- App CLAUDE.md's abbreviated result contract does not explain nullable metric objects. Render `savings`/`co2` value, unit and scenario fields only when present; handle null ROI/payback and final CI explicitly.
- Sibling architecture suggests location may be near the roof; Economics requires inside or on its boundary. `dataTier` remains optional with no inferred mapping in Economics.

These are handoff documentation/UI issues, not authorization to fabricate roof
planes, calibrated intervals or missing data in this package.

Any change to these shapes needs a version bump on the exporting package's GitHub Release tag and a coordinated PR on the consuming side that updates the pinned tag — this replaces the "coordinate via PR description" note from the single-repo CLAUDE.md, since a cross-repo interface change can no longer be reviewed in one diff.

Economics 0.3.0 adds optional `layout` with explicit module dimensions/rating,
edge clearance and geographic keep-out polygons. It also exports pure
`calculatePanelLayout`. Layout is a horizontal-footprint estimate and does not
change the Radiation call or introduce roof-plane inputs. Consumers may omit it.

## Per-repo setup checklist

Each repo needs its own:
- Branch protection rule on `main` (PR required + Require review from Code Owners) — same steps as before, repeated three times
- `.github/CODEOWNERS` — `app-rooftop-solar` lists both A and B; each engine repo lists its single owner
- Its own `CLAUDE.md` (see the per-repo files) — the old single-repo CLAUDE.md's content has been split across these three plus this file
- A `vX.Y.Z` GitHub Release (pre-release until the exported API stabilizes) so dependents can pin a git-tag dependency to it — see "Important: these are packages, not services" above
