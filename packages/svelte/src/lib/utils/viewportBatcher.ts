import type { Viewport } from '@xyflow/system';

/**
 * Batches viewport updates using requestAnimationFrame to prevent
 * excessive reactivity triggers during panning/zooming.
 *
 * This utility queues viewport updates and applies only the latest value
 * in the next animation frame, reducing the number of visibility
 * recalculations from ~60+ per second to max 1 per frame.
 *
 * Additionally supports throttling to further reduce update frequency
 * for better performance with large graphs.
 */
export class ViewportBatcher {
  private rafId: number | null = null;
  private pendingViewport: Viewport | null = null;
  private applyFn: (viewport: Viewport) => void;
  private throttleMs: number;
  private lastUpdateTime = 0;

  constructor(applyFn: (viewport: Viewport) => void, throttleMs = 0) {
    this.applyFn = applyFn;
    this.throttleMs = throttleMs;
  }

  /**
   * Schedule a viewport update. If a frame is already scheduled,
   * the pending viewport is replaced with the new one (only the
   * latest update is applied).
   *
   * If throttling is enabled, updates will only be applied if enough
   * time has passed since the last update.
   */
  schedule(viewport: Viewport): void {
    this.pendingViewport = viewport;

    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        if (this.pendingViewport) {
          const now = performance.now();
          const timeSinceLastUpdate = now - this.lastUpdateTime;

          // Apply update only if throttle time has elapsed
          if (timeSinceLastUpdate >= this.throttleMs) {
            this.applyFn(this.pendingViewport);
            this.lastUpdateTime = now;
            this.pendingViewport = null;
          } else {
            // Schedule another RAF to check again after the throttle period
            this.rafId = null;
            const remainingTime = this.throttleMs - timeSinceLastUpdate;
            setTimeout(() => {
              if (this.pendingViewport) {
                this.applyFn(this.pendingViewport);
                this.lastUpdateTime = performance.now();
                this.pendingViewport = null;
              }
            }, remainingTime);
            return;
          }
        }
        this.rafId = null;
      });
    }
  }

  /**
   * Immediately flush any pending viewport update, bypassing
   * the animation frame delay. Useful for ensuring pixel-perfect
   * positioning when panning stops.
   */
  flush(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.pendingViewport) {
      this.applyFn(this.pendingViewport);
      this.pendingViewport = null;
    }
  }

  /**
   * Cancel any pending updates and clean up state.
   * Should be called when the batcher is no longer needed.
   */
  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingViewport = null;
  }
}
