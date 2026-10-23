"""First and repeated complete-draft gates; no averaging or discarded samples."""
import json
import math
import pathlib
import re
import sys


def check_character_timings(result):
    assert result.get('passed') is True, 'Complete UI/field checks must pass first'
    cards = [sample for sample in result['results'] if re.fullmatch(r'character-import-xlsx-[0-2]', sample['operation'])]
    assert len(cards) == 3 and {sample['operation'] for sample in cards} == {'character-import-xlsx-' + str(i) for i in range(3)}, 'Require each first and repeated complete draft exactly once'
    for sample in cards:
        for key, limit in [('responseMs', 100), ('totalMs', 500)]:
            number = sample.get(key)
            assert isinstance(number, (int, float)) and not isinstance(number, bool) and math.isfinite(number) and 0 <= number <= limit, 'Character ' + key + ' exceeds ' + str(limit) + 'ms or is invalid: ' + str(sample)
    return cards


if __name__ == '__main__':
    cards = check_character_timings(json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')))
    print(json.dumps({'characterSamples': len(cards), 'completeMs': [item['totalMs'] for item in cards], 'responseMs': [item['responseMs'] for item in cards], 'passed': True}))
