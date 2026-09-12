# Pre-integration scenario validation

`src/scenarios.test.ts` exercises the public async API from geographic polygon
through real geometry, layout, physics and economics. Only Radiation and elevation
responses are mocked. This is a controlled package integration test, not a live
browser/provider test or empirical accuracy validation.

## Complete fixtures

All cases use explicit synthetic 1×2 m / 400 W panels, 0.2 m clearance,
1500 kWh/m²/year canonical POA (upstream interval 1300–1700), 50% compensation,
USD 0.20/kWh, USD 10,000 cost, 0.4 kgCO2e/kWh, 25 years, 0.65% degradation
and 2% escalation. These values are fixtures, not regional recommendations.

| Roof / scenario | Panels | kWp | Annual kWh | First-year USD | kgCO2e/year | Horizon ROI | Payback years |
|---|---:|---:|---:|---:|---:|---:|---:|
| 4×6 m, hot/humid reference | 6 | 2.4 | 2,752 | 275 | 1,101 | -18.95% | Not within 25 years |
| 10×10 m, hot/dry reference | 36 | 14.4 | 14,607 | 1,461 | 5,843 | 330.24% | 6.59 |
| 20×20 m, cool reference | 171 | 68.4 | 88,142 | 8,814 | 35,257 | 2496.16% | 1.13 |
| 0.8×10 m, no fit | 0 | 0 | 0 | 0 | 0 | -100% | Not within 25 years |

The large-case financial result is suspicious as a real-world estimate because
the fixed test cost does not scale with capacity. It is mathematically consistent,
not evidence of a verified installation price. No model assumption was adjusted
to beautify it. Negative ROI is valid; negative generation/savings/emissions are
not. Humid/dry labels describe supplied temperature/soiling scenarios, not an
implemented humidity model or geographic inference.

Independent checks cover rectangular panel boundaries, clearance, overlap, area,
capacity, broad specific-yield screening (900–1500 kWh/kWp under these fixtures),
annual sums, ROI arithmetic and cumulative interpolated payback. This yield
screen is an engineering sanity check, not a claimed measured accuracy range.

## Coverage and limits

13 additional tests cover nested roof scaling, shading/soiling/temperature,
elevation resolution/failure, tariffs, cost, category compensation, net metering,
emissions factors, finite numbers, units, input non-mutation and identical outputs
under identical fixed provider responses. Provisional labels are asserted intact.

Nested rectangular scaling passes. More area alone does not guarantee more panels
for arbitrary shapes or a budget-limited heuristic. Deterministic core calculations
do not imply identical entire outputs across changing remote responses or cache
diagnostics. Provider success/failure is simulated here; existing provider unit
tests cover the fallback machinery separately. No external reliability claim is made.

Full suite: 126 tests across 9 files (previous 113 unchanged). No production model
or API changes were needed. Build, test type-checking, lint and diff checks must
also pass before the checkpoint. App bundling, drawn-polygon UI integration,
live data reliability and empirical uncertainty coverage remain separate gates.
