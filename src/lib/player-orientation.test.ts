import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { createWebFullscreenRotation, isAppleMobile } from './player-orientation';

describe('Apple mobile fullscreen orientation', () => {
  it.each([
    [{ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 }, true],
    [{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 5 }, true],
    [{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 0 }, false],
    [{ userAgent: 'Mozilla/5.0 (Linux; Android 16)', platform: 'Linux', maxTouchPoints: 5 }, false],
  ])('identifies devices needing system-managed native rotation: %j', (navigator, expected) => {
    expect(isAppleMobile(navigator)).toBe(expected);
  });

  it('preserves landscape web fullscreen without using the native orientation-lock API', () => {
    const dom = new JSDOM('<div id="player"><video></video></div>');
    const doc = dom.window.document;
    Object.defineProperties(doc.documentElement, { clientWidth: { value: 390 }, clientHeight: { value: 844 } });
    const player = doc.querySelector<HTMLElement>('#player')!;
    const video = doc.querySelector('video')!;
    Object.defineProperties(video, { videoWidth: { value: 1280 }, videoHeight: { value: 720 } });
    let rotated = false;
    const rotation = createWebFullscreenRotation(player, video, value => { rotated = value; });
    rotation.setActive(true);
    expect(player.style.width).toBe('844px');
    expect(player.style.height).toBe('390px');
    expect(player.style.transform).toBe('rotate(90deg) translate(0, -390px)');
    expect(rotated).toBe(true);
    rotation.setActive(false);
    expect(player.style.transform).toBe('');
    expect(player.style.width).toBe('');
    expect(rotated).toBe(false);
    rotation.dispose();
  });

  it('leaves a landscape viewport unrotated and clears rotation on disposal', () => {
    const dom = new JSDOM('<div><video></video></div>');
    const doc = dom.window.document;
    let width = 844;
    let height = 390;
    Object.defineProperties(doc.documentElement, { clientWidth: { get: () => width }, clientHeight: { get: () => height } });
    const player = doc.querySelector('div')!;
    const video = doc.querySelector('video')!;
    Object.defineProperties(video, { videoWidth: { value: 1280 }, videoHeight: { value: 720 } });
    const rotation = createWebFullscreenRotation(player, video, () => {});
    rotation.setActive(true);
    expect(player.style.transform).toBe('');
    width = 390;
    height = 844;
    rotation.setActive(true);
    expect(player.style.transform).toContain('rotate(90deg)');
    rotation.dispose();
    expect(player.style.transform).toBe('');
    rotation.setActive(true);
    expect(player.style.transform).toBe('');
  });
});
