import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEnvSources } from './env-sources';

afterEach(() => vi.unstubAllEnvs());
const source = (key?: unknown) => ({ name: '源', url: 'https://example.com/api.php/provide/vod', ...(key === undefined ? {} : { key }) });
describe('stable deployment source identities', () => {
  it('keeps explicit old keys after removals while preserving positional fallback', () => {
    vi.stubEnv('DEFAULT_SOURCES', JSON.stringify([source('env_5'), source(), source('env_9')]));
    expect(getEnvSources().map(s => s.key)).toEqual(['env_5', 'env_1', 'env_9']);
  });
  it.each(['manual_0', 'env_-1', 'env_01', 'env_1x', 4])('rejects invalid explicit key %s', key => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('DEFAULT_SOURCES', JSON.stringify([source(key)]));
    expect(getEnvSources()).toEqual([]);
    vi.restoreAllMocks();
  });
  it('rejects collisions between explicit and positional keys', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('DEFAULT_SOURCES', JSON.stringify([source('env_1'), source()]));
    expect(getEnvSources()).toEqual([]);
    vi.restoreAllMocks();
  });
});
