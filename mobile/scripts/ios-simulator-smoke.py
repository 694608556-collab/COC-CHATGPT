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
        report = container / 'tmp/ios-smoke-result.json'
        attempts = []
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
            command('xcrun', 'simctl', 'io', udid, 'screenshot', str(OUTPUT / 'ios-initial-screen.png'), timeout=90)
            print(json.dumps(attempts[-1]), flush=True)
            if not result.get('passed'):
                raise RuntimeError('Native startup check failed: ' + str(result))
    except Exception as error:
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
