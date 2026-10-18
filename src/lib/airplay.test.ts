import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createNativeAirPlay, enableHlsAirPlay } from './airplay';

function media() {
  const dom = new JSDOM('<video><source src="blob:local-stream" type="video/mp4"></video>');
  const video = dom.window.document.querySelector('video')!;
  video.canPlayType = () => 'probably';
  video.disableRemotePlayback = true;
  return video;
}

describe('HLS AirPlay source alternatives', () => {
  it('keeps local buffered playback first and offers a network HLS source to the receiver', () => {
    const video = media();
    enableHlsAirPlay(video, 'https://media.example/episode.m3u8');
    expect(video.querySelector('source')?.src).toBe('blob:local-stream');
    const sources = video.querySelectorAll('source');
    expect(sources).toHaveLength(2);
    expect(sources[1].src).toBe('https://media.example/episode.m3u8');
    expect(sources[1].type).toBe('application/x-mpegURL');
    expect(video.disableRemotePlayback).toBe(false);
    expect(video.hasAttribute('src')).toBe(false);
  });

  it('replaces the previous episode alternative without accumulating old sources', () => {
    const video = media();
    enableHlsAirPlay(video, 'https://media.example/old.m3u8');
    enableHlsAirPlay(video, 'https://media.example/new.m3u8');
    expect(Array.from(video.querySelectorAll('source')).map(s => s.src))
      .toEqual(['blob:local-stream', 'https://media.example/new.m3u8']);
  });

  it('leaves browsers without native HLS support alone', () => {
    const video = media();
    video.canPlayType = () => '';
    enableHlsAirPlay(video, 'https://media.example/episode.m3u8');
    expect(video.querySelectorAll('source')).toHaveLength(1);
    expect(video.disableRemotePlayback).toBe(true);
  });

  it('does not expose authenticated proxy or local blob URLs to a receiver', () => {
    for (const url of ['/api/proxy?url=https://media.example/video.m3u8', 'blob:other-stream']) {
      const video = media();
      enableHlsAirPlay(video, url);
      expect(video.querySelectorAll('source')).toHaveLength(1);
      expect(video.disableRemotePlayback).toBe(true);
    }
  });
});

function nativeMedia(ordinaryError?: () => void) {
  const video = media() as HTMLVideoElement & {
    webkitShowPlaybackTargetPicker: () => void;
    webkitCurrentPlaybackTargetIsWireless: boolean;
  };
  let paused = false;
  Object.defineProperty(video, 'paused', { get: () => paused });
  Object.defineProperty(video, 'duration', { get: () => 600 });
  video.currentTime = 120;
  video.crossOrigin = 'anonymous';
  video.load = vi.fn();
  video.pause = vi.fn(() => { paused = true; });
  video.play = vi.fn(async () => { paused = false; });
  video.webkitShowPlaybackTargetPicker = vi.fn();
  video.webkitCurrentPlaybackTargetIsWireless = false;
  const beforeNative = vi.fn();
  const restore = vi.fn();
  const failure = vi.fn();
  if (ordinaryError) video.addEventListener('error', ordinaryError);
  const controller = createNativeAirPlay(video, { beforeNative, restore, failure });
  const wireless = (value: boolean) => {
    video.webkitCurrentPlaybackTargetIsWireless = value;
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('webkitcurrentplaybacktargetiswirelesschanged'));
  };
  return { video, controller, beforeNative, restore, failure, wireless };
}

describe('explicit native AirPlay handoff', () => {
  it('leaves ordinary playback unchanged until requested, then uses the real URL before opening the picker', () => {
    const { video, controller, beforeNative } = nativeMedia();
    expect(video.querySelector('source')?.getAttribute('src')).toBe('blob:local-stream');
    expect(beforeNative).not.toHaveBeenCalled();
    video.webkitShowPlaybackTargetPicker = vi.fn(() => {
      expect(video.src).toBe('https://media.example/episode.m3u8');
      expect(video.querySelector('source')).toBeNull();
      expect(controller.active).toBe(true);
      expect(beforeNative).toHaveBeenCalledOnce();
    });
    expect(controller.request('https://media.example/episode.m3u8')).toBe(true);
    expect(video.hasAttribute('crossorigin')).toBe(false);
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('loadedmetadata'));
    expect(video.currentTime).toBe(120);
    expect(video.disableRemotePlayback).toBe(false);
    controller.dispose();
  });

  it('restores the last position on return and can open the picker on a second round trip', () => {
    const { video, controller, restore, wireless } = nativeMedia();
    controller.request('https://media.example/episode.m3u8');
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('loadedmetadata'));
    wireless(true);
    video.currentTime = 158;
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('timeupdate'));
    video.currentTime = 0; // Safari can reset the element while disconnecting.
    wireless(false);
    expect(restore).toHaveBeenLastCalledWith(158, true);
    expect(controller.active).toBe(false);
    expect(video.crossOrigin).toBe('anonymous');
    controller.request('https://media.example/episode.m3u8');
    wireless(true);
    wireless(false);
    expect(video.webkitShowPlaybackTargetPicker).toHaveBeenCalledTimes(2);
    expect(restore).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('does not restore on an initial non-wireless event or a cancelled picker, and permits another request', () => {
    const { video, controller, restore, wireless } = nativeMedia();
    controller.request('https://media.example/episode.m3u8');
    wireless(false);
    expect(restore).not.toHaveBeenCalled();
    controller.request('https://media.example/episode.m3u8');
    expect(video.webkitShowPlaybackTargetPicker).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('falls back to local playback on native load errors and removes all listeners on disposal', () => {
    const { video, controller, restore, failure, wireless } = nativeMedia();
    controller.request('https://media.example/episode.m3u8');
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('error'));
    expect(restore).toHaveBeenCalledWith(120, true);
    expect(failure).toHaveBeenCalledOnce();
    controller.request('https://media.example/new.m3u8');
    controller.dispose();
    wireless(true);
    wireless(false);
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('error'));
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('rejects cookie-protected proxy URLs and unsupported browsers without disrupting playback', () => {
    const { video, controller, beforeNative } = nativeMedia();
    expect(controller.request('/api/proxy?url=https://example.test/video.m3u8')).toBe(false);
    video.canPlayType = () => '';
    expect(controller.request('https://media.example/episode.m3u8')).toBe(false);
    expect(beforeNative).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('preserves a pause and an explicit seek to zero made during AirPlay', () => {
    const { video, controller, restore, wireless } = nativeMedia();
    controller.request('https://media.example/episode.m3u8');
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('loadedmetadata'));
    wireless(true);
    video.currentTime = 0;
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('seeked'));
    video.pause();
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('pause'));
    wireless(false);
    expect(restore).toHaveBeenCalledWith(0, false);
    controller.dispose();
  });

  it('prevents the player from scheduling stale retries for native-owned errors only', () => {
    const ordinaryError = vi.fn();
    const { video, controller, restore } = nativeMedia(ordinaryError);
    controller.request('https://media.example/episode.m3u8');
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('error'));
    expect(ordinaryError).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledOnce();
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('error'));
    expect(ordinaryError).toHaveBeenCalledOnce();
    controller.dispose();
  });
});
