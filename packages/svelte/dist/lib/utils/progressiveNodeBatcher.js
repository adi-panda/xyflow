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
    panDirection = { x: 0, y: 0 }; // Current pan direction (viewport delta)
    // RAF and batching state
    rafId = null;
    accumulator = 0;
    isFlushing = false;
    // Throttle updates during progressive loading to reduce derivation frequency
    lastUpdateTime = 0;
    UPDATE_THROTTLE_MS = 50; // Update at most every 50ms during batching
    // Callback for when rendered nodes change
    onUpdate = null;
    // Cache to avoid creating new Maps when nothing changed
    cachedReturnMap = null;
    lastRenderedSize = 0;
    dirty = true;
    constructor(options) {
        this.threshold = options.threshold;
        this.batchSize = options.batchSize;
        this.onUpdate = options.onUpdate ?? null;
    }
    /**
     * Update the pan direction. This affects how pending nodes are sorted.
     * @param direction The viewport delta (positive x = panning left, negative x = panning right)
     */
    setPanDirection(direction) {
        this.panDirection = direction;
    }
    /**
     * Update the visible nodes. Returns the nodes that should actually be rendered.
     * If there are too many new nodes, they'll be queued and added progressively.
     */
    updateVisibleNodes(allVisibleNodes, previouslyRenderedNodes) {
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
        }
        // If new nodes exceed threshold, queue them for progressive loading
        if (newlyVisible.size > this.threshold) {
            if (this.debug) {
                console.log(`[NodeBatcher] PROGRESSIVE: ${newlyVisible.size} new nodes > threshold ${this.threshold}, queueing`);
            }
            // Clear any existing pending nodes to prevent accumulation
            // This keeps the batcher focused on the current viewport
            // BUT don't interrupt if we're in the middle of a gradual flush
            if (this.pendingNodes.size > 0 && !this.isFlushing) {
                if (this.rafId !== null) {
                    cancelAnimationFrame(this.rafId);
                    this.rafId = null;
                }
                this.pendingNodes.clear();
                this.accumulator = 0;
            }
            // Add new nodes to pending queue
            for (const [id, node] of newlyVisible) {
                this.pendingNodes.set(id, node);
            }
            // Start progressive loading (only if not already flushing)
            if (!this.isFlushing) {
                this.scheduleNextBatch();
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
        // Only create a new Map if something actually changed
        if (hasChanges || this.dirty || this.cachedReturnMap === null) {
            this.cachedReturnMap = new Map(this.renderedNodes);
            this.lastRenderedSize = this.renderedNodes.size;
            this.dirty = false;
        }
        return this.cachedReturnMap;
    }
    scheduleNextBatch() {
        if (this.rafId !== null || this.pendingNodes.size === 0) {
            return;
        }
        this.rafId = requestAnimationFrame(() => {
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
                this.onUpdate?.();
            }
            // Schedule next batch if more pending
            if (this.pendingNodes.size > 0) {
                this.scheduleNextBatch();
            }
        });
    }
    /**
     * Get the currently rendered nodes.
     */
    getRenderedNodes() {
        return this.renderedNodes;
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
        this.rafId = requestAnimationFrame(() => {
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
                this.onUpdate?.();
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
        this.pendingNodes.clear();
        this.renderedNodes.clear();
        this.cachedReturnMap = null;
        this.lastRenderedSize = 0;
        this.dirty = true;
        this.accumulator = 0;
        this.isFlushing = false;
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
    }
    /**
     * Cleanup.
     */
    destroy() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.pendingNodes.clear();
        this.renderedNodes.clear();
        this.cachedReturnMap = null;
        this.lastRenderedSize = 0;
        this.dirty = true;
        this.isFlushing = false;
    }
}
