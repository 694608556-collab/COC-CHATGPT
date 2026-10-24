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
IO_SPEC = importlib.util.spec_from_file_location('ios_complete_io_schedule', pathlib.Path(__file__).with_name('ios-public-io-check.py'))
PUBLIC_IO = importlib.util.module_from_spec(IO_SPEC)
IO_SPEC.loader.exec_module(PUBLIC_IO)


class RequiredIOScheduleTests(unittest.TestCase):
    def test_native_and_ui_are_independent_mandatory_jobs(self):
        for name in ['ios-native', 'ios']:
            block = SMOKE._job_block((ROOT / '.github/workflows/ios-check.yml').read_text(encoding='utf-8'), name)
            self.assertEqual(block.splitlines().count('    runs-on: xcode-27'), 1)
            self.assertNotRegex(block, r'^    (?:if|needs|continue-on-error):')

    def test_independent_native_and_ui_cannot_be_optional_or_serialized(self):
        for name in ['ios-native', 'ios']:
            for option in ['if: false', 'needs: complete-public-io', 'continue-on-error: true']:
                changed = self.workflow.replace('  ' + name + ':\n', '  ' + name + ':\n    ' + option + '\n')
                with self.subTest(job=name, option=option), self.assertRaises(RuntimeError):
                    self.delegated(workflow=changed)
        changed = self.workflow.replace('      - name: Check fresh native WKWebView startup', '      - if: false\n        name: Check fresh native WKWebView startup')
        with self.assertRaises(RuntimeError):
            self.delegated(workflow=changed)

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
            ('needs: [ios-native, ios, complete-public-io]', 'needs: [ios]'),
            ('test \"$UI_RESULT\" = success', 'true'),
            ('  ios-native:\n', '  removed-native:\n'),
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

    def test_cold_format_matrix_and_its_proof_tests_are_mandatory(self):
        for command in ('python3 scripts/ios-cold-table-check.py',
                        'python3 scripts/test-ios-cold-tables.py'):
            self.assertIn('        run: ' + command, self.reusable)
            for replacement in ('        run: true',
                                '        if: false\n        run: ' + command,
                                '        continue-on-error: true\n        run: ' + command):
                changed = self.reusable.replace('        run: ' + command, replacement)
                with self.subTest(command=command, replacement=replacement), self.assertRaises(RuntimeError):
                    self.delegated(reusable=changed)

    def test_parallel_cold_formats_and_aggregate_cannot_be_weakened(self):
        for before, after in [
            ('  cold-tables:\n', '  cold-tables:\n    if: false\n'),
            ('      fail-fast: false', '      fail-fast: true'),
            ('        first: [csv, xlsx, xls]', '        first: [csv, xlsx]'),
            ('--table-first ${{ matrix.first }}', '--table-first csv'),
            ('    needs: [public-io-feedback, cold-tables]', '    needs: [public-io-feedback]'),
            ('test "$COLD_RESULT" = success', 'true'),
            ('--aggregate-only', '--removed-aggregate'),
            ('        merge-multiple: true', '        merge-multiple: false'),
        ]:
            changed = self.reusable.replace(before, after)
            self.assertNotEqual(changed, self.reusable)
            with self.subTest(change=before), self.assertRaises(RuntimeError): self.delegated(reusable=changed)

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


