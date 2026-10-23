"""Gate every complete table preview and the final independently checked commit."""
import json
import math
import pathlib
import sys


PREVIEW_OPERATIONS = {
    'record-table-import-preview-' + extension + '-' + str(repeat)
    for extension in ('csv', 'xlsx', 'xls')
    for repeat in range(3)
}
ORIGINAL_PREVIEW_OPERATIONS = {
    'record-table-import-preview-' + extension for extension in ('csv', 'xlsx', 'xls')
}
COMMIT_OPERATION = 'record-table-import-commit-full-115'


def check_table_timings(result):
    assert isinstance(result, dict) and result.get('passed') is True, 'Complete UI/link/manual-body checks must pass first'
    original_bodies = result.get('completeOriginalBodiesVerified')
    assert type(original_bodies) is int and original_bodies == 78, 'Require independent verification of all 78 original complete bodies'
    samples = result.get('results')
    assert isinstance(samples, list), 'Require the complete table measurement list'
    assert all(isinstance(sample, dict) and isinstance(sample.get('operation'), str) for sample in samples), 'Every measurement must have an operation name'
    previews = [sample for sample in samples if sample['operation'].startswith('record-table-import-preview-')]
    names = [sample['operation'] for sample in previews]
    assert all(name in PREVIEW_OPERATIONS | ORIGINAL_PREVIEW_OPERATIONS for name in names), 'Unknown table preview operation cannot substitute for a required sample'
    assert len(names) == len(set(names)), 'Every table preview measurement must be unique'
    repeated = [sample for sample in previews if sample['operation'] in PREVIEW_OPERATIONS]
    assert len(repeated) == 9 and {sample['operation'] for sample in repeated} == PREVIEW_OPERATIONS, 'Require each first and repeated CSV/XLSX/XLS complete preview exactly once'
    commits = [sample for sample in samples if sample['operation'] == COMMIT_OPERATION]
    assert len(commits) == 1, 'Require the final complete 115-row commit exactly once'
    commit_ms = commits[0].get('totalMs')
    assert isinstance(commit_ms, (int, float)) and not isinstance(commit_ms, bool) and math.isfinite(commit_ms) and commit_ms >= 0, 'Complete commit measurement must be finite and nonnegative'
    for sample in previews:
        for key, limit in [('responseMs', 100), ('totalMs', 500)]:
            number = sample.get(key)
            assert isinstance(number, (int, float)) and not isinstance(number, bool) and 0 <= number <= limit and math.isfinite(number), 'Table ' + key + ' exceeds ' + str(limit) + 'ms or is invalid: ' + str(sample)
    return previews


if __name__ == '__main__':
    previews = check_table_timings(json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')))
    print(json.dumps({'tableSamples': len(previews), 'completeMs': [item['totalMs'] for item in previews], 'responseMs': [item['responseMs'] for item in previews], 'passed': True}))
