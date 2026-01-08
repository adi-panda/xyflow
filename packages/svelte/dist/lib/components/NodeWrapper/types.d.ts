import type { SvelteFlowStore } from '../../store/types';
import type { Node, Edge, InternalNode } from '../../types';
export type ConnectableContext = {
    value: boolean;
};
/**
 * Minimal interface for ResizeObserver-like objects.
 * Allows both native ResizeObserver and StaggeredResizeObserver to be used.
 */
export interface ResizeObserverLike {
    observe(target: Element): void;
    unobserve(target: Element): void;
}
export type NodeWrapperProps<NodeType extends Node = Node, EdgeType extends Edge = Edge> = {
    node: InternalNode<NodeType>;
    store: SvelteFlowStore<NodeType, EdgeType>;
    nodeClickDistance?: number;
    resizeObserver?: ResizeObserverLike | null;
};
