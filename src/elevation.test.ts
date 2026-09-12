import { describe, it, expect, vi } from 'vitest';
import { createElevationResolver, terrariumElevation, terrainPixel } from './elevation';
const location = { lat: 37.50004, lng: 127.00004 };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
describe('elevation', () => {
  it('decodes known Terrarium bytes and locates a tile pixel', () => {
    expect(terrariumElevation(128, 10, 128)).toBe(10.5);
    expect(terrariumElevation(127, 255, 0)).toBe(-1);
    expect(terrainPixel(0, 0)).toMatchObject({ x: 0, y: 0 });
  });
  it.each([1, 2, 3] as const)('attempts terrain primary in tier %s and caches rounded coordinates', async tier => {
    const fetcher = vi.fn(async () => new Response(new Blob(['fixture'])));
    const resolve = createElevationResolver({ fetch: fetcher, decodePixel: async () => 100 });
    const a = await resolve(location, tier);
    const b = await resolve({ lat: 37.500049, lng: 127.000049 }, tier);
    expect(a.source).toBe('terrarium'); expect(b.cached).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(b.lookupLocation).toEqual({ lat: 37.5, lng: 127 });
  });
  it('falls back after decode/CORS errors, status errors and null data', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).includes('open-elevation')
      ? json({ results: [{ elevation: 25 }] }) : json({ status: 'OK', results: [{ elevation: null }] }));
    const resolve = createElevationResolver({ fetch: fetcher, decodePixel: async () => { throw new Error('tainted'); } });
    const r = await resolve(location, 3);
    expect(r.source).toBe('open-elevation');
    expect(r.attempts.map(a => a.provider)).toEqual(['terrarium', 'open-topo-data', 'open-elevation']);
  });
  it('uses USGS only in explicit Tier-1 US context and Google only with configured quota', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).includes('maps.googleapis')
      ? json({ status: 'OK', results: [{ elevation: 50 }] }) : new Response('', { status: 429 }));
    const resolve = createElevationResolver({ fetch: fetcher });
    const r = await resolve({ lat: 40, lng: -100 }, 1, { countryCode: 'US', google: { apiKey: 'test-key', quotaCapConfirmed: true } });
    expect(r.attempts.map(a => a.provider)).toEqual(['terrarium', 'open-topo-data', 'open-elevation', 'usgs-epqs', 'google']);
    expect(JSON.stringify(r)).not.toContain('test-key');
  });
  it('continues on timeout with unavailable elevation and no Google call by default', async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const r = await createElevationResolver({ fetch: fetcher, timeoutMs: 2 })(location, 2);
    expect(r.status).toBe('unavailable'); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('expires negative cache and does not expose cache mutation', async () => {
    let time = 0;
    const fetcher = vi.fn(async () => new Response('', { status: 500 }));
    const resolve = createElevationResolver({ fetch: fetcher, now: () => time });
    const a = await resolve(location, 1); a.warnings.push('mutated');
    expect((await resolve(location, 1)).warnings).not.toContain('mutated');
    time = 61000; await resolve(location, 1);
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it('treats open-elevation zero as ambiguous and rate limits OpenTopoData', async () => {
    const fetcher = vi.fn(async () => json({ status: 'OK', results: [{ elevation: 0 }] }));
    const resolve = createElevationResolver({ fetch: fetcher, decodePixel: async () => { throw Error(); }, now: () => 0 });
    expect((await resolve(location, 1)).source).toBe('open-topo-data');
    expect((await resolve({ lat: 38, lng: 127 }, 2)).status).toBe('unavailable');
  });
});
