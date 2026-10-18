import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEnvLiveSources } from './env-live-sources';

afterEach(() => vi.unstubAllEnvs());
const source = (key?: unknown) => ({ name: '源', url: 'https://example.com/api.php/provide/vod', ...(key === undefined ? {} : { key }) });
describe('stable deployment live source identities', () => {
  it('keeps explicit old keys after removals while preserving positional fallback', () => {
    vi.stubEnv('DEFAULT_LIVE_SOURCES', JSON.stringify([source('envlive_5'), source(), source('envlive_9')]));
    expect(getEnvLiveSources().map(s => s.key)).toEqual(['envlive_5', 'envlive_1', 'envlive_9']);
  });
  it.each(['manual_0', 'envlive_-1', 'envlive_01', 'envlive_1x', 4])('rejects invalid explicit key %s', key => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('DEFAULT_LIVE_SOURCES', JSON.stringify([source(key)]));
    expect(getEnvLiveSources()).toEqual([]);
    vi.restoreAllMocks();
  });
  it('rejects collisions between explicit and positional keys', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('DEFAULT_LIVE_SOURCES', JSON.stringify([source('envlive_1'), source()]));
    expect(getEnvLiveSources()).toEqual([]);
    vi.restoreAllMocks();
  });
});
