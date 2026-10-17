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
