import argparse
import json
import os
import pathlib
import re
import subprocess
import time
import uuid

OUTPUT = pathlib.Path('ios/build')


def select_runtime(runtimes, target='27.0'):
    """Require the requested iOS runtime; never silently test another version."""
    found = [r for r in runtimes if r.get('isAvailable') and 'iOS' in r['identifier'] and r['version'] == target]
    if not found:
        raise RuntimeError('Required iOS ' + target + ' runtime unavailable; available: ' + ', '.join(r['version'] for r in runtimes if r.get('isAvailable')))
    return found[0]


def command(*args, timeout=60, log=None):
    """Bound every subprocess; stream large build output to its retained log."""
    print('running: ' + ' '.join(args[:4]), flush=True)
    result = subprocess.run(args, text=True, stdout=log or subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, check=True)
    return (result.stdout or '').strip()


def _job_block(workflow, name):
    """Read our checked-in block-style job layout, rejecting ambiguous entries."""
    if workflow.count('\njobs:\n') != 1:
        raise RuntimeError('Required iOS workflow jobs are missing or ambiguous')
    jobs = workflow.split('\njobs:\n', 1)[1]
    headers = list(re.finditer(r'^  ([A-Za-z0-9_-]+):[ \t]*$', jobs, re.MULTILINE))
    selected = [index for index, header in enumerate(headers) if header.group(1) == name]
    if len(selected) != 1:
        raise RuntimeError('Required iOS job missing or duplicated: ' + name)
    index = selected[0]
    return jobs[headers[index].end():headers[index + 1].start() if index + 1 < len(headers) else len(jobs)]


