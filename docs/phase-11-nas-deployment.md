# Phase 11: UGREEN NAS Docker deployment

This setup is for trusted LAN testing only. No tunnel, DNS, reverse proxy, TLS, router forwarding or public exposure is configured.

## Files to upload

Create a persistent NAS shared-folder directory, for example `/volume1/docker/private-manager` (replace this example with the actual path shown by your UGREEN NAS). Upload:

- `Dockerfile`, `.dockerignore`, `docker-compose.yml`
- `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, `next-env.d.ts` if present
- `postcss.config.mjs`, `eslint.config.mjs`, `vitest.config.mts`
- `app/`, `components/`, `lib/`, `public/`, `scripts/`, `drizzle/`, `tests/`
- `.env.production.example` and this deployment guide

Uploading the whole project is also fine after excluding `.env`, `.env.*` except the production example, `node_modules/`, `.next/`, `data/`, `backups/`, and `.git/`. Do not upload the development `.env`. The Docker build context independently excludes secrets, historical CSVs and backups.

Use the NAS Docker/Container application with Docker Compose v2 or newer. These images support native amd64 and arm64 builds; the local verification uses the host's architecture. Build on the NAS architecture, or explicitly cross-build an image before transferring it. Do not move a Windows `node_modules` directory onto the NAS.

## Environment configuration

SSH into the NAS and open the deployment directory:

```sh
cd /volume1/docker/private-manager
cp .env.production.example .env
chmod 600 .env
```

Edit `.env` in this same directory, alongside `docker-compose.yml`:

- Set a strong random `POSTGRES_PASSWORD`.
- Set `AUTH_USERNAME`, a cost-12 bcrypt `AUTH_PASSWORD_HASH`, and a random `AUTH_SECRET` of at least 32 bytes.
- Set `APP_BIND_IP` to the NAS's LAN IPv4 address, for example `192.168.1.50`, and leave `APP_PORT=3000`.
- Keep `AUTH_COOKIE_SECURE=false` only for initial trusted-LAN HTTP testing. Production defaults secure if the variable is absent. Set it to `true` when HTTPS is added in Phase 12. HTTP does not encrypt login traffic, so use this only on your trusted LAN.
- Copy your existing OpenAI provider settings only if AI should be enabled. These are runtime server environment values and are never image build arguments. Leaving the key empty preserves manual functionality.
- Keep the `COMPOSE_PROJECT_NAME=private-manager` value stable. A different project name selects a different Docker volume and can make an existing database appear empty.

IMPORTANT: Compose `.env` uses SINGLE quotes to preserve literal bcrypt dollar signs. Paste the raw hash, for example `AUTH_PASSWORD_HASH='$2b$12$...'`, without `\$` escaping. The development Next.js `.env` escaping instructions do not apply here. Do not mount `.env` into the app container. Compose passes explicit variables into the containers.

If a hash is needed, use the existing `npm run auth:hash-password` on your development computer, then paste the generated hash into the NAS `.env`. To generate a new secret locally:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The app and migration entrypoints construct `DATABASE_URL` internally using the Compose DB credentials and hostname `db`. Password characters are URL-encoded, so no manually encoded connection URL is needed. Never use `localhost` as the app's database host inside a container.

## Build and start the database

```sh
docker compose config --quiet
docker compose --profile tools build app migrate
docker compose up -d --wait db
```

`config --quiet` validates without printing resolved secrets. Avoid sharing the output of plain `docker compose config` or `docker inspect`, which can include environment values.

PostgreSQL has no host port mapping. Its named volume is normally `private-manager_postgres_data`. The `database` network is internal; app also has an outbound network so explicitly requested AI operations can reach their provider. Secrets are not stored in the image.

## Transfer the existing migrated data before starting the app

The new NAS volume starts empty. Deploying source code does NOT transfer the current database. To preserve all current live/archived/cancelled Objects, checklist IDs, positions, categories, timestamps, Activity and Drizzle migration history, move a complete PostgreSQL backup.

On your CURRENT computer, export the existing database. These commands avoid binary shell redirection problems in Windows PowerShell:

```powershell
docker exec private-manager-db pg_dump -U postgres -d private_manager -Fc --no-owner --no-acl -f /tmp/private-manager-transfer.dump
docker cp private-manager-db:/tmp/private-manager-transfer.dump ./private-manager-transfer.dump
```

Stop editing Objects after the final export until you have verified the NAS copy. Keep the original database/container and backup intact as your rollback copy. Copy `private-manager-transfer.dump` securely to a `backups/` directory alongside the NAS deployment files. Backups are excluded from images.

For the FIRST restore into the NEW EMPTY NAS database only:

```sh
docker compose stop app
docker compose cp backups/private-manager-transfer.dump db:/tmp/private-manager-transfer.dump
docker compose exec -T db sh -c 'pg_restore --exit-on-error --single-transaction --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/private-manager-transfer.dump'
```

Do not run that restore onto a populated NAS database. Do not use `--clean` as a routine command. If the destination is already populated, first back it up and plan the restore explicitly. The backup includes the `drizzle` schema so already-applied migrations are recognized. The fixed default category IDs are preserved. Pending category backfills remain pending; this deployment never runs them.

If this is genuinely a new installation with no existing data to preserve, skip the restore step.

## Explicit migrations, then production app

```sh
docker compose --profile tools run --rm migrate
docker compose up -d --wait app
```

Run migrations AFTER restoring the existing backup, BEFORE starting/updating the app. The migration job uses committed SQL files and Drizzle's migration ledger, so rerunning it applies only pending migrations. It takes an advisory lock to reject overlapping migration operators. PostgreSQL migrations execute transactionally. A failure exits nonzero; investigate it before starting the new application version.

There is no automatic seed, Kanban Tool import, category backfill or database migration on app startup/restart. Never run the development seed against real data. Future SQL migrations still need review and a backup before deployment; repeatability does not make every future schema change reversible.

The app runs `next build` output via standalone `server.js`, never `next dev`. Node runs as a non-root user. Neither image requires build-time database/auth/API credentials.

Open `http://NAS-LAN-IP:3000`, log in, and verify the Board. Check the Done archive and the Ready archive's Cancelled filter. Compare several known Objects and checklist/history entries with the original installation before switching your daily use to the NAS.

