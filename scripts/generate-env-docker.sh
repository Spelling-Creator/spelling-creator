#!/bin/sh
#
# The app image's `generate-env` command: scripts/generate-env.sh, writing .env
# into the directory it is run in.
#
#   docker run --rm -v "$PWD:/w" -w /w -u "$(id -u):$(id -g)" \
#     ghcr.io/spelling-creator/spelling-creator generate-env
#
# The mount is where the file lands, and -u makes it yours rather than the
# image's `node` user's. Everything else (refusing to overwrite, the temp file,
# owner-only permissions) is generate-env.sh's. `--print` prints instead, with
# nothing mounted.

set -eu

SCRIPT=/app/scripts/generate-env.sh

for arg in "$@"; do
	if [ "$arg" = --print ] || [ "$arg" = --help ] || [ "$arg" = -h ]; then
		exec sh "$SCRIPT" "$@"
	fi
done

# Still in the image's own working directory means nothing was mounted, and a
# .env written here would vanish with the container.
if [ "$PWD" = /app ]; then
	cat >&2 <<-'USAGE'
		Mount the directory to write .env into, and run as yourself:

		  docker run --rm -v "$PWD:/w" -w /w -u "$(id -u):$(id -g)" \
		    ghcr.io/spelling-creator/spelling-creator generate-env

		Or add --print to print a fresh .env instead of writing one.
	USAGE
	exit 2
fi

exec sh "$SCRIPT" --target .env "$@"
