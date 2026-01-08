<script lang="ts" generics="NodeType extends Node = Node, EdgeType extends Edge = Edge">
  import { onDestroy } from 'svelte';

  import { NodeWrapper } from '$lib/components/NodeWrapper';
  import { StaggeredResizeObserver } from '$lib/utils/staggeredResizeObserver';

  import type { Node, Edge, NodeEvents } from '$lib/types';
  import type { SvelteFlowStore } from '$lib/store/types';

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

  // Use StaggeredResizeObserver to prevent lag spikes when many nodes mount at once.
  // Instead of observing all nodes in a single frame, observations are batched
  // across multiple frames (5 per frame by default).
  const resizeObserver: StaggeredResizeObserver | null =
    typeof ResizeObserver === 'undefined'
      ? null
      : new StaggeredResizeObserver((entries: ResizeObserverEntry[]) => {
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
        }, 30); // Process 5 observe() calls per frame

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
