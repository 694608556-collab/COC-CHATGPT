"""Additional complete I/O feedback loop; never substitutes for full iOS CI."""
import importlib.util
import json
import os
import pathlib
import tempfile
import time
import uuid

spec = importlib.util.spec_from_file_location('coc_smoke_shared', pathlib.Path(__file__).with_name('ios-simulator-smoke.py'))
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
command = shared.command
output = pathlib.Path('ios/build')


def write_diagnostic(name, data):
    """Diagnostic failures must never replace the acceptance failure."""
    try:
        (output / name).write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    except Exception as error:
        print('Public I/O diagnostic write: ' + str(error), flush=True)


def collect_health(phase, owned, runtime):
    # Only public runner metadata and process names; never environment dumps,
    # process arguments, application files or private input are collected.
    data = {'phase': phase, 'device': owned, 'runtime': runtime,
            'image': {key: os.environ.get(key) for key in ('ImageOS', 'ImageVersion', 'RUNNER_OS', 'RUNNER_ARCH')}}
    for name, args in (
        ('xcode', ('xcodebuild', '-version')),
        ('runtimes', ('xcrun', 'simctl', 'runtime', 'list')),
        ('memory', ('vm_stat',)),
        ('processes', ('ps', '-axo', 'pid,ppid,stat,%cpu,%mem,rss,comm')),
        ('disk', ('df', '-k', '.')),
    ):
        try:
            data[name] = {'output': command(*args, timeout=10)}
        except Exception as error:
            data[name] = {'error': str(error)}
    write_diagnostic('ios-public-io-diagnostic-health-' + phase + '.json', data)


def boot_status(owned):
    # Stream the entire output, including output preceding a timeout, then put
    # it in the existing diagnostic JSON artifact family without truncation.
    with tempfile.TemporaryFile(mode='w+', encoding='utf-8', errors='replace') as log:
        try:
            command('xcrun', 'simctl', 'bootstatus', owned, '-b', timeout=300, log=log)
        finally:
            try:
                log.flush()
                log.seek(0)
                write_diagnostic('ios-public-io-diagnostic-bootstatus.json', {'device': owned, 'output': log.read()})
            except Exception as error:
                print('Public I/O boot diagnostic: ' + str(error), flush=True)


def main():
    output.mkdir(parents=True, exist_ok=True)
    owned = None
    runtime = None
    phase = 'environment'
    try:
        runtime = shared.select_runtime(json.loads(command('xcrun', 'simctl', 'list', 'runtimes', '--json'))['runtimes'])
        types = json.loads(command('xcrun', 'simctl', 'list', 'devicetypes', '--json'))['devicetypes']
        device = next(item for item in types if item['name'] == 'iPhone 14 Pro')
        collect_health('startup', owned, runtime)
        phase = 'create'
        created = command('xcrun', 'simctl', 'create', 'COC additional complete public I/O', device['identifier'], runtime['identifier'])
        uuid.UUID(created)
        owned = created
        phase = 'boot'
        command('xcrun', 'simctl', 'boot', owned, timeout=300)
        phase = 'bootstatus'
        boot_status(owned)
        # Match the successful native/UI coordinator: build for this exact
        # booted device. The generic-before-boot scheduling assumption failed
        # on both runner image versions; all acceptance limits stay unchanged.
        phase = 'build'
        with (output / 'public-io-diagnostic-build.log').open('w') as log:
            command('xcodebuild', '-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug', '-destination', 'platform=iOS Simulator,id=' + owned, '-derivedDataPath', 'ios/build/public-io-simulator', 'build', 'CODE_SIGN_IDENTITY=-', 'CODE_SIGNING_ALLOWED=YES', timeout=900, log=log)
        phase = 'install'
        command('xcrun', 'simctl', 'install', owned, 'ios/build/public-io-simulator/Build/Products/Debug-iphonesimulator/App.app', timeout=120)
        phase = 'container'
        container = pathlib.Path(command('xcrun', 'simctl', 'get_app_container', owned, 'coc.logbook', 'data'))
        phase = 'prepare-public-fixtures'
        command('node', 'scripts/public-io-fixtures.mjs', '--ios', timeout=120)
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
        write_diagnostic('ios-public-io-diagnostic-failure.json', {'passed': False, 'phase': phase, 'error': str(error), 'scope': 'additional fictional complete I/O only; full CI remains required'})
        collect_health('failure', owned, runtime)
        raise
    finally:
        if owned:
            try:
                command('xcrun', 'simctl', 'shutdown', owned, timeout=45)
            except Exception as error:
                print('Owned diagnostic simulator cleanup: ' + str(error), flush=True)


if __name__ == '__main__':
    main()
