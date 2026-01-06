/**
 * Manages progressive loading of edges to prevent lag spikes when many edges
 * become visible at once during rapid panning.
 *
 * When the number of newly visible edges exceeds a threshold, edges are added
 * in batches across multiple frames instead of all at once.
 */
export class ProgressiveEdgeBatcher {
    pendingEdges = new Map();
    renderedEdges = new Map();
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
     * Update the visible edges. Returns the edges that should actually be rendered.
     * If there are too many new edges, they'll be queued and added progressively.
     */
    updateVisibleEdges(allVisibleEdges, previouslyRenderedEdges) {
        // If progressive loading is disabled (threshold = 0), return all edges immediately
        if (this.threshold === 0) {
            this.renderedEdges = allVisibleEdges;
            return allVisibleEdges;
        }
        // Find newly visible edges (in allVisible but not already rendered or pending)
        const newlyVisible = new Map();
        for (const [id, edge] of allVisibleEdges) {
            if (!previouslyRenderedEdges.has(id) && !this.renderedEdges.has(id) && !this.pendingEdges.has(id)) {
                newlyVisible.set(id, edge);
            }
        }
        // Find edges that are no longer visible (were rendered but not in allVisible)
        for (const id of this.renderedEdges.keys()) {
            if (!allVisibleEdges.has(id)) {
                this.renderedEdges.delete(id);
            }
        }
        // Also remove from pending if no longer visible
        for (const id of this.pendingEdges.keys()) {
            if (!allVisibleEdges.has(id)) {
                this.pendingEdges.delete(id);
            }
        }
        // Update existing rendered edges with fresh data
        for (const [id, edge] of allVisibleEdges) {
            if (this.renderedEdges.has(id)) {
                this.renderedEdges.set(id, edge);
            }
        }
        // If new edges exceed threshold, queue them for progressive loading
        if (newlyVisible.size > this.threshold) {
            // Clear any existing pending edges to prevent accumulation
            // This keeps the batcher focused on the current viewport
            // BUT don't interrupt if we're in the middle of a gradual flush
            if (this.pendingEdges.size > 0 && !this.isFlushing) {
                if (this.rafId !== null) {
                    cancelAnimationFrame(this.rafId);
                    this.rafId = null;
                }
                this.pendingEdges.clear();
                this.accumulator = 0;
            }
            // Add new edges to pending queue
            for (const [id, edge] of newlyVisible) {
                this.pendingEdges.set(id, edge);
            }
            // Start progressive loading (only if not already flushing)
            if (!this.isFlushing) {
                this.scheduleNextBatch();
            }
        }
        else if (newlyVisible.size > 0) {
            // Below threshold - add all new edges immediately
            for (const [id, edge] of newlyVisible) {
                this.renderedEdges.set(id, edge);
            }
        }
        // Return a new Map so Svelte detects the change
        return new Map(this.renderedEdges);
    }
    scheduleNextBatch() {
        if (this.rafId !== null || this.pendingEdges.size === 0) {
            return;
        }
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            // Accumulate batch size (supports fractional values like 0.1)
            // e.g., batchSize=0.1 means add 1 edge every 10 frames
            this.accumulator += this.batchSize;
            const edgesToAdd = Math.floor(this.accumulator);
            this.accumulator -= edgesToAdd;
            // Add next batch of edges
            let added = 0;
            for (const [id, edge] of this.pendingEdges) {
                if (added >= edgesToAdd)
                    break;
                this.renderedEdges.set(id, edge);
                this.pendingEdges.delete(id);
                added++;
            }
            // Notify that rendered edges changed
            if (added > 0) {
                this.onUpdate();
            }
            // Schedule next batch if more pending
            if (this.pendingEdges.size > 0) {
                this.scheduleNextBatch();
            }
        });
    }
    /**
     * Get the currently rendered edges.
     */
    getRenderedEdges() {
        return this.renderedEdges;
    }
    /**
     * Check if there are edges still pending to be rendered.
     */
    hasPendingEdges() {
        return this.pendingEdges.size > 0;
    }
    /**
     * Flush all pending edges immediately (can cause lag with many edges).
     */
    flush() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        // Add all pending edges immediately
        for (const [id, edge] of this.pendingEdges) {
            this.renderedEdges.set(id, edge);
        }
        this.pendingEdges.clear();
        this.onUpdate();
    }
    /**
     * Flush pending edges gradually over multiple frames to avoid lag spikes.
     * Uses larger batches than normal progressive loading for faster completion.
     */
    flushGradually(batchSize = 50) {
        // Cancel any existing batch operation first
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.pendingEdges.size === 0) {
            this.isFlushing = false;
            return;
        }
        // Mark that we're in flush mode to prevent updateVisibleEdges from interrupting
        this.isFlushing = true;
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            let added = 0;
            for (const [id, edge] of this.pendingEdges) {
                if (added >= batchSize)
                    break;
                this.renderedEdges.set(id, edge);
                this.pendingEdges.delete(id);
                added++;
            }
            if (added > 0) {
                this.onUpdate();
            }
            // Continue flushing if more pending
            if (this.pendingEdges.size > 0) {
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
        this.pendingEdges.clear();
        this.renderedEdges.clear();
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
        this.pendingEdges.clear();
        this.renderedEdges.clear();
        this.isFlushing = false;
    }
}
