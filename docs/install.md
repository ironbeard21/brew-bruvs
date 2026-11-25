# Install and operate Brew-Bruvs

## Install

Install Docker Engine or Docker Desktop with Docker Compose v2. Use the Compose file and
`.env.example` from the [release you plan to install](https://github.com/ironbeard21/brew-bruvs/releases).
Run the commands below from that checkout's root.

1. Copy `.env.example` to `.env`.
2. Set `POSTGRES_PASSWORD` to a random URL-safe password, for example the output of
   `openssl rand -hex 24`. Keep a protected copy of this file.
3. Set `BASE_URL` to the address users will open. Use `http://localhost:8080` for a local evaluation.
4. Set `BREW_BRUVS_IMAGE` to the full version tag published for your release. For example, Git tag
   `v1.0.0` publishes `ghcr.io/ironbeard21/brew-bruvs:1.0.0`. The Phase 1 prerelease uses
   `ghcr.io/ironbeard21/brew-bruvs:0.1.0-rc.1`.
5. For a modified server, set `SOURCE_URL` to the corresponding source for the deployed build.
   The server advertises it on the About page. The default points to the upstream repository.

```sh
docker compose -f docker/compose.yml pull
docker compose -f docker/compose.yml up -d --no-build --wait
```

The app applies database migrations and loads the catalog before it accepts requests. Open
`BASE_URL` and complete first-run setup. The PostgreSQL service is reachable only on the Compose
network. For remote access, put the app behind an HTTPS reverse proxy and restrict direct access to
the published Compose port. Enable `TRUST_PROXY` only when that proxy controls the final
`X-Forwarded-For` value and users cannot bypass it.

## Back up

Save the database archive and a separate protected copy of `.env`. The archive contains account
and brewing data. Restrict file permissions and keep a copy off the Docker host. PostgreSQL can
take a consistent logical backup while the app is running.

```sh
umask 077
backup="brew-bruvs-$(date +%F-%H%M%S).dump"
docker compose -f docker/compose.yml exec -T postgres \
  pg_dump -U brew -d brew --format=custom > "$backup" &&
docker compose -f docker/compose.yml exec -T postgres pg_restore --list < "$backup"
```

Keep the archive only after both commands succeed. Record the app and PostgreSQL versions with the
backup. Rehearse a restore before relying on a backup for an upgrade.

## Restore to a fresh database

Use the original database password, public URL, and app version from the backup. Run the commands
below with the original stack's app stopped so the restored app can bind the same port. Keep the
original volume for recovery.

```sh
docker compose -f docker/compose.yml stop app
docker compose -p brew-bruvs-restored -f docker/compose.yml up -d --wait postgres
docker compose -p brew-bruvs-restored -f docker/compose.yml exec -T postgres \
  pg_restore -U brew -d brew --exit-on-error --single-transaction --no-owner --no-privileges \
  < "$backup"
docker compose -p brew-bruvs-restored -f docker/compose.yml up -d --no-build --wait
```

The project name `brew-bruvs-restored` must be unused so Compose creates a fresh volume. After
restoring, sign in and check recipes, batches and readings. Use `-p brew-bruvs-restored` in
subsequent commands if you keep this instance. Do not use `down --volumes` on any project whose data
you intend to keep.

## Upgrade

1. Read the target release notes and record the current image and Compose configuration.
2. Stop app writes and take a database backup using the commands above.
3. Use the target release's Compose file, keep the existing project name and PostgreSQL volume,
   and set `BREW_BRUVS_IMAGE` to the target full version.
4. Pull and replace the app.

```sh
docker compose -f docker/compose.yml pull app
docker compose -f docker/compose.yml up -d --no-build --wait app
```

Check that sign-in, recipes and batches work. If a schema migration has run, recover by restoring
the pre-upgrade backup into a fresh volume with the previous app image. The image change described
here leaves the PostgreSQL major version unchanged.

## Release tags and browser headers

Pushing a release tag such as `v1.0.0` builds amd64 and arm64 images and publishes `1.0.0`, `1.0`,
and `latest` after smoke, upgrade and restore checks succeed. Prerelease tags publish the full
prerelease version and leave the moving stable tags in place. GitHub release notes group
Conventional Commits since the preceding version tag.

The app denies framing, blocks embedded objects, restricts the document base URL to the same
origin, disables MIME sniffing, and suppresses the referrer. CI checks these headers against the
production web image. Configure HTTPS redirection and HSTS at the public proxy. The shipped CSP
sets no script or style source restrictions, so it supports Expo's generated web assets and
runtime styles.
