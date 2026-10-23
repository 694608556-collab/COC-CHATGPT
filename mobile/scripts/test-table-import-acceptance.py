import copy
import unittest
from table_import_acceptance import check_table_timings


class TableImportAcceptance(unittest.TestCase):
    def fixture(self):
        return {
            'passed': True,
            'completeOriginalBodiesVerified': 78,
            'results': [
                {'operation': 'record-table-import-preview-' + extension + '-' + str(repeat), 'responseMs': 100, 'totalMs': 600}
                for extension in ('csv', 'xlsx', 'xls') for repeat in range(3)
            ] + [{'operation': 'record-table-import-commit-full-115', 'totalMs': 1200}]
        }

    def test_exact_boundaries_and_full_commit(self):
        # Complete preview has the 600ms gate; the later full commit is measured separately.
        self.assertEqual(len(check_table_timings(self.fixture())), 9)

    def full_matrix_fixture(self):
        data = self.fixture()
        data['results'] += [
            {'operation': 'record-table-import-preview-' + extension, 'responseMs': 100, 'totalMs': 600}
            for extension in ('csv', 'xlsx', 'xls')
        ]
        return data

    def test_full_matrix_retains_all_three_original_previews(self):
        self.assertEqual(len(check_table_timings(self.full_matrix_fixture())), 12)

    def test_each_original_preview_still_has_the_same_strict_gates(self):
        for index in range(3):
            for key, bad in [('responseMs', 100.001), ('totalMs', 600.001), ('responseMs', float('nan')), ('totalMs', True)]:
                with self.subTest(sample=index, field=key, value=bad):
                    data = self.full_matrix_fixture()
                    for sample in data['results']: sample.update(responseMs=1, totalMs=1)
                    data['results'][-3 + index][key] = bad
                    with self.assertRaises(AssertionError): check_table_timings(data)

    def test_original_previews_cannot_replace_any_new_first_or_repeat(self):
        for index in range(9):
            with self.subTest(sample=index):
                data = self.full_matrix_fixture(); data['results'].pop(index)
                with self.assertRaises(AssertionError): check_table_timings(data)

    def test_unknown_or_duplicate_original_preview_names_are_rejected(self):
        for operation in ['record-table-import-preview-ods', 'record-table-import-preview-csv-3', 'record-table-import-preview-csv']:
            data = self.full_matrix_fixture()
            data['results'].append({'operation': operation, 'responseMs': 1, 'totalMs': 1})
            with self.assertRaises(AssertionError): check_table_timings(data)

    def test_every_format_first_and_repeated_sample_must_pass_without_averaging(self):
        for index in range(9):
            for key, bad in [('responseMs', 100.001), ('totalMs', 600.001)]:
                with self.subTest(sample=index, field=key):
                    data = self.fixture()
                    for sample in data['results'][:9]: sample.update(responseMs=1, totalMs=1)
                    data['results'][index][key] = bad
                    with self.assertRaises(AssertionError): check_table_timings(data)

    def test_missing_duplicate_replaced_or_extra_preview_rejected(self):
        changes = [
            lambda rows: rows.pop(0),
            lambda rows: rows.append(copy.deepcopy(rows[0])),
            lambda rows: rows[8].update(operation=rows[0]['operation']),
            lambda rows: rows[0].update(operation='record-table-import-preview-csv-3'),
            lambda rows: rows.append({'operation': 'record-table-import-preview-csv-3', 'responseMs': 1, 'totalMs': 1})
        ]
        for change in changes:
            data = self.fixture(); change(data['results'])
            with self.assertRaises(AssertionError): check_table_timings(data)

    def test_invalid_nonfinite_missing_or_boolean_preview_measurements_rejected(self):
        for value in [None, True, False, -1, float('nan'), float('inf'), -float('inf'), '10']:
            for key in ['responseMs', 'totalMs']:
                for index in range(9):
                    with self.subTest(sample=index, field=key, value=value):
                        data = self.fixture(); data['results'][index][key] = value
                        with self.assertRaises(AssertionError): check_table_timings(data)
        for key in ['responseMs', 'totalMs']:
            data = self.fixture(); del data['results'][0][key]
            with self.assertRaises(AssertionError): check_table_timings(data)

    def test_failed_or_missing_complete_content_checks_never_pass(self):
        for value in [False, None, 1, 'true']:
            data = self.fixture(); data['passed'] = value
            with self.assertRaises(AssertionError): check_table_timings(data)
        for value in [None, 0, 77, 79, True, 78.0, '78']:
            data = self.fixture(); data['completeOriginalBodiesVerified'] = value
            with self.assertRaises(AssertionError): check_table_timings(data)

    def test_final_full_commit_is_required_once_with_a_valid_measurement(self):
        for change in [lambda rows: rows.pop(), lambda rows: rows.append(copy.deepcopy(rows[-1]))]:
            data = self.fixture(); change(data['results'])
            with self.assertRaises(AssertionError): check_table_timings(data)
        for value in [None, True, False, -1, float('nan'), float('inf'), '1200']:
            data = self.fixture(); data['results'][-1]['totalMs'] = value
            with self.assertRaises(AssertionError): check_table_timings(data)

    def test_malformed_report_does_not_count_as_success(self):
        for value in [None, [], 'success']:
            with self.assertRaises(AssertionError): check_table_timings(value)
        for value in [None, {}, [None], [{'operation': None}]]:
            data = self.fixture(); data['results'] = value
            with self.assertRaises(AssertionError): check_table_timings(data)


if __name__ == '__main__': unittest.main()
