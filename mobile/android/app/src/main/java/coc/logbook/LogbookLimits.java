package coc.logbook;

/** Bounded transport pieces, independent of record/library/file content size.
 * StorageBudget owns volume accounting; allocations are limited by the runtime.
 */
final class LogbookLimits {
    private LogbookLimits() {}
    static final boolean DEVICE_SPACE_LIBRARY = true;
    static final int TRANSFER_CHUNK_BYTES = 256 * 1024;
}
