"""Real files: source/runtime changes, bundle corruption and missing proofs rebuild."""
import pathlib
import tempfile
import unittest
from ios_build_reuse import digest, reusable, record


class BuildReuse(unittest.TestCase):
    def test_identical_build_reuses_but_changed_bytes_or_context_do_not(self):
        with tempfile.TemporaryDirectory(prefix='coc-public-build-proof-') as folder:
            root = pathlib.Path(folder)
            source = root / 'public.swift'
            source.write_text('original source', encoding='utf-8')
            app = root / 'App.app'
            app.mkdir()
            (app / 'App').write_bytes(b'public binary')
            (app / 'font').write_bytes(b'all font bytes')
            marker = root / 'proof.json'
            context = {'sources': digest([source]), 'runtime': 'public-runtime', 'configuration': 'Debug', 'run': 'owned-job'}
            self.assertFalse(reusable(marker, app, context))
            record(marker, app, context)
            self.assertTrue(reusable(marker, app, context))
            for key in context:
                self.assertFalse(reusable(marker, app, {**context, key: 'changed'}))
            (app / 'font').write_bytes(b'damaged font')
            self.assertFalse(reusable(marker, app, context))
            (app / 'font').write_bytes(b'all font bytes')
            source.write_text('changed source', encoding='utf-8')
            self.assertFalse(reusable(marker, app, {**context, 'sources': digest([source])}))
            marker.write_text('invalid json', encoding='utf-8')
            self.assertFalse(reusable(marker, app, context))


if __name__ == '__main__':
    unittest.main()
