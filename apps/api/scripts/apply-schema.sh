#!/bin/sh
#
# Apply apps/api/schema.sql to a self-hosted database, once GoTrue is ready.
#
#   sh apps/api/scripts/apply-schema.sh
#
# The compose stack's `schema` service runs this from the app image on every
# `docker compose up`, which is how the schema reaches the database without a
# clone of the repository. Every statement in schema.sql is safe to re-run, so
# running it on each start is also how an upgrade picks up new tables and
# columns.
#
# Connection details come from the standard libpq variables. The defaults are
# the compose stack's; PGPASSWORD has no default and must be set.
#
#   PGHOST      postgres
#   PGUSER      postgres
#   PGDATABASE  spelling
#   PGPASSWORD  (required)
#
# Why it waits, and why it stops on the first error: every table in the schema
# references auth.users, which GoTrue creates on its first migration, so the
# schema cannot be applied until auth has started, and applying it early fails
# *every* statement. `psql` walks straight past errors and exits 0, so that
# failure would be silent: an empty database, PostgREST reporting "0
# Relations", and the app answering 502 with no clue why.

set -eu

export PGHOST="${PGHOST:-postgres}"
export PGUSER="${PGUSER:-postgres}"
export PGDATABASE="${PGDATABASE:-spelling}"

if [ -z "${PGPASSWORD:-}" ]; then
	echo 'PGPASSWORD is not set.' >&2
	exit 1
fi

SCHEMA=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)/schema.sql

# Two seconds apart, so this is five minutes. GoTrue's first migration usually
# takes seconds, but has been seen to take nearly two minutes on a small home
# server, which is too close to give up at.
ATTEMPTS=150

echo 'waiting for auth.users (GoTrue creates it on its first migration)...'
attempt=0
# Bounded, and loud about why it gave up. An unbounded wait cannot tell "not
# migrated yet" from "cannot reach the database at all", and both look
# identical from outside: a container that never finishes and an app that
# never starts. psql's own errors are left on stderr so they land in
# `docker compose logs schema`.
until [ "$(psql -tAc "select to_regclass('auth.users')" | tr -d '[:space:]')" = "auth.users" ]; do
	attempt=$((attempt + 1))
	if [ "$attempt" -ge "$ATTEMPTS" ]; then
		echo "GAVE UP: auth.users did not appear within $((ATTEMPTS * 2 / 60)) minutes."
		echo ''
		echo 'What this container can see:'
		# Narrows it without a round trip. No auth schema at all means GoTrue
		# never connected (check its logs for a connection refusal; the usual
		# one is sslmode). An auth schema with no tables means it connected and
		# its migration failed part way. Errors here instead mean this container
		# cannot reach postgres either.
		psql -tAc "select 'auth schema exists: ' || count(*) from pg_namespace where nspname = 'auth'" || true
		psql -tAc "select 'tables in auth: ' || count(*) from pg_tables where schemaname = 'auth'" || true
		echo ''
		echo 'Then: docker compose logs auth'
		exit 1
	fi
	if [ $((attempt % 5)) -eq 0 ]; then
		echo "  still waiting ($((attempt * 2))s)"
	fi
	sleep 2
done

echo 'applying schema.sql'
psql -v ON_ERROR_STOP=1 -f "$SCHEMA"

echo 'granting the new tables to service_role'
# Belt and braces over the ALTER DEFAULT PRIVILEGES in the compose file's roles
# script. Default privileges only reach objects created afterwards by the role
# that set them, which makes them quietly conditional on how and by whom the
# schema was applied. The failure is a table that exists, that PostgREST can
# see, and that the API is refused with 42501. That reads as an authentication
# problem and is not one. Granting explicitly here does not depend on any of it.
psql -v ON_ERROR_STOP=1 -c "grant all on all tables in schema public to service_role;
  grant all on all sequences in schema public to service_role;"
