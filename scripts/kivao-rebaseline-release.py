#!/usr/bin/env python3
"""Build evidence and owner authorization; this tool never pushes or deploys.

Owner/SHA/CI/expiry and authenticated manifest checks follow the previously
reviewed scripts/kivao-release.py in dev/kivao-ecommerce-agent. There is no
independent reviewer or Environment approval implied by this mechanism.
"""
import argparse
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
POLICY = json.loads((ROOT / '.github/kivao-rebaseline.json').read_text())
ROLES = {'web': 'CANVAS_WEB_IMAGE', 'backend': 'CANVAS_BACKEND_IMAGE', 'agent': 'CANVAS_YINGCE_AGENT_IMAGE'}
DOCKERFILES = {'web': 'Dockerfile', 'backend': 'backend/Dockerfile', 'agent': 'yingce-agent/Dockerfile'}
PREPARATION = {
    '.github/kivao-rebaseline.json', '.github/workflows/kivao-rebaseline-ci.yml',
    '.github/workflows/kivao-rebaseline-publish.yml', 'scripts/kivao-rebaseline-release.py',
    'scripts/test_kivao_rebaseline_release.py',
    'backend/cmd/kivao-import/main.go', 'backend/cmd/kivao-import/main_test.go',
    'backend/internal/database/kivao_import.go', 'backend/internal/database/kivao_import_files.go',
    'backend/internal/database/kivao_import_test.go', 'backend/internal/app/kivao_import_plugins_test.go',
    'docs/plans/kivao-production-upgrade.md', 'docs/content/docs/backend/backend-database.mdx',
    'docs/content/docs/progress/pending-test.mdx',
}
INPUTS = [*DOCKERFILES.values(), 'web/bun.lock', 'web/package.json', 'backend/go.mod', 'backend/go.sum',
          'backend/agent-runtime/pi/package-lock.json', 'nginx.conf', 'docker/canvas-web-entrypoint.sh']


def capture(args):
    return subprocess.check_output(args, cwd=ROOT, text=True).strip()


def git(*args):
    return capture(['git', *args])


def digest(value):
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', value or ''):
        raise ValueError('invalid_full_digest')
    return value


def release_name(sha, release=None):
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('full_sha_required')
    prefix = 'kivao-rebaseline-' + sha[:12]
    release = release or prefix + '-r1'
    if not re.fullmatch(re.escape(prefix) + r'-r[1-9][0-9]*', release):
        raise ValueError('wrong_release_or_sha')
    return release


def authorize(sha, release, approval, context, now=None):
    release_name(sha, release)
    owner = POLICY['repository'].split('/')[0]
    expected = {'GITHUB_REPOSITORY': POLICY['repository'], 'GITHUB_EVENT_NAME': 'push',
                'GITHUB_ACTOR': owner, 'GITHUB_TRIGGERING_ACTOR': owner, 'GITHUB_SHA': sha,
                'GITHUB_REF': 'refs/tags/' + release, 'GITHUB_RUN_ATTEMPT': '1',
                'KIVAO_REBASELINE_PUBLISH_ENABLED': 'true'}
    if any(context.get(k) != v for k, v in expected.items()):
        raise ValueError('owner_tag_first_attempt_and_switch_required')
    if not isinstance(approval, dict) or any(approval.get(k) != v for k, v in {
        'decision': 'IMAGE_PUBLISH_APPROVED', 'approved_by': owner, 'sha': sha, 'release': release,
    }.items()):
        raise ValueError('exact_owner_authorization_required')
    if type(approval.get('ci_run_id')) is not int or approval['ci_run_id'] <= 0:
        raise ValueError('approved_ci_run_required')
    if not re.fullmatch(r'[A-Za-z0-9._/-]{1,120}', approval.get('authorization_ref', '')):
        raise ValueError('decision_reference_required')
    issued = datetime.fromisoformat(approval['approved_at'])
    expires = datetime.fromisoformat(approval['expires_at'])
    now = now or datetime.now(timezone.utc)
    if issued.tzinfo is None or expires.tzinfo is None or not issued <= now < expires or not timedelta(0) < expires-issued <= timedelta(hours=24):
        raise ValueError('authorization_expired_or_invalid')
    return {**approval, 'independent_review': False}


