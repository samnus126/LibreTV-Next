import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createNativeAirPlay, enableHlsAirPlay, getPlaybackProgress } from './airplay';

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
  Object.defineProperty(video, 'duration', { get: () => 600, configurable: true });
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

  it('keeps the native media on return and reopens the picker without reloading', () => {
    const { video, controller, restore, wireless } = nativeMedia();
    controller.request('https://media.example/episode.m3u8');
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('loadedmetadata'));
    wireless(true);
    video.currentTime = 158;
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('timeupdate'));
    video.currentTime = 0; // Safari can reset the element while disconnecting.
    wireless(false);
    expect(restore).not.toHaveBeenCalled();
    expect(controller.active).toBe(true);
    expect(controller.progress.position).toBe(158);
    expect(video.currentTime).toBe(158);
    expect(video.hasAttribute('crossorigin')).toBe(false);
    controller.request('https://media.example/episode.m3u8');
    wireless(true);
    wireless(false);
    expect(video.webkitShowPlaybackTargetPicker).toHaveBeenCalledTimes(2);
    expect(restore).not.toHaveBeenCalled();
    expect(video.load).toHaveBeenCalledOnce();
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
    expect(restore).not.toHaveBeenCalled();
    expect(controller.progress.position).toBe(0);
    expect(video.paused).toBe(true);
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


describe('AirPlay progress protection', () => {
  it('sets the resume position before starting native playback or opening the picker', () => {
    const { video, controller } = nativeMedia();
    video.load = vi.fn(() => { video.currentTime = 0; });
    const startedAt: number[] = [];
    video.play = vi.fn(async () => { startedAt.push(video.currentTime); });
    video.webkitShowPlaybackTargetPicker = vi.fn(() => { expect(video.currentTime).toBe(120); });
    controller.request('https://media.example/episode.m3u8');
    expect(startedAt).toEqual([120]);
    controller.dispose();
  });

  it('retains the last safe progress while metadata and the resume seek are pending', () => {
    const { video, controller } = nativeMedia();
    controller.request('https://media.example/episode.m3u8');
    video.currentTime = 0;
    expect(getPlaybackProgress(video, true, controller)).toEqual({ position: 120, duration: 600 });
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('loadedmetadata'));
    video.currentTime = 1;
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('timeupdate'));
    expect(getPlaybackProgress(video, true, controller)).toEqual({ position: 120, duration: 600 });
    video.currentTime = 120;
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('seeked'));
    video.currentTime = 128;
    expect(getPlaybackProgress(video, true, controller)).toEqual({ position: 128, duration: 600 });
    controller.dispose();
  });

  it('retains duration across a temporary native reload and saves before fallback teardown', () => {
    const { video, controller, restore } = nativeMedia();
    controller.request('https://media.example/episode.m3u8');
    Object.defineProperty(video, 'duration', { get: () => NaN, configurable: true });
    video.currentTime = 0;
    expect(getPlaybackProgress(video, true, controller)).toEqual({ position: 120, duration: 600 });
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('error'));
    expect(restore).toHaveBeenCalledWith(120, true);
    expect(getPlaybackProgress(video, false, controller)).toBeNull();
    controller.dispose();
  });

  it('retries the saved seek when the receiver resets the element on connection', () => {
    const { video, controller, wireless } = nativeMedia();
    controller.request('https://media.example/episode.m3u8');
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('loadedmetadata'));
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('seeked'));
    video.currentTime = 0;
    wireless(true);
    expect(video.currentTime).toBe(120);
    controller.dispose();
  });

  it('does not save a reload zero until normal restoration has completed', () => {
    const { video } = nativeMedia();
    video.currentTime = 0;
    expect(getPlaybackProgress(video, false)).toBeNull();
    Object.defineProperty(video, 'seeking', { get: () => true });
    expect(getPlaybackProgress(video, true)).toBeNull();
  });
});


it('does not replace the saved progress with a low timeupdate during route renegotiation', () => {
  const { video, controller, wireless } = nativeMedia();
  controller.request('https://media.example/episode.m3u8');
  video.dispatchEvent(new video.ownerDocument.defaultView!.Event('loadedmetadata'));
  wireless(true);
  video.currentTime = 2;
  video.dispatchEvent(new video.ownerDocument.defaultView!.Event('timeupdate'));
  expect(getPlaybackProgress(video, true, controller)?.position).toBe(120);
  video.currentTime = 30;
  video.dispatchEvent(new video.ownerDocument.defaultView!.Event('seeked'));
  expect(getPlaybackProgress(video, true, controller)?.position).toBe(30);
  controller.dispose();
});


it('does not checkpoint an active handoff before normal history restoration completes', () => {
  const { video, controller } = nativeMedia();
  video.currentTime = 0;
  controller.request('https://media.example/episode.m3u8');
  expect(getPlaybackProgress(video, false, controller)).toBeNull();
  controller.dispose();
});

it.each(['loadedmetadata', 'canplay'])('resumes after a receiver reload arriving after connection: %s', event => {
  const { video, controller, wireless } = nativeMedia();
  controller.request('https://media.example/episode.m3u8');
  video.dispatchEvent(new video.ownerDocument.defaultView!.Event('loadedmetadata'));
  wireless(true);
  video.currentTime = 160;
  video.dispatchEvent(new video.ownerDocument.defaultView!.Event('timeupdate'));
  video.currentTime = 0;
  video.dispatchEvent(new video.ownerDocument.defaultView!.Event(event));
  expect(video.currentTime).toBe(160);
  controller.dispose();
});


it('allows a backward user seek whose canplay arrives before seeked', () => {
  const { video, controller, wireless } = nativeMedia();
  controller.request('https://media.example/episode.m3u8');
  video.dispatchEvent(new video.ownerDocument.defaultView!.Event('loadedmetadata'));
  wireless(true);
  let seeking = true;
  Object.defineProperty(video, 'seeking', { get: () => seeking });
  video.currentTime = 30;
  video.dispatchEvent(new video.ownerDocument.defaultView!.Event('canplay'));
  expect(video.currentTime).toBe(30);
  seeking = false;
  video.dispatchEvent(new video.ownerDocument.defaultView!.Event('seeked'));
  expect(getPlaybackProgress(video, true, controller)?.position).toBe(30);
  controller.dispose();
});


it('retains local pause intent after returning from AirPlay if native playback later fails', () => {
  const { video, controller, restore, wireless } = nativeMedia();
  controller.request('https://media.example/episode.m3u8');
  video.dispatchEvent(new video.ownerDocument.defaultView!.Event('loadedmetadata'));
  wireless(true);
  wireless(false);
  video.currentTime = 150;
  video.pause();
  video.dispatchEvent(new video.ownerDocument.defaultView!.Event('pause'));
  video.dispatchEvent(new video.ownerDocument.defaultView!.Event('error'));
  expect(restore).toHaveBeenCalledWith(150, false);
  controller.dispose();
});
