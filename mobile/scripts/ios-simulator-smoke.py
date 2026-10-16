import json
import pathlib
import subprocess
import time

def command(*args):
    return subprocess.check_output(args, text=True).strip()

runtimes = json.loads(command('xcrun', 'simctl', 'list', 'runtimes', '--json'))['runtimes']
available = [r for r in runtimes if r.get('isAvailable') and 'iOS' in r['identifier']]
runtime = sorted(available, key=lambda r: tuple(map(int, r['version'].split('.'))))[-1]
types = json.loads(command('xcrun', 'simctl', 'list', 'devicetypes', '--json'))['devicetypes']
device = next(d for d in types if d['name'] == 'iPhone 14 Pro')
udid = command('xcrun', 'simctl', 'create', 'COC isolated iPhone 14 Pro', device['identifier'], runtime['identifier'])
metadata = {'device': device['name'], 'runtime': runtime['version'], 'udid': udid, 'scope': 'fresh cloud simulator, no user phone data'}
pathlib.Path('ios/build/simulator-environment.json').write_text(json.dumps(metadata))
try:
    subprocess.run(['xcrun', 'simctl', 'boot', udid], check=True)
    subprocess.run(['xcrun', 'simctl', 'bootstatus', udid, '-b'], check=True)
    with open('ios/build/simulator-build.log', 'w') as log:
        result = subprocess.run(['xcodebuild', '-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug', '-destination', 'platform=iOS Simulator,id=' + udid, '-derivedDataPath', 'ios/build/simulator', 'build', 'CODE_SIGN_IDENTITY=-', 'CODE_SIGNING_ALLOWED=YES'], stdout=log, stderr=subprocess.STDOUT)
    if result.returncode:
        print(pathlib.Path('ios/build/simulator-build.log').read_text()[-10000:])
        raise RuntimeError('Simulator build failed')
    subprocess.run(['xcrun', 'simctl', 'install', udid, 'ios/build/simulator/Build/Products/Debug-iphonesimulator/App.app'], check=True)
    subprocess.run(['xcrun', 'simctl', 'launch', udid, 'coc.logbook', '--coc-ios-smoke'], check=True)
    container = pathlib.Path(command('xcrun', 'simctl', 'get_app_container', udid, 'coc.logbook', 'data'))
    report = container / 'tmp/ios-smoke-result.json'
    for _ in range(90):
        if report.exists(): break
        time.sleep(0.5)
    subprocess.run(['xcrun', 'simctl', 'io', udid, 'screenshot', 'ios/build/ios-initial-screen.png'], check=True)
    result = json.loads(report.read_text())
    pathlib.Path('ios/build/ios-smoke-result.json').write_text(json.dumps({**metadata, **result}))
    print(json.dumps({**metadata, **result}))
    assert result.get('passed'), result
finally:
    subprocess.run(['xcrun', 'simctl', 'shutdown', udid], check=False)
