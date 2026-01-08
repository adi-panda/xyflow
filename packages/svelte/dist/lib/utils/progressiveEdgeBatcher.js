/**
 * Manages progressive loading of edges to prevent lag spikes when many edges
 * become visible at once during rapid panning.
 *
 * When the number of newly visible edges exceeds a threshold, only a batch
 * of edges are added per updateVisibleEdges call instead of all at once.
 * The remaining edges are queued and added on subsequent calls.
 */
export class ProgressiveEdgeBatcher {
    pendingEdges = new Map();
    renderedEdges = new Map();
    batchSize;
    threshold;
    // Cache to avoid creating new Maps when nothing changed
    cachedReturnMap = null;
    dirty = true;
    // Callback for when rendered edges change
    onUpdate = null;
    constructor(options) {
        this.threshold = options.threshold;
        this.batchSize = options.batchSize;
        this.onUpdate = options.onUpdate ?? null;
    }
    /**
     * Update the visible edges. Returns the edges that should actually be rendered.
     * If there are too many new edges, they'll be queued and added progressively
     * on subsequent calls.
     */
    updateVisibleEdges(allVisibleEdges, previouslyRenderedEdges) {
        // If progressive loading is disabled (threshold = 0), return all edges immediately
        if (this.threshold === 0) {
            this.renderedEdges = allVisibleEdges;
            return allVisibleEdges;
        }
        let hasChanges = false;
        // Find newly visible edges (in allVisible but not already rendered or pending)
        const newlyVisible = new Map();
        for (const [id, edge] of allVisibleEdges) {
            if (!previouslyRenderedEdges.has(id) &&
                !this.renderedEdges.has(id) &&
                !this.pendingEdges.has(id)) {
                newlyVisible.set(id, edge);
            }
        }
        // Find edges that are no longer visible (were rendered but not in allVisible)
        for (const id of this.renderedEdges.keys()) {
            if (!allVisibleEdges.has(id)) {
                this.renderedEdges.delete(id);
                hasChanges = true;
            }
        }
        // Also remove from pending if no longer visible
        for (const id of this.pendingEdges.keys()) {
            if (!allVisibleEdges.has(id)) {
                this.pendingEdges.delete(id);
            }
        }
        // Update existing rendered edges with fresh data (references may have changed)
        for (const [id, edge] of allVisibleEdges) {
            if (this.renderedEdges.has(id)) {
                const existing = this.renderedEdges.get(id);
                // Only update if the edge reference actually changed
                if (existing !== edge) {
                    this.renderedEdges.set(id, edge);
                    hasChanges = true;
                }
            }
        }
        // Process pending edges first - add a batch of them to rendered
        if (this.pendingEdges.size > 0) {
            let added = 0;
            for (const [id, edge] of this.pendingEdges) {
                if (added >= this.batchSize)
                    break;
                // Only add if still visible
                if (allVisibleEdges.has(id)) {
                    this.renderedEdges.set(id, edge);
                    hasChanges = true;
                }
                this.pendingEdges.delete(id);
                added++;
            }
        }
        // If new edges exceed threshold, queue them for progressive loading
        if (newlyVisible.size > this.threshold) {
            // Add new edges to pending queue
            for (const [id, edge] of newlyVisible) {
                this.pendingEdges.set(id, edge);
            }
            // Add first batch immediately
            let added = 0;
            for (const [id, edge] of this.pendingEdges) {
                if (added >= this.batchSize)
                    break;
                if (allVisibleEdges.has(id)) {
                    this.renderedEdges.set(id, edge);
                    hasChanges = true;
                }
                this.pendingEdges.delete(id);
                added++;
            }
        }
        else if (newlyVisible.size > 0) {
            // Below threshold - add all new edges immediately
            for (const [id, edge] of newlyVisible) {
                this.renderedEdges.set(id, edge);
            }
            hasChanges = true;
        }
        // Only create a new Map if something actually changed
        if (hasChanges || this.dirty || this.cachedReturnMap === null) {
            this.cachedReturnMap = new Map(this.renderedEdges);
            this.dirty = false;
        }
        return this.cachedReturnMap;
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
     * Flush all pending edges immediately.
     */
    flush() {
        for (const [id, edge] of this.pendingEdges) {
            this.renderedEdges.set(id, edge);
        }
        this.pendingEdges.clear();
        this.dirty = true;
        this.onUpdate?.();
    }
    /**
     * Flush pending edges gradually (adds batchSize edges).
     * Call this multiple times to gradually flush all pending edges.
     */
    flushGradually(batchSize) {
        const size = batchSize ?? this.batchSize;
        let added = 0;
        for (const [id, edge] of this.pendingEdges) {
            if (added >= size)
                break;
            this.renderedEdges.set(id, edge);
            this.pendingEdges.delete(id);
            added++;
        }
        if (added > 0) {
            this.dirty = true;
            this.onUpdate?.();
        }
    }
    /**
     * Reset the batcher state.
     */
    reset() {
        this.pendingEdges.clear();
        this.renderedEdges.clear();
        this.cachedReturnMap = null;
        this.dirty = true;
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
        this.pendingEdges.clear();
        this.renderedEdges.clear();
        this.cachedReturnMap = null;
        this.dirty = true;
    }
}
