import assert from 'node:assert/strict';
import { test } from 'node:test';

// Native Node loader, package exports resolution, no Vitest/Vite or loader hooks.
// .check.mjs keeps this native-node test outside Vitest's discovery pattern.
test('built package imports by name and exposes the unchanged runtime API', async () => {
  const api = await import('engine-system-economics');
  assert.deepEqual(Object.keys(api).sort(), ['calculateEconomics', 'calculatePanelLayout', 'getSystemEconomics']);
  const result = api.calculatePanelLayout([[37, 127], [37.0001, 127], [37.0001, 127.0001], [37, 127.0001]], {
    panel: { widthM: 1, lengthM: 2, ratedPowerW: 400 }, edgeClearanceM: 0.2,
  });
  assert.ok(result.panelCount > 0);
  assert.equal(result.installedDcCapacityKw, result.panelCount * 400 / 1000);
  const pending = api.getSystemEconomics({});
  assert.ok(pending instanceof Promise);
  await assert.rejects(pending, /INVALID_INPUT/);
});
