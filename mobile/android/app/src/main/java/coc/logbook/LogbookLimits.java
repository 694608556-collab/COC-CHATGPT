package coc.logbook;

/** Native-owned budgets; no bridge request may choose a limit. All values retain
 * the existing accounting and bounds. Library growth requires streaming restore.
 */
final class LogbookLimits {
    private LogbookLimits() {}
    static final long LIBRARY_BYTES = 64L * 1024 * 1024;
    static final long SNAPSHOT_UPLOAD_BYTES = 64L * 1024 * 1024;
    static final long SNAPSHOT_REQUEST_BYTES = 64L * 1024 * 1024;
    static final long ENTITY_REQUEST_BYTES = 64L * 1024 * 1024;
    static final long TABLE_REQUEST_BYTES = 64L * 1024 * 1024;
    static final long READ_LEASE_BYTES = 64L * 1024 * 1024;
    static final long BATCH_STAGING_BYTES = 64L * 1024 * 1024;
    static final long RECORD_RESPONSE_BYTES = 64L * 1024 * 1024;
    static final long ARCHIVE_FILE_BYTES = 64L * 1024 * 1024;
    static final long PICKED_FILE_BYTES = 64L * 1024 * 1024;
    static final int TRANSFER_CHUNK_BYTES = 256 * 1024;
}
