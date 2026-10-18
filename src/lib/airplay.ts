export type AirPlayVideo = HTMLVideoElement & {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
};

export function supportsNativeAirPlay(video: AirPlayVideo): boolean {
  return !!video.canPlayType('application/vnd.apple.mpegurl') &&
    typeof video.webkitShowPlaybackTargetPicker === 'function';
}

export function startNativeHlsPlayback(
  video: AirPlayVideo,
  url: string,
  options: { startTime?: number; onError: () => void; onPlayRejected?: () => void; onRemoteError?: () => void }
): () => void {
  const crossOrigin = video.getAttribute('crossorigin');
  const autoplay = video.autoplay;
  const remote = video.remote;
  let wireless = !!video.webkitCurrentPlaybackTargetIsWireless || remote?.state === 'connected';
  let position = options.startTime ?? 0;
  let pendingPosition: number | null = position;
  let disposed = false;
  const rememberPosition = () => {
    if (Number.isFinite(video.currentTime) && (video.currentTime > 0 || video.readyState >= 1)) {
      position = video.currentTime;
    }
  };
  const loadLocal = () => {
    video.querySelectorAll('source').forEach(source => source.remove());
    // Native Safari HLS does not need CORS for local playback. A forced
    // anonymous CORS request would reject otherwise playable stream hosts.
    video.removeAttribute('crossorigin');
    video.disableRemotePlayback = false;
    video.setAttribute('x-webkit-airplay', 'allow');
    video.src = url;
    video.load();
  };
  const onMetadata = () => {
    if (disposed || wireless) return;
    if (pendingPosition !== null) {
      const end = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.1) : Infinity;
      video.currentTime = Math.min(pendingPosition, end);
      pendingPosition = null;
    }
    video.play().catch(() => {
      if (!disposed) options.onPlayRejected?.();
    });
  };
  const onWireless = (connected: boolean) => {
    if (connected === wireless || disposed) return;
    // On disconnect Safari may already have reset currentTime to zero.
    // Preserve the last timeupdate instead of sampling that reset timeline.
    if (connected) rememberPosition();
    const returning = wireless && !connected;
    wireless = connected;
    if (returning) {
      // Reopen a real native URL instead of reusing the detached MMS blob.
      pendingPosition = position;
      loadLocal();
    }
  };
  const onWebkitWireless = () => onWireless(!!video.webkitCurrentPlaybackTargetIsWireless);
  const onConnect = () => onWireless(true);
  const onDisconnect = () => onWireless(false);
  const onError = () => {
    if (wireless || video.webkitCurrentPlaybackTargetIsWireless || remote?.state === 'connecting' || remote?.state === 'connected') options.onRemoteError?.();
    else options.onError();
  };
  video.autoplay = false; // Seek to the saved position before starting playback.
  video.addEventListener('loadedmetadata', onMetadata);
  video.addEventListener('timeupdate', rememberPosition);
  video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWebkitWireless);
  video.addEventListener('error', onError);
  remote?.addEventListener('connecting', onConnect);
  remote?.addEventListener('connect', onConnect);
  remote?.addEventListener('disconnect', onDisconnect);
  loadLocal();
  return () => {
    disposed = true;
    video.removeEventListener('loadedmetadata', onMetadata);
    video.removeEventListener('timeupdate', rememberPosition);
    video.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWebkitWireless);
    video.removeEventListener('error', onError);
    remote?.removeEventListener('connect', onConnect);
    remote?.removeEventListener('connecting', onConnect);
    remote?.removeEventListener('disconnect', onDisconnect);
    video.autoplay = autoplay;
    if (crossOrigin === null) video.removeAttribute('crossorigin');
    else video.setAttribute('crossorigin', crossOrigin);
  };
}

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
