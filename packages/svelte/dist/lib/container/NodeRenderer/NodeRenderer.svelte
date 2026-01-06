<script lang="ts" generics="NodeType extends Node = Node, EdgeType extends Edge = Edge">
  import { onDestroy } from 'svelte';

  import { NodeWrapper } from '../../components/NodeWrapper';

  import type { Node, Edge, NodeEvents } from '../../types';
  import type { SvelteFlowStore } from '../../store/types';

  let {
    store = $bindable(),
    nodeClickDistance,
    onnodeclick,
    onnodecontextmenu,
    onnodepointerenter,
    onnodepointermove,
    onnodepointerleave,
    onnodedrag,
    onnodedragstart,
    onnodedragstop
  }: {
    store: SvelteFlowStore<NodeType, EdgeType>;
    nodeClickDistance?: number;
  } & NodeEvents<NodeType> = $props();

  let pendingResizeUpdates = new Map<string, ResizeObserverEntry>();

  const resizeObserver: ResizeObserver | null =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries: ResizeObserverEntry[]) => {
          // Skip updates during panning to reduce layout thrashing
          // Store pending updates to process after dragging stops
          if (store.dragging) {
            entries.forEach((entry) => {
              const id = entry.target.getAttribute('data-id') as string;
              pendingResizeUpdates.set(id, entry);
            });
            return;
          }

          // eslint-disable-next-line svelte/prefer-svelte-reactivity
          const updates = new Map();

          entries.forEach((entry: ResizeObserverEntry) => {
            const id = entry.target.getAttribute('data-id') as string;

            updates.set(id, {
              id,
              nodeElement: entry.target as HTMLDivElement,
              force: true
            });
          });

          store.updateNodeInternals(updates);
        });

  // Process pending resize updates after panning stops
  $effect(() => {
    if (!store.dragging && pendingResizeUpdates.size > 0) {
      const updates = new Map();

      pendingResizeUpdates.forEach((entry) => {
        const id = entry.target.getAttribute('data-id') as string;
        updates.set(id, {
          id,
          nodeElement: entry.target as HTMLDivElement,
          force: true
        });
      });

      store.updateNodeInternals(updates);
      pendingResizeUpdates.clear();
    }
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
  });
</script>

<div class="svelte-flow__nodes">
  {#each store.visible.nodes.values() as node (node.id)}
    <NodeWrapper
      bind:store
      {node}
      {resizeObserver}
      {nodeClickDistance}
      {onnodeclick}
      {onnodepointerenter}
      {onnodepointermove}
      {onnodepointerleave}
      {onnodedrag}
      {onnodedragstart}
      {onnodedragstop}
      {onnodecontextmenu}
    />
  {/each}
</div>
