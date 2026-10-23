import copy
import unittest
from character_import_acceptance import check_character_timings


class CharacterImportAcceptance(unittest.TestCase):
    def fixture(self):
        return {'passed': True, 'results': [{'operation': 'character-import-xlsx-' + str(i), 'responseMs': 100, 'totalMs': 600} for i in range(3)]}

    def test_exact_boundaries(self):
        self.assertEqual(len(check_character_timings(self.fixture())), 3)

    def test_each_first_and_repeat_must_pass_without_averaging(self):
        for i in range(3):
            for key, bad in [('responseMs', 100.001), ('totalMs', 600.001)]:
                with self.subTest(sample=i, field=key):
                    data = self.fixture()
                    for item in data['results']: item.update(responseMs=1, totalMs=1)
                    data['results'][i][key] = bad
                    with self.assertRaises(AssertionError): check_character_timings(data)

    def test_missing_and_duplicate_samples_rejected(self):
        for change in [lambda rows: rows.pop(), lambda rows: rows.append(copy.deepcopy(rows[0])), lambda rows: rows[2].update(operation='character-import-xlsx-1')]:
            data = self.fixture(); change(data['results'])
            with self.assertRaises(AssertionError): check_character_timings(data)

    def test_invalid_or_nonfinite_measurements_rejected(self):
        for value in [None, True, -1, float('nan'), float('inf'), '10']:
            for key in ['responseMs', 'totalMs']:
                with self.subTest(field=key, value=value):
                    data = self.fixture(); data['results'][0][key] = value
                    with self.assertRaises(AssertionError): check_character_timings(data)

    def test_failed_content_checks_never_pass_as_performance_success(self):
        data = self.fixture(); data['passed'] = False
        with self.assertRaises(AssertionError): check_character_timings(data)


if __name__ == '__main__': unittest.main()
