/** Called after hls.js attaches its ManagedMediaSource <source>.
 * AirPlay needs a network URL after the local blob source; authenticated
 * same-origin proxies cannot be fetched by a television without our cookie.
 */
export function enableHlsAirPlay(video: HTMLVideoElement, url: string): void {
  if (!video.canPlayType('application/vnd.apple.mpegurl') || !/^https?:\/\//i.test(url)) return;
  // A src attribute takes precedence over source children. Do not disturb
  // legacy MSE playback that has no ManagedMediaSource source alternative.
  if (video.hasAttribute('src') || !video.querySelector('source[src^="blob:"]')) return;
  let source = video.querySelector<HTMLSourceElement>('source[data-airplay-source]');
  if (!source) {
    source = video.ownerDocument.createElement('source');
    source.setAttribute('data-airplay-source', '');
    source.type = 'application/x-mpegURL';
    video.appendChild(source);
  }
  source.src = url;
  video.disableRemotePlayback = false;
}

interface AirPlayVideo extends HTMLVideoElement {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
}

interface NativeAirPlayHooks {
  beforeNative: () => void;
  restore: (position: number, shouldPlay: boolean) => void;
  failure: () => void;
}

/** Opt in only on a user click. Normal playback keeps hls.js and proxy support. */
export function createNativeAirPlay(video: AirPlayVideo, hooks: NativeAirPlayHooks) {
  let active = false;
  let disposed = false;
  let connected = false;
  let position = 0;
  let shouldPlay = false;
  let seekPending = false;
  let crossOrigin: string | null = null;
  let sourceUrl = '';

  const reset = () => {
    if (active) {
      if (crossOrigin === null) video.removeAttribute('crossorigin');
      else video.setAttribute('crossorigin', crossOrigin);
    }
    active = connected = seekPending = false;
    sourceUrl = '';
  };
  const restore = () => {
    if (!active) return;
    const lastPosition = video.currentTime > 0 ? video.currentTime : position;
    reset();
    hooks.restore(lastPosition, shouldPlay);
  };
  const recordPosition = () => {
    if (active && !seekPending && Number.isFinite(video.currentTime) && video.currentTime > 0) {
      position = video.currentTime;
    }
  };
  const recordSeek = () => {
    if (active && !seekPending && video.webkitCurrentPlaybackTargetIsWireless && Number.isFinite(video.currentTime)) {
      position = video.currentTime;
    }
  };
  const recordPlaybackIntent = () => {
    // Ignore pauses caused by detaching MMS or disconnecting the remote route.
    if (active && !seekPending && video.webkitCurrentPlaybackTargetIsWireless) shouldPlay = !video.paused;
  };
  const seek = () => {
    if (!active || !seekPending || !Number.isFinite(video.duration) || video.duration <= 0) return;
    video.currentTime = Math.min(position, Math.max(0, video.duration - 1));
    seekPending = false;
  };
  const onWireless = () => {
    if (!active) return;
    if (video.webkitCurrentPlaybackTargetIsWireless) { connected = true; recordPlaybackIntent(); }
    else if (connected) restore();
  };
  const onError = (event?: Event) => {
    if (!active) return;
    // Artplayer otherwise schedules its own delayed reconnect to the old URL.
    event?.stopImmediatePropagation();
    restore();
    hooks.failure();
  };
  video.addEventListener('loadedmetadata', seek);
  video.addEventListener('canplay', seek);
  video.addEventListener('timeupdate', recordPosition);
  video.addEventListener('seeked', recordSeek);
  video.addEventListener('playing', recordPlaybackIntent);
  video.addEventListener('pause', recordPlaybackIntent);
  video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWireless);
  video.addEventListener('error', onError, true);

  return {
    get active() { return active; },
    request(url: string): boolean {
      if (disposed || !video.canPlayType('application/vnd.apple.mpegurl') ||
        typeof video.webkitShowPlaybackTargetPicker !== 'function' || !/^https?:\/\//i.test(url)) return false;
      try {
        if (!active || sourceUrl !== url) {
          reset();
          position = Number.isFinite(video.currentTime) ? video.currentTime : 0;
          shouldPlay = !video.paused;
          crossOrigin = video.getAttribute('crossorigin');
          active = seekPending = true;
          sourceUrl = url;
          hooks.beforeNative();
          video.pause();
          video.removeAttribute('crossorigin');
          video.querySelectorAll('source').forEach(source => source.remove());
          video.src = url;
          video.disableRemotePlayback = false;
          video.load();
          // Both calls stay in the click gesture; no async availability cache.
          void video.play().catch(() => {});
        }
        video.webkitShowPlaybackTargetPicker();
        return true;
      } catch {
        onError();
        return false;
      }
    },
    reset,
    dispose() {
      reset();
      disposed = true;
      video.removeEventListener('loadedmetadata', seek);
      video.removeEventListener('canplay', seek);
      video.removeEventListener('timeupdate', recordPosition);
      video.removeEventListener('seeked', recordSeek);
      video.removeEventListener('playing', recordPlaybackIntent);
      video.removeEventListener('pause', recordPlaybackIntent);
      video.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWireless);
      video.removeEventListener('error', onError, true);
    },
  };
}