def source(sha, release=None):
    release = release_name(sha, release)
    if git('rev-parse', 'HEAD') != sha or git('status', '--porcelain', '--untracked-files=no'):
        raise ValueError('clean_exact_checkout_required')
    git('merge-base', '--is-ancestor', POLICY['product_commit'], sha)
    git('merge-base', '--is-ancestor', POLICY['upstream_commit'], sha)
    changed = git('diff', '--name-only', POLICY['product_commit'], sha).splitlines()
    if set(changed) - PREPARATION or git('rev-list', '--min-parents=2', POLICY['product_commit']+'..'+sha):
        raise ValueError('changes_outside_frozen_product_and_preparation')
    schema = (ROOT/'backend/internal/database/migrations.go').read_text()
    if not re.search(r'CurrentSchemaVersion\s+int64\s*=\s*104\b', schema):
        raise ValueError('unexpected_schema')
    version = (ROOT/'VERSION').read_text().strip()
    if not re.fullmatch(r'v[0-9.]+', version):
        raise ValueError('invalid_application_version')
    return {'source_commit': sha, 'source_tree': git('rev-parse', sha+'^{tree}'), 'release': release,
            'application_version': version, 'schema': POLICY['schema'], 'platform': POLICY['platform'],
            'source_scope_verified': True, 'registry_publish': False,
            'build_args': {'BUILD_COMMIT': sha, 'BUILD_VERSION': version, 'BUILD_TIME': git('show', '-s', '--format=%cI', sha)},
            'changed_from_product': changed,
            'file_sha256': {p: hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in INPUTS}}


def validate_image(info, plan):
    release_name(plan['source_commit'], plan['release'])
    if plan.get('platform') != POLICY['platform'] or plan.get('schema') != POLICY['schema'] or plan.get('application_version') != (ROOT/'VERSION').read_text().strip():
        raise ValueError('unexpected_image_build_plan')
    labels = info.get('Config', {}).get('Labels') or {}
    expected = {'org.opencontainers.image.source': 'https://github.com/'+POLICY['repository'],
                'org.opencontainers.image.revision': plan['source_commit'],
                'org.opencontainers.image.version': plan['application_version'], 'io.kivao.release': plan['release']}
    if any(labels.get(k) != v for k, v in expected.items()) or f"{info.get('Os')}/{info.get('Architecture')}" != POLICY['platform']:
        raise ValueError('image_identity_mismatch')
    return {'image_id': digest(info.get('Id')), 'labels': expected}


