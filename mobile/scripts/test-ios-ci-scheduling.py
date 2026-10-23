"""Fail closed when the complete I/O check is delegated to another required CI job."""
import importlib.util
import contextlib
import io
import json
import os
import pathlib
import re
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('ios_smoke_schedule', pathlib.Path(__file__).with_name('ios-simulator-smoke.py'))
SMOKE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SMOKE)


class RequiredIOScheduleTests(unittest.TestCase):
    def setUp(self):
        self.workflow = (ROOT / '.github/workflows/ios-check.yml').read_text(encoding='utf-8')
        self.reusable = (ROOT / '.github/workflows/ios-public-io-check.yml').read_text(encoding='utf-8')
        self.environment = {
            'GITHUB_ACTIONS': 'true',
            'GITHUB_JOB': 'ios',
            'GITHUB_WORKFLOW_REF': '694608556-collab/COC-CHATGPT/.github/workflows/ios-check.yml@refs/heads/codex/ios-ipa-adaptation',
        }

    def delegated(self, workflow=None, reusable=None, environment=None, job='complete-public-io'):
        return SMOKE.required_public_io_is_delegated(
            job,
            self.environment if environment is None else environment,
            self.workflow if workflow is None else workflow,
            self.reusable if reusable is None else reusable,
        )

    def test_default_direct_execution_keeps_full_io(self):
        self.assertFalse(SMOKE.required_public_io_is_delegated(None, {}, '', ''))

    def test_actual_workflow_has_parallel_mandatory_full_io(self):
        self.assertTrue(self.delegated())

    def test_missing_or_optional_job_is_rejected(self):
        variants = [
            self.workflow.replace('  complete-public-io:\n', '  removed-public-io:\n'),
            self.workflow.replace('  complete-public-io:\n', '  complete-public-io:\n    if: false\n'),
            self.workflow.replace('  complete-public-io:\n', '  complete-public-io:\n    continue-on-error: true\n'),
            self.workflow.replace('  complete-public-io:\n', '  complete-public-io:\n    needs: ios\n'),
            self.workflow.replace('uses: ./.github/workflows/ios-public-io-check.yml', 'uses: ./.github/workflows/not-the-full-check.yml'),
        ]
        for variant in variants:
            with self.subTest(variant=variants.index(variant)), self.assertRaises(RuntimeError):
                self.delegated(workflow=variant)

    def test_missing_or_weakened_aggregate_gate_is_rejected(self):
        for before, after in [
            ('  ios-complete:\n', '  removed-complete:\n'),
            ('needs: [ios, complete-public-io]', 'needs: [ios]'),
            ('if: ${{ always() }}', 'if: ${{ success() }}'),
            ('test "$NATIVE_RESULT" = success', 'true'),
            ('test "$IO_RESULT" = success', 'true'),
            ('      - name: Require native, system UI and complete I/O success', '      - if: false\n        name: Require native, system UI and complete I/O success'),
        ]:
            changed = self.workflow.replace(before, after)
            self.assertNotEqual(changed, self.workflow)
            with self.subTest(change=before), self.assertRaises(RuntimeError):
                self.delegated(workflow=changed)

    def test_reusable_cannot_drop_full_execution_or_acceptance_checks(self):
        for before, after in [
            ('  workflow_call:', '  removed_call:'),
            ('python3 scripts/ios-public-io-check.py', 'true'),
            ('python3 scripts/test-character-import-acceptance.py', 'true'),
            ('python3 scripts/test-table-import-acceptance.py', 'true'),
            ('    runs-on: xcode-27', '    runs-on: different-runner'),
            ('  public-io-feedback:\n', '  public-io-feedback:\n    if: false\n'),
            ('        run: python3 scripts/ios-public-io-check.py', '        if: false\n        run: python3 scripts/ios-public-io-check.py'),
            ('        run: python3 scripts/ios-public-io-check.py', '        continue-on-error: true\n        run: python3 scripts/ios-public-io-check.py'),
        ]:
            changed = self.reusable.replace(before, after)
            self.assertNotEqual(changed, self.reusable)
            with self.subTest(change=before), self.assertRaises(RuntimeError):
                self.delegated(reusable=changed)

    def test_only_full_workflow_can_explicitly_delegate(self):
        for environment in [{}, {**self.environment, 'GITHUB_JOB': 'unrelated'}, {**self.environment, 'GITHUB_WORKFLOW_REF': 'owner/repo/.github/workflows/unrelated.yml@refs/heads/main'}]:
            with self.subTest(environment=environment), self.assertRaises(RuntimeError):
                self.delegated(environment=environment)
        with self.assertRaises(RuntimeError):
            self.delegated(job='not-the-full-io-job')

    def execute_schedule(self, delegated=False, fail_ui=False, fail_capacity=False):
        """Exercise the real coordinator with public synthetic simulator reports."""
        calls = []
        declared_source = (ROOT / 'mobile/scripts/ios-picker-ui-tests.swift').read_text(encoding='utf-8')
        with tempfile.TemporaryDirectory(prefix='coc-public-ci-schedule-') as directory:
            base = pathlib.Path(directory)
            container = base / 'public-container'
            (container / 'tmp').mkdir(parents=True)
            (container / 'tmp/ios-name-events.jsonl').write_text('{"public":true}\n', encoding='utf-8')
            for relative, content in {
                'ios/build/public-coc7.xlsx': 'public fixture placeholder',
                'ios/build/ios-capacity-webview.js': 'public fixture placeholder',
                'ios/build/public-io/public-io-webview.js': 'public fixture placeholder',
                'scripts/ios-picker-ui-tests.swift': declared_source,
                'scripts/ios-scale-webview.js': 'public fixture placeholder',
            }.items():
                path = base / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding='utf-8')
            created = 0
            scale_launches = 0

            def fake_command(*args, **kwargs):
                nonlocal created, scale_launches
                calls.append((args, kwargs))
                if args[:4] == ('xcrun', 'simctl', 'list', 'runtimes'):
                    return json.dumps({'runtimes': [{'isAvailable': True, 'identifier': 'public-iOS-27', 'version': '27.0'}]})
                if args[:4] == ('xcrun', 'simctl', 'list', 'devicetypes'):
                    return json.dumps({'devicetypes': [{'name': 'iPhone 14 Pro', 'identifier': 'public-phone'}]})
                if args[:3] == ('xcrun', 'simctl', 'create'):
                    created += 1
                    return '00000000-0000-0000-0000-' + str(created).zfill(12)
                if args[:3] == ('xcrun', 'simctl', 'get_app_container'):
                    return str(container)
                if args[:3] == ('xcrun', 'simctl', 'launch'):
                    if '--coc-ios-smoke' in args:
                        (container / 'tmp/ios-smoke-result.json').write_text('{"passed":true}', encoding='utf-8')
                    else:
                        scale_launches += 1
                        passed = not (fail_capacity and scale_launches == 2)
                        (container / 'tmp/ios-scale-result.json').write_text(json.dumps({'passed': passed}), encoding='utf-8')
                if fail_ui and args[0] == 'xcodebuild' and 'test' in args:
                    raise subprocess.CalledProcessError(65, ['public-ui-assertion'])
                return ''

            with contextlib.chdir(base), contextlib.redirect_stdout(io.StringIO()), \
                    mock.patch.object(SMOKE, 'command', fake_command), \
                    mock.patch.object(SMOKE.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)), \
                    mock.patch.dict(os.environ, self.environment, clear=False):
                arguments = ['--required-public-io-job', 'complete-public-io'] if delegated else []
                if fail_ui or fail_capacity:
                    with self.assertRaisesRegex(RuntimeError, 'public UI group|capacity WKWebView failed'):
                        SMOKE.main(arguments)
                else:
                    SMOKE.main(arguments)
        return calls

    def assert_original_native_suites(self, calls):
        cold = [args for args, _ in calls if '--coc-ios-smoke' in args]
        self.assertEqual(len(cold), 3)
        cases = [part.split('/')[-1] for args, _ in calls for part in args if part.startswith('-only-testing:')]
        declared = re.findall(r'\bfunc (test\w+)\(', (ROOT / 'mobile/scripts/ios-picker-ui-tests.swift').read_text(encoding='utf-8'))
        self.assertEqual(sorted(cases), sorted(declared))
        self.assertEqual(len(cases), 7)
        for args, options in calls:
            if args[0] == 'xcodebuild' and 'test' in args:
                self.assertEqual(options['timeout'], 900)

    def test_default_coordinator_runs_full_io_and_independent_check(self):
        calls = self.execute_schedule()
        self.assert_original_native_suites(calls)
        self.assertEqual(sum(args[:3] == ('xcrun', 'simctl', 'create') for args, _ in calls), 2)
        self.assertEqual(sum('--coc-public-io' in args for args, _ in calls), 1)
        self.assertEqual(sum(args[:2] == ('python3', 'scripts/check-public-io.py') for args, _ in calls), 1)

    def test_delegated_coordinator_preserves_all_native_ui_and_capacity_checks(self):
        calls = self.execute_schedule(delegated=True)
        self.assert_original_native_suites(calls)
        self.assertEqual(sum(args[:3] == ('xcrun', 'simctl', 'create') for args, _ in calls), 1)
        self.assertEqual(sum('--coc-ios-scale' in args for args, _ in calls), 2)
        self.assertFalse(any('--coc-public-io' in args for args, _ in calls))
        self.assertTrue(any(args[:2] == ('python3', 'scripts/ios-scale-fixture.py') for args, _ in calls))
        self.assertTrue(any(args[:2] == ('python3', 'scripts/ios-capacity-fixture.py') for args, _ in calls))

    def test_delegation_never_masks_native_ui_or_capacity_failure(self):
        self.assert_original_native_suites(self.execute_schedule(delegated=True, fail_ui=True))
        self.assert_original_native_suites(self.execute_schedule(delegated=True, fail_capacity=True))


if __name__ == '__main__':
    unittest.main()
