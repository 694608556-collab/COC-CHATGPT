#pragma once
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* Complete strict UTF-8/JSON/key validation for one immutable original value.
 * metadata!=0 also requires a bodyless object. Zero means complete fallback,
 * including resource exhaustion; this API never grants write authority. */
int coc_search_json_check(const uint8_t *source, size_t bytes,
                          uint64_t resident_budget, int metadata);
/* Upload-only admission additionally proves that every decoded key is ASCII.
 * Unicode keys request the unchanged Swift reader, whose key set includes
 * canonical equivalence. Zero is complete fallback, never content rejection. */
int coc_upload_json_check(const uint8_t *source, size_t bytes,
                          uint64_t resident_budget);
/* Read-only rawContent projection: validate EVERY original byte/key/value,
 * replace only messages[].raw with null, and preserve all searchable fields.
 * The original database is never modified. Free a successful result with free().
 * Null requests the complete legacy path, never a content-size rejection. */
uint8_t *coc_search_json_project(const uint8_t *source, size_t bytes,
                                uint64_t resident_budget, size_t *projected_bytes);
/* Same complete original validation; fixed message tuples with presence bits.
 * Raw/unknown fields are validated but are not part of the search projection. */
uint8_t *coc_search_json_compact(const uint8_t *source,size_t bytes,
                               uint64_t resident_budget,size_t *projected_bytes);
/* Full log/message/image schema validation plus searchable field tuples. */
uint8_t *coc_search_json_searchable(const uint8_t *source,size_t bytes,
                                 uint64_t resident_budget,size_t *projected_bytes);
/* Full record-body validation and the same tuples in a single C pass.
 * Only the top-level rawContent member is projected; every other byte remains
 * exact, including complete manual content. Null requests complete fallback. */
uint8_t *coc_search_json_body(const uint8_t *source,size_t bytes,
                            uint64_t resident_budget,size_t *projected_bytes);
#ifdef __cplusplus
}
#endif
