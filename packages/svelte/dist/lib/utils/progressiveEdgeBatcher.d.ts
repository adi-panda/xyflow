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
    private maxPanVelocity;
    private lastViewportPos;
    private lastUpdateTime;
    private currentVelocity;
    private isPanningFast;
    private staleCheckTimeoutId;
    private readonly STALE_VELOCITY_THRESHOLD_MS;
    constructor(options: {
        threshold: number;
        batchSize: number;
        onUpdate?: () => void;
        maxPanVelocity?: number;
    });
    /**
     * Update the visible edges. Returns the edges that should actually be rendered.
     * If there are too many new edges, they'll be queued and added progressively
     * on subsequent calls.
     *
     * @param viewportPos - Optional viewport position for velocity tracking.
     *   If maxPanVelocity is set, progressive loading only happens when velocity is below the threshold.
     */
    updateVisibleEdges(allVisibleEdges: Map<string, EdgeLayouted<EdgeType>>, previouslyRenderedEdges: Map<string, EdgeLayouted<EdgeType>>, viewportPos?: {
        x: number;
        y: number;
    }): Map<string, EdgeLayouted<EdgeType>>;
    /**
     * Schedule a delayed check to detect when panning has stopped.
     * If no updateVisibleEdges call happens for STALE_VELOCITY_THRESHOLD_MS,
     * we assume the user has stopped panning and should trigger an update.
     */
    private scheduleStaleVelocityCheck;
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
        maxPanVelocity?: number;
    }): void;
    /**
     * Get the current pan velocity in pixels per second.
     */
    getCurrentVelocity(): number;
    /**
     * Check if currently panning too fast for progressive loading.
     */
    isPanningTooFast(): boolean;
    /**
     * Cleanup.
     */
    destroy(): void;
}
