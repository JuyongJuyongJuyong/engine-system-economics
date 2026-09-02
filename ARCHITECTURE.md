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
- `engine-system-economics` depends on `engine-radiation-uncertainty` as a package dependency and calls its exported functions directly in-process (same JS bundle, no network hop) to get kWh + uncertainty range, then adds its own PR/geometry/ROI modeling on top.
- `app-rooftop-solar` depends on `engine-system-economics` (which transitively pulls in `engine-radiation-uncertainty`) as a package dependency, imports its functions, and bundles everything into one static site at build time.
- At runtime, in the user's browser, there is exactly one static bundle — the three-repo split is a *source code / ownership* boundary, not a *runtime* boundary. This keeps the zero-backend-server constraint intact.

## Interface contracts (the part that must not silently drift between repos)

- **`engine-radiation-uncertainty` exports**: a function taking `{ lat, lng, tier }` (or equivalent) and returning `{ kWh_per_m2_per_year, uncertainty_ci_90 }` plus whatever intermediate values `engine-system-economics` needs (e.g. clearness index, transposition factor).
- **`engine-system-economics` exports**: a function taking the roof polygon (`[lat, lng][]`), roof metadata (shape, material, shading tap), and the radiation-package output, returning the final `{ kWh, savings, co2, uncertainty_ci_90 }` shown in the UI.
- **`app-rooftop-solar` calls**: only `engine-system-economics` directly — it never needs to know `engine-radiation-uncertainty` exists, keeping the UI's dependency surface to one package.

Any change to these shapes needs a version bump on the exporting package's GitHub Release tag and a coordinated PR on the consuming side that updates the pinned tag — this replaces the "coordinate via PR description" note from the single-repo CLAUDE.md, since a cross-repo interface change can no longer be reviewed in one diff.

## Per-repo setup checklist

Each repo needs its own:
- Branch protection rule on `main` (PR required + Require review from Code Owners) — same steps as before, repeated three times
- `.github/CODEOWNERS` — `app-rooftop-solar` lists both A and B; each engine repo lists its single owner
- Its own `CLAUDE.md` (see the per-repo files) — the old single-repo CLAUDE.md's content has been split across these three plus this file
- A `vX.Y.Z` GitHub Release (pre-release until the exported API stabilizes) so dependents can pin a git-tag dependency to it — see "Important: these are packages, not services" above
