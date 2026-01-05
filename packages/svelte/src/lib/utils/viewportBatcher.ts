import type { Viewport } from '@xyflow/system';

/**
 * Batches viewport updates using requestAnimationFrame to prevent
 * excessive reactivity triggers during panning/zooming.
 *
 * This utility queues viewport updates and applies only the latest value
 * in the next animation frame, reducing the number of visibility
 * recalculations from ~60+ per second to max 1 per frame.
 */
export class ViewportBatcher {
  private rafId: number | null = null;
  private pendingViewport: Viewport | null = null;
  private applyFn: (viewport: Viewport) => void;

  constructor(applyFn: (viewport: Viewport) => void) {
    this.applyFn = applyFn;
  }

  /**
   * Schedule a viewport update. If a frame is already scheduled,
   * the pending viewport is replaced with the new one (only the
   * latest update is applied).
   */
  schedule(viewport: Viewport): void {
    this.pendingViewport = viewport;

    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        if (this.pendingViewport) {
          this.applyFn(this.pendingViewport);
          this.pendingViewport = null;
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
