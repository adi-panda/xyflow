import type { InternalNode, Node } from '../types';
export type PanDirection = {
    x: number;
    y: number;
};
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
export declare class ProgressiveNodeBatcher<NodeType extends Node = Node> {
    private pendingNodes;
    private renderedNodes;
    private batchSize;
    private threshold;
    private debug;
    private debugPerf;
    private rafId;
    private accumulator;
    private isFlushing;
    private rafScheduleTime;
    private flushRafScheduleTime;
    private onUpdate;
    private cachedReturnMap;
    private cachedPendingMap;
    private dirty;
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
     * Update the visible nodes. Returns the nodes that should actually be rendered.
     * If there are too many new nodes, they'll be queued and added progressively.
     *
     * @param viewportPos - Optional viewport position for velocity tracking.
     *   If maxPanVelocity is set, progressive loading only happens when velocity is below the threshold.
     */
    updateVisibleNodes(allVisibleNodes: Map<string, InternalNode<NodeType>>, previouslyRenderedNodes: Map<string, InternalNode<NodeType>>, viewportPos?: {
        x: number;
        y: number;
    }): Map<string, InternalNode<NodeType>>;
    private scheduleNextBatch;
    /**
     * Schedule a delayed check to detect when panning has stopped.
     * If no updateVisibleNodes call happens for STALE_VELOCITY_THRESHOLD_MS,
     * we assume the user has stopped panning and should start processing pending nodes.
     */
    private scheduleStaleVelocityCheck;
    /**
     * Get the currently rendered nodes.
     */
    getRenderedNodes(): Map<string, InternalNode<NodeType>>;
    /**
     * Get nodes that are pending to be rendered (for placeholder display).
     * Returns a cached snapshot that's consistent with getRenderedNodes().
     */
    getPendingNodes(): Map<string, InternalNode<NodeType>>;
    /**
     * Check if there are nodes still pending to be rendered.
     */
    hasPendingNodes(): boolean;
    /**
     * Flush all pending nodes immediately (can cause lag with many nodes).
     */
    flush(): void;
    /**
     * Flush pending nodes gradually over multiple frames to avoid lag spikes.
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
        maxPanVelocity?: number;
    }): void;
    /**
     * Enable or disable RAF performance logging.
     * When enabled, logs timing info for each RAF callback to help identify lag sources.
     */
    setDebugPerf(enabled: boolean): void;
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
