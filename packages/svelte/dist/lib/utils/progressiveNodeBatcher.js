/**
 * Manages progressive loading of nodes to prevent lag spikes when many nodes
 * become visible at once during rapid panning.
 *
 * When the number of newly visible nodes exceeds a threshold, nodes are added
 * in batches across multiple frames instead of all at once.
 */
export class ProgressiveNodeBatcher {
    pendingNodes = new Map();
    renderedNodes = new Map();
    rafId = null;
    batchSize;
    threshold;
    onUpdate;
    accumulator = 0; // For fractional batch sizes
    isFlushing = false; // Prevents interruption during gradual flush
    constructor(options) {
        this.threshold = options.threshold;
        this.batchSize = options.batchSize;
        this.onUpdate = options.onUpdate;
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
        // Find newly visible nodes (in allVisible but not already rendered or pending)
        const newlyVisible = new Map();
        for (const [id, node] of allVisibleNodes) {
            if (!previouslyRenderedNodes.has(id) && !this.renderedNodes.has(id) && !this.pendingNodes.has(id)) {
                newlyVisible.set(id, node);
            }
        }
        // Find nodes that are no longer visible (were rendered but not in allVisible)
        for (const id of this.renderedNodes.keys()) {
            if (!allVisibleNodes.has(id)) {
                this.renderedNodes.delete(id);
            }
        }
        // Also remove from pending if no longer visible
        for (const id of this.pendingNodes.keys()) {
            if (!allVisibleNodes.has(id)) {
                this.pendingNodes.delete(id);
            }
        }
        // Update existing rendered nodes with fresh data
        for (const [id, node] of allVisibleNodes) {
            if (this.renderedNodes.has(id)) {
                this.renderedNodes.set(id, node);
            }
        }
        // If new nodes exceed threshold, queue them for progressive loading
        if (newlyVisible.size > this.threshold) {
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
            for (const [id, node] of newlyVisible) {
                this.renderedNodes.set(id, node);
            }
        }
        // Return a new Map so Svelte detects the change
        return new Map(this.renderedNodes);
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
            // Notify that rendered nodes changed
            if (added > 0) {
                this.onUpdate();
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
        // Add all pending nodes immediately
        for (const [id, node] of this.pendingNodes) {
            this.renderedNodes.set(id, node);
        }
        this.pendingNodes.clear();
        this.onUpdate();
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
                this.onUpdate();
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
        this.isFlushing = false;
    }
}
