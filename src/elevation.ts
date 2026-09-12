/** Source contracts: https://github.com/tilezen/joerd/blob/master/docs/use-service.md
 * https://www.opentopodata.org/api/ ; https://github.com/Jorl17/open-elevation/blob/master/docs/api.md
 * https://apps.nationalmap.gov/epqs/ . Providers are best effort, never a prerequisite for energy.
 */
export interface ElevationOptions {
  /** Explicit eligibility: EPQS is only attempted for Tier-1 US cross-check/fallback. */
  countryCode?: string;
  /** Disabled by default. Caller must enforce an actual Cloud Console quota cap. */
  google?: { apiKey: string; quotaCapConfirmed: true };
}
export interface ElevationResult {
  meters: number | null;
  source: string | null;
  status: 'resolved' | 'unavailable';
  cached: boolean;
  lookupLocation: { lat: number; lng: number };
  attempts: { provider: string; status: 'success' | 'failed' }[];
  warnings: string[];
}
export function terrariumElevation(r: number, g: number, b: number): number {
  if (![r, g, b].every(v => Number.isInteger(v) && v >= 0 && v <= 255)) throw new Error('INVALID_TERRARIUM_PIXEL');
  return r * 256 + g + b / 256 - 32768;
}
export function terrainPixel(lat: number, lng: number) {
  const z = 12, n = 2 ** z;
  if (Math.abs(lat) >= 85.05112878) throw new Error('TERRAIN_OUT_OF_COVERAGE');
  const x = ((lng + 180) / 360 * n) % n;
  const y = (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n;
  return { url: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${Math.floor(x)}/${Math.floor(y)}.png`,
    x: Math.floor((x - Math.floor(x)) * 256), y: Math.floor((y - Math.floor(y)) * 256) };
}
async function browserPixel(blob: Blob, x: number, y: number): Promise<number> {
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx || bitmap.width !== 256 || bitmap.height !== 256) throw new Error('INVALID_TERRAIN_TILE');
    ctx.drawImage(bitmap, 0, 0);
    const [r, g, b, alpha] = ctx.getImageData(x, y, 1, 1).data;
    if (alpha !== 255) throw new Error('TERRAIN_NODATA');
    return terrariumElevation(r!, g!, b!);
  } finally { bitmap.close(); }
}
export function createElevationResolver(dependencies: {
  fetch?: typeof fetch;
  decodePixel?: typeof browserPixel;
  now?: () => number;
  timeoutMs?: number;
} = {}) {
  const request = dependencies.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = dependencies.now ?? Date.now;
  const cache = new Map<string, { time: number; result: ElevationResult }>();
  const pending = new Map<string, Promise<ElevationResult>>();
  // One OpenTopoData attempt/second per resolver; do not queue browser users behind quotas.
  let lastTopo = -Infinity;
  return async (location: { lat: number; lng: number }, radiationTier: 1 | 2 | 3, options: ElevationOptions = {}): Promise<ElevationResult> => {
    if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng) || Math.abs(location.lat) > 90 || Math.abs(location.lng) > 180) throw new Error('INVALID_ELEVATION_LOCATION');
    if (options.google && (!options.google.apiKey || options.google.quotaCapConfirmed !== true)) throw new Error('GOOGLE_QUOTA_CONFIRMATION_REQUIRED');
    const lat = Number(location.lat.toFixed(3)), lng = Number(location.lng.toFixed(3));
    const eligible = options.countryCode === 'US' && radiationTier === 1;
    const key = JSON.stringify([lat, lng, eligible, options.google?.apiKey ?? null]);
    const hit = cache.get(key);
    if (hit && now() - hit.time < (hit.result.status === 'resolved' ? 86400000 : 60000)) return structuredClone({ ...hit.result, cached: true });
    const inflight = pending.get(key);
    if (inflight) return structuredClone(await inflight);
    const work = async (): Promise<ElevationResult> => {
      const result: ElevationResult = { meters: null, source: null, status: 'unavailable', cached: false,
        lookupLocation: { lat, lng }, attempts: [], warnings: [] };
      const providers = ['terrarium', 'open-topo-data', 'open-elevation', ...(eligible ? ['usgs-epqs'] : []), ...(options.google ? ['google'] : [])];
      for (const provider of providers) {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const run = async () => {
            let url: string;
            if (provider === 'terrarium') {
              const tile = terrainPixel(lat, lng);
              const response = await request(tile.url, { signal: controller.signal });
              if (!response.ok) throw new Error('HTTP');
              return (dependencies.decodePixel ?? browserPixel)(await response.blob(), tile.x, tile.y);
            }
            if (provider === 'open-topo-data') {
              if (now() - lastTopo < 1000) throw new Error('LOCAL_RATE_LIMIT');
              lastTopo = now();
              url = `https://api.opentopodata.org/v1/srtm30m?locations=${lat},${lng}`;
            } else if (provider === 'open-elevation') url = `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`;
            else if (provider === 'usgs-epqs') url = `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&units=Meters&wkid=4326&includeDate=false`;
            else url = `https://maps.googleapis.com/maps/api/elevation/json?locations=${lat},${lng}&key=${encodeURIComponent(options.google!.apiKey)}`;
            const response = await request(url, { signal: controller.signal });
            if (!response.ok) throw new Error('HTTP');
            const body = await response.json();
            if ((provider === 'open-topo-data' || provider === 'google') && body.status !== 'OK') throw new Error('PROVIDER_ERROR');
            const value = provider === 'usgs-epqs' ? (typeof body.value === 'string' && body.value.trim() ? Number(body.value) : body.value) : body.results?.[0]?.elevation;
            // Open-Elevation documents zero as also meaning missing data; conservatively fall through.
            if (provider === 'open-elevation' && value === 0) throw new Error('AMBIGUOUS_ZERO');
            return value;
          };
          const meters = await Promise.race([run(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new Error('TIMEOUT')); }, dependencies.timeoutMs ?? 2500);
          })]);
          if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < -500 || meters > 9000) throw new Error('INVALID_ELEVATION');
          result.meters = meters; result.source = provider; result.status = 'resolved';
          result.attempts.push({ provider, status: 'success' });
          break;
        } catch {
          result.attempts.push({ provider, status: 'failed' }); // Never serialize URLs/API keys.
        } finally { if (timer !== undefined) clearTimeout(timer); }
      }
      if (result.status === 'unavailable') result.warnings.push('Elevation unavailable: correction skipped and scenario uncertainty widened.');
      result.warnings.push('Rounded-coordinate terrain height is not roof height; provider accuracy is not calibrated.');
      if (cache.size >= 256) cache.delete(cache.keys().next().value!);
      cache.set(key, { time: now(), result: structuredClone(result) });
      return result;
    };
    const promise = work(); pending.set(key, promise);
    try { return await promise; } finally { pending.delete(key); }
  };
}
export const resolveElevation = createElevationResolver();
