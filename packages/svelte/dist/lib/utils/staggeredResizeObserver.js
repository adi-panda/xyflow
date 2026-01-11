/**
 * A wrapper around ResizeObserver that staggers observe() calls across
 * multiple animation frames to prevent lag spikes when many nodes mount at once.
 *
 * Instead of calling resizeObserver.observe() for 50 nodes in a single frame,
 * this queues them and processes a small batch each frame.
 */
export class StaggeredResizeObserver {
    observer;
    pendingObserveList = [];
    pendingObserveSet = new Set(); // For O(1) lookups
    pendingUnobserve = new Set();
    rafId = null;
    batchSize;
    listIndex = 0; // Pointer to avoid O(n) shift()
    debugPerf = false; // Enable RAF performance logging
    rafScheduleTime = 0; // When RAF was scheduled
    constructor(callback, batchSize = 5) {
        this.observer = new ResizeObserver(callback);
        this.batchSize = batchSize;
    }
    /**
     * Queue an element to be observed. The actual observe() call will be
     * staggered across frames to prevent layout thrashing.
     */
    observe(element) {
        // If it was pending unobserve, just cancel that
        if (this.pendingUnobserve.has(element)) {
            this.pendingUnobserve.delete(element);
            return;
        }
        // Avoid duplicates - O(1) with Set
        if (!this.pendingObserveSet.has(element)) {
            this.pendingObserveList.push(element);
            this.pendingObserveSet.add(element);
            this.scheduleProcessing();
        }
    }
    /**
     * Unobserve an element immediately (unobserve is cheap).
     * Also removes from pending queue if not yet observed.
     */
    unobserve(element) {
        // Remove from pending queue if it's there - O(1) check with Set
        if (this.pendingObserveSet.has(element)) {
            this.pendingObserveSet.delete(element);
            // Note: element stays in list but will be skipped in processBatch
            return;
        }
        // Mark for unobserve (will be processed in next batch to avoid
        // unobserving something we haven't observed yet)
        this.pendingUnobserve.add(element);
        this.scheduleProcessing();
    }
    /**
     * Immediately observe all pending elements (use sparingly).
     */
    flush() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        // Process all unobserves first
        for (const element of this.pendingUnobserve) {
            this.observer.unobserve(element);
        }
        this.pendingUnobserve.clear();
        // Then observe all pending (only elements still in Set, starting from current index)
        for (let i = this.listIndex; i < this.pendingObserveList.length; i++) {
            const element = this.pendingObserveList[i];
            if (this.pendingObserveSet.has(element)) {
                this.observer.observe(element);
            }
        }
        this.pendingObserveList = [];
        this.pendingObserveSet.clear();
        this.listIndex = 0;
    }
    /**
     * Disconnect the underlying ResizeObserver and clear all pending operations.
     */
    disconnect() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.pendingObserveList = [];
        this.pendingObserveSet.clear();
        this.pendingUnobserve.clear();
        this.listIndex = 0;
        this.observer.disconnect();
    }
    scheduleProcessing() {
        if (this.rafId !== null)
            return;
        this.rafScheduleTime = performance.now();
        this.rafId = requestAnimationFrame(() => {
            const rafStart = performance.now();
            const rafDelay = rafStart - this.rafScheduleTime;
            this.rafId = null;
            const processed = this.processBatch();
            const rafDuration = performance.now() - rafStart;
            if (this.debugPerf && (rafDelay > 500 || rafDuration > 500)) {
                console.warn(`[StaggeredResizeObserver] SLOW RAF - delay: ${rafDelay.toFixed(1)}ms, duration: ${rafDuration.toFixed(1)}ms, observed: ${processed} elements`);
            }
        });
    }
    processBatch() {
        // Process unobserves first (they're cheap and prevent wasted work)
        for (const element of this.pendingUnobserve) {
            this.observer.unobserve(element);
        }
        this.pendingUnobserve.clear();
        // Process a batch of observes using index pointer (O(1) per element instead of O(n) shift)
        let processed = 0;
        while (this.listIndex < this.pendingObserveList.length && processed < this.batchSize) {
            const element = this.pendingObserveList[this.listIndex];
            this.listIndex++;
            // Only observe if still in Set (wasn't unobserved)
            if (this.pendingObserveSet.has(element)) {
                this.pendingObserveSet.delete(element);
                this.observer.observe(element);
                processed++;
            }
        }
        // Compact the list when we've processed everything to prevent memory growth
        if (this.listIndex >= this.pendingObserveList.length) {
            this.pendingObserveList = [];
            this.listIndex = 0;
        }
        else if (this.listIndex > 1000) {
            // Periodically compact if we have many processed elements to prevent memory bloat
            this.pendingObserveList = this.pendingObserveList.slice(this.listIndex);
            this.listIndex = 0;
        }
        // Schedule next batch if there's more
        if (this.pendingObserveSet.size > 0) {
            this.scheduleProcessing();
        }
        return processed;
    }
    /**
     * Update the batch size for processing.
     */
    setBatchSize(size) {
        this.batchSize = size;
    }
    /**
     * Check if there are pending observations.
     */
    hasPending() {
        return this.pendingObserveSet.size > 0 || this.pendingUnobserve.size > 0;
    }
    /**
     * Enable or disable RAF performance logging.
     * When enabled, logs timing info for each RAF callback to help identify lag sources.
     */
    setDebugPerf(enabled) {
        this.debugPerf = enabled;
    }
}
