/**
 * Manages progressive loading of nodes to prevent lag spikes when many nodes
 * become visible at once during rapid panning.
 *
 * When the number of newly visible nodes exceeds a threshold, nodes are added
 * in batches across multiple frames instead of all at once.
 *
 * Nodes are sorted by their position relative to the pan direction, so nodes
 * entering the viewport from the direction you're panning appear first.
 */
export class ProgressiveNodeBatcher {
    pendingNodes = new Map();
    renderedNodes = new Map();
    batchSize;
    threshold;
    debug = false; // Enable debug logging
    debugPerf = false; // Enable RAF performance logging
    // RAF and batching state
    rafId = null;
    accumulator = 0;
    isFlushing = false;
    rafScheduleTime = 0; // When RAF was scheduled
    flushRafScheduleTime = 0; // When flush RAF was scheduled
    // Callback for when rendered nodes change
    onUpdate = null;
    // Cache to avoid creating new Maps when nothing changed
    cachedReturnMap = null;
    cachedPendingMap = new Map();
    dirty = true;
    // Velocity tracking for pan-speed-based loading
    maxPanVelocity; // pixels per second - only load when below this
    lastViewportPos = null;
    lastUpdateTime = 0;
    currentVelocity = 0;
    isPanningFast = false;
    staleCheckTimeoutId = null;
    STALE_VELOCITY_THRESHOLD_MS = 100; // If no update for this long, assume stopped
    constructor(options) {
        this.threshold = options.threshold;
        this.batchSize = options.batchSize;
        this.onUpdate = options.onUpdate ?? null;
        this.maxPanVelocity = options.maxPanVelocity ?? 0; // 0 = disabled (always load)
    }
    /**
     * Update the visible nodes. Returns the nodes that should actually be rendered.
     * If there are too many new nodes, they'll be queued and added progressively.
     *
     * @param viewportPos - Optional viewport position for velocity tracking.
     *   If maxPanVelocity is set, progressive loading only happens when velocity is below the threshold.
     */
    updateVisibleNodes(allVisibleNodes, previouslyRenderedNodes, viewportPos) {
        // Update velocity tracking if viewport position is provided
        if (viewportPos && this.maxPanVelocity > 0) {
            const now = performance.now();
            if (this.lastViewportPos !== null && this.lastUpdateTime > 0) {
                const dt = (now - this.lastUpdateTime) / 1000; // seconds
                if (dt > 0) {
                    const dx = viewportPos.x - this.lastViewportPos.x;
                    const dy = viewportPos.y - this.lastViewportPos.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    this.currentVelocity = distance / dt; // pixels per second
                    this.isPanningFast = this.currentVelocity > this.maxPanVelocity;
                    if (this.debug) {
                        console.log(`[NodeBatcher] velocity: ${this.currentVelocity.toFixed(0)} px/s, fast: ${this.isPanningFast}`);
                    }
                }
            }
            this.lastViewportPos = { ...viewportPos };
            this.lastUpdateTime = now;
        }
        // If progressive loading is disabled (threshold = 0), return all nodes immediately
        if (this.threshold === 0) {
            this.renderedNodes = allVisibleNodes;
            return allVisibleNodes;
        }
        let hasChanges = false;
        // Find newly visible nodes (in allVisible but not already rendered or pending)
        const newlyVisible = new Map();
        for (const [id, node] of allVisibleNodes) {
            if (!previouslyRenderedNodes.has(id) &&
                !this.renderedNodes.has(id) &&
                !this.pendingNodes.has(id)) {
                newlyVisible.set(id, node);
            }
        }
        // Find nodes that are no longer visible (were rendered but not in allVisible)
        for (const id of this.renderedNodes.keys()) {
            if (!allVisibleNodes.has(id)) {
                this.renderedNodes.delete(id);
                hasChanges = true;
            }
        }
        // Also remove from pending if no longer visible
        for (const id of this.pendingNodes.keys()) {
            if (!allVisibleNodes.has(id)) {
                this.pendingNodes.delete(id);
                hasChanges = true; // Mark as changed so cache updates
            }
        }
        // Update existing rendered nodes with fresh data (references may have changed)
        for (const [id, node] of allVisibleNodes) {
            if (this.renderedNodes.has(id)) {
                const existing = this.renderedNodes.get(id);
                // Only update if the node reference actually changed
                if (existing !== node) {
                    this.renderedNodes.set(id, node);
                    hasChanges = true;
                }
            }
            // Also update pending nodes with fresh data to keep placeholder positions accurate
            if (this.pendingNodes.has(id)) {
                const existing = this.pendingNodes.get(id);
                if (existing !== node) {
                    this.pendingNodes.set(id, node);
                    hasChanges = true;
                }
            }
        }
        // If new nodes exceed threshold, queue them for progressive loading
        if (newlyVisible.size > this.threshold) {
            if (this.debug) {
                console.log(`[NodeBatcher] PROGRESSIVE: ${newlyVisible.size} new nodes > threshold ${this.threshold}, queueing`);
            }
            // Cancel any scheduled RAF but DON'T clear pending nodes that are still visible
            // Clearing them causes flickering because they're not in newlyVisible (already in pending)
            // and would be lost
            if (!this.isFlushing && this.rafId !== null) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
                this.accumulator = 0;
            }
            // Add new nodes to pending queue (existing pending nodes that are still visible remain)
            for (const [id, node] of newlyVisible) {
                this.pendingNodes.set(id, node);
            }
            hasChanges = true; // Mark as changed so cache updates
            // Start progressive loading only if:
            // 1. Not already flushing
            // 2. Not panning too fast (or velocity tracking is disabled)
            if (!this.isFlushing && !this.isPanningFast) {
                this.scheduleNextBatch();
            }
            else if (this.isPanningFast) {
                if (this.debug) {
                    console.log(`[NodeBatcher] Panning fast, deferring batch scheduling`);
                }
                // Schedule a check for when panning stops (velocity becomes stale)
                this.scheduleStaleVelocityCheck();
            }
        }
        else if (newlyVisible.size > 0) {
            // Below threshold - add all new nodes immediately
            if (this.debug) {
                console.log(`[NodeBatcher] IMMEDIATE: ${newlyVisible.size} new nodes <= threshold ${this.threshold}, adding all at once`);
            }
            for (const [id, node] of newlyVisible) {
                this.renderedNodes.set(id, node);
            }
            hasChanges = true;
        }
        // If we have pending nodes and velocity just dropped below threshold, start processing
        if (this.pendingNodes.size > 0 &&
            !this.isPanningFast &&
            !this.isFlushing &&
            this.rafId === null) {
            if (this.debug) {
                console.log(`[NodeBatcher] Velocity dropped, starting to process ${this.pendingNodes.size} pending nodes`);
            }
            this.scheduleNextBatch();
        }
        // Only create new Maps if something actually changed
        if (hasChanges || this.dirty || this.cachedReturnMap === null) {
            this.cachedReturnMap = new Map(this.renderedNodes);
            this.cachedPendingMap = new Map(this.pendingNodes);
            this.dirty = false;
        }
        return this.cachedReturnMap;
    }
    scheduleNextBatch() {
        if (this.rafId !== null || this.pendingNodes.size === 0) {
            return;
        }
        this.rafScheduleTime = performance.now();
        this.rafId = requestAnimationFrame(() => {
            const rafStart = performance.now();
            const rafDelay = rafStart - this.rafScheduleTime;
            this.rafId = null;
            // Accumulate batch size (supports fractional values like 0.1)
            // e.g., batchSize=0.1 means add 1 node every 10 frames
            this.accumulator += this.batchSize;
            const nodesToAdd = Math.floor(this.accumulator);
            this.accumulator -= nodesToAdd;
            // Add next batch of nodes
            let added = 0;
            for (const [id, node] of this.pendingNodes) {
                if (added >= nodesToAdd)
                    break;
                this.renderedNodes.set(id, node);
                this.pendingNodes.delete(id);
                added++;
            }
            if (this.debug) {
                console.log(`[NodeBatcher] BATCH: added ${added} nodes, ${this.pendingNodes.size} still pending`);
            }
            // Notify that rendered nodes changed
            if (added > 0) {
                this.dirty = true; // Mark dirty so next updateVisibleNodes creates new Map
                // Update cached pending map immediately to prevent flicker
                this.cachedPendingMap = new Map(this.pendingNodes);
                this.onUpdate?.();
            }
            const rafDuration = performance.now() - rafStart;
            if (this.debugPerf && (rafDelay > 500 || rafDuration > 500)) {
                console.warn(`[NodeBatcher:scheduleNextBatch] SLOW RAF - delay: ${rafDelay.toFixed(1)}ms, duration: ${rafDuration.toFixed(1)}ms, added: ${added} nodes`);
            }
            // Schedule next batch if more pending
            if (this.pendingNodes.size > 0) {
                this.scheduleNextBatch();
            }
        });
    }
    /**
     * Schedule a delayed check to detect when panning has stopped.
     * If no updateVisibleNodes call happens for STALE_VELOCITY_THRESHOLD_MS,
     * we assume the user has stopped panning and should start processing pending nodes.
     */
    scheduleStaleVelocityCheck() {
        // Don't schedule multiple checks
        if (this.staleCheckTimeoutId !== null) {
            return;
        }
        this.staleCheckTimeoutId = setTimeout(() => {
            this.staleCheckTimeoutId = null;
            // Check if velocity data is stale (no recent updates)
            const now = performance.now();
            const timeSinceLastUpdate = now - this.lastUpdateTime;
            if (timeSinceLastUpdate >= this.STALE_VELOCITY_THRESHOLD_MS) {
                // No updates for a while - user has stopped panning
                this.isPanningFast = false;
                this.currentVelocity = 0;
                if (this.debug) {
                    console.log(`[NodeBatcher] Velocity stale (${timeSinceLastUpdate.toFixed(0)}ms since last update), resetting to 0`);
                }
                // Start processing pending nodes if we have any
                if (this.pendingNodes.size > 0 && !this.isFlushing && this.rafId === null) {
                    if (this.debug) {
                        console.log(`[NodeBatcher] Starting to process ${this.pendingNodes.size} pending nodes after pan stop`);
                    }
                    this.scheduleNextBatch();
                }
            }
            else {
                // Still getting updates, schedule another check
                this.scheduleStaleVelocityCheck();
            }
        }, this.STALE_VELOCITY_THRESHOLD_MS);
    }
    /**
     * Get the currently rendered nodes.
     */
    getRenderedNodes() {
        return this.renderedNodes;
    }
    /**
     * Get nodes that are pending to be rendered (for placeholder display).
     * Returns a cached snapshot that's consistent with getRenderedNodes().
     */
    getPendingNodes() {
        return this.cachedPendingMap;
    }
    /**
     * Check if there are nodes still pending to be rendered.
     */
    hasPendingNodes() {
        return this.pendingNodes.size > 0;
    }
    /**
     * Flush all pending nodes immediately (can cause lag with many nodes).
     */
    flush() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.pendingNodes.size === 0) {
            return;
        }
        // Add all pending nodes immediately
        for (const [id, node] of this.pendingNodes) {
            this.renderedNodes.set(id, node);
        }
        this.pendingNodes.clear();
        this.dirty = true;
        // Update cached pending map immediately to prevent flicker
        this.cachedPendingMap = new Map();
        this.onUpdate?.();
    }
    /**
     * Flush pending nodes gradually over multiple frames to avoid lag spikes.
     * Uses larger batches than normal progressive loading for faster completion.
     */
    flushGradually(batchSize = 50) {
        // Cancel any existing batch operation first
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.pendingNodes.size === 0) {
            this.isFlushing = false;
            return;
        }
        // Mark that we're in flush mode to prevent updateVisibleNodes from interrupting
        this.isFlushing = true;
        this.flushRafScheduleTime = performance.now();
        this.rafId = requestAnimationFrame(() => {
            const rafStart = performance.now();
            const rafDelay = rafStart - this.flushRafScheduleTime;
            this.rafId = null;
            let added = 0;
            for (const [id, node] of this.pendingNodes) {
                if (added >= batchSize)
                    break;
                this.renderedNodes.set(id, node);
                this.pendingNodes.delete(id);
                added++;
            }
            if (added > 0) {
                this.dirty = true;
                // Update cached pending map immediately to prevent flicker
                this.cachedPendingMap = new Map(this.pendingNodes);
                this.onUpdate?.();
            }
            const rafDuration = performance.now() - rafStart;
            if (this.debugPerf && (rafDelay > 500 || rafDuration > 500)) {
                console.warn(`[NodeBatcher:flushGradually] SLOW RAF - delay: ${rafDelay.toFixed(1)}ms, duration: ${rafDuration.toFixed(1)}ms, added: ${added} nodes`);
            }
            // Continue flushing if more pending
            if (this.pendingNodes.size > 0) {
                this.flushGradually(batchSize);
            }
            else {
                this.isFlushing = false;
            }
        });
    }
    /**
     * Reset the batcher state.
     */
    reset() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.staleCheckTimeoutId !== null) {
            clearTimeout(this.staleCheckTimeoutId);
            this.staleCheckTimeoutId = null;
        }
        this.pendingNodes.clear();
        this.renderedNodes.clear();
        this.cachedReturnMap = null;
        this.cachedPendingMap = new Map();
        this.dirty = true;
        this.accumulator = 0;
        this.isFlushing = false;
        // Reset velocity tracking
        this.lastViewportPos = null;
        this.lastUpdateTime = 0;
        this.currentVelocity = 0;
        this.isPanningFast = false;
    }
    /**
     * Update configuration.
     */
    updateConfig(options) {
        if (options.threshold !== undefined) {
            this.threshold = options.threshold;
        }
        if (options.batchSize !== undefined) {
            this.batchSize = options.batchSize;
        }
        if (options.maxPanVelocity !== undefined) {
            this.maxPanVelocity = options.maxPanVelocity;
        }
    }
    /**
     * Enable or disable RAF performance logging.
     * When enabled, logs timing info for each RAF callback to help identify lag sources.
     */
    setDebugPerf(enabled) {
        this.debugPerf = enabled;
    }
    /**
     * Get the current pan velocity in pixels per second.
     */
    getCurrentVelocity() {
        return this.currentVelocity;
    }
    /**
     * Check if currently panning too fast for progressive loading.
     */
    isPanningTooFast() {
        return this.isPanningFast;
    }
    /**
     * Cleanup.
     */
    destroy() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.staleCheckTimeoutId !== null) {
            clearTimeout(this.staleCheckTimeoutId);
            this.staleCheckTimeoutId = null;
        }
        this.pendingNodes.clear();
        this.renderedNodes.clear();
        this.cachedReturnMap = null;
        this.cachedPendingMap = new Map();
        this.dirty = true;
        this.isFlushing = false;
        this.lastViewportPos = null;
        this.lastUpdateTime = 0;
        this.currentVelocity = 0;
        this.isPanningFast = false;
    }
}
