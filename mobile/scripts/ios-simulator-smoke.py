import json
import pathlib
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


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    udid = None
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
        diagnostic_args = []
        try:
            help_result = subprocess.run(['xcodebuild', '-help'], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30, check=False)
            if help_result.returncode == 0 and '-collect-test-diagnostics' in help_result.stdout:
                diagnostic_args = ['-collect-test-diagnostics', 'never']
        except subprocess.TimeoutExpired:
            # Capability discovery only controls extra failure diagnostics.
            # A slow help command must not skip any required system UI test.
            print('xcodebuild help timed out; running all required UI checks with default diagnostics.', flush=True)
        with (OUTPUT / 'picker-ui.log').open('w') as log:
            try:
                command('xcodebuild', '-project', 'ios/App/App.xcodeproj', '-scheme', 'PickerUITests', '-configuration', 'Debug', '-destination', 'platform=iOS Simulator,id=' + udid, '-derivedDataPath', 'ios/build/simulator', '-resultBundlePath', 'ios/build/picker-ui.xcresult', 'test', *diagnostic_args, 'CODE_SIGN_IDENTITY=-', 'CODE_SIGNING_ALLOWED=YES', timeout=900, log=log)
            finally:
                # Export public simulator screenshots for inspection on Windows;
                # an export error must not replace the original test result.
                try:
                    command('xcrun', 'xcresulttool', 'export', 'attachments', '--path', 'ios/build/picker-ui.xcresult', '--output-path', 'ios/build/picker-attachments', timeout=60)
                except Exception as error:
                    print('Public UI attachment export failed: ' + str(error), flush=True)
        if capture_errors:
            raise RuntimeError('Required screenshot capture failed after startup/UI checks: ' + '; '.join(capture_errors))
    except Exception as error:
        (OUTPUT / 'simulator-failure.json').write_text(json.dumps({**metadata, 'passed': False, 'phase': phase, 'error': str(error)}))
        output = OUTPUT / 'ios-smoke-result.json'
        if not output.exists():
            output.write_text(json.dumps({**metadata, 'passed': False, 'phase': phase, 'error': str(error)}))
        raise
    finally:
        if udid:
            try:
                command('xcrun', 'simctl', 'shutdown', udid, timeout=45)
            except Exception as error:
                print('isolated simulator cleanup: ' + str(error), flush=True)


if __name__ == '__main__':
    main()
