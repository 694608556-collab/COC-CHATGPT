"""Seed only a newly created CI simulator from the shared fictional JSON fixture."""
import json, pathlib, sqlite3, sys

target = pathlib.Path(sys.argv[1])
if target.exists():
    raise RuntimeError('Refuse an existing database')
sample = json.loads(pathlib.Path('ios/build/public-io/public-io-library.json').read_text())
assert len(sample['records']) == 78 and all(r['id'].startswith('public-io-') for r in sample['records'])
target.parent.mkdir(parents=True, exist_ok=True)
encode = lambda value: json.dumps(value, ensure_ascii=False, separators=(',', ':'))
db = sqlite3.connect(target)
db.executescript('PRAGMA user_version=1; CREATE TABLE state(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT,revision INTEGER NOT NULL); CREATE TABLE records(id TEXT PRIMARY KEY,position INTEGER NOT NULL,metadata TEXT NOT NULL,body TEXT NOT NULL);')
db.execute('INSERT INTO state VALUES(1,?,1)', (encode({k:v for k,v in sample.items() if k != 'records'}),))
for i, record in enumerate(sample['records']):
    body = {k:v for k,v in record.items() if k in ('rawContent', 'manualContent')}
    metadata = {k:v for k,v in record.items() if k not in body}
    db.execute('INSERT INTO records VALUES(?,?,?,?)', (record['id'],i,encode(metadata),encode(body)))
db.commit()
assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
db.close()
