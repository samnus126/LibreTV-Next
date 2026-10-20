/** iPadOS desktop browsing identifies itself as a touch-capable Mac. */
export function isAppleMobile(navigator: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Rotate only web fullscreen. Safari controls orientation in its native video UI;
 * calling screen.orientation.lock there can reject with a NotAllowedError.
 */
export function createWebFullscreenRotation(player: HTMLElement, video: HTMLVideoElement, onRotate: (rotated: boolean) => void) {
  let disposed = false;
  const clear = () => {
    player.style.width = '';
    player.style.height = '';
    player.style.transformOrigin = '';
    player.style.transform = '';
    player.classList.remove('art-auto-orientation');
    onRotate(false);
  };
  return {
    setActive(active: boolean) {
      if (disposed) return;
      const viewport = player.ownerDocument.documentElement;
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      const { videoWidth, videoHeight } = video;
      const mismatch = videoWidth > videoHeight && width < height || videoWidth < videoHeight && width > height;
      if (!active || !videoWidth || !videoHeight || !mismatch) { clear(); return; }
      player.style.width = `${height}px`;
      player.style.height = `${width}px`;
      player.style.transformOrigin = '0 0';
      player.style.transform = `rotate(90deg) translate(0, -${width}px)`;
      player.classList.add('art-auto-orientation');
      onRotate(true);
    },
    dispose() { clear(); disposed = true; },
  };
}
