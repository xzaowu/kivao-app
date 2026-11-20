#!/usr/bin/env bash
set -euo pipefail

# Run only against the disposable PostgreSQL service started by candidate CI.
pg_container=${1:?disposable PostgreSQL container required}
out=${2:?evidence directory required}
pg_port=${3:?local PostgreSQL port required}
mkdir -p "$out/baseline"
out=$(realpath "$out")
readarray -t policy < <(python3 -c 'import json; p=json.load(open(".github/kivao-rebaseline.json")); print(p["rollback_commit"], p["rollback_schema"], p["schema"], sep="\n")')
git archive "${policy[0]}" backend | tar -x -C "$out/baseline"
(cd "$out/baseline/backend" && go build -o "$out/schema-old" ./cmd/migrate-schema)
(cd backend && go build -o "$out/schema-new" ./cmd/migrate-schema)

pg() {
    docker exec -i "$pg_container" "$@"
}
schema() {
    CANVAS_DATABASE_DRIVER=postgres DATABASE_URL="postgres://postgres:synthetic_ci_only@127.0.0.1:$pg_port/$2?sslmode=disable" "$out/$1" "$3"
}
verify() {
    schema "$1" "$2" verify > "$out/$2-verify.json"
    python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); n=int(sys.argv[2]); assert d["ready"] and d["current"] == d["expected"] == n, d' "$out/$2-verify.json" "$3"
}
snapshot() {
    pg psql -U postgres -d "$1" -Atc "
        SELECT id,username,password_hash FROM users WHERE id='upgrade-fixture';
        SELECT user_id,available_microcredits FROM credit_accounts WHERE user_id='upgrade-fixture';
        SELECT id,model_key,capability FROM channel_models WHERE id='upgrade-fixture';"
}

pg createdb -U postgres kivao_upgrade_fixture
schema schema-old kivao_upgrade_fixture up > "$out/old-up.log"
verify schema-old kivao_upgrade_fixture "${policy[1]}"
pg psql -U postgres -d kivao_upgrade_fixture -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO users(id,username,password_hash,role,status) VALUES ('upgrade-fixture','upgrade-fixture','synthetic-hash','admin','active');
INSERT INTO credit_accounts(user_id,available_microcredits,reserved_microcredits) VALUES ('upgrade-fixture',123456,0);
INSERT INTO channel_models(id,model_key,capability) VALUES ('upgrade-fixture','synthetic','image');
SQL
snapshot kivao_upgrade_fixture > "$out/before.txt"
pg pg_dump -U postgres -Fc --no-owner --no-privileges kivao_upgrade_fixture > "$out/rollback.dump"

schema schema-new kivao_upgrade_fixture up > "$out/new-up.log"
schema schema-new kivao_upgrade_fixture up > "$out/new-repeat.log"
verify schema-new kivao_upgrade_fixture "${policy[2]}"
snapshot kivao_upgrade_fixture > "$out/after.txt"
cmp "$out/before.txt" "$out/after.txt"
if schema schema-old kivao_upgrade_fixture verify > "$out/old-reject.log" 2>&1; then
    echo "Previous binary accepted the upgraded database" >&2
    exit 1
fi
grep -q '高于程序支持' "$out/old-reject.log"

pg createdb -U postgres kivao_rollback_fixture
pg pg_restore -U postgres -d kivao_rollback_fixture --exit-on-error --no-owner --no-privileges < "$out/rollback.dump"
verify schema-old kivao_rollback_fixture "${policy[1]}"
snapshot kivao_rollback_fixture > "$out/rollback.txt"
cmp "$out/before.txt" "$out/rollback.txt"
