"""Additional complete I/O feedback loop; never substitutes for full iOS CI."""
import importlib.util
import json
import pathlib
import time
import uuid

spec = importlib.util.spec_from_file_location('coc_smoke_shared', pathlib.Path(__file__).with_name('ios-simulator-smoke.py'))
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
command = shared.command
output = pathlib.Path('ios/build')


def main():
    output.mkdir(parents=True, exist_ok=True)
    owned = None
    phase = 'environment'
    try:
        runtime = shared.select_runtime(json.loads(command('xcrun', 'simctl', 'list', 'runtimes', '--json'))['runtimes'])
        types = json.loads(command('xcrun', 'simctl', 'list', 'devicetypes', '--json'))['devicetypes']
        device = next(item for item in types if item['name'] == 'iPhone 14 Pro')
        # Build and prepare the public fixture before starting CoreSimulator.
        # Neither needs a booted device; keeping a VM alive through a full
        # compile competes for the runner's CPU and memory before acceptance.
        # The same fresh runtime/device and all process/performance limits stay.
        phase = 'build'
        with (output / 'public-io-diagnostic-build.log').open('w') as log:
            command('xcodebuild', '-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', 'ios/build/public-io-simulator', 'build', 'CODE_SIGN_IDENTITY=-', 'CODE_SIGNING_ALLOWED=YES', timeout=900, log=log)
        phase = 'prepare-public-fixtures'
        command('node', 'scripts/public-io-fixtures.mjs', '--ios', timeout=120)
        phase = 'create'
        owned = command('xcrun', 'simctl', 'create', 'COC additional complete public I/O', device['identifier'], runtime['identifier'])
        uuid.UUID(owned)
        phase = 'boot'
        command('xcrun', 'simctl', 'boot', owned, timeout=300)
        command('xcrun', 'simctl', 'bootstatus', owned, '-b', timeout=300)
        phase = 'install'
        command('xcrun', 'simctl', 'install', owned, 'ios/build/public-io-simulator/Build/Products/Debug-iphonesimulator/App.app', timeout=120)
        phase = 'container'
        container = pathlib.Path(command('xcrun', 'simctl', 'get_app_container', owned, 'coc.logbook', 'data'))
        phase = 'fixtures'
        command('python3', 'scripts/ios-public-io-fixture.py', str(container / 'Library/Application Support/COCLogbook/logbook.sqlite'), timeout=120)
        (container / 'tmp').mkdir(parents=True, exist_ok=True)
        (container / 'tmp/ios-scale-webview.js').write_bytes((output / 'public-io/public-io-webview.js').read_bytes())
        report = container / 'tmp/ios-scale-result.json'
        phase = 'complete-io'
        command('xcrun', 'simctl', 'launch', owned, 'coc.logbook', '--coc-ios-scale', '--coc-public-io', timeout=120)
        deadline = time.monotonic() + 950
        while not report.exists() and time.monotonic() < deadline:
            time.sleep(1)
        if not report.exists():
            raise TimeoutError('Complete public I/O report not produced')
        result_path = output / 'ios-public-io-diagnostic-result.json'
        result_path.write_bytes(report.read_bytes())
        result = json.loads(result_path.read_text())
        if not result.get('passed'):
            raise RuntimeError('Complete public I/O failed: ' + str(result))
        command('xcrun', 'simctl', 'terminate', owned, 'coc.logbook', timeout=60)
        command('python3', 'scripts/check-public-io.py', str(container), str(result_path), timeout=120)
        print('Additional complete I/O passed; full iOS CI remains required.', flush=True)
    except Exception as error:
        (output / 'ios-public-io-diagnostic-failure.json').write_text(json.dumps({'passed': False, 'phase': phase, 'error': str(error), 'scope': 'additional fictional complete I/O only; full CI remains required'}))
        raise
    finally:
        if owned:
            try:
                command('xcrun', 'simctl', 'shutdown', owned, timeout=45)
            except Exception as error:
                print('Owned diagnostic simulator cleanup: ' + str(error), flush=True)


if __name__ == '__main__':
    main()
