"""Independent SQLite proofs for fictional cold table imports only."""
import hashlib
from contextlib import closing
import json
import pathlib
import sqlite3
import uuid
from table_import_acceptance import check_table_timings

FORMATS = ('csv', 'xlsx', 'xls')
MANUAL = 'PUBLIC_MANUAL_BEGIN\n完整😀正文\nPUBLIC_MANUAL_END'


def check_cold_report(result, first):
    assert first in FORMATS
    assert result.get('coldTableFirst') == first, 'Requested first format must survive the actual WebView entry'
    assert result.get('physicalPhone') is False
    uuid.UUID(result['coldSimulator'])
    start = FORMATS.index(first)
    order = FORMATS[start:] + FORMATS[:start]
    expected = ['record-table-import-preview-' + fmt + '-' + str(repeat) for fmt in order for repeat in range(3)]
    expected.append('record-table-import-commit-full-115')
    assert [row['operation'] for row in result['results']] == expected, 'Require exactly nine previews in cold-first order and one complete commit'
    check_table_timings(result)


def read_body(db, record_id):
    key = 'body:' + record_id
    proof = db.execute('SELECT bytes,sha256 FROM value_manifests WHERE key=?', (key,)).fetchone()
    if proof:
        parts = db.execute('SELECT part,value FROM value_chunks WHERE key=? ORDER BY part', (key,)).fetchall()
        assert [part for part, _ in parts] == list(range(len(parts)))
        data = b''.join(bytes(value) for _, value in parts)
        assert len(data) == proof[0] and hashlib.sha256(data).hexdigest() == proof[1]
        return json.loads(data)
    return json.loads(db.execute('SELECT body FROM records WHERE id=?', (record_id,)).fetchone()[0])


def verify_database(database, source):
    originals = source['records']
    assert len(originals) == 78 and {row['id'] for row in originals} == {'public-io-' + str(i) for i in range(78)}
    with closing(sqlite3.connect(pathlib.Path(database).resolve().as_uri() + '?mode=ro', uri=True)) as db:
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        rows = db.execute('SELECT id,metadata FROM records ORDER BY position').fetchall()
        assert len(rows) == 193
        records = {key: json.loads(metadata) for key, metadata in rows}
        assert len(records) == 193
        original_ids = {row['id'] for row in originals}
        for original in originals:
            expected_metadata = {key: value for key, value in original.items() if key not in ('rawContent', 'manualContent')}
            assert records[original['id']] == expected_metadata, 'Original record metadata changed'
            body = read_body(db, original['id'])
            assert body == {key: value for key, value in original.items() if key in ('rawContent', 'manualContent')}, 'Original complete body changed'
        added = [row for key, row in records.items() if key not in original_ids]
        assert len(added) == 115
        assert len({row['moduleId'] for row in added}) == 1
        for i in range(114):
            matching = [row for row in added if row['name'] == '公开导入场' + str(i)]
            assert len(matching) == 1
            row = matching[0]
            assert row['link'] == 'https://log.weizaima.com/?key=public-io-' + str(i)
            assert row['order'] == i and row['sequenceNo'] == i + 1
        manual = [row for row in added if row['name'] == '公开导入完整手动正文']
        assert len(manual) == 1 and manual[0].get('link', '') == ''
        assert manual[0]['order'] == 114 and manual[0]['sequenceNo'] == 115
        assert read_body(db, manual[0]['id'])['manualContent'] == MANUAL
    return 78


def verify(container, report, first, source_path=pathlib.Path('ios/build/public-io/public-io-library.json')):
    result = json.loads(pathlib.Path(report).read_text(encoding='utf-8'))
    assert result.get('passed') is True
    source = json.loads(pathlib.Path(source_path).read_text(encoding='utf-8'))
    result['completeOriginalBodiesVerified'] = verify_database(pathlib.Path(container) / 'Library/Application Support/COCLogbook/logbook.sqlite', source)
    result['independentImportedRecordsVerified'] = 115
    check_cold_report(result, first)
    pathlib.Path(report).write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    return result
