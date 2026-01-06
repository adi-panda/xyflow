import type { Node } from '../types';
/**
 * Hook for receiving data of one or multiple nodes
 *
 * @public
 * @param nodeId - The id (or ids) of the node to get the data from
 * @returns An array of data objects
 */
export declare function useNodesData<NodeType extends Node = Node>(nodeId: string): {
    current: Pick<NodeType, 'id' | 'data' | 'type'> | null;
};
export declare function useNodesData<NodeType extends Node = Node>(nodeIds: string[]): {
    current: Pick<NodeType, 'id' | 'data' | 'type'>[];
};
