import type { InternalNode, Node } from '$lib/types';

/**
 * Manages progressive loading of nodes to prevent lag spikes when many nodes
 * become visible at once during rapid panning.
 *
 * When the number of newly visible nodes exceeds a threshold, nodes are added
 * in batches across multiple frames instead of all at once.
 */
export class ProgressiveNodeBatcher<NodeType extends Node = Node> {
  private pendingNodes: Map<string, InternalNode<NodeType>> = new Map();
  private renderedNodes: Map<string, InternalNode<NodeType>> = new Map();
  private rafId: number | null = null;
  private batchSize: number;
  private threshold: number;
  private onUpdate: () => void;
  private accumulator: number = 0; // For fractional batch sizes

  constructor(options: { threshold: number; batchSize: number; onUpdate: () => void }) {
    this.threshold = options.threshold;
    this.batchSize = options.batchSize;
    this.onUpdate = options.onUpdate;
  }

  /**
   * Update the visible nodes. Returns the nodes that should actually be rendered.
   * If there are too many new nodes, they'll be queued and added progressively.
   */
  updateVisibleNodes(
    allVisibleNodes: Map<string, InternalNode<NodeType>>,
    previouslyRenderedNodes: Map<string, InternalNode<NodeType>>
  ): Map<string, InternalNode<NodeType>> {
    // If progressive loading is disabled (threshold = 0), return all nodes immediately
    if (this.threshold === 0) {
      this.renderedNodes = allVisibleNodes;
      return allVisibleNodes;
    }

    // Find newly visible nodes (in allVisible but not in previouslyRendered)
    const newlyVisible: Map<string, InternalNode<NodeType>> = new Map();
    for (const [id, node] of allVisibleNodes) {
      if (!previouslyRenderedNodes.has(id) && !this.renderedNodes.has(id)) {
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
      // Add new nodes to pending queue
      for (const [id, node] of newlyVisible) {
        this.pendingNodes.set(id, node);
      }

      // Start progressive loading if not already running
      this.scheduleNextBatch();
    } else if (newlyVisible.size > 0) {
      // Below threshold - add all new nodes immediately
      for (const [id, node] of newlyVisible) {
        this.renderedNodes.set(id, node);
      }
    }

    // Return a new Map so Svelte detects the change
    return new Map(this.renderedNodes);
  }

  private scheduleNextBatch() {
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
        if (added >= nodesToAdd) break;

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
  getRenderedNodes(): Map<string, InternalNode<NodeType>> {
    return this.renderedNodes;
  }

  /**
   * Check if there are nodes still pending to be rendered.
   */
  hasPendingNodes(): boolean {
    return this.pendingNodes.size > 0;
  }

  /**
   * Flush all pending nodes immediately (useful when panning stops).
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
    this.pendingNodes.clear();
    this.renderedNodes.clear();
  }
}
