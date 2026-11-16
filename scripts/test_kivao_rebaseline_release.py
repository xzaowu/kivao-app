"""Offline release boundary tests; all credentials, digests and reports are synthetic."""
import copy
from datetime import datetime, timedelta, timezone
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('kivao-rebaseline-release.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
SHA = 'a' * 40
RELEASE = 'kivao-rebaseline-' + SHA[:12] + '-r1'
NOW = datetime(2026, 11, 15, tzinfo=timezone.utc)


def image(role, published=False):
    registry_digest = 'sha256:' + {'web': '1', 'backend': '2', 'agent': '3'}[role] * 64
    return {
        'source_commit': SHA, 'role': role, 'release': RELEASE, 'application_version': 'v1.8.5',
        'platform': 'linux/amd64', 'schema': 104, 'source_scope_verified': True,
        'build_args': {'BUILD_COMMIT': SHA}, 'embedded_commit_verified': True,
        'registry_publish': published, 'registry_digest': registry_digest if published else None,
        'image': f"ghcr.io/{r.POLICY['repository']}-{role}@{registry_digest}" if published else 'local-candidate',
        'image_id': 'sha256:' + '4' * 64,
        'labels': {'org.opencontainers.image.source': 'https://github.com/' + r.POLICY['repository'],
                   'org.opencontainers.image.revision': SHA, 'org.opencontainers.image.version': 'v1.8.5',
                   'io.kivao.release': RELEASE},
    }


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.context = {
            'GITHUB_REPOSITORY': r.POLICY['repository'], 'GITHUB_ACTOR': 'xzaowu',
            'GITHUB_TRIGGERING_ACTOR': 'xzaowu', 'GITHUB_EVENT_NAME': 'push',
            'GITHUB_SHA': SHA, 'GITHUB_REF': 'refs/tags/' + RELEASE, 'GITHUB_RUN_ATTEMPT': '1',
            'KIVAO_REBASELINE_PUBLISH_ENABLED': 'true',
        }
        self.approval = {'decision': 'IMAGE_PUBLISH_APPROVED', 'approved_by': 'xzaowu',
                         'sha': SHA, 'release': RELEASE, 'ci_run_id': 123, 'authorization_ref': 'human-123',
                         'approved_at': NOW.isoformat(), 'expires_at': (NOW + timedelta(hours=1)).isoformat()}

    def test_authorization_is_owner_exact_sha_ci_version_and_time_bound(self):
        self.assertFalse(r.authorize(SHA, RELEASE, self.approval, self.context, NOW)['independent_review'])
        for key, value in [('GITHUB_ACTOR', 'other'), ('GITHUB_TRIGGERING_ACTOR', 'other'),
                           ('GITHUB_SHA', 'b' * 40), ('GITHUB_RUN_ATTEMPT', '2'),
                           ('GITHUB_EVENT_NAME', 'workflow_dispatch'), ('GITHUB_REF', 'refs/heads/main'),
                           ('KIVAO_REBASELINE_PUBLISH_ENABLED', ''), ('KIVAO_REBASELINE_PUBLISH_ENABLED', 'false')]:
            with self.subTest(context=key), self.assertRaises(ValueError):
                r.authorize(SHA, RELEASE, self.approval, {**self.context, key: value}, NOW)
        for key, value in [('sha', 'b' * 40), ('release', 'latest'), ('approved_by', 'other'),
                           ('decision', 'VISUAL_PASS'), ('ci_run_id', True), ('ci_run_id', 0),
                           ('authorization_ref', ''), ('expires_at', NOW.isoformat()),
                           ('expires_at', (NOW + timedelta(hours=25)).isoformat()),
                           ('approved_at', NOW.replace(tzinfo=None).isoformat())]:
            with self.subTest(approval=key), self.assertRaises(ValueError):
                r.authorize(SHA, RELEASE, {**self.approval, key: value}, self.context, NOW)

    def test_tag_cannot_be_latest_or_another_sha(self):
        for tag in ['latest', 'v1.8.5', 'kivao-rebaseline-bbbbbbbbbbbb-r1', RELEASE + '-extra']:
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                r.release_name(SHA, tag)

    def test_remote_tag_requires_annotation_name_object_and_exact_commit(self):
        ref = {'ref': 'refs/tags/'+RELEASE, 'object': {'type': 'tag', 'sha': 'b'*40}}
        tag = {'sha': 'b'*40, 'tag': RELEASE, 'object': {'type': 'commit', 'sha': SHA}}
        for field, value in [('ref', 'refs/tags/other'), ('object', None),
                             ('object', {'type': 'commit', 'sha': SHA}),
                             ('object', {'type': 'tag', 'sha': '../../other'})]:
            with self.subTest(ref=field, value=value), patch.object(r, 'capture', return_value=json.dumps({**ref, field: value})) as fetch:
                with self.assertRaisesRegex(ValueError, 'remote_annotated_tag_required'):
                    r.check_tag(SHA, RELEASE)
                self.assertEqual(fetch.call_count, 1)
        for field, value in [('sha', 'c'*40), ('tag', 'another-release'), ('object', None),
                             ('object', {'type': 'commit', 'sha': 'c'*40}),
                             ('object', {'type': 'tag', 'sha': SHA})]:
            with self.subTest(tag=field, value=value), patch.object(r, 'capture', side_effect=[json.dumps(ref), json.dumps({**tag, field: value})]):
                with self.assertRaisesRegex(ValueError, 'remote_tag_target_mismatch'):
                    r.check_tag(SHA, RELEASE)
        with patch.object(r, 'capture', side_effect=subprocess.CalledProcessError(1, ['gh', 'api'])):
            with self.assertRaises(subprocess.CalledProcessError):
                r.check_tag(SHA, RELEASE)

    def test_remote_annotation_survives_checkout_rewriting_local_tag(self):
        with tempfile.TemporaryDirectory() as directory:
            def git(*args):
                return subprocess.check_output(['git', '-C', directory, *args], text=True, stderr=subprocess.DEVNULL).strip()
            git('init', '-q')
            git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'synthetic release')
            sha = git('rev-parse', 'HEAD')
            name = r.release_name(sha)
            git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                '-c', 'tag.gpgsign=false', 'tag', '-a', name, '-m', 'synthetic annotation')
            tag_sha = git('rev-parse', 'refs/tags/'+name)
            ref = {'ref': 'refs/tags/'+name, 'object': {'type': 'tag', 'sha': tag_sha}}
            tag = {'sha': tag_sha, 'tag': name, 'object': {'type': 'commit', 'sha': sha}}
            self.assertEqual(git('cat-file', '-t', 'refs/tags/'+name), 'tag')
            git('update-ref', 'refs/tags/'+name, sha)
            self.assertEqual(git('cat-file', '-t', 'refs/tags/'+name), 'commit')
            with patch.object(r, 'capture', side_effect=[json.dumps(ref), json.dumps(tag)]) as fetch:
                result = r.check_tag(sha, name)
                self.assertEqual(result['source_commit'], sha)
                self.assertEqual(result['tag_object'], tag_sha)
                self.assertTrue(result['remote_annotated_tag_verified'])
                self.assertEqual(fetch.call_args_list[0].args[0], ['gh', 'api', f"repos/{r.POLICY['repository']}/git/ref/tags/{name}"])
                self.assertEqual(fetch.call_args_list[1].args[0], ['gh', 'api', f"repos/{r.POLICY['repository']}/git/tags/{tag_sha}"])

    def test_source_allows_only_preparation_on_frozen_product(self):
        def fake_git(*args):
            if args == ('rev-parse', 'HEAD'):
                return SHA
            if args[0] == 'diff':
                return '.github/workflows/kivao-rebaseline-ci.yml'
            return ''
        with patch.object(r, 'git', side_effect=fake_git):
            self.assertEqual(r.source(SHA)['schema'], 104)
        def changed_product(*args):
            return 'web/src/application.tsx' if args[0] == 'diff' else fake_git(*args)
        with patch.object(r, 'git', side_effect=changed_product), self.assertRaises(ValueError):
            r.source(SHA)
        def merged(*args):
            return 'merge-commit' if args[0] == 'rev-list' else fake_git(*args)
        with patch.object(r, 'git', side_effect=merged), self.assertRaises(ValueError):
            r.source(SHA)

    def test_exact_completed_ci_and_three_local_images_required(self):
        run = {'id': 123, 'head_sha': SHA, 'head_branch': r.POLICY['ci_branch'], 'event': 'push',
               'status': 'completed', 'conclusion': 'success', 'path': '.github/workflows/kivao-rebaseline-ci.yml',
               'repository': {'full_name': r.POLICY['repository']}}
        r.check_ci_run(run, SHA, 123)
        for key, value in [('head_sha', 'b' * 40), ('id', 124), ('conclusion', 'failure'),
                           ('status', 'in_progress'), ('head_branch', 'main'), ('event', 'pull_request')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                r.check_ci_run({**run, key: value}, SHA, 123)
        report = {'source_commit': SHA, 'status': 'PASS', 'quality_result': 'success',
                  'import_result': 'success', 'registry_publish': False,
                  'images': {role: image(role) for role in r.ROLES}}
        r.check_ci(report, SHA)
        for field, value in [('platform', 'linux/arm64'), ('schema', 79), ('embedded_commit_verified', False), ('registry_publish', True),
                             ('source_commit', 'b' * 40), ('source_scope_verified', False)]:
            broken = copy.deepcopy(report)
            broken['images']['agent'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                r.check_ci(broken, SHA)
        del report['images']['backend']
        with self.assertRaises(ValueError):
            r.check_ci(report, SHA)

    def test_registry_absence_requires_readable_known_manifest(self):
        anchor = r.POLICY['rollback'][r.ROLES['web']].split('@')[1]
        valid = [(200, {}, {'token': 'synthetic'}), (200, {'Docker-Content-Digest': anchor}, {}),
                 (404, {}, {'errors': [{'code': 'MANIFEST_UNKNOWN'}]})]
        with patch.dict(os.environ, {'GHCR_READ_USER': 'fixture', 'GHCR_READ_TOKEN': 'synthetic'}):
            with patch.object(r, 'registry_json', side_effect=valid):
                self.assertTrue(r.registry_preflight(SHA, RELEASE, ['web'])['roles']['web']['candidate_absent'])
            for responses in [valid[:1] + [(404, {}, {})], valid[:2] + [(200, {}, {})],
                              valid[:2] + [(404, {}, {'errors': [{'code': 'DENIED'}]})]]:
                with self.subTest(responses=responses), patch.object(r, 'registry_json', side_effect=responses), self.assertRaises(ValueError):
                    r.registry_preflight(SHA, RELEASE, ['web'])

    def test_image_platform_and_labels_are_not_inferred_from_tag(self):
        plan = image('agent')
        info = {'Id': plan['image_id'], 'Os': 'linux', 'Architecture': 'amd64', 'Config': {'Labels': plan['labels']}}
        r.validate_image(info, plan)
        with self.assertRaises(ValueError):
            r.validate_image({**info, 'Architecture': 'arm64'}, plan)
        with self.assertRaises(ValueError):
            r.validate_image({**info, 'Config': {'Labels': {}}}, plan)

    def test_locks_require_pulled_registry_evidence_and_configured_rollback(self):
        reports = [image(role, True) for role in r.ROLES]
        locks = r.paired_locks(reports)
        self.assertEqual(locks['rollback'], r.POLICY['rollback'])
        self.assertTrue(locks['image_only_cutover_allowed'])
        self.assertEqual(locks['database_strategy'], 'reuse_existing_database_data_and_redis')
        self.assertFalse(locks['production_cutover_authorized'])
        self.assertTrue(locks['agent_init_required'])
        self.assertEqual((locks['target_schema'], locks['rollback_schema']), (104, 104))
        with patch.dict(r.POLICY, {'rollback_schema': 79}):
            historical = r.paired_locks(reports)
            self.assertFalse(historical['image_only_cutover_allowed'])
            self.assertEqual(historical['database_strategy'], 'separate_database_data_and_redis')
        for field, value in [('registry_digest', None), ('registry_publish', False), ('source_scope_verified', False),
                             ('source_commit', 'b' * 40), ('image', 'local-image:latest')]:
            bad = copy.deepcopy(reports)
            bad[0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                r.paired_locks(bad)
        with self.assertRaises(ValueError):
            r.paired_locks(reports[:2])


if __name__ == '__main__':
    unittest.main()