class CompleteIOPreparationTests(unittest.TestCase):
    DEVICE = '00000000-0000-0000-0000-000000000001'
    BOOT_OUTPUT = 'Waiting for SpringBoard\n' + ('public boot detail\n' * 5000) + 'Finished\n'

    def execute(self, fail=None, content_passed=True, health_failure=False,
                diagnostic_write_failure=False, device_id=DEVICE, runtime_version='27.0', table_first=None):
        calls = []
        self.failure = None
        self.error = None
        self.diagnostics = {}
        with tempfile.TemporaryDirectory(prefix='coc-public-io-schedule-') as directory:
            base = pathlib.Path(directory)
            container = base / 'public-container'
            (container / 'tmp').mkdir(parents=True)
            for name in ['ios/App/App/Info.plist', 'ios/App/App.xcodeproj/project.pbxproj', 'ios/App/CapApp-SPM/Package.swift', 'native/table-kernel/table-kernel.h', 'pnpm-lock.yaml']:
                source = base / name
                source.parent.mkdir(parents=True, exist_ok=True)
                source.write_text('public build input', encoding='utf-8')

            def fake_command(*args, **kwargs):
                calls.append((args, kwargs))
                if kwargs.get('timeout') == 10:
                    if health_failure:
                        raise subprocess.TimeoutExpired(args, 10)
                    return 'public runner diagnostic\n'
                if args[:3] == ('xcrun', 'simctl', 'bootstatus') and kwargs.get('log'):
                    kwargs['log'].write(self.BOOT_OUTPUT)
                if fail and args[:len(fail)] == fail:
                    if fail[:2] == ('xcrun', 'simctl'):
                        raise subprocess.TimeoutExpired(args, kwargs.get('timeout', 60))
                    raise subprocess.CalledProcessError(1, args)
                if args[:4] == ('xcrun', 'simctl', 'list', 'runtimes'):
                    return json.dumps({'runtimes': [{'isAvailable': True, 'identifier': 'public-iOS-27', 'version': runtime_version}]})
                if args[:4] == ('xcrun', 'simctl', 'list', 'devicetypes'):
                    return json.dumps({'devicetypes': [{'name': 'iPhone 14 Pro', 'identifier': 'public-phone'}]})
                if args[:3] == ('xcrun', 'simctl', 'create'):
                    return device_id
                if args[:3] == ('xcrun', 'simctl', 'get_app_container'):
                    return str(container)
                if args[:2] == ('xcodebuild', '-project'):
                    binary = base / 'ios/build/public-io-simulator/Build/Products/Debug-iphonesimulator/App.app/App'
                    binary.parent.mkdir(parents=True, exist_ok=True)
                    binary.write_bytes(b'public simulator executable')
                if args[:2] == ('node', 'scripts/public-io-fixtures.mjs'):
                    output = base / 'ios/build/public-io/public-io-webview.js'
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_text('public fixture placeholder', encoding='utf-8')
                if args[:3] == ('xcrun', 'simctl', 'launch'):
                    (container / 'tmp/ios-scale-result.json').write_text(json.dumps({'passed': content_passed, 'results': [{'operation': 'module-search-' + str(index), 'totalMs': 500, 'responseMs': 50} for index in range(3)]}), encoding='utf-8')
                return ''

            original_write = pathlib.Path.write_text

            def write_text(path, *args, **kwargs):
                if diagnostic_write_failure and (path.name.startswith('ios-public-io-diagnostic-health-') or path.name == 'ios-public-io-diagnostic-bootstatus.json'):
                    raise OSError('public diagnostic storage unavailable')
                return original_write(path, *args, **kwargs)

            with contextlib.chdir(base), contextlib.redirect_stdout(io.StringIO()), \
                    mock.patch.object(PUBLIC_IO, 'command', fake_command), \
                    mock.patch.object(pathlib.Path, 'write_text', write_text), \
                    mock.patch.dict(os.environ, {'ImageOS': 'public-image', 'ImageVersion': 'public-version', 'PUBLIC_TEST_SECRET': 'never-collect-this'}):
                if fail or not content_passed or device_id != self.DEVICE or runtime_version != '27.0':
                    with self.assertRaises((subprocess.CalledProcessError, subprocess.TimeoutExpired, RuntimeError, ValueError)) as caught:
                        PUBLIC_IO.main(table_first)
                    self.error = caught.exception
                    self.failure = json.loads((base / 'ios/build/ios-public-io-diagnostic-failure.json').read_text(encoding='utf-8'))
                    self.assertIs(self.failure['passed'], False)
                else:
                    PUBLIC_IO.main(table_first)
                script = container / 'tmp/ios-scale-webview.js'
                self.injected_script = script.read_text(encoding='utf-8') if script.exists() else None
                self.diagnostics = {path.name: json.loads(path.read_text(encoding='utf-8')) for path in (base / 'ios/build').glob('ios-public-io-diagnostic-*.json')}
        return calls

    def test_booted_owned_device_is_the_only_build_and_install_target(self):
        # Replace the disproven build-before-boot hypothesis with a behavioral
        # contract that rejects generic, foreign or not-yet-booted targets.
        calls = self.execute()
        commands = [args for args, _ in calls]
        build = next(i for i, args in enumerate(commands) if args[:2] == ('xcodebuild', '-project'))
        fixtures = next(i for i, args in enumerate(commands) if args[:2] == ('node', 'scripts/public-io-fixtures.mjs'))
        create = next(i for i, args in enumerate(commands) if args[:3] == ('xcrun', 'simctl', 'create'))
        boot = next(i for i, args in enumerate(commands) if args[:3] == ('xcrun', 'simctl', 'boot'))
        ready = next(i for i, args in enumerate(commands) if args[:3] == ('xcrun', 'simctl', 'bootstatus'))
        install = next(i for i, args in enumerate(commands) if args[:3] == ('xcrun', 'simctl', 'install'))
        container = next(i for i, args in enumerate(commands) if args[:3] == ('xcrun', 'simctl', 'get_app_container'))
        self.assertLess(create, boot)
        self.assertLess(boot, ready)
        self.assertLess(ready, build)
        self.assertLess(build, install)
        self.assertLess(install, container)
        self.assertLess(container, fixtures)
        self.assertEqual(commands[create][-2:], ('public-phone', 'public-iOS-27'))
        self.assertEqual(commands[build][commands[build].index('-destination') + 1], 'platform=iOS Simulator,id=' + self.DEVICE)
        for args in commands:
            if args[:2] == ('xcrun', 'simctl') and args[2] in ('boot', 'bootstatus', 'install', 'get_app_container', 'launch', 'terminate', 'shutdown'):
                self.assertEqual(args[3], self.DEVICE)

    def test_setup_retains_timeouts_and_runs_full_io_and_independent_gate_once(self):
        calls = self.execute()
        expected = {'boot': 300, 'bootstatus': 300, 'install': 120, 'get_app_container': 60, 'launch': 120, 'terminate': 60, 'shutdown': 45}
        for args, options in calls:
            if args[:2] == ('xcodebuild', '-project'): self.assertEqual(options['timeout'], 900)
            if args[:2] == ('xcrun', 'simctl') and args[2] in expected:
                self.assertEqual(options.get('timeout', 60), expected[args[2]])
        self.assertEqual(sum('--coc-public-io' in args for args, _ in calls), 1)
        self.assertEqual(sum(args[:2] == ('python3', 'scripts/check-public-io.py') for args, _ in calls), 1)
        self.assertEqual(sum(args[:2] == ('node', 'scripts/public-io-fixtures.mjs') for args, _ in calls), 1)
        self.assertEqual(sum(args[:2] == ('python3', 'scripts/ios-public-io-fixture.py') for args, _ in calls), 1)

    def test_cold_entry_injects_only_requested_format_and_uses_independent_table_gate(self):
        for first in ('csv', 'xlsx', 'xls'):
            with self.subTest(first=first):
                calls = self.execute(table_first=first)
                self.assertTrue(self.injected_script.startswith('window.__cocPublicTableFirst=' + json.dumps(first) + ';\n'))
                checks = [args for args, _ in calls if args[:2] == ('python3', 'scripts/check-ios-table-io.py')]
                self.assertEqual(len(checks), 1)
                self.assertEqual(checks[0][-1], first)
                self.assertIn('ios-public-io-diagnostic-table-' + first + '-result.json', checks[0][-2])
                self.assertEqual(sum(args[:3] == ('xcrun', 'simctl', 'create') for args, _ in calls), 1)
                self.assertEqual(sum(args[:2] == ('python3', 'scripts/ios-public-io-fixture.py') for args, _ in calls), 1)

    def test_invalid_cold_entry_cannot_create_or_touch_a_simulator(self):
        with mock.patch.object(PUBLIC_IO, 'command') as command:
            for value in ('CSV', '', 'ods', True):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    PUBLIC_IO.main(value)
            command.assert_not_called()

    def test_build_failure_cleans_up_owned_device_without_install_or_test_execution(self):
        calls = self.execute(fail=('xcodebuild', '-project'))
        self.assertEqual(sum(args[:3] == ('xcrun', 'simctl', 'boot') for args, _ in calls), 1)
        self.assertEqual(sum(args[:3] == ('xcrun', 'simctl', 'shutdown') for args, _ in calls), 1)
        self.assertFalse(any(args[:3] == ('xcrun', 'simctl', 'install') for args, _ in calls))
        self.assertFalse(any('--coc-public-io' in args for args, _ in calls))
        self.assertEqual(self.failure['phase'], 'build')

    def test_container_timeout_is_not_retried_or_counted_as_performance_success(self):
        calls = self.execute(fail=('xcrun', 'simctl', 'get_app_container'))
        self.assertEqual(sum(args[:3] == ('xcrun', 'simctl', 'get_app_container') for args, _ in calls), 1)
        self.assertFalse(any('--coc-public-io' in args for args, _ in calls))

    def test_content_failure_cannot_reach_success_gate(self):
        calls = self.execute(content_passed=False)
        self.assertFalse(any(args[:2] == ('python3', 'scripts/check-public-io.py') for args, _ in calls))

    def test_independent_proof_or_performance_failure_remains_a_failed_run(self):
        calls = self.execute(fail=('python3', 'scripts/check-public-io.py'))
        self.assertEqual(sum(args[:2] == ('python3', 'scripts/check-public-io.py') for args, _ in calls), 1)

    def test_full_bootstatus_output_is_retained_without_truncation(self):
        self.execute()
        self.assertEqual(self.diagnostics['ios-public-io-diagnostic-bootstatus.json'], {'device': self.DEVICE, 'output': self.BOOT_OUTPUT})

    def test_bootstatus_timeout_retains_output_and_prevents_build_or_install(self):
        calls = self.execute(fail=('xcrun', 'simctl', 'bootstatus'))
        self.assertEqual(self.failure['phase'], 'bootstatus')
        self.assertEqual(self.diagnostics['ios-public-io-diagnostic-bootstatus.json']['output'], self.BOOT_OUTPUT)
        self.assertFalse(any(args[:2] == ('xcodebuild', '-project') for args, _ in calls))
        self.assertFalse(any(args[:3] == ('xcrun', 'simctl', 'install') for args, _ in calls))
        self.assertEqual(sum(args[:3] == ('xcrun', 'simctl', 'shutdown') for args, _ in calls), 1)

    def test_public_health_evidence_contains_only_allowlisted_metadata(self):
        calls = self.execute()
        health = self.diagnostics['ios-public-io-diagnostic-health-startup.json']
        self.assertEqual(set(health['image']), {'ImageOS', 'ImageVersion', 'RUNNER_OS', 'RUNNER_ARCH'})
        self.assertEqual(health['image']['ImageVersion'], 'public-version')
        self.assertEqual(health['runtime']['version'], '27.0')
        for name in ('xcode', 'runtimes', 'memory', 'processes', 'disk'):
            self.assertIn('output', health[name])
        self.assertNotIn('never-collect-this', json.dumps(self.diagnostics))
        probes = [args for args, options in calls if options.get('timeout') == 10]
        self.assertEqual(probes, [('xcodebuild', '-version'), ('xcrun', 'simctl', 'runtime', 'list'), ('vm_stat',), ('ps', '-axo', 'pid,ppid,stat,%cpu,%mem,rss,comm'), ('df', '-k', '.')])

    def test_failed_health_commands_do_not_mask_original_install_timeout(self):
        calls = self.execute(fail=('xcrun', 'simctl', 'install'), health_failure=True)
        self.assertIsInstance(self.error, subprocess.TimeoutExpired)
        self.assertEqual(self.error.cmd[:3], ('xcrun', 'simctl', 'install'))
        self.assertEqual(self.error.timeout, 120)
        self.assertEqual(self.failure['phase'], 'install')
        self.assertFalse(any('--coc-public-io' in args for args, _ in calls))
        self.assertEqual(sum(args[:3] == ('xcrun', 'simctl', 'install') for args, _ in calls), 1)
        for phase in ('startup', 'failure'):
            health = self.diagnostics['ios-public-io-diagnostic-health-' + phase + '.json']
            for name in ('xcode', 'runtimes', 'memory', 'processes', 'disk'):
                self.assertIn('error', health[name])

    def test_failed_diagnostic_writes_do_not_mask_original_proof_failure(self):
        calls = self.execute(fail=('python3', 'scripts/check-public-io.py'), diagnostic_write_failure=True)
        self.assertIsInstance(self.error, subprocess.CalledProcessError)
        self.assertEqual(self.error.cmd[:2], ('python3', 'scripts/check-public-io.py'))
        self.assertEqual(sum(args[:2] == ('python3', 'scripts/check-public-io.py') for args, _ in calls), 1)

    def test_unavailable_requested_runtime_never_falls_back_or_builds(self):
        calls = self.execute(runtime_version='27.1')
        self.assertEqual(self.failure['phase'], 'environment')
        self.assertRegex(str(self.error), 'Required iOS 27.0 runtime unavailable')
        self.assertFalse(any(args[:3] == ('xcrun', 'simctl', 'create') for args, _ in calls))
        self.assertFalse(any(args[:2] == ('xcodebuild', '-project') for args, _ in calls))

    def test_invalid_device_identifier_never_reaches_boot_build_or_install(self):
        calls = self.execute(device_id='booted')
        self.assertEqual(self.failure['phase'], 'create')
        self.assertFalse(any(args[:3] == ('xcrun', 'simctl', 'boot') for args, _ in calls))
        self.assertFalse(any(args[:2] == ('xcodebuild', '-project') for args, _ in calls))
        self.assertFalse(any(args[:3] == ('xcrun', 'simctl', 'install') for args, _ in calls))
        self.assertFalse(any(args[:3] == ('xcrun', 'simctl', 'shutdown') for args, _ in calls))

    def test_health_probe_failure_does_not_skip_any_acceptance_gate(self):
        calls = self.execute(health_failure=True)
        self.assertEqual(sum('--coc-public-io' in args for args, _ in calls), 1)
        self.assertEqual(sum(args[:2] == ('python3', 'scripts/check-public-io.py') for args, _ in calls), 1)


if __name__ == '__main__':
    unittest.main()
