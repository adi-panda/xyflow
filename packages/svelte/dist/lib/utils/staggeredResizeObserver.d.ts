/**
 * A wrapper around ResizeObserver that staggers observe() calls across
 * multiple animation frames to prevent lag spikes when many nodes mount at once.
 *
 * Instead of calling resizeObserver.observe() for 50 nodes in a single frame,
 * this queues them and processes a small batch each frame.
 */
export declare class StaggeredResizeObserver {
    private observer;
    private pendingObserveList;
    private pendingObserveSet;
    private pendingUnobserve;
    private rafId;
    private batchSize;
    private listIndex;
    private debugPerf;
    private rafScheduleTime;
    constructor(callback: ResizeObserverCallback, batchSize?: number);
    /**
     * Queue an element to be observed. The actual observe() call will be
     * staggered across frames to prevent layout thrashing.
     */
    observe(element: Element): void;
    /**
     * Unobserve an element immediately (unobserve is cheap).
     * Also removes from pending queue if not yet observed.
     */
    unobserve(element: Element): void;
    /**
     * Immediately observe all pending elements (use sparingly).
     */
    flush(): void;
    /**
     * Disconnect the underlying ResizeObserver and clear all pending operations.
     */
    disconnect(): void;
    private scheduleProcessing;
    private processBatch;
    /**
     * Update the batch size for processing.
     */
    setBatchSize(size: number): void;
    /**
     * Check if there are pending observations.
     */
    hasPending(): boolean;
    /**
     * Enable or disable RAF performance logging.
     * When enabled, logs timing info for each RAF callback to help identify lag sources.
     */
    setDebugPerf(enabled: boolean): void;
}
