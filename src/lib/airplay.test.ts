import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { enableHlsAirPlay, startNativeHlsPlayback, supportsNativeAirPlay, type AirPlayVideo } from './airplay';

function nativeMedia() {
  const video = media() as AirPlayVideo;
  video.webkitShowPlaybackTargetPicker = () => {};
  video.webkitCurrentPlaybackTargetIsWireless = false;
  video.setAttribute('crossorigin', 'anonymous');
  video.load = vi.fn();
  video.play = vi.fn(async () => {});
  const event = (name: string) => video.dispatchEvent(new video.ownerDocument.defaultView!.Event(name));
  return { video, event };
}

describe('native Safari HLS AirPlay playback', () => {
  it('selects native playback only when both HLS and the Safari AirPlay API exist', () => {
    const { video } = nativeMedia();
    expect(supportsNativeAirPlay(video)).toBe(true);
    video.webkitShowPlaybackTargetPicker = undefined;
    expect(supportsNativeAirPlay(video)).toBe(false);
  });

  it('uses the network URL without a blob or anonymous-CORS restriction', () => {
    const { video } = nativeMedia();
    const cleanup = startNativeHlsPlayback(video, 'https://media.example/movie.m3u8', { onError: () => {} });
    expect(video.src).toBe('https://media.example/movie.m3u8');
    expect(video.querySelectorAll('source')).toHaveLength(0);
    expect(video.hasAttribute('crossorigin')).toBe(false);
    expect(video.disableRemotePlayback).toBe(false);
    cleanup();
    expect(video.getAttribute('crossorigin')).toBe('anonymous');
  });

  it('reopens local playback and preserves position when Safari disconnects AirPlay', () => {
    const { video, event } = nativeMedia();
    const cleanup = startNativeHlsPlayback(video, 'https://media.example/movie.m3u8', { startTime: 120, onError: () => {} });
    event('loadedmetadata');
    expect(video.currentTime).toBe(120);
    video.webkitCurrentPlaybackTargetIsWireless = true;
    event('webkitcurrentplaybacktargetiswirelesschanged');
    video.currentTime = 156;
    event('timeupdate');
    video.webkitCurrentPlaybackTargetIsWireless = false;
    event('webkitcurrentplaybacktargetiswirelesschanged');
    // Safari resets the media timeline while reloading the local resource.
    video.currentTime = 0;
    event('loadedmetadata');
    expect(video.currentTime).toBe(156);
    cleanup();
  });

  it('does not replace a remote playback failure with an hls.js retry while still connected', () => {
    const { video, event } = nativeMedia();
    let failures = 0;
    const cleanup = startNativeHlsPlayback(video, 'https://media.example/movie.m3u8', { onError: () => failures++ });
    video.webkitCurrentPlaybackTargetIsWireless = true;
    event('webkitcurrentplaybacktargetiswirelesschanged');
    event('error');
    expect(failures).toBe(0);
    video.webkitCurrentPlaybackTargetIsWireless = false;
    event('webkitcurrentplaybacktargetiswirelesschanged');
    event('error');
    expect(failures).toBe(1);
    cleanup();
  });

  it('keeps the last wireless position if Safari resets the timeline before disconnect notification', () => {
    const { video, event } = nativeMedia();
    Object.defineProperty(video, 'readyState', { value: 4 });
    const cleanup = startNativeHlsPlayback(video, 'https://media.example/movie.m3u8', { onError: () => {} });
    video.currentTime = 90;
    event('timeupdate');
    video.webkitCurrentPlaybackTargetIsWireless = true;
    event('webkitcurrentplaybacktargetiswirelesschanged');
    video.currentTime = 0;
    video.webkitCurrentPlaybackTargetIsWireless = false;
    event('webkitcurrentplaybacktargetiswirelesschanged');
    event('loadedmetadata');
    expect(video.currentTime).toBe(90);
    cleanup();
  });

  it('removes recovery listeners on episode replacement or teardown', () => {
    const { video, event } = nativeMedia();
    const cleanup = startNativeHlsPlayback(video, 'https://media.example/movie.m3u8', { startTime: 120, onError: () => {} });
    cleanup();
    video.currentTime = 0;
    event('loadedmetadata');
    expect(video.currentTime).toBe(0);
  });

  it('does not treat an error during remote connection setup as a local source failure', () => {
    const { video, event } = nativeMedia();
    const remote = new video.ownerDocument.defaultView!.EventTarget();
    Object.assign(remote, { state: 'connecting' });
    Object.defineProperty(video, 'remote', { value: remote });
    let failures = 0;
    const cleanup = startNativeHlsPlayback(video, 'https://media.example/movie.m3u8', { onError: () => failures++ });
    event('error');
    expect(failures).toBe(0);
    cleanup();
  });
});

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
