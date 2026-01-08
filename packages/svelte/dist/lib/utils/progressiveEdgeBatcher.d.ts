import type { Edge, EdgeLayouted } from '../types';
export type PanDirection = {
    x: number;
    y: number;
};
/**
 * Manages progressive loading of edges to prevent lag spikes when many edges
 * become visible at once during rapid panning.
 *
 * When the number of newly visible edges exceeds a threshold, only a batch
 * of edges are added per updateVisibleEdges call instead of all at once.
 * The remaining edges are queued and added on subsequent calls.
 */
export declare class ProgressiveEdgeBatcher<EdgeType extends Edge = Edge> {
    private pendingEdges;
    private renderedEdges;
    private batchSize;
    private threshold;
    private cachedReturnMap;
    private dirty;
    private onUpdate;
    constructor(options: {
        threshold: number;
        batchSize: number;
        onUpdate?: () => void;
    });
    /**
     * Update the visible edges. Returns the edges that should actually be rendered.
     * If there are too many new edges, they'll be queued and added progressively
     * on subsequent calls.
     */
    updateVisibleEdges(allVisibleEdges: Map<string, EdgeLayouted<EdgeType>>, previouslyRenderedEdges: Map<string, EdgeLayouted<EdgeType>>): Map<string, EdgeLayouted<EdgeType>>;
    /**
     * Get the currently rendered edges.
     */
    getRenderedEdges(): Map<string, EdgeLayouted<EdgeType>>;
    /**
     * Check if there are edges still pending to be rendered.
     */
    hasPendingEdges(): boolean;
    /**
     * Flush all pending edges immediately.
     */
    flush(): void;
    /**
     * Flush pending edges gradually (adds batchSize edges).
     * Call this multiple times to gradually flush all pending edges.
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
