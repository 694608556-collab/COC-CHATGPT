import contextlib
import hashlib
import importlib.util
import json
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest
import uuid
from unittest import mock
from ios_table_readback import FORMATS, MANUAL, check_cold_report, verify_database

spec = importlib.util.spec_from_file_location('cold_table_runner', pathlib.Path(__file__).with_name('ios-cold-table-check.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def report(first):
    start = FORMATS.index(first)
    formats = FORMATS[start:] + FORMATS[:start]
    return {'passed': True, 'physicalPhone': False, 'coldTableFirst': first, 'coldSimulator': str(uuid.uuid4()),
            'completeOriginalBodiesVerified': 78, 'independentImportedRecordsVerified': 115,
            'results': [{'operation': 'record-table-import-preview-' + fmt + '-' + str(i), 'responseMs': 100, 'totalMs': 600}
                        for fmt in formats for i in range(3)] + [{'operation': 'record-table-import-commit-full-115', 'totalMs': 1000}]}


class ColdTableReports(unittest.TestCase):
    def test_all_three_cold_orders_retain_all_nine_exact_boundaries(self):
        for first in FORMATS:
            check_cold_report(report(first), first)

    def test_warm_sequence_missing_duplicate_and_extra_samples_fail(self):
        for mutate in [lambda rows: rows.reverse(), lambda rows: rows.pop(0), lambda rows: rows.append(rows[0]),
                       lambda rows: rows.insert(0, {'operation': 'module-search-0', 'totalMs': 0})]:
            value = report('xlsx'); mutate(value['results'])
            with self.assertRaises(AssertionError): check_cold_report(value, 'xlsx')

    def test_every_sample_keeps_strict_first_and_repeated_thresholds(self):
        for first in FORMATS:
            for i in range(9):
                for key, bad in [('responseMs', 100.001), ('totalMs', 600.001)]:
                    value = report(first); value['results'][i][key] = bad
                    with self.subTest(first=first, sample=i, key=key), self.assertRaises(AssertionError): check_cold_report(value, first)

    def test_wrong_first_device_and_body_proof_fail(self):
        for key, value in [('coldTableFirst', 'csv'), ('coldSimulator', 'booted'), ('completeOriginalBodiesVerified', 77), ('passed', False)]:
            data = report('xlsx'); data[key] = value
            with self.subTest(key=key), self.assertRaises((AssertionError, ValueError)): check_cold_report(data, 'xlsx')


class IndependentReadback(unittest.TestCase):
    def fixture(self, root):
        path = root / 'public.sqlite'
        db = sqlite3.connect(path)
        db.executescript('CREATE TABLE records(id TEXT,position INTEGER,metadata TEXT,body TEXT); CREATE TABLE value_manifests(key TEXT,bytes INTEGER,sha256 TEXT); CREATE TABLE value_chunks(key TEXT,part INTEGER,value BLOB);')
        source = {'records': []}
        for i in range(78):
            original = {'id': 'public-io-' + str(i), 'name': 'original-' + str(i), 'rawContent': {'text': 'full-original-😀\r\n\u0000-' + str(i)}}
            source['records'].append(original)
            db.execute('INSERT INTO records VALUES(?,?,?,?)', (original['id'], i, json.dumps({k:v for k,v in original.items() if k != 'rawContent'}), json.dumps({'rawContent': original['rawContent']})))
        for i in range(115):
            row = {'id': 'added-' + str(i), 'moduleId': 'imported', 'name': '公开导入场' + str(i) if i < 114 else '公开导入完整手动正文',
                   'link': 'https://log.weizaima.com/?key=public-io-' + str(i) if i < 114 else '', 'order': i, 'sequenceNo': i + 1}
            db.execute('INSERT INTO records VALUES(?,?,?,?)', (row['id'], 78 + i, json.dumps(row), json.dumps({'manualContent': MANUAL} if i == 114 else {})))
        # Exercise actual chunk proof verification, including Unicode and NUL.
        data = json.dumps({'rawContent': source['records'][0]['rawContent']}, ensure_ascii=False).encode()
        db.execute('INSERT INTO value_manifests VALUES(?,?,?)', ('body:public-io-0', len(data), hashlib.sha256(data).hexdigest()))
        for i, part in enumerate([data[:7], data[7:]]): db.execute('INSERT INTO value_chunks VALUES(?,?,?)', ('body:public-io-0', i, part))
        db.commit(); db.close()
        return path, source

    def test_complete_original_and_imported_data_are_independently_read(self):
        with tempfile.TemporaryDirectory() as folder:
            path, source = self.fixture(pathlib.Path(folder))
            self.assertEqual(verify_database(path, source), 78)

    def test_manual_record_optional_link_matches_the_actual_saved_metadata(self):
        # Both native importers omit an empty optional link on manual records.
        with tempfile.TemporaryDirectory() as folder:
            path, source = self.fixture(pathlib.Path(folder))
            with contextlib.closing(sqlite3.connect(path)) as db:
                db.execute("UPDATE records SET metadata=json_remove(metadata,'$.link') WHERE id='added-114'")
                db.commit()
            self.assertEqual(verify_database(path, source), 78)
            with contextlib.closing(sqlite3.connect(path)) as db:
                db.execute("UPDATE records SET metadata=json_set(metadata,'$.link','unexpected') WHERE id='added-114'")
                db.commit()
            with self.assertRaises(AssertionError): verify_database(path, source)

    def test_missing_tail_wrong_link_manual_truncation_and_corrupt_chunk_fail(self):
        mutations = ["DELETE FROM records WHERE id='added-114'",
                     "UPDATE records SET metadata=json_set(metadata,'$.link','wrong') WHERE id='added-113'",
                     "UPDATE records SET body='{\"manualContent\":\"truncated\"}' WHERE id='added-114'",
                     "UPDATE value_chunks SET value=X'00' WHERE part=1"]
        for sql in mutations:
            with self.subTest(sql=sql), tempfile.TemporaryDirectory() as folder:
                path, source = self.fixture(pathlib.Path(folder))
                with contextlib.closing(sqlite3.connect(path)) as db:
                    db.execute(sql); db.commit()
                with self.assertRaises(AssertionError): verify_database(path, source)


class ColdRunner(unittest.TestCase):
    def test_aggregate_only_requires_all_independent_reports_without_launching_children(self):
        for broken in (None, 'missing', 'duplicate', 'corrupt'):
            with self.subTest(broken=broken), tempfile.TemporaryDirectory() as folder, contextlib.chdir(folder):
                pathlib.Path('ios/build').mkdir(parents=True)
                for first in FORMATS:
                    value = report(first)
                    if broken == 'missing' and first == 'xls': continue
                    if broken == 'duplicate': value['coldSimulator'] = '00000000-0000-0000-0000-000000000001'
                    if broken == 'corrupt' and first == 'xlsx': value['results'][0]['totalMs'] = 600.001
                    pathlib.Path('ios/build/ios-public-io-diagnostic-table-' + first + '-result.json').write_text(json.dumps(value), encoding='utf-8')
                with mock.patch.object(runner.subprocess, 'run', side_effect=AssertionError('Aggregation must not launch children')), contextlib.redirect_stdout(__import__('io').StringIO()):
                    if broken:
                        with self.assertRaises((AssertionError, FileNotFoundError)): runner.main(['--aggregate-only'])
                    else: runner.main(['--aggregate-only'])
                summary = json.loads(pathlib.Path('ios/build/ios-public-io-diagnostic-cold-table-matrix.json').read_text(encoding='utf-8'))
                self.assertIs(summary['passed'], broken is None)

    def execute(self, fail_at=None, reused_simulator=False, corrupt_report=False, previous_success=False):
        calls = []
        with tempfile.TemporaryDirectory() as folder, contextlib.chdir(folder):
            pathlib.Path('ios/build').mkdir(parents=True)
            summary_path = pathlib.Path('ios/build/ios-public-io-diagnostic-cold-table-matrix.json')
            if previous_success:
                summary_path.write_text(json.dumps({'passed': True, 'runs': [report(first) for first in FORMATS]}), encoding='utf-8')
            def run(args, check):
                self.assertIs(check, True); calls.append(args)
                # Old success must already be invalidated before the first child.
                self.assertIs(json.loads(summary_path.read_text(encoding='utf-8'))['passed'], False)
                if len(calls) == fail_at: raise subprocess.CalledProcessError(1, args)
                first = args[-1]; value = report(first)
                if reused_simulator: value['coldSimulator'] = '00000000-0000-0000-0000-000000000001'
                if corrupt_report: value['results'].pop(0)
                pathlib.Path('ios/build/ios-public-io-diagnostic-table-' + first + '-result.json').write_text(json.dumps(value), encoding='utf-8')
            with mock.patch.object(runner.subprocess, 'run', run), contextlib.redirect_stdout(__import__('io').StringIO()):
                if fail_at or reused_simulator or corrupt_report:
                    with self.assertRaises((subprocess.CalledProcessError, AssertionError)): runner.main()
                    summary = json.loads(summary_path.read_text(encoding='utf-8'))
                    self.assertIs(summary['passed'], False)
                    self.assertEqual(summary['status'], 'failed')
                    self.assertEqual(summary['failedFirst'], calls[-1][-1])
                else:
                    runner.main()
                    summary = json.loads(pathlib.Path('ios/build/ios-public-io-diagnostic-cold-table-matrix.json').read_text(encoding='utf-8'))
                    self.assertEqual(len(summary['runs']), 3)
                    self.assertIs(summary['requiresCompleteIo'], True)
        return calls

    def test_three_independent_child_invocations_each_keep_the_full_matrix(self):
        calls = self.execute()
        self.assertEqual([args[-2:] for args in calls], [['--table-first', first] for first in FORMATS])

    def test_failure_stops_without_retry_or_publishing_success(self):
        self.assertEqual(len(self.execute(fail_at=2)), 2)
        self.assertEqual(len(self.execute(corrupt_report=True)), 1)

    def test_reusing_an_app_process_or_simulator_is_rejected(self):
        self.assertEqual(len(self.execute(reused_simulator=True)), 2)

    def test_previous_success_cannot_survive_a_new_second_child_failure(self):
        self.assertEqual(len(self.execute(fail_at=2, previous_success=True)), 2)


if __name__ == '__main__': unittest.main()