def required_public_io_is_delegated(job, environment, workflow, reusable):
    """Only full CI may delegate I/O; all other invocations retain inline I/O.

    This deliberately accepts the checked-in simple workflow layout only. A
    workflow restructuring must update this guard and its negative tests, so a
    missing/conditional/optional replacement cannot silently remove coverage.
    """
    if job is None:
        return False
    if (job != 'complete-public-io' or environment.get('GITHUB_ACTIONS') != 'true'
            or environment.get('GITHUB_JOB') != 'ios'
            or not re.fullmatch(r'[^/]+/[^/]+/\.github/workflows/ios-check\.yml@.+', environment.get('GITHUB_WORKFLOW_REF', ''))):
        raise RuntimeError('Complete I/O delegation requires the explicit full iOS workflow job')
    delegated = _job_block(workflow, job)
    lines = [line.strip() for line in delegated.splitlines() if line.strip() and not line.lstrip().startswith('#')]
    if lines != ['uses: ./.github/workflows/ios-public-io-check.yml']:
        raise RuntimeError('Complete I/O must be an unconditional parallel reusable job')
    gate = _job_block(workflow, 'ios-complete')
    required_gate = [
        '    needs: [ios-native, ios, complete-public-io]',
        '    if: ${{ always() }}',
        '          NATIVE_RESULT: ${{ needs.ios-native.result }}',
        '          UI_RESULT: ${{ needs.ios.result }}',
        '          IO_RESULT: ${{ needs.complete-public-io.result }}',
        '        run: test "$NATIVE_RESULT" = success && test "$UI_RESULT" = success && test "$IO_RESULT" = success',
    ]
    if (any(gate.splitlines().count(line) != 1 for line in required_gate)
            or 'continue-on-error:' in gate
            or re.search(r'^\s{6,}(?:- )?if:', gate, re.MULTILINE)):
        raise RuntimeError('Full iOS acceptance must require success from native, system UI and independent I/O jobs')
    native = _job_block(workflow, 'ios-native')
    ui = _job_block(workflow, 'ios')
    for block in [native, ui]:
        if (block.splitlines().count('    runs-on: xcode-27') != 1
                or re.search(r'^    (?:if|needs|continue-on-error):', block, re.MULTILINE)):
            raise RuntimeError('Native and system UI must run unconditionally on independent fresh hosts')
    for required in ['pnpm typecheck && pnpm test', 'ios/build/native-checks ios/build/native-sample.json',
                     'node scripts/check-backup-stream.mjs', 'node scripts/check-table-stream.mjs',
                     'node scripts/check-single-record-stream.mjs', 'bash scripts/package-ios.sh']:
        steps = re.split(r'^      - ', native, flags=re.MULTILINE)[1:]
        matches = [step for step in steps if required in step]
        if len(matches) != 1 or re.search(r'^\s*(?:if|continue-on-error):', matches[0], re.MULTILINE):
            raise RuntimeError('Complete native, capacity or device build check missing/conditional: ' + required)
    if ui.count('python3 scripts/ios-simulator-smoke.py --required-public-io-job complete-public-io') != 1:
        raise RuntimeError('The complete original system UI coordinator must remain required')
    ui_steps = re.split(r'^      - ', ui, flags=re.MULTILINE)[1:]
    ui_command = [step for step in ui_steps if 'python3 scripts/ios-simulator-smoke.py --required-public-io-job complete-public-io' in step]
    if re.search(r'^\s*(?:if|continue-on-error):', ui_command[0], re.MULTILINE):
        raise RuntimeError('The complete system UI coordinator cannot be conditional')
    header = reusable.split('\njobs:\n', 1)[0]
    if not re.search(r'^  workflow_call:[ \t]*$', header, re.MULTILINE) or re.search(r'^  push:', header, re.MULTILINE):
        raise RuntimeError('Complete I/O must be callable without a duplicate push run')
    io = _job_block(reusable, 'public-io-feedback')
    if (io.splitlines().count('    runs-on: xcode-27') != 1
            or re.search(r'^    (?:if|needs|continue-on-error):', io, re.MULTILINE)):
        raise RuntimeError('Complete I/O must execute unconditionally on its fresh Xcode runner')
    required_commands = [
        'python3 scripts/ios-public-io-check.py',
        'python3 scripts/test-character-import-acceptance.py',
        'python3 scripts/test-table-import-acceptance.py',
        'python3 scripts/test-ios-cold-tables.py',
    ]
    steps = re.split(r'^      - ', io, flags=re.MULTILINE)[1:]
    for command_text in required_commands:
        matching = [step for step in steps if re.search(r'(?m)^\s*run:.*' + re.escape(command_text) + r'(?:\s|$)', step)]
        if len(matching) != 1 or re.search(r'^\s*(?:if|continue-on-error):', matching[0], re.MULTILINE):
            raise RuntimeError('Required complete I/O or performance check missing/conditional: ' + command_text)
    cold = _job_block(reusable, 'cold-tables')
    required_cold = ['    runs-on: xcode-27', '      fail-fast: false',
                     '        first: [csv, xlsx, xls]',
                     '        run: python3 scripts/ios-public-io-check.py --table-first ${{ matrix.first }}',
                     '          name: ios-cold-table-${{ matrix.first }}']
    if (any(cold.splitlines().count(line) != 1 for line in required_cold)
            or re.search(r'^    (?:if|needs|continue-on-error):', cold, re.MULTILINE)
            or 'continue-on-error:' in cold):
        raise RuntimeError('Every cold format requires its own mandatory independent runner')
    for step in re.split(r'^      - ', cold, flags=re.MULTILINE)[1:]:
        if 'run:' in step and re.search(r'^\s*if:', step, re.MULTILINE):
            raise RuntimeError('Cold format execution cannot be conditional')
    aggregate = _job_block(reusable, 'complete-io')
    required_aggregate = ['    runs-on: ubuntu-latest',
        '    needs: [public-io-feedback, cold-tables]', '    if: ${{ always() }}',
        '          IO_RESULT: ${{ needs.public-io-feedback.result }}',
        '          COLD_RESULT: ${{ needs.cold-tables.result }}',
        '        run: test "$IO_RESULT" = success && test "$COLD_RESULT" = success',
        '          pattern: ios-cold-table-*', '          path: mobile/ios/build',
        '          merge-multiple: true',
        '        run: python3 scripts/ios-cold-table-check.py --aggregate-only']
    if (any(aggregate.splitlines().count(line) != 1 for line in required_aggregate)
            or 'continue-on-error:' in aggregate):
        raise RuntimeError('Full I/O and all independently verified cold matrices must succeed')
    for step in re.split(r'^      - ', aggregate, flags=re.MULTILINE)[1:]:
        if ('run:' in step or 'actions/download-artifact@v4' in step) and re.search(r'^\s*if:', step, re.MULTILINE):
            raise RuntimeError('Required cold table aggregation cannot be conditional')
    return True


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--required-public-io-job', help='Full CI only: mandatory parallel job that runs all complete I/O checks')
    arguments = parser.parse_args(argv)
    root = pathlib.Path(__file__).resolve().parents[2]
    delegated_io = required_public_io_is_delegated(
        arguments.required_public_io_job, os.environ,
        (root / '.github/workflows/ios-check.yml').read_text(encoding='utf-8'),
        (root / '.github/workflows/ios-public-io-check.yml').read_text(encoding='utf-8'),
    )
    OUTPUT.mkdir(parents=True, exist_ok=True)
    udid = None
    io_udid = None
    metadata = {'device': 'iPhone 14 Pro', 'requestedRuntime': '27.0', 'scope': 'fresh cloud simulator, no user phone data'}
    phase = 'environment'
    try:
        runtime = select_runtime(json.loads(command('xcrun', 'simctl', 'list', 'runtimes', '--json'))['runtimes'])
        types = json.loads(command('xcrun', 'simctl', 'list', 'devicetypes', '--json'))['devicetypes']
        device = next(d for d in types if d['name'] == 'iPhone 14 Pro')
        udid = command('xcrun', 'simctl', 'create', 'COC isolated iPhone 14 Pro', device['identifier'], runtime['identifier'])
        uuid.UUID(udid)
        metadata.update(runtime=runtime['version'], udid=udid)
        (OUTPUT / 'simulator-environment.json').write_text(json.dumps(metadata))
        phase = 'boot'
        command('xcrun', 'simctl', 'boot', udid, timeout=300)
        command('xcrun', 'simctl', 'bootstatus', udid, '-b', timeout=300)
        phase = 'build'
        with (OUTPUT / 'simulator-build.log').open('w') as log:
            command('xcodebuild', '-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug', '-destination', 'platform=iOS Simulator,id=' + udid, '-derivedDataPath', 'ios/build/simulator', 'build', 'CODE_SIGN_IDENTITY=-', 'CODE_SIGNING_ALLOWED=YES', timeout=900, log=log)
        phase = 'install'
        command('xcrun', 'simctl', 'install', udid, 'ios/build/simulator/Build/Products/Debug-iphonesimulator/App.app', timeout=120)
        container = pathlib.Path(command('xcrun', 'simctl', 'get_app_container', udid, 'coc.logbook', 'data'))
        # Only this newly created CI simulator receives the fictional picker file.
        fixture_folder = container / 'Documents/COC-Picker-Public-Test'
        fixture_folder.mkdir(parents=True, exist_ok=True)
        (fixture_folder / 'public-coc7.xlsx').write_bytes(pathlib.Path('ios/build/public-coc7.xlsx').read_bytes())
        report = container / 'tmp/ios-smoke-result.json'
        attempts = []
        capture_errors = []
        # A single successful cold start cannot rule out the observed intermittent failure.
        for attempt in range(1, 4):
            phase = 'launch-' + str(attempt)
            if attempt > 1:
                command('xcrun', 'simctl', 'terminate', udid, 'coc.logbook', timeout=60)
            report.unlink(missing_ok=True)
            command('xcrun', 'simctl', 'launch', udid, 'coc.logbook', '--coc-ios-smoke', timeout=120)
            phase = 'report-' + str(attempt)
            deadline = time.monotonic() + 180
            while not report.exists() and time.monotonic() < deadline:
                time.sleep(0.5)
            if not report.exists():
                raise TimeoutError('Native startup report not produced within 180 seconds, attempt ' + str(attempt))
            result = {**metadata, **json.loads(report.read_text())}
            attempts.append({'attempt': attempt, **result})
            (OUTPUT / 'ios-smoke-result.json').write_text(json.dumps({**result, 'coldStarts': attempts}))
            if attempt == 3:
                try:
                    command('xcrun', 'simctl', 'io', udid, 'screenshot', str(OUTPUT / 'ios-initial-screen.png'), timeout=30)
                except Exception as error:
                    capture_errors.append(str(error))
                    (OUTPUT / 'screenshot-error.json').write_text(json.dumps({'passed': False, 'error': str(error)}))
                    print('Screenshot failed; continuing required UI checks: ' + str(error), flush=True)
            print(json.dumps(attempts[-1]), flush=True)
            if not result.get('passed'):
                raise RuntimeError('Native startup check failed: ' + str(result))
        phase = 'picker-ui-project'
        command('ruby', 'scripts/ios-picker-project.rb', timeout=120)
        phase = 'picker-ui-test'
        # Retain xcresult, screenshots and complete assertion logs. Avoid Xcode's
        # extra 600-second simulator diagnostic probe after a reported failure.
        # This workflow pins Xcode 27, whose flag is supported. A timed-out
        # help probe previously re-enabled the 600s failure diagnostic delay,
        # leaving the xcresult incomplete at the unchanged 900s process limit.
        diagnostic_args = ['-collect-test-diagnostics', 'never']
        # Keep each invocation's original 900s process limit. Three independent
        # suites avoid combining all original checks and added launch repeats
        # into a single nearly-900s process. Every declared UI test is required.
        groups = [
            ('core', ['testCoc7ImportPickerCancelSaveAndRestart', 'testExplicitLocalFolderReturnsAndSurvivesRestart', 'testFolderOpenReturnsAndSurvivesRestart'], 'picker-ui.xcresult', False),
            ('names', ['testPublicNameCandidatesSecondLaunchWithNativeKeyboard', 'testPublicNameCandidatesThirdLaunchWithNativeKeyboard', 'testPublicNameCandidatesWithNativeKeyboard'], 'picker-ui-names.xcresult', False),
            ('stress', ['testPublicNameCandidateRepeatedSwitchFocusAndKeyboard'], 'picker-ui-stress.xcresult', True),
        ]
        declared = re.findall(r'\bfunc (test\w+)\(', pathlib.Path('scripts/ios-picker-ui-tests.swift').read_text(encoding='utf-8'))
        planned = [case for _, cases, _, _ in groups for case in cases]
        if len(planned) != len(set(planned)) or sorted(planned) != sorted(declared):
            raise RuntimeError('Every declared public UI test must run exactly once: ' + str(declared))
        ui_failures = []
        trace_failures = []
        trace_lines = dict()
        with (OUTPUT / 'picker-ui.log').open('w') as log:
            for group, cases, bundle, trace_expected in groups:
                print('Required public UI group: ' + group + ', tests=' + str(len(cases)), flush=True)
                log.write('\nRequired public UI group: ' + group + '\n')
                log.flush()
                test_filters = ['-only-testing:PickerUITests/PickerUITests/' + case for case in cases]
                try:
                    command('xcodebuild', '-project', 'ios/App/App.xcodeproj', '-scheme', 'PickerUITests', '-configuration', 'Debug', '-destination', 'platform=iOS Simulator,id=' + udid, '-derivedDataPath', 'ios/build/simulator', '-resultBundlePath', str(OUTPUT / bundle), 'test', *test_filters, *diagnostic_args, 'CODE_SIGN_IDENTITY=-', 'CODE_SIGNING_ALLOWED=YES', timeout=900, log=log)
                except subprocess.CalledProcessError as error:
                    # Still collect the independent required stress group, but
                    # any failing group keeps the entire acceptance run failed.
                    ui_failures.append(group + ': ' + str(error))
                finally:
                    try:
                        if not trace_expected:
                            (OUTPUT / ('ios-name-trace-disabled-' + group + '.json')).write_text(json.dumps({'enabled': False, 'reason': 'Required public UI group deliberately has no event trace'}))
                        else:
                            trace_container = pathlib.Path(command('xcrun', 'simctl', 'get_app_container', udid, 'coc.logbook', 'data'))
                            trace = trace_container / 'tmp/ios-name-events.jsonl'
                            if not trace.exists():
                                raise RuntimeError('Required public stress event trace missing')
                            data = trace.read_bytes()
                            (OUTPUT / ('ios-name-events-' + group + '.jsonl')).write_bytes(data)
                            # Discard only byte-identical copies of the same event.
                            trace_lines.update(dict.fromkeys(data.splitlines()))
                            (OUTPUT / 'ios-name-events.jsonl').write_bytes(b'\n'.join(trace_lines) + b'\n')
                    except Exception as error:
                        trace_failures.append(group + ': ' + str(error))
                        (OUTPUT / ('ios-name-trace-missing-' + group + '.json')).write_text(json.dumps({'passed': False, 'error': str(error)}))
                    try:
                        attachments = OUTPUT / 'picker-attachments' / group
                        command('xcrun', 'xcresulttool', 'export', 'attachments', '--path', str(OUTPUT / bundle), '--output-path', str(attachments), timeout=60)
                        manifest = attachments / 'manifest.json'
                        if manifest.exists():
                            (OUTPUT / ('picker-manifest-' + group + '.json')).write_bytes(manifest.read_bytes())
                    except Exception as error:
                        print('Public UI attachment export failed: ' + str(error), flush=True)
        if ui_failures or trace_failures:
            raise RuntimeError('Required public UI group or trace failed: ' + '; '.join(ui_failures + trace_failures))
        phase = 'public-scale-fixture'
        # Xcode UI testing may reinstall the app and rotate its data container.
        # Re-query this job's isolated simulator before touching public fixtures.
        container = pathlib.Path(command('xcrun', 'simctl', 'get_app_container', udid, 'coc.logbook', 'data'))
        # The simulator was created by this job. Never seed a physical/user device.
        subprocess.run(['xcrun', 'simctl', 'terminate', udid, 'coc.logbook'], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
        database = container / 'Library/Application Support/COCLogbook/logbook.sqlite'
        # Preserve all earlier public system-UI fixtures as evidence rather than clearing them.
        for suffix in ['', '-wal', '-shm']:
            existing = pathlib.Path(str(database) + suffix)
            if existing.exists():
                existing.rename(pathlib.Path(str(existing) + '.pre-scale'))
        command('python3', 'scripts/ios-scale-fixture.py', str(database), timeout=60)
        (container / 'tmp').mkdir(parents=True, exist_ok=True)
        (container / 'tmp/ios-scale-webview.js').write_text(pathlib.Path('scripts/ios-scale-webview.js').read_text())
        scale_report = container / 'tmp/ios-scale-result.json'
        phase = 'public-scale-wkwebview'
        command('xcrun', 'simctl', 'launch', udid, 'coc.logbook', '--coc-ios-scale', timeout=120)
        deadline = time.monotonic() + 950
        while not scale_report.exists() and time.monotonic() < deadline:
            time.sleep(1)
        if not scale_report.exists():
            raise TimeoutError('Public 50-campaign WKWebView scale report not produced')
        scale = json.loads(scale_report.read_text())
        (OUTPUT / 'ios-scale-result.json').write_text(json.dumps(scale, ensure_ascii=False))
        print(json.dumps(scale), flush=True)
        if not scale.get('passed'):
            raise RuntimeError('Public WKWebView scale failed: ' + str(scale))
        phase = 'public-capacity-fixture'
        command('xcrun', 'simctl', 'terminate', udid, 'coc.logbook', timeout=60)
        for suffix in ['', '-wal', '-shm']:
            existing = pathlib.Path(str(database) + suffix)
            if existing.exists():
                existing.rename(pathlib.Path(str(existing) + '.pre-capacity'))
        command('python3', 'scripts/ios-capacity-fixture.py', str(database), timeout=120)
        command('node', 'scripts/ios-capacity-webview.mjs', timeout=60)
        (container / 'tmp/ios-scale-webview.js').write_text(pathlib.Path('ios/build/ios-capacity-webview.js').read_text())
        scale_report.unlink(missing_ok=True)
        phase = 'public-capacity-wkwebview'
        command('xcrun', 'simctl', 'launch', udid, 'coc.logbook', '--coc-ios-scale', timeout=120)
        deadline = time.monotonic() + 950
        while not scale_report.exists() and time.monotonic() < deadline:
            time.sleep(1)
        if not scale_report.exists():
            raise TimeoutError('Public native capacity WKWebView report not produced')
        capacity = json.loads(scale_report.read_text())
        (OUTPUT / 'ios-capacity-result.json').write_text(json.dumps(capacity, ensure_ascii=False))
        print(json.dumps(capacity), flush=True)
        if not capacity.get('passed'):
            raise RuntimeError('Public native capacity WKWebView failed: ' + str(capacity))
        if delegated_io:
            print('Complete I/O is required in the parallel complete-public-io job; ios-complete requires both jobs to succeed.', flush=True)
        else:
            phase = 'public-complete-io-fixtures'
            command('xcrun', 'simctl', 'shutdown', udid, timeout=60)
            command('node', 'scripts/public-io-fixtures.mjs', '--ios', timeout=120)
            io_udid = command('xcrun', 'simctl', 'create', 'COC isolated public I/O timing', device['identifier'], runtime['identifier'])
            uuid.UUID(io_udid)
            command('xcrun', 'simctl', 'boot', io_udid, timeout=300)
            command('xcrun', 'simctl', 'bootstatus', io_udid, '-b', timeout=300)
            command('xcrun', 'simctl', 'install', io_udid, 'ios/build/simulator/Build/Products/Debug-iphonesimulator/App.app', timeout=120)
            io_container = pathlib.Path(command('xcrun', 'simctl', 'get_app_container', io_udid, 'coc.logbook', 'data'))
            command('python3', 'scripts/ios-public-io-fixture.py', str(io_container / 'Library/Application Support/COCLogbook/logbook.sqlite'), timeout=120)
            (io_container / 'tmp').mkdir(parents=True, exist_ok=True)
            (io_container / 'tmp/ios-scale-webview.js').write_text(pathlib.Path('ios/build/public-io/public-io-webview.js').read_text())
            io_report = io_container / 'tmp/ios-scale-result.json'
            phase = 'public-complete-io-wkwebview'
            command('xcrun', 'simctl', 'launch', io_udid, 'coc.logbook', '--coc-ios-scale', '--coc-public-io', timeout=120)
            deadline = time.monotonic() + 950
            while not io_report.exists() and time.monotonic() < deadline:
                time.sleep(1)
            if not io_report.exists():
                raise TimeoutError('Public complete I/O timing report not produced')
            io_output = OUTPUT / 'ios-public-io-result.json'
            io_output.write_bytes(io_report.read_bytes())
            io_result = json.loads(io_output.read_text())
            if not io_result.get('passed'):
                raise RuntimeError('Complete public I/O failed: ' + str(io_result))
            command('xcrun', 'simctl', 'terminate', io_udid, 'coc.logbook', timeout=60)
            command('python3', 'scripts/check-public-io.py', str(io_container), str(io_output), timeout=120)
        if capture_errors:
            raise RuntimeError('Required screenshot capture failed after startup/UI checks: ' + '; '.join(capture_errors))
    except Exception as error:
        (OUTPUT / 'simulator-failure.json').write_text(json.dumps({**metadata, 'passed': False, 'phase': phase, 'error': str(error)}))
        output = OUTPUT / 'ios-smoke-result.json'
        if not output.exists():
            output.write_text(json.dumps({**metadata, 'passed': False, 'phase': phase, 'error': str(error)}))
        raise
    finally:
        if io_udid:
            try:
                command('xcrun', 'simctl', 'shutdown', io_udid, timeout=45)
            except Exception as error:
                print('isolated I/O simulator cleanup: ' + str(error), flush=True)
        if udid:
            try:
                command('xcrun', 'simctl', 'shutdown', udid, timeout=45)
            except Exception as error:
                print('isolated simulator cleanup: ' + str(error), flush=True)


if __name__ == '__main__':
    main()
