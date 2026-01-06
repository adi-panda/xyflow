import type { InternalNode, Node } from '../types';
/**
 * Manages progressive loading of nodes to prevent lag spikes when many nodes
 * become visible at once during rapid panning.
 *
 * When the number of newly visible nodes exceeds a threshold, nodes are added
 * in batches across multiple frames instead of all at once.
 */
export declare class ProgressiveNodeBatcher<NodeType extends Node = Node> {
    private pendingNodes;
    private renderedNodes;
    private rafId;
    private batchSize;
    private threshold;
    private onUpdate;
    private accumulator;
    constructor(options: {
        threshold: number;
        batchSize: number;
        onUpdate: () => void;
    });
    /**
     * Update the visible nodes. Returns the nodes that should actually be rendered.
     * If there are too many new nodes, they'll be queued and added progressively.
     */
    updateVisibleNodes(allVisibleNodes: Map<string, InternalNode<NodeType>>, previouslyRenderedNodes: Map<string, InternalNode<NodeType>>): Map<string, InternalNode<NodeType>>;
    private scheduleNextBatch;
    /**
     * Get the currently rendered nodes.
     */
    getRenderedNodes(): Map<string, InternalNode<NodeType>>;
    /**
     * Check if there are nodes still pending to be rendered.
     */
    hasPendingNodes(): boolean;
    /**
     * Flush all pending nodes immediately (useful when panning stops).
     */
    flush(): void;
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