def verify_image(sha, release, role, image, registry_digest=None):
    plan = source(sha, release)
    inspected = json.loads(capture(['docker', 'image', 'inspect', image]))[0]
    identity = validate_image(inspected, plan)
    command = ['docker', 'run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'sh', image, '-ec']
    if role == 'web':
        capture([*command, 'grep -rlF -- "$1" /opt/canvas-release/assets >/dev/null', 'sh', sha])
    elif role == 'backend':
        capture([*command, 'grep -aqF -- "$1" /usr/local/bin/yingce-backend', 'sh', sha])
    else:
        files = {'yingce-agent/server.mjs': '/app/server.mjs', 'yingce-agent/run-directories.mjs': '/app/run-directories.mjs',
                 'yingce-agent/session-admission.mjs': '/app/session-admission.mjs',
                 'backend/agent-runtime/pi/agent-runtime.mjs': '/app/agent-runtime/agent-runtime.mjs',
                 'backend/agent-runtime/pi/package-lock.json': '/app/agent-runtime/package-lock.json'}
        rows = capture([*command, 'sha256sum "$@"', 'sh', *files.values()]).splitlines()
        actual = {row.split()[1]: row.split()[0] for row in rows}
        if any(actual.get(target) != hashlib.sha256((ROOT/path).read_bytes()).hexdigest() for path, target in files.items()):
            raise ValueError('agent_source_or_dependency_mismatch')
    if registry_digest:
        ref = f"ghcr.io/{POLICY['repository']}-{role}@{digest(registry_digest)}"
        if image != ref or ref not in inspected.get('RepoDigests', []):
            raise ValueError('registry_digest_not_pulled')
    return {**plan, **identity, 'role': role, 'image': image, 'embedded_commit_verified': True,
            'identity_method': 'source_files_and_OCI' if role == 'agent' else 'embedded_commit_and_OCI',
            'registry_publish': bool(registry_digest), 'registry_digest': registry_digest}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def registry_json(url, authorization):
    request = urllib.request.Request(url, headers={'Authorization': authorization, 'Accept':
        'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, '
        'application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json'})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
            return response.status, dict(response.headers), json.loads(response.read(1048576))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return 404, {}, json.loads(error.read(16384))
        raise ValueError('registry_access_failed_absence_unproven') from None


def registry_preflight(sha, release, roles):
    release = release_name(sha, release)
    username, token = os.environ.get('GHCR_READ_USER'), os.environ.get('GHCR_READ_TOKEN')
    if not username or not token:
        raise ValueError('registry_read_credentials_required')
    auth = 'Basic '+base64.b64encode(f'{username}:{token}'.encode()).decode()
    result = {}
    for role in roles:
        repository = POLICY['repository']+'-'+role
        query = urllib.parse.urlencode({'service': 'ghcr.io', 'scope': 'repository:'+repository+':pull'})
        status, _, payload = registry_json('https://ghcr.io/token?'+query, auth)
        if status != 200 or not payload.get('token'):
            raise ValueError('registry_authentication_failed')
        bearer = 'Bearer '+payload['token']
        base = 'https://ghcr.io/v2/'+repository+'/manifests/'
        anchor = POLICY['rollback'][ROLES[role]].split('@')[1]
        status, headers, _ = registry_json(base+anchor, bearer)
        if status != 200 or {k.lower(): v for k, v in headers.items()}.get('docker-content-digest') != anchor:
            raise ValueError('known_rollback_not_readable_absence_unproven')
        status, _, body = registry_json(base+release, bearer)
        if status != 404 or [e.get('code') for e in body.get('errors', [])] != ['MANIFEST_UNKNOWN']:
            raise ValueError('revision_exists_or_unknown_registry_state')
        result[role] = {'candidate_absent': True, 'readable_rollback': anchor}
    return {'source_commit': sha, 'release': release, 'registry_write': False, 'roles': result}


def check_ci_run(run, sha, run_id):
    expected = {'id': run_id, 'head_sha': sha, 'head_branch': POLICY['ci_branch'], 'event': 'push',
                'status': 'completed', 'conclusion': 'success', 'path': '.github/workflows/kivao-rebaseline-ci.yml'}
    if any(run.get(k) != v for k, v in expected.items()) or run.get('repository', {}).get('full_name') != POLICY['repository']:
        raise ValueError('exact_successful_ci_run_required')
    return {'verified_ci_run': run_id, 'source_commit': sha}


def check_ci(report, sha):
    if any(report.get(k) != v for k, v in {'source_commit': sha, 'status': 'PASS', 'quality_result': 'success',
                                         'import_result': 'success', 'registry_publish': False}.items()):
        raise ValueError('incomplete_ci')
    if set(report.get('images', {})) != set(ROLES):
        raise ValueError('missing_ci_images')
    for role, r in report['images'].items():
        if r.get('source_commit') != sha or r.get('role') != role or r.get('build_args', {}).get('BUILD_COMMIT') != sha or not r.get('embedded_commit_verified') or not r.get('source_scope_verified') or r.get('registry_publish') is not False:
            raise ValueError('ci_image_evidence_mismatch')
        validate_image({'Id': r['image_id'], 'Os': 'linux', 'Architecture': 'amd64', 'Config': {'Labels': r['labels']}}, r)
    return {'verified_ci': True, 'source_commit': sha}


def paired_locks(reports):
    if len(reports) != 3 or {r['role'] for r in reports} != set(ROLES):
        raise ValueError('three_roles_required')
    sha, release = reports[0]['source_commit'], reports[0]['release']
    release_name(sha, release)
    values = {'CANVAS_IMAGE_TAG': release}
    for r in reports:
        if r['source_commit'] != sha or r['release'] != release or not r.get('registry_publish') or not r.get('embedded_commit_verified') or not r.get('source_scope_verified') or r.get('build_args', {}).get('BUILD_COMMIT') != sha:
            raise ValueError('published_consistent_images_required')
        validate_image({'Id': r['image_id'], 'Os': 'linux', 'Architecture': 'amd64', 'Config': {'Labels': r['labels']}}, r)
        values[ROLES[r['role']]] = f"ghcr.io/{POLICY['repository']}-{r['role']}@{digest(r.get('registry_digest'))}"
        if r['image'] != values[ROLES[r['role']]]:
            raise ValueError('pulled_reference_mismatch')
    return {'source_commit': sha, 'release': values, 'rollback': POLICY['rollback'], 'agent_init_required': True,
            'target_schema': POLICY['schema'], 'rollback_schema': POLICY['rollback_schema'],
            'database_strategy': 'separate_database_data_and_redis', 'image_only_cutover_allowed': False,
            'production_cutover_authorized': False, 'migration_authorized': False}


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2)+'\n')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['source', 'authorize', 'verify-image', 'registry-preflight', 'check-ci-run', 'check-ci', 'summary', 'locks'])
    p.add_argument('--sha', required=True)
    p.add_argument('--release')
    p.add_argument('--role', choices=ROLES)
    p.add_argument('--image')
    p.add_argument('--registry-digest')
    p.add_argument('--report', type=Path)
    p.add_argument('--run-id', type=int)
    p.add_argument('--directory', type=Path)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    if a.command == 'source':
        result = source(a.sha, a.release)
        if output := os.environ.get('GITHUB_OUTPUT'):
            with open(output, 'a') as f:
                for k, v in {'sha': a.sha, 'version': result['application_version'], 'time': result['build_args']['BUILD_TIME'], 'release': result['release']}.items():
                    f.write(f'{k}={v}\n')
    elif a.command == 'authorize':
        result = authorize(a.sha, a.release, json.loads(os.environ.get('KIVAO_REBASELINE_PUBLISH_APPROVAL', 'null')), os.environ)
        if output := os.environ.get('GITHUB_OUTPUT'):
            with open(output, 'a') as f:
                f.write(f"ci_run_id={result['ci_run_id']}\n")
    elif a.command == 'verify-image':
        result = verify_image(a.sha, a.release, a.role, a.image, a.registry_digest)
    elif a.command == 'registry-preflight':
        result = registry_preflight(a.sha, a.release, [a.role] if a.role else ROLES)
    elif a.command == 'check-ci-run':
        result = check_ci_run(json.loads(a.report.read_text()), a.sha, a.run_id)
    elif a.command == 'check-ci':
        result = check_ci(json.loads(a.report.read_text()), a.sha)
    else:
        reports = [json.loads((a.directory/f'image-{role}.json').read_text()) for role in ROLES]
        if any(r['source_commit'] != a.sha for r in reports):
            raise ValueError('mixed_source_reports')
        if a.command == 'summary':
            if os.environ.get('QUALITY_RESULT') != 'success' or os.environ.get('IMPORT_RESULT') != 'success':
                raise ValueError('required_jobs_failed')
            result = {'source_commit': a.sha, 'status': 'PASS', 'quality_result': 'success', 'import_result': 'success',
                      'import_scope': 'synthetic_PG17', 'private_plugin_fixture': 'local_evidence_only',
                      'registry_publish': False, 'images': {r['role']: r for r in reports}}
            check_ci(result, a.sha)
        else:
            result = paired_locks(reports)
            a.output.mkdir(parents=True, exist_ok=False)
            for mode in ['release', 'rollback']:
                (a.output/f'{mode}-images.env').write_text(''.join(f'{k}={v}\n' for k, v in result[mode].items()))
            a.output /= 'image-locks.json'
    write_json(a.output, result)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Credential-bearing requests and subprocess details must not reach CI logs.
        reason = str(error) if isinstance(error, ValueError) and re.fullmatch(r'[a-z_]{1,100}', str(error)) else 'internal_check_failed'
        print('KIVAO release check failed: '+reason+'; no deployment was performed.', file=sys.stderr)
        sys.exit(1)
