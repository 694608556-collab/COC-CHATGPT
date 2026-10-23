"""Independent readback of only fictional outputs and the newly created CI database."""
import hashlib, json, pathlib, re, sqlite3, sys, zipfile
import xml.etree.ElementTree as ET
from character_import_acceptance import check_character_timings
from table_import_acceptance import check_table_timings

container, report = map(pathlib.Path, sys.argv[1:3])
result = json.loads(report.read_text())
assert result['passed'] is True and len(result['documents']) >= 31
check_character_timings(result)
archive = (container / 'Documents/归档').resolve()
for item in result['documents']:
    path = (archive / item['name']).resolve()
    assert path.parent == archive
    data = path.read_bytes()
    assert len(data) == item['bytes'] and hashlib.sha256(data).hexdigest() == item['sha256']
    extension = path.suffix.lower()
    if extension == '.json':
        value = json.loads(data)
        if isinstance(value, dict) and 'snapshot' in value:
            assert len(value['snapshot']['records']) == 193
        else:
            logs = [row['log'] for row in value] if isinstance(value, list) else [value]
            assert all(len(log['messages']) == 650 and log['messages'][-1]['text'].endswith('_649') for log in logs)
    elif extension in ('.doc', '.txt'):
        assert 'PUBLIC_END_' in data.decode('utf-8-sig') and '_649' in data.decode('utf-8-sig')
    elif extension == '.docx':
        with zipfile.ZipFile(path) as source:
            assert source.testzip() is None
            text = ''.join(ET.fromstring(source.read('word/document.xml')).itertext())
            assert 'PUBLIC_END_' in text and '_649' in text
    elif extension == '.pdf':
        assert data.startswith(b'%PDF-') and b'%%EOF' in data[-2048:] and re.search(rb'/Type\s*/Pages\b', data)
    elif extension in ('.zip', '.xlsx'):
        with zipfile.ZipFile(path) as source:
            assert source.testzip() is None
source = json.loads(pathlib.Path('ios/build/public-io/public-io-library.json').read_text())
database = container / 'Library/Application Support/COCLogbook/logbook.sqlite'
db = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)
assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
assert db.execute('SELECT COUNT(*) FROM records').fetchone()[0] == 193
for original in source['records']:
    key = 'body:' + original['id']
    proof = db.execute('SELECT bytes,sha256 FROM value_manifests WHERE key=?', (key,)).fetchone()
    if proof:
        parts = db.execute('SELECT part,value FROM value_chunks WHERE key=? ORDER BY part', (key,)).fetchall()
        assert [part for part, _ in parts] == list(range(len(parts)))
        data = b''.join(bytes(value) for _, value in parts)
        assert len(data) == proof[0] and hashlib.sha256(data).hexdigest() == proof[1]
        body = json.loads(data)
    else:
        body = json.loads(db.execute('SELECT body FROM records WHERE id=?', (original['id'],)).fetchone()[0])
    assert body['rawContent'] == original['rawContent']
db.close()
result.update(independentOutputProofs=len(result['documents']), completeOriginalBodiesVerified=78)
check_table_timings(result)
report.write_text(json.dumps(result, ensure_ascii=False))
print('PUBLIC_IOS_IO_PROOFS outputs=' + str(len(result['documents'])) + ' completeBodies=78 sqliteIntegrity=ok physicalPhone=false')
