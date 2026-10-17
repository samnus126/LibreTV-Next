type PlaybackState = Pick<HTMLVideoElement, 'currentTime' | 'paused' | 'seeking' | 'readyState' | 'playbackRate' | 'buffered'>;

export function shouldThrottlePrefetch(video: PlaybackState, throttled: boolean): boolean {
  if (video.seeking) return true;
  if (video.paused) return false;
  if (video.readyState < 3) return true;
  let ahead = 0;
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) > video.currentTime) {
      ahead = (video.buffered.end(i) - video.currentTime) / Math.max(video.playbackRate, 0.1);
      break;
    }
  }
  // Stop early when reserve drops; only resume after a larger reserve recovers.
  return ahead < (throttled ? 20 : 8);
}
