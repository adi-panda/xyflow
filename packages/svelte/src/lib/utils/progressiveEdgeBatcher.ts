import type { Edge, EdgeLayouted } from '$lib/types';

/**
 * Manages progressive loading of edges to prevent lag spikes when many edges
 * become visible at once during rapid panning.
 *
 * When the number of newly visible edges exceeds a threshold, edges are added
 * in batches across multiple frames instead of all at once.
 *
 * Edges only render when their source and target nodes are already rendered
 * (checked via canRender callback).
 */
export class ProgressiveEdgeBatcher<EdgeType extends Edge = Edge> {
  private pendingEdges: Map<string, EdgeLayouted<EdgeType>> = new Map();
  private renderedEdges: Map<string, EdgeLayouted<EdgeType>> = new Map();
  private rafId: number | null = null;
  private batchSize: number;
  private threshold: number;
  private onUpdate: () => void;
  private accumulator: number = 0; // For fractional batch sizes
  // Callback to check if an edge's nodes are rendered (set externally each frame)
  canRender: ((edge: EdgeLayouted<EdgeType>) => boolean) | null = null;

  constructor(options: { threshold: number; batchSize: number; onUpdate: () => void }) {
    this.threshold = options.threshold;
    this.batchSize = options.batchSize;
    this.onUpdate = options.onUpdate;
  }

  /**
   * Update the visible edges. Returns the edges that should actually be rendered.
   * If there are too many new edges, they'll be queued and added progressively.
   */
  updateVisibleEdges(
    allVisibleEdges: Map<string, EdgeLayouted<EdgeType>>,
    previouslyRenderedEdges: Map<string, EdgeLayouted<EdgeType>>
  ): Map<string, EdgeLayouted<EdgeType>> {
    // If progressive loading is disabled (threshold = 0), return all edges immediately
    if (this.threshold === 0) {
      this.renderedEdges = allVisibleEdges;
      return allVisibleEdges;
    }

    // Find newly visible edges (in allVisible but not in previouslyRendered)
    const newlyVisible: Map<string, EdgeLayouted<EdgeType>> = new Map();
    for (const [id, edge] of allVisibleEdges) {
      if (!previouslyRenderedEdges.has(id) && !this.renderedEdges.has(id)) {
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
      // Add new edges to pending queue
      for (const [id, edge] of newlyVisible) {
        this.pendingEdges.set(id, edge);
      }

      // Start progressive loading if not already running
      this.scheduleNextBatch();
    } else {
      // Below threshold - add all new edges immediately
      for (const [id, edge] of newlyVisible) {
        this.renderedEdges.set(id, edge);
      }
    }

    // Return a new Map so Svelte detects the change
    return new Map(this.renderedEdges);
  }

  private scheduleNextBatch() {
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

      // Add next batch of edges (only those whose nodes are rendered)
      let added = 0;
      for (const [id, edge] of this.pendingEdges) {
        if (added >= edgesToAdd) break;

        // Check if this edge's nodes are rendered (if callback provided)
        if (this.canRender && !this.canRender(edge)) {
          // Skip this edge - its nodes aren't ready yet
          continue;
        }

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
  getRenderedEdges(): Map<string, EdgeLayouted<EdgeType>> {
    return this.renderedEdges;
  }

  /**
   * Check if there are edges still pending to be rendered.
   */
  hasPendingEdges(): boolean {
    return this.pendingEdges.size > 0;
  }

  /**
   * Flush all pending edges immediately (useful when panning stops).
   * Only flushes edges whose nodes are rendered (if canRender is set).
   */
  flush() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Add all pending edges that can be rendered
    const toRemove: string[] = [];
    for (const [id, edge] of this.pendingEdges) {
      // Only add if nodes are ready (or no canRender check)
      if (!this.canRender || this.canRender(edge)) {
        this.renderedEdges.set(id, edge);
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.pendingEdges.delete(id);
    }

    this.onUpdate();
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
  }

  /**
   * Update configuration.
   */
  updateConfig(options: { threshold?: number; batchSize?: number }) {
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
  }
}
