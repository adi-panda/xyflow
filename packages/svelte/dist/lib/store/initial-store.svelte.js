/* eslint-disable svelte/prefer-svelte-reactivity */
import { infiniteExtent, SelectionMode, ConnectionMode, devWarn, adoptUserNodes, getViewportForBounds, updateConnectionLookup, initialConnection, mergeAriaLabelConfig, getInternalNodesBounds, createMarkerIds, pointToRendererPoint, fitViewport } from '@xyflow/system';
import DefaultNode from '../components/nodes/DefaultNode.svelte';
import InputNode from '../components/nodes/InputNode.svelte';
import OutputNode from '../components/nodes/OutputNode.svelte';
import GroupNode from '../components/nodes/GroupNode.svelte';
import { BezierEdgeInternal, SmoothStepEdgeInternal, StraightEdgeInternal, StepEdgeInternal } from '../components/edges';
import { MediaQuery } from 'svelte/reactivity';
import { getLayoutedEdges, getVisibleNodes } from './visibleElements';
import { ViewportBatcher } from '../utils/viewportBatcher';
import { ProgressiveNodeBatcher } from '../utils/progressiveNodeBatcher';
import { ProgressiveEdgeBatcher } from '../utils/progressiveEdgeBatcher';
export const initialNodeTypes = {
    input: InputNode,
    output: OutputNode,
    default: DefaultNode,
    group: GroupNode
};
export const initialEdgeTypes = {
    straight: StraightEdgeInternal,
    smoothstep: SmoothStepEdgeInternal,
    default: BezierEdgeInternal,
    step: StepEdgeInternal
};
function getInitialViewport(
// This is just used to make sure adoptUserNodes is called before we calculate the viewport
_nodesInitialized, fitView, initialViewport, width, height, nodeLookup) {
    if (fitView && !initialViewport && width && height) {
        const bounds = getInternalNodesBounds(nodeLookup, {
            filter: (node) => !!((node.width || node.initialWidth) && (node.height || node.initialHeight))
        });
        return getViewportForBounds(bounds, width, height, 0.5, 2, 0.1);
    }
    else {
        return initialViewport ?? { x: 0, y: 0, zoom: 1 };
    }
}
export function getInitialStore(signals) {
    // We use a class here, because Svelte adds getters & setter for us.
    // Inline classes have some performance implications but we just call it once (max twice).
    class SvelteFlowStore {
        flowId = $derived(signals.props.id ?? '1');
        domNode = $state.raw(null);
        panZoom = $state.raw(null);
        width = $state.raw(signals.width ?? 0);
        height = $state.raw(signals.height ?? 0);
        zIndexMode = $state.raw(signals.props.zIndexMode ?? 'basic');
        // RAF batching for viewport updates during panning (internal use only)
        viewportBatcher = null;
        isViewportUpdateFromInternal = false;
        // Pan direction tracking for progressive loading
        _prevViewportForPan = null;
        // Progressive node loading to prevent lag spikes
        progressiveNodeBatcher = null;
        _progressiveTrigger = $state.raw(0); // Incremented to force re-derivation
        _prevRenderedNodes = new Map();
        // Progressive edge loading to prevent lag spikes
        progressiveEdgeBatcher = null;
        _prevRenderedEdges = new Map();
        nodesInitialized = $derived.by(() => {
            const nodesInitialized = adoptUserNodes(signals.nodes, this.nodeLookup, this.parentLookup, {
                nodeExtent: this.nodeExtent,
                nodeOrigin: this.nodeOrigin,
                elevateNodesOnSelect: signals.props.elevateNodesOnSelect ?? true,
                checkEquality: true,
                zIndexMode: this.zIndexMode
            });
            if (this.fitViewQueued && nodesInitialized) {
                if (this.fitViewOptions?.duration) {
                    this.resolveFitView();
                }
                else {
                    /**
                     * When no duration is set, viewport is set immediately which prevents an update
                     * I do not understand why, however we are setting state in a derived which is a no-go
                     */
                    queueMicrotask(() => {
                        this.resolveFitView();
                    });
                }
            }
            return nodesInitialized;
        });
        viewportInitialized = $derived(this.panZoom !== null);
        _edges = $derived.by(() => {
            updateConnectionLookup(this.connectionLookup, this.edgeLookup, signals.edges);
            return signals.edges;
        });
        get nodes() {
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            this.nodesInitialized;
            return signals.nodes;
        }
        set nodes(nodes) {
            signals.nodes = nodes;
        }
        get edges() {
            return this._edges;
        }
        set edges(edges) {
            signals.edges = edges;
        }
        _prevSelectedNodes = [];
        _prevSelectedNodeIds = new Set();
        selectedNodes = $derived.by(() => {
            const selectedNodesCount = this._prevSelectedNodeIds.size;
            const selectedNodeIds = new Set();
            const selectedNodes = this.nodes.filter((node) => {
                if (node.selected) {
                    selectedNodeIds.add(node.id);
                    this._prevSelectedNodeIds.delete(node.id);
                }
                return node.selected;
            });
            // Either the number of selected nodes has changed or two nodes changed their selection state
            // at the same time. However then the previously selected node will be inside _prevSelectedNodeIds
            if (selectedNodesCount !== selectedNodeIds.size || this._prevSelectedNodeIds.size > 0) {
                this._prevSelectedNodes = selectedNodes;
            }
            this._prevSelectedNodeIds = selectedNodeIds;
            return this._prevSelectedNodes;
        });
        _prevSelectedEdges = [];
        _prevSelectedEdgeIds = new Set();
        selectedEdges = $derived.by(() => {
            const selectedEdgesCount = this._prevSelectedEdgeIds.size;
            const selectedEdgeIds = new Set();
            const selectedEdges = this.edges.filter((edge) => {
                if (edge.selected) {
                    selectedEdgeIds.add(edge.id);
                    this._prevSelectedEdgeIds.delete(edge.id);
                }
                return edge.selected;
            });
            // Either the number of selected edges has changed or two edges changed their selection state
            // at the same time. However then the previously selected edge will be inside _prevSelectedEdgeIds
            if (selectedEdgesCount !== selectedEdgeIds.size || this._prevSelectedEdgeIds.size > 0) {
                this._prevSelectedEdges = selectedEdges;
            }
            this._prevSelectedEdgeIds = selectedEdgeIds;
            return this._prevSelectedEdges;
        });
        selectionChangeHandlers = new Map();
        nodeLookup = new Map();
        parentLookup = new Map();
        connectionLookup = new Map();
        edgeLookup = new Map();
        _prevVisibleEdges = new Map();
        visible = $derived.by(() => {
            const { 
            // Access nodes getter to trigger on node changes (add/delete/move)
            // The getter internally accesses nodesInitialized which populates nodeLookup
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            nodes, _edges: edges, _prevVisibleEdges: previousEdges, nodeLookup, connectionMode, onerror, onlyRenderVisibleElements, visibilityBuffer, defaultEdgeOptions, zIndexMode, progressiveNodeThreshold, progressiveNodeBatcher, _prevRenderedNodes, progressiveEdgeThreshold, progressiveEdgeBatcher, _prevRenderedEdges, 
            // Access trigger to force re-derivation when batcher updates
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            _progressiveTrigger } = this;
            let visibleNodes;
            let visibleEdges;
            const options = {
                edges,
                defaultEdgeOptions,
                previousEdges,
                nodeLookup,
                connectionMode,
                elevateEdgesOnSelect: signals.props.elevateEdgesOnSelect ?? true,
                zIndexMode,
                onerror
            };
            if (onlyRenderVisibleElements) {
                // We only subscribe to viewport, width, height if onlyRenderVisibleElements is true
                const { viewport, width, height } = this;
                const transform = [viewport.x, viewport.y, viewport.zoom];
                // Scale buffer with zoom to maintain consistent world-space lookahead.
                // When zoomed in, screen-space buffer covers less world-space, so we increase it.
                // This reduces mount/unmount churn during panning at high zoom levels.
                // Clamp to reasonable bounds (max 0.5 = 50% of viewport as buffer)
                const zoomScaledBuffer = Math.min(visibilityBuffer * Math.max(1, viewport.zoom), 0.5);
                const allVisibleNodes = getVisibleNodes(nodeLookup, transform, width, height, zoomScaledBuffer);
                // Progressive node loading (independent) - only render nodes actually in viewport
                if (progressiveNodeThreshold > 0 && progressiveNodeBatcher) {
                    // Scale batch size inversely with zoom - when zoomed in, nodes are more
                    // expensive (more DOM elements), so use smaller batches to avoid frame drops.
                    // At zoom=1, use configured batch size. At zoom=2, use half. Min 1.
                    const scaledBatchSize = Math.max(1, Math.round(this.progressiveNodeBatchSize / Math.max(1, viewport.zoom)));
                    progressiveNodeBatcher.updateConfig({ batchSize: scaledBatchSize });
                    visibleNodes = progressiveNodeBatcher.updateVisibleNodes(allVisibleNodes, _prevRenderedNodes);
                    // The batcher returns a cached Map, no need to copy again
                    this._prevRenderedNodes = visibleNodes;
                }
                else {
                    visibleNodes = allVisibleNodes;
                }
                // Get layouted edges - edges can render even if source/target nodes are off-screen
                const allVisibleEdges = getLayoutedEdges({
                    ...options,
                    onlyRenderVisible: true,
                    visibleNodes: new Map(visibleNodes),
                    transform,
                    width,
                    height,
                    buffer: zoomScaledBuffer
                });
                // Progressive edge loading (independent)
                if (progressiveEdgeThreshold > 0 && progressiveEdgeBatcher) {
                    visibleEdges = progressiveEdgeBatcher.updateVisibleEdges(allVisibleEdges, _prevRenderedEdges);
                    // The batcher returns a cached Map, no need to copy again
                    this._prevRenderedEdges = visibleEdges;
                }
                else {
                    visibleEdges = allVisibleEdges;
                }
            }
            else {
                visibleNodes = this.nodeLookup;
                visibleEdges = getLayoutedEdges(options);
            }
            return {
                nodes: visibleNodes,
                edges: visibleEdges
            };
        });
        nodesDraggable = $derived(signals.props.nodesDraggable ?? true);
        nodesConnectable = $derived(signals.props.nodesConnectable ?? true);
        elementsSelectable = $derived(signals.props.elementsSelectable ?? true);
        nodesFocusable = $derived(signals.props.nodesFocusable ?? true);
        edgesFocusable = $derived(signals.props.edgesFocusable ?? true);
        disableKeyboardA11y = $derived(signals.props.disableKeyboardA11y ?? false);
        minZoom = $derived(signals.props.minZoom ?? 0.5);
        maxZoom = $derived(signals.props.maxZoom ?? 2);
        nodeOrigin = $derived(signals.props.nodeOrigin ?? [0, 0]);
        nodeExtent = $derived(signals.props.nodeExtent ?? infiniteExtent);
        translateExtent = $derived(signals.props.translateExtent ?? infiniteExtent);
        defaultEdgeOptions = $derived(signals.props.defaultEdgeOptions ?? {});
        nodeDragThreshold = $derived(signals.props.nodeDragThreshold ?? 1);
        autoPanOnNodeDrag = $derived(signals.props.autoPanOnNodeDrag ?? true);
        autoPanOnConnect = $derived(signals.props.autoPanOnConnect ?? true);
        autoPanOnNodeFocus = $derived(signals.props.autoPanOnNodeFocus ?? true);
        autoPanSpeed = $derived(signals.props.autoPanSpeed ?? 15);
        connectionDragThreshold = $derived(signals.props.connectionDragThreshold ?? 1);
        fitViewQueued = signals.props.fitView ?? false;
        fitViewOptions = signals.props.fitViewOptions;
        fitViewResolver = null;
        snapGrid = $derived(signals.props.snapGrid ?? null);
        dragging = $state.raw(false);
        selectionRect = $state.raw(null);
        selectionKeyPressed = $state.raw(false);
        multiselectionKeyPressed = $state.raw(false);
        deleteKeyPressed = $state.raw(false);
        panActivationKeyPressed = $state.raw(false);
        zoomActivationKeyPressed = $state.raw(false);
        selectionRectMode = $state.raw(null);
        ariaLiveMessage = $state.raw('');
        selectionMode = $derived(signals.props.selectionMode ?? SelectionMode.Partial);
        nodeTypes = $derived({ ...initialNodeTypes, ...signals.props.nodeTypes });
        edgeTypes = $derived({ ...initialEdgeTypes, ...signals.props.edgeTypes });
        noPanClass = $derived(signals.props.noPanClass ?? 'nopan');
        noDragClass = $derived(signals.props.noDragClass ?? 'nodrag');
        noWheelClass = $derived(signals.props.noWheelClass ?? 'nowheel');
        ariaLabelConfig = $derived(mergeAriaLabelConfig(signals.props.ariaLabelConfig));
        // _viewport is the internal viewport.
        // when binding to viewport, we operate on signals.viewport instead
        _viewport = $state.raw(getInitialViewport(this.nodesInitialized, signals.props.fitView, signals.props.initialViewport, this.width, this.height, this.nodeLookup));
        get viewport() {
            return signals.viewport ?? this._viewport;
        }
        set viewport(newViewport) {
            // Handle controlled viewport mode
            if (signals.viewport) {
                signals.viewport = newViewport;
            }
            // For internal viewport updates during pan/zoom, use batching if enabled
            if (this.isViewportUpdateFromInternal && this.viewportBatcher && this.batchViewportUpdates) {
                this.viewportBatcher.schedule(newViewport);
            }
            else {
                // Direct updates (from props or programmatic API calls) bypass batching
                this._viewport = newViewport;
            }
        }
        // _connection is viewport independent and originating from XYHandle
        _connection = $state.raw(initialConnection);
        // We derive a viewport dependent connection here
        connection = $derived.by(() => {
            if (!this._connection.inProgress) {
                return this._connection;
            }
            return {
                ...this._connection,
                to: pointToRendererPoint(this._connection.to, [
                    this.viewport.x,
                    this.viewport.y,
                    this.viewport.zoom
                ])
            };
        });
        connectionMode = $derived(signals.props.connectionMode ?? ConnectionMode.Strict);
        connectionRadius = $derived(signals.props.connectionRadius ?? 20);
        isValidConnection = $derived(signals.props.isValidConnection ?? (() => true));
        selectNodesOnDrag = $derived(signals.props.selectNodesOnDrag ?? true);
        defaultMarkerColor = $derived(signals.props.defaultMarkerColor === undefined ? '#b1b1b7' : signals.props.defaultMarkerColor);
        markers = $derived.by(() => {
            return createMarkerIds(signals.edges, {
                defaultColor: this.defaultMarkerColor,
                id: this.flowId,
                defaultMarkerStart: this.defaultEdgeOptions.markerStart,
                defaultMarkerEnd: this.defaultEdgeOptions.markerEnd
            });
        });
        onlyRenderVisibleElements = $derived(signals.props.onlyRenderVisibleElements ?? false);
        visibilityBuffer = $derived(signals.props.visibilityBuffer ?? 0.1);
        batchViewportUpdates = $derived(signals.props.batchViewportUpdates ?? true);
        viewportUpdateThrottle = $derived(signals.props.viewportUpdateThrottle ?? 0);
        progressiveNodeThreshold = $derived(signals.props.progressiveNodeThreshold ?? 0);
        progressiveNodeBatchSize = $derived(signals.props.progressiveNodeBatchSize ?? 15);
        progressiveEdgeThreshold = $derived(signals.props.progressiveEdgeThreshold ?? 0);
        progressiveEdgeBatchSize = $derived(signals.props.progressiveEdgeBatchSize ?? 20);
        onerror = $derived(signals.props.onflowerror ?? devWarn);
        ondelete = $derived(signals.props.ondelete);
        onbeforedelete = $derived(signals.props.onbeforedelete);
        onbeforeconnect = $derived(signals.props.onbeforeconnect);
        onconnect = $derived(signals.props.onconnect);
        onconnectstart = $derived(signals.props.onconnectstart);
        onconnectend = $derived(signals.props.onconnectend);
        onbeforereconnect = $derived(signals.props.onbeforereconnect);
        onreconnect = $derived(signals.props.onreconnect);
        onreconnectstart = $derived(signals.props.onreconnectstart);
        onreconnectend = $derived(signals.props.onreconnectend);
        clickConnect = $derived(signals.props.clickConnect ?? true);
        onclickconnectstart = $derived(signals.props.onclickconnectstart);
        onclickconnectend = $derived(signals.props.onclickconnectend);
        clickConnectStartHandle = $state.raw(null);
        onselectiondrag = $derived(signals.props.onselectiondrag);
        onselectiondragstart = $derived(signals.props.onselectiondragstart);
        onselectiondragstop = $derived(signals.props.onselectiondragstop);
        resolveFitView = async () => {
            if (!this.panZoom) {
                return;
            }
            await fitViewport({
                nodes: this.nodeLookup,
                width: this.width,
                height: this.height,
                panZoom: this.panZoom,
                minZoom: this.minZoom,
                maxZoom: this.maxZoom
            }, this.fitViewOptions);
            this.fitViewResolver?.resolve(true);
            /**
             * wait for the fitViewport to resolve before deleting the resolver,
             * we want to reuse the old resolver if the user calls fitView again in the mean time
             */
            this.fitViewQueued = false;
            this.fitViewOptions = undefined;
            this.fitViewResolver = null;
        };
        _prefersDark = new MediaQuery('(prefers-color-scheme: dark)', signals.props.colorModeSSR === 'dark');
        colorMode = $derived(signals.props.colorMode === 'system'
            ? this._prefersDark.current
                ? 'dark'
                : 'light'
            : (signals.props.colorMode ?? 'light'));
        // Viewport batching lifecycle methods
        initViewportBatching() {
            if (!this.viewportBatcher) {
                this.viewportBatcher = new ViewportBatcher((viewport) => {
                    this._viewport = viewport;
                }, this.viewportUpdateThrottle // Normal throttle (e.g., 0-33ms)
                );
            }
        }
        setViewportUpdateSource(isInternal) {
            this.isViewportUpdateFromInternal = isInternal;
        }
        destroyViewportBatching() {
            if (this.viewportBatcher) {
                this.viewportBatcher.destroy();
                this.viewportBatcher = null;
            }
        }
        // Progressive node loading lifecycle methods
        initProgressiveNodeBatching() {
            if (!this.progressiveNodeBatcher && this.progressiveNodeThreshold > 0) {
                this.progressiveNodeBatcher = new ProgressiveNodeBatcher({
                    threshold: this.progressiveNodeThreshold,
                    batchSize: this.progressiveNodeBatchSize,
                    onUpdate: () => {
                        // Increment trigger to force re-derivation of visible nodes
                        this._progressiveTrigger++;
                    }
                });
            }
        }
        flushProgressiveNodes() {
            this.progressiveNodeBatcher?.flush();
        }
        flushProgressiveNodesGradually(batchSize) {
            this.progressiveNodeBatcher?.flushGradually(batchSize);
        }
        destroyProgressiveNodeBatching() {
            if (this.progressiveNodeBatcher) {
                this.progressiveNodeBatcher.destroy();
                this.progressiveNodeBatcher = null;
            }
        }
        // Progressive edge loading lifecycle methods
        initProgressiveEdgeBatching() {
            if (!this.progressiveEdgeBatcher && this.progressiveEdgeThreshold > 0) {
                this.progressiveEdgeBatcher = new ProgressiveEdgeBatcher({
                    threshold: this.progressiveEdgeThreshold,
                    batchSize: this.progressiveEdgeBatchSize,
                    onUpdate: () => {
                        // Increment trigger to force re-derivation of visible edges
                        this._progressiveTrigger++;
                    }
                });
            }
        }
        flushProgressiveEdges() {
            this.progressiveEdgeBatcher?.flush();
        }
        flushProgressiveEdgesGradually(batchSize) {
            this.progressiveEdgeBatcher?.flushGradually(batchSize);
        }
        destroyProgressiveEdgeBatching() {
            if (this.progressiveEdgeBatcher) {
                this.progressiveEdgeBatcher.destroy();
                this.progressiveEdgeBatcher = null;
            }
        }
        constructor() {
            if (process.env.NODE_ENV === 'development') {
                warnIfDeeplyReactive(signals.nodes, 'nodes');
                warnIfDeeplyReactive(signals.edges, 'edges');
            }
        }
        resetStoreValues() {
            // Flush any pending updates before reset
            this.viewportBatcher?.flush();
            this.progressiveNodeBatcher?.reset();
            this.progressiveEdgeBatcher?.reset();
            this.dragging = false;
            this.selectionRect = null;
            this.selectionRectMode = null;
            this.selectionKeyPressed = false;
            this.multiselectionKeyPressed = false;
            this.deleteKeyPressed = false;
            this.panActivationKeyPressed = false;
            this.zoomActivationKeyPressed = false;
            this._connection = initialConnection;
            this.clickConnectStartHandle = null;
            this.viewport = signals.props.initialViewport ?? { x: 0, y: 0, zoom: 1 };
            this.ariaLiveMessage = '';
        }
    }
    return new SvelteFlowStore();
}
// Only way to check if an object is a proxy
// is to see if is failes to perform a structured clone
function warnIfDeeplyReactive(array, name) {
    try {
        if (array && array.length > 0) {
            structuredClone(array[0]);
        }
    }
    catch {
        console.warn(`Use $state.raw for ${name} to prevent performance issues.`);
    }
}
/* eslint-enable svelte/prefer-svelte-reactivity */