## Health and reboot behavior

```sh
docker compose ps
docker compose logs --tail=100 app db
curl --fail http://NAS-LAN-IP:3000/api/health
docker compose exec -T db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

`/api/health` returns only `status: ok` or `status: unavailable`; it checks auth configuration and the required Object schema/database connection without exposing data or errors. An unhealthy app after deployment usually means migrations/configuration need attention. Docker healthchecks report readiness; they do not automatically restart a process solely because it becomes unhealthy.

Both services use `restart: unless-stopped`. Enable automatic startup of the NAS Docker/Container service in UGREEN settings. A NAS reboot should restart previously running containers. Intentionally stopped containers remain stopped; run `docker compose up -d` to resume them. A physical NAS reboot is not simulated by the local tests.

```sh
docker compose restart db app
docker compose ps
```

The named database volume survives container restarts, image rebuilds, and `docker compose down` followed by `up`. Do not use `docker compose down -v`, `docker volume rm` or volume-pruning tools on the production project. Never change the PostgreSQL major version by editing the tag without a separate upgrade plan.

## Backups

Logical PostgreSQL backups are preferred over copying files from a running database volume. The following NAS shell command creates an online consistent full-database backup:

```sh
cd /volume1/docker/private-manager
umask 077
mkdir -p backups
backup="backups/private-manager-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' > "$backup"
test -s "$backup"
```

Check the dump command exit status before treating a file as successful. Store a second copy outside this NAS, with restricted access/encryption. Keep `.env` separately in a secure backup; database dumps do not include the app's login configuration or provider settings. Periodically restore a backup into a separate test database to prove it is usable. The first-install restore procedure above demonstrates the restore tool and flags.

If using NAS volume snapshots instead, stop app and db, take a consistent snapshot of the Docker volume storage, then start services. Do not copy a live PostgreSQL data directory as an ordinary file backup. Logical dumps are more portable across hosts and storage layouts.

## Updating later

1. Back up the database and preserve the previous app image/source revision.
2. Upload updated source and committed migrations; keep the NAS `.env` and volume unchanged.
3. Run `docker compose --profile tools build app migrate`.
4. Stop app, run `docker compose --profile tools run --rm migrate`, then `docker compose up -d --wait app`.
5. Verify health, login, Board and historical data.

Rolling back application files alone may be insufficient after a schema change. Use your retained database backup and previous application revision as a matched recovery set.

## Local verification

Verified on September 14, 2026: Compose configuration passed; both Linux production images built successfully with npm ci and next build; app/database started healthy; database host port bindings were empty; real Edge HTTP login, Board, archived Done and cancelled Ready passed. Database snapshots matched after migration rerun, restart and container removal/recreation using the same volume. Only the isolated test project/volume was removed. Existing user database was untouched. TypeScript and ESLint passed; 98 tests passed and one optional live test was skipped. Physical UGREEN hardware/reboot has not been tested.

The existing package lock required repair using the same Linux Node 22/npm environment for reproducible clean installs. LAN HTTP opt-out applies consistently to both Secure cookies and the same-origin protocol check; host matching and cross-site rejection remain enforced. Without the explicit opt-out, production still requires HTTPS origins and Secure cookies.

`tests/docker-deployment.mjs` generates random temporary credentials and a random Compose project name. It validates config, builds both images, migrates twice, checks unchanged migration/data state, tests a real browser login and archived/cancelled history, then checks persistence after restart and container recreation. It only deletes its own isolated test volume. It never imports or mutates the user's database and makes zero AI calls.

Windows test invocation (uses the existing installed Edge/Playwright runtime):

```powershell
$env:PLAYWRIGHT_MODULE='C:\Users\Mario\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
node tests/docker-deployment.mjs
```
