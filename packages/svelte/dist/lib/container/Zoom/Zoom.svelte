<script lang="ts" generics="NodeType extends Node = Node, EdgeType extends Edge = Edge">
  import { type PanZoomInstance, type Transform } from '@xyflow/system';

  import zoom from '../../actions/zoom';
  import type { ZoomProps } from './types';
  import type { Node, Edge } from '../../types';

  let {
    store = $bindable(),
    panOnScrollMode,
    preventScrolling,
    zoomOnScroll,
    zoomOnDoubleClick,
    zoomOnPinch,
    panOnDrag,
    panOnScroll,
    panOnScrollSpeed,
    paneClickDistance,
    selectionOnDrag,
    onmovestart,
    onmove,
    onmoveend,
    oninit,
    children
  }: ZoomProps<NodeType, EdgeType> = $props();

  let panOnDragActive = $derived(store.panActivationKeyPressed || panOnDrag);
  let panOnScrollActive = $derived(store.panActivationKeyPressed || panOnScroll);

  // We extract the initial value by destructuring
  const { viewport: initialViewport } = store;

  let onInitCalled = false;
  $effect(() => {
    if (!onInitCalled && store.viewportInitialized) {
      // Initialize viewport batching if enabled
      if (store.batchViewportUpdates) {
        store.initViewportBatching();
      }
      // Initialize progressive node loading if enabled
      if (store.progressiveNodeThreshold > 0) {
        store.initProgressiveNodeBatching();
      }
      // Initialize progressive edge loading if enabled
      if (store.progressiveEdgeThreshold > 0) {
        store.initProgressiveEdgeBatching();
      }
      oninit?.();
      onInitCalled = true;
    }
  });

  // Cleanup effect to destroy batchers on unmount
  $effect(() => {
    return () => {
      store.destroyViewportBatching();
      store.destroyProgressiveNodeBatching();
      store.destroyProgressiveEdgeBatching();
    };
  });
</script>

<div
  class="svelte-flow__zoom svelte-flow__container"
  use:zoom={{
    viewport: store.viewport,
    minZoom: store.minZoom,
    maxZoom: store.maxZoom,
    initialViewport,
    onDraggingChange: (dragging: boolean) => {
      store.dragging = dragging;
    },
    setPanZoomInstance: (instance: PanZoomInstance) => {
      store.panZoom = instance;
    },
    onPanZoomStart: onmovestart,
    onPanZoom: onmove,
    onPanZoomEnd: (event, viewport) => {
      // Flush pending updates for pixel-perfect final positioning
      store.viewportBatcher?.flush();
      // Flush any remaining progressive nodes/edges so they render immediately when panning stops
      store.flushProgressiveNodes();
      store.flushProgressiveEdges();
      onmoveend?.(event, viewport);
    },
    zoomOnScroll,
    zoomOnDoubleClick,
    zoomOnPinch,
    panOnScroll: panOnScrollActive,
    panOnDrag: panOnDragActive,
    panOnScrollSpeed,
    panOnScrollMode,
    zoomActivationKeyPressed: store.zoomActivationKeyPressed,
    preventScrolling: typeof preventScrolling === 'boolean' ? preventScrolling : true,
    noPanClassName: store.noPanClass,
    noWheelClassName: store.noWheelClass,
    userSelectionActive: !!store.selectionRect,
    translateExtent: store.translateExtent,
    lib: 'svelte',
    paneClickDistance,
    selectionOnDrag,
    onTransformChange: (transform: Transform) => {
      store.setViewportUpdateSource(true);
      store.viewport = { x: transform[0], y: transform[1], zoom: transform[2] };
      store.setViewportUpdateSource(false);
    },
    connectionInProgress: store.connection.inProgress
  }}
>
  {@render children()}
</div>
