/**
 * Batches viewport updates using requestAnimationFrame to prevent
 * excessive reactivity triggers during panning/zooming.
 *
 * Additionally supports:
 * - Throttling to reduce update frequency
 * - Velocity-based adaptive throttling (slower updates during rapid panning)
 */
export class ViewportBatcher {
    rafId = null;
    pendingViewport = null;
    applyFn;
    throttleMs;
    lastApplyTime = -Infinity;
    // Velocity tracking for rapid pan detection
    lastViewport = null;
    lastScheduleTime = -Infinity;
    // RAF performance logging
    debugPerf = false;
    rafScheduleTime = 0;
    constructor(applyFn, throttleMs = 0) {
        this.applyFn = applyFn;
        this.throttleMs = throttleMs;
    }
    schedule(viewport) {
        this.pendingViewport = viewport;
        // Track velocity for rapid pan detection
        const now = performance.now();
        if (this.lastViewport && this.lastScheduleTime !== -Infinity) {
            const deltaTime = now - this.lastScheduleTime;
            if (deltaTime > 0) {
                const deltaX = viewport.x - this.lastViewport.x;
                const deltaY = viewport.y - this.lastViewport.y;
            }
        }
        this.lastViewport = viewport;
        this.lastScheduleTime = now;
        this.ensureRaf();
    }
    ensureRaf() {
        if (this.rafId !== null)
            return;
        this.rafScheduleTime = performance.now();
        const tick = () => {
            const rafStart = performance.now();
            const rafDelay = rafStart - this.rafScheduleTime;
            this.rafId = null;
            if (!this.pendingViewport)
                return;
            const now = performance.now();
            // Use rapid throttle during fast panning, normal throttle otherwise
            const currentThrottle = this.throttleMs;
            let applied = false;
            // Apply update if throttle period has passed
            if (now - this.lastApplyTime >= currentThrottle) {
                const vp = this.pendingViewport;
                this.pendingViewport = null;
                this.lastApplyTime = now;
                this.applyFn(vp);
                applied = true;
            }
            const rafDuration = performance.now() - rafStart;
            if (this.debugPerf && (rafDelay > 500 || rafDuration > 500)) {
                console.warn(`[ViewportBatcher] SLOW RAF - delay: ${rafDelay.toFixed(1)}ms, duration: ${rafDuration.toFixed(1)}ms, applied: ${applied}`);
            }
            // If we still have a pending viewport (either because we didn't apply due
            // to throttle, or because schedule() was called during apply), keep looping.
            if (this.pendingViewport)
                this.ensureRaf();
        };
        this.rafId = requestAnimationFrame(tick);
    }
    flush() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.pendingViewport) {
            this.applyFn(this.pendingViewport);
            this.pendingViewport = null;
            this.lastApplyTime = performance.now();
        }
    }
    destroy() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.pendingViewport = null;
    }
    /**
     * Enable or disable RAF performance logging.
     * When enabled, logs timing info for each RAF callback to help identify lag sources.
     */
    setDebugPerf(enabled) {
        this.debugPerf = enabled;
    }
}
