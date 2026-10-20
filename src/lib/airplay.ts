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
  let duration = 0;
  let metadataReady = false;
  let shouldPlay = false;
  let seekPending = false;
  let crossOrigin: string | null = null;
  let sourceUrl = '';

  const reset = () => {
    if (active) {
      if (crossOrigin === null) video.removeAttribute('crossorigin');
      else video.setAttribute('crossorigin', crossOrigin);
    }
    active = connected = seekPending = metadataReady = false;
    sourceUrl = '';
  };
  const restore = () => {
    if (!active) return;
    recordPosition();
    const lastPosition = position;
    reset();
    hooks.restore(lastPosition, shouldPlay);
  };
  const confirmSeek = () => {
    if (seekPending && metadataReady && !video.seeking &&
      Number.isFinite(video.currentTime) && video.currentTime >= position - 1) seekPending = false;
  };
  const recordPosition = () => {
    if (!active) return;
    if (Number.isFinite(video.duration) && video.duration > 0) duration = video.duration;
    confirmSeek();
    if (!seekPending && !video.seeking && Number.isFinite(video.currentTime) && video.currentTime > 0 && video.currentTime >= position - 1) {
      position = video.currentTime;
    }
  };
  const recordSeek = () => {
    if (!active) return;
    if (seekPending) { confirmSeek(); return; }
    if (!video.seeking && Number.isFinite(video.currentTime)) position = video.currentTime;
  };
  const recordPlaybackIntent = () => {
    // Ignore pauses caused by detaching MMS or disconnecting the remote route.
    if (active && !seekPending && video.webkitCurrentPlaybackTargetIsWireless) shouldPlay = !video.paused;
  };
  const seek = () => {
    if (!active || !seekPending || !Number.isFinite(video.duration) || video.duration <= 0) return;
    duration = video.duration;
    position = Math.min(position, Math.max(0, duration - 1));
    // Assigning currentTime requests a seek; it does not mean the seek has finished.
    try { video.currentTime = position; } catch { /* Retry when more metadata arrives. */ }
  };
  const onMetadata = () => {
    if (!active) return;
    // Some receivers report the route before reloading the media at zero.
    if (!seekPending && !video.seeking && position > 1 && video.currentTime < position - 1) seekPending = true;
    metadataReady = true;
    seek();
  };
  const onWireless = () => {
    if (!active) return;
    if (video.webkitCurrentPlaybackTargetIsWireless) {
      connected = true;
      // The remote route can reset the media element after the initial native seek.
      if (!seekPending && !video.seeking && position > 1 && video.currentTime < position - 1) { seekPending = true; seek(); }
      else confirmSeek();
      recordPlaybackIntent();
    } else if (connected) restore();
  };
  const onError = (event?: Event) => {
    if (!active) return;
    // Artplayer otherwise schedules its own delayed reconnect to the old URL.
    event?.stopImmediatePropagation();
    restore();
    hooks.failure();
  };
  video.addEventListener('loadedmetadata', onMetadata);
  video.addEventListener('canplay', onMetadata);
  video.addEventListener('timeupdate', recordPosition);
  video.addEventListener('seeked', recordSeek);
  video.addEventListener('playing', recordPlaybackIntent);
  video.addEventListener('pause', recordPlaybackIntent);
  video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWireless);
  video.addEventListener('error', onError, true);

  return {
    get active() { return active; },
    get progress() { recordPosition(); return { position, duration }; },
    request(url: string): boolean {
      if (disposed || !video.canPlayType('application/vnd.apple.mpegurl') ||
        typeof video.webkitShowPlaybackTargetPicker !== 'function' || !/^https?:\/\//i.test(url)) return false;
      try {
        if (!active || sourceUrl !== url) {
          reset();
          position = Number.isFinite(video.currentTime) ? video.currentTime : 0;
          duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
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
          // HAVE_NOTHING stores this as the default start position, avoiding a fetch at zero first.
          try { video.currentTime = position; } catch { /* loadedmetadata retries the seek. */ }
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
      video.removeEventListener('loadedmetadata', onMetadata);
      video.removeEventListener('canplay', onMetadata);
      video.removeEventListener('timeupdate', recordPosition);
      video.removeEventListener('seeked', recordSeek);
      video.removeEventListener('playing', recordPlaybackIntent);
      video.removeEventListener('pause', recordPlaybackIntent);
      video.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWireless);
      video.removeEventListener('error', onError, true);
    },
  };
}


/** Shared by periodic, pause, hidden-page and teardown history writes. */
export function getPlaybackProgress(
  video: Pick<HTMLVideoElement, 'currentTime' | 'duration' | 'seeking'>,
  restored: boolean,
  airplay?: Pick<ReturnType<typeof createNativeAirPlay>, 'active' | 'progress'> | null,
): { position: number; duration: number } | null {
  if (!restored) return null;
  const progress = airplay?.active ? airplay.progress :
    !video.seeking ? { position: video.currentTime, duration: video.duration } : null;
  return progress && Number.isFinite(progress.position) && progress.position >= 0 &&
    Number.isFinite(progress.duration) && progress.duration > 0 ? progress : null;
}
