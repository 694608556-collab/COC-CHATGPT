"""Three independent simulator/app processes; supplements all complete I/O gates."""
import json
import pathlib
import subprocess
import sys
from ios_table_readback import FORMATS, check_cold_report


def main():
    results = []
    summary_path = pathlib.Path('ios/build/ios-public-io-diagnostic-cold-table-matrix.json')
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    # Invalidate only this runner's aggregate before any child can fail. Keep
    # individual prior diagnostics available without presenting stale success.
    pending = {'passed': False, 'physicalPhone': False, 'requiresCompleteIo': True,
               'status': 'incomplete', 'completedFirstFormats': []}
    summary_path.write_text(json.dumps(pending), encoding='utf-8')
    try:
        for first in FORMATS:
            # A separate runner creates its own simulator and refuses an existing DB.
            # Any setup, source, content or timing failure stops; nothing is retried.
            subprocess.run([sys.executable, 'scripts/ios-public-io-check.py', '--table-first', first], check=True)
            path = pathlib.Path('ios/build/ios-public-io-diagnostic-table-' + first + '-result.json')
            result = json.loads(path.read_text(encoding='utf-8'))
            check_cold_report(result, first)
            assert result.get('independentImportedRecordsVerified') == 115
            assert result['coldSimulator'] not in [previous['coldSimulator'] for previous in results], 'Every first format requires an independent newly created simulator/app process'
            results.append(result)
    except Exception:
        pending.update(status='failed', failedFirst=first, completedFirstFormats=[value['coldTableFirst'] for value in results])
        try:
            summary_path.write_text(json.dumps(pending), encoding='utf-8')
        except Exception as error:
            print('Cold table summary write failed: ' + str(error), flush=True)
        raise
    summary = {'passed': True, 'physicalPhone': False, 'requiresCompleteIo': True, 'runs': results}
    summary_path.write_text(json.dumps(summary, ensure_ascii=False), encoding='utf-8')
    print('All three independent cold table matrices passed; complete I/O and full iOS CI remain required.')


if __name__ == '__main__':
    main()
