#pragma once
#include <stddef.h>
#include <stdint.h>
#include "search-json.h"
#ifdef __cplusplus
extern "C" {
#endif
/* The host must prove this immutable private snapshot against its sealed
 * native owner. Result is UTF-8 JSON, never write authority. Free with free().
 * Unsupported formats or resident-cache overflow request complete fallback. */
char *coc_table_kernel_preview(const uint8_t *source, size_t bytes,
                               uint64_t available);
/* Complete read-only record workbook projection. Same immutable source and
 * fallback contract; all worksheet rows/cells and merged ranges are retained. */
char *coc_table_kernel_records(const uint8_t *source, size_t bytes,
                               uint64_t available);
/* Code/allocator initialization with literal public numeric XML only. No
 * user input, file capability, retained source, or business data is touched. */
void coc_table_kernel_warm(void);
/* Decode one lossless upload window, never an entire-content quota. Returns 1
 * only for the exact declared output, complete checksum and consumed input.
 * Caller owns both bounded buffers and still verifies the full upload hash. */
int coc_upload_inflate(const uint8_t *wire, size_t wire_bytes,
                       uint8_t *output, size_t expected_bytes);
#ifdef __cplusplus
}
#endif
