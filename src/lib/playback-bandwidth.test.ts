import { describe, expect, it } from 'vitest';
import { shouldThrottlePrefetch } from './playback-bandwidth';

function video(ranges: [number, number][], currentTime = 10) {
  return {
    currentTime, paused: false, seeking: false, readyState: 4, playbackRate: 1,
    buffered: { length: ranges.length, start: (i: number) => ranges[i][0], end: (i: number) => ranges[i][1] },
  };
}

describe('playback bandwidth priority', () => {
  it('holds prefetch until recovery has a healthy reserve, rather than resuming on playing alone', () => {
    expect(shouldThrottlePrefetch(video([[0, 12]]), true)).toBe(true);
    expect(shouldThrottlePrefetch(video([[0, 35]]), true)).toBe(false);
  });
  it('uses hysteresis so a middle-sized buffer does not repeatedly start and stop downloads', () => {
    expect(shouldThrottlePrefetch(video([[0, 22]]), true)).toBe(true);
    expect(shouldThrottlePrefetch(video([[0, 22]]), false)).toBe(false);
    expect(shouldThrottlePrefetch(video([[0, 15]]), false)).toBe(true);
  });
  it('does not count disconnected future ranges as playable reserve', () => {
    expect(shouldThrottlePrefetch(video([[0, 12], [50, 100]]), true)).toBe(true);
  });
  it('accounts for faster playback and prioritizes seeks and loading', () => {
    expect(shouldThrottlePrefetch({ ...video([[0, 40]]), playbackRate: 2 }, true)).toBe(true);
    expect(shouldThrottlePrefetch({ ...video([[0, 40]]), seeking: true }, false)).toBe(true);
    expect(shouldThrottlePrefetch({ ...video([[0, 40]]), readyState: 2 }, false)).toBe(true);
  });
  it('allows background caching during an intentional pause', () => {
    expect(shouldThrottlePrefetch({ ...video([]), paused: true }, true)).toBe(false);
  });
});
