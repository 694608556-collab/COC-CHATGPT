"""First, repeated and missing results must each fail closed at 600/100ms."""
import copy
import unittest
from ios_search_acceptance import verify


class SearchAcceptance(unittest.TestCase):
    def fixture(self):
        return {'results': [{'operation': f'module-search-{i}', 'totalMs': 600, 'responseMs': 100} for i in range(3)]}

    def test_exact_limits(self):
        self.assertEqual(len(verify(self.fixture())), 3)

    def test_every_first_and_repeat_is_required(self):
        for index in range(3):
            result = self.fixture()
            result['results'].pop(index)
            with self.assertRaises(ValueError):
                verify(result)

    def test_every_result_and_response_must_pass(self):
        for index in range(3):
            for key, value in [('totalMs', 600.01), ('responseMs', 100.01), ('totalMs', float('nan')), ('responseMs', None), ('responseMs', True)]:
                result = copy.deepcopy(self.fixture())
                result['results'][index][key] = value
                with self.assertRaises(ValueError):
                    verify(result)


if __name__ == '__main__':
    unittest.main()
