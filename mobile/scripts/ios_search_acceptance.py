"""Require every complete public first/repeated search, without averaging."""
import math


def verify(result):
    rows = [row for row in result.get('results', []) if str(row.get('operation', '')).startswith('module-search-')]
    if [row.get('operation') for row in rows] != ['module-search-0', 'module-search-1', 'module-search-2']:
        raise ValueError('All three first/repeated complete searches are required')
    for row in rows:
        for key, limit in [('totalMs', 600), ('responseMs', 100)]:
            value = row.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or value > limit:
                raise ValueError(f"{row['operation']} {key}={value} exceeds or lacks the {limit}ms gate")
    return rows
