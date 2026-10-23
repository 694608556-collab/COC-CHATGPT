"""Reuse only identical verified simulator binaries; each test still gets a fresh device."""
import hashlib
import json
import pathlib


def digest(paths):
    value = hashlib.sha256()
    for root in sorted(map(pathlib.Path, paths), key=str):
        files = sorted(root.rglob('*')) if root.is_dir() else [root]
        if not root.exists():
            raise OSError('Missing build input')
        for file in files:
            if file.is_symlink():
                file.resolve().relative_to(root.resolve() if root.is_dir() else root.parent.resolve())
            if not file.is_file():
                continue
            value.update(str(file.relative_to(root) if root.is_dir() else root.name).encode())
            value.update(b'\0')
            with file.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    value.update(chunk)
            value.update(b'\0')
    return value.hexdigest()


def reusable(marker, app, context):
    try:
        app = pathlib.Path(app)
        if not (app / 'App').is_file():
            return False
        proof = json.loads(pathlib.Path(marker).read_text(encoding='utf-8'))
        return proof.get('context') == context and proof.get('bundleSha256') == digest([app])
    except (OSError, ValueError, TypeError):
        return False


def record(marker, app, context):
    proof = {'context': context, 'bundleSha256': digest([pathlib.Path(app)])}
    pathlib.Path(marker).write_text(json.dumps(proof), encoding='utf-8')
    return proof
