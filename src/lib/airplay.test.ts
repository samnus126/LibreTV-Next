import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { enableHlsAirPlay } from './airplay';

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
