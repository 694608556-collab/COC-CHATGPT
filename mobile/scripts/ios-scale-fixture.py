"""Public synthetic iOS v1 database, used only inside the fresh CI simulator."""
import json
import pathlib
import sqlite3
import sys

sample = json.loads(pathlib.Path('ios/build/native-sample.json').read_text())
target = pathlib.Path(sys.argv[1])
if target.exists():
    raise RuntimeError('Refusing to overwrite an existing database')
target.parent.mkdir(parents=True, exist_ok=True)
root = {k: v for k, v in sample.items() if k != 'records'}
root['characters'] = []
root['settings'].pop('autoBackup', None)
module = sample['modules'][0]
root['modules'] = [{**module, 'id': f'public-module-{i}', 'name': f'公开压力模组{i}', 'pairs': [], 'order': i} for i in range(50)]
base = next(r for r in sample['records'] if 'rawContent' in r)
db = sqlite3.connect(target)
db.executescript('PRAGMA user_version=1; CREATE TABLE state(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT,revision INTEGER NOT NULL); CREATE TABLE records(id TEXT PRIMARY KEY,position INTEGER NOT NULL,metadata TEXT NOT NULL,body TEXT NOT NULL);')
encode = lambda value: json.dumps(value, ensure_ascii=False, separators=(',', ':'))
db.execute('INSERT INTO state VALUES(1,?,1)', (encode(root),))
for i in range(1050):
    record = {k: v for k, v in base.items() if k not in ('rawContent', 'manualContent', 'cacheSourceUrl', 'playDate')}
    record.update(id=f'public-record-{i}' if i < 1000 else f'public-manual-{i-1000}', moduleId=f'public-module-{i//20 if i<1000 else i-1000}', order=i, dateSource='none')
    if i < 1000:
        record.update(sourceType='online', status='pending', link=f'https://log.weizaima.com/?key=public-{i}')
        raw = {**base['rawContent']}
        raw.pop('sourceUrl', None)
        raw['messages'] = [{**raw['messages'][0], 'text': 'PUBLIC OLD ' + 'A'*48000 + '中文😀'}]
        body = {'rawContent': raw}
    else:
        record.update(sourceType='manual', status='manual')
        record.pop('link', None)
        body = {'manualContent': f'PUBLIC MANUAL {i}\r\n\r\n中文😀'}
    db.execute('INSERT INTO records VALUES(?,?,?,?)', (record['id'], i, encode(record), encode(body)))
db.commit()
assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
db.close()
print('Public iOS v1 fixture: 50 campaigns, 1000 online + 50 manual,', target.stat().st_size, 'bytes')
