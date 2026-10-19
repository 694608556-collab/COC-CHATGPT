import hashlib
import json
import pathlib
import plistlib
import subprocess
import sys

app = pathlib.Path(sys.argv[1])
info = plistlib.loads((app / 'Info.plist').read_bytes())
assert info['CFBundleIdentifier'] == 'coc.logbook'
assert info['CFBundleShortVersionString'] == '1.0.5'
assert info['CFBundleVersion'] == '39'
architectures = subprocess.check_output(['lipo', '-archs', str(app / info['CFBundleExecutable'])], text=True).strip()
assert 'arm64' in architectures.split(), architectures
public = app / 'public'
for name in ['app.js', 'app.css', 'snapshot-worker.js', 'export-worker.js', 'index.html']:
    assert (public / name).read_bytes() == (pathlib.Path('www') / name).read_bytes(), name
assert 'data-platform="ios"' in (public / 'index.html').read_text()
assert 'viewport-fit=cover' in (public / 'index.html').read_text()
assert 'maximum-scale=1' in (public / 'index.html').read_text()
fonts = list((public / 'fonts').glob('*'))
assert len(fonts) == 8
for font in fonts:
    original = font.name.rsplit('-', 1)[0] + font.suffix
    assert font.read_bytes() == (pathlib.Path('../src/renderer/src/assets/fonts') / original).read_bytes(), font.name
for file in app.rglob('*'):
    assert file.suffix not in ['.p12', '.pfx', '.password', '.keystore', '.jks', '.map', '.sqlite', '.db'], str(file)
assert not (app / 'embedded.mobileprovision').exists()
config = json.loads((app / 'capacitor.config.json').read_text())
assert not config.get('server', {}).get('url')
print(json.dumps({'bundle': info['CFBundleIdentifier'], 'version': info['CFBundleShortVersionString'], 'build': info['CFBundleVersion'], 'architectures': architectures, 'webAssetsMatch': True, 'originalFonts': len(fonts), 'signing': 'unsigned; requires Apple signing before installation'}, ensure_ascii=False))
