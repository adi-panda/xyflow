import type { Edge, EdgeLayouted } from '../types';
/**
 * Manages progressive loading of edges to prevent lag spikes when many edges
 * become visible at once during rapid panning.
 *
 * When the number of newly visible edges exceeds a threshold, edges are added
 * in batches across multiple frames instead of all at once.
 */
export declare class ProgressiveEdgeBatcher<EdgeType extends Edge = Edge> {
    private pendingEdges;
    private renderedEdges;
    private rafId;
    private batchSize;
    private threshold;
    private onUpdate;
    private accumulator;
    private isFlushing;
    constructor(options: {
        threshold: number;
        batchSize: number;
        onUpdate: () => void;
    });
    /**
     * Update the visible edges. Returns the edges that should actually be rendered.
     * If there are too many new edges, they'll be queued and added progressively.
     */
    updateVisibleEdges(allVisibleEdges: Map<string, EdgeLayouted<EdgeType>>, previouslyRenderedEdges: Map<string, EdgeLayouted<EdgeType>>): Map<string, EdgeLayouted<EdgeType>>;
    private scheduleNextBatch;
    /**
     * Get the currently rendered edges.
     */
    getRenderedEdges(): Map<string, EdgeLayouted<EdgeType>>;
    /**
     * Check if there are edges still pending to be rendered.
     */
    hasPendingEdges(): boolean;
    /**
     * Flush all pending edges immediately (can cause lag with many edges).
     */
    flush(): void;
    /**
     * Flush pending edges gradually over multiple frames to avoid lag spikes.
     * Uses larger batches than normal progressive loading for faster completion.
     */
    flushGradually(batchSize?: number): void;
    /**
     * Reset the batcher state.
     */
    reset(): void;
    /**
     * Update configuration.
     */
    updateConfig(options: {
        threshold?: number;
        batchSize?: number;
    }): void;
    /**
     * Cleanup.
     */
    destroy(): void;
}
