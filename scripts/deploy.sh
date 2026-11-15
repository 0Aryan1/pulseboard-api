#!/usr/bin/env bash
# Deploys one commit on the EC2 server. Run as the ubuntu user (the PM2 owner):
#
#   bash scripts/deploy.sh <commit-sha> [allow-migrations]
#
# GitHub Actions runs this through AWS SSM after the tests pass. It can also be
# run by hand over SSH. Same steps as "Updating the app" in DEPLOYMENT.md, plus:
#   - stops if the new commit adds a migration (unless allow-migrations is "true")
#   - checks /health after the restart and rolls back to the old commit if it fails
set -euo pipefail

APP_DIR="$HOME/pulseboard-api"
TARGET="${1:?usage: deploy.sh <commit-sha> [allow-migrations]}"
ALLOW_MIGRATIONS="${2:-false}"

# Node and PM2 may come from nvm, which a non-interactive shell doesn't load.
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

log() { echo "[deploy] $*"; }

# Puts the working tree on a commit and gets it ready to run.
checkout() {
    local from="$1" to="$2"
    git reset --hard --quiet "$to"
    # npm ci deletes node_modules first, so only run it when the lockfile changed.
    if ! git diff --quiet "$from" "$to" -- package-lock.json; then
        log "package-lock.json changed, running npm ci"
        npm ci --no-audit --no-fund
    fi
    npx prisma generate
}

healthy() {
    # Neon can take a few seconds to wake up, so retry for about 30 seconds.
    for _ in $(seq 1 15); do
        if curl -fsS http://localhost:3000/health >/dev/null 2>&1; then
            return 0
        fi
        sleep 2
    done
    return 1
}

restart() {
    pm2 restart api worker --update-env >/dev/null
}

main() {
    cd "$APP_DIR"
    git fetch --quiet origin

    local current
    current="$(git rev-parse HEAD)"
    TARGET="$(git rev-parse "$TARGET^{commit}")"

    if [ "$current" = "$TARGET" ]; then
        log "already on $TARGET, nothing to do"
        exit 0
    fi

    # Migrations are raw SQL applied by hand. Deploying code before its
    # migration would break the app, so stop here and leave everything as is.
    local new_migrations
    new_migrations="$(git diff --name-only --diff-filter=A "$current" "$TARGET" -- migrations/)"
    if [ -n "$new_migrations" ] && [ "$ALLOW_MIGRATIONS" != "true" ]; then
        log "this deploy adds migrations:"
        echo "$new_migrations"
        log "apply them to Neon first, then re-run the workflow with 'migrations applied' ticked"
        exit 1
    fi

    log "deploying ${current:0:7} -> ${TARGET:0:7}"
    checkout "$current" "$TARGET"
    restart

    if healthy; then
        pm2 save >/dev/null
        log "done, /health is ok"
        exit 0
    fi

    log "/health failed after the restart, rolling back to ${current:0:7}"
    pm2 logs api --lines 30 --nostream || true
    checkout "$TARGET" "$current"
    restart
    if healthy; then
        log "rollback ok, the old version is running"
    else
        log "rollback also failed /health, check the server by hand"
    fi
    exit 1
}

# Everything runs from main, so bash has read the whole file before git changes it.
main
