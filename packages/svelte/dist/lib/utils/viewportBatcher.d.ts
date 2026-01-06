import type { Viewport } from '@xyflow/system';
/**
 * Batches viewport updates using requestAnimationFrame to prevent
 * excessive reactivity triggers during panning/zooming.
 *
 * Additionally supports:
 * - Throttling to reduce update frequency
 * - Velocity-based adaptive throttling (slower updates during rapid panning)
 */
export declare class ViewportBatcher {
    private rafId;
    private pendingViewport;
    private applyFn;
    private throttleMs;
    private lastApplyTime;
    private lastViewport;
    private lastScheduleTime;
    constructor(applyFn: (viewport: Viewport) => void, throttleMs?: number);
    schedule(viewport: Viewport): void;
    private ensureRaf;
    flush(): void;
    destroy(): void;
}
