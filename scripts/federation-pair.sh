#!/bin/sh
#
# Set up two self-hosted instances on this Docker host that federate with each
# other, for trying federation by hand. It builds the app image from this
# checkout, writes a directory and a .env for each instance, starts both, and
# checks each can reach the other. It does not try federation itself.
#
#   ./scripts/federation-pair.sh                    # build, configure, start
#   ./scripts/federation-pair.sh --address 10.0.0.5 # when the address can't be guessed
#   ./scripts/federation-pair.sh --no-build         # reuse the image built last time
#   ./scripts/federation-pair.sh --no-start         # write the two configs and stop there
#
# Options:
#   --address ADDR  This host's address on its network. Both instances use it
#                   in their origins, because each server has to reach the
#                   other by the very name in its origin, and `localhost`
#                   inside a container is the container. Guessed when left out.
#   --dir DIR       Where the two instances live (default ~/spelling-creator-federation).
#   --ports A,B     The two instances' http ports (default 8080,8081).
#   --tag TAG       The image tag to build and run (default federation).
#   --no-build      Do not build the image; run the one already tagged TAG.
#   --no-start      Write the configs only.
#
# Running it again is safe. An instance's .env is created once and then only
# has the settings below rewritten, because its credentials are baked into its
# database volume the first time it starts, and new ones would lock it out.
#
# See "Trying it with two instances" in apps/docs/docs/developers/federation.md.

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

ADDRESS=''
BASE="${HOME}/spelling-creator-federation"
PORTS='8080,8081'
TAG='federation'
BUILD=1
START=1

while [ $# -gt 0 ]; do
	case "$1" in
		--address | --dir | --ports | --tag)
			if [ $# -lt 2 ]; then
				printf '%s needs a value\n' "$1" >&2
				exit 2
			fi
			case "$1" in
				--address) ADDRESS=$2 ;;
				--dir) BASE=$2 ;;
				--ports) PORTS=$2 ;;
				--tag) TAG=$2 ;;
			esac
			shift
			;;
		--no-build) BUILD=0 ;;
		--no-start) START=0 ;;
		-h | --help)
			sed -n '3,28p' "$0" | sed 's/^# \{0,1\}//'
			exit 0
			;;
		*)
			printf 'unknown option: %s\n' "$1" >&2
			exit 2
			;;
	esac
	shift
done

say() { printf '%s\n' "$*"; }
fail() {
	printf '%s\n' "$*" >&2
	exit 1
}

# ---- Preflight --------------------------------------------------------------

PORT_A=${PORTS%%,*}
PORT_B=${PORTS#*,}
case "$PORT_A$PORT_B" in
	*[!0-9]* | '') fail "--ports takes two port numbers, like 8080,8081." ;;
esac
[ "$PORT_A" != "$PORT_B" ] || fail "The two instances need different ports."
# The https ports are published too, even though nothing here uses https, so
# they have to differ as well. 8080 goes with 8443, as in the compose defaults.
HTTPS_A=$((PORT_A + 363))
HTTPS_B=$((PORT_B + 363))

if [ "$BUILD" -eq 1 ] || [ "$START" -eq 1 ]; then
	command -v docker >/dev/null 2>&1 || fail "docker was not found."
	docker compose version >/dev/null 2>&1 || fail "docker compose (v2) was not found."
fi

# The first address of this host on its network. Not 127.0.0.1, and not a
# Docker bridge address, which the other container could reach but a browser
# on another machine could not.
guess_address() {
	_addr=$(hostname -I 2>/dev/null | awk '{ print $1 }') || true
	if [ -z "$_addr" ] && command -v ip >/dev/null 2>&1; then
		_addr=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }') || true
	fi
	if [ -z "$_addr" ] && command -v ipconfig >/dev/null 2>&1; then
		_addr=$(ipconfig getifaddr en0 2>/dev/null) || true
	fi
	printf '%s' "$_addr"
}

[ -n "$ADDRESS" ] || ADDRESS=$(guess_address)
[ -n "$ADDRESS" ] || fail "Could not work out this host's address. Pass it with --address."
case "$ADDRESS" in
	localhost | 127.*) fail "The address has to be one the other container can reach, not $ADDRESS." ;;
esac

# ---- Configuration ----------------------------------------------------------

# Set KEY=VALUE in a .env, replacing the line that sets it or appending one.
# Line by line, for the reason generate-env.sh gives: `sed -i` is spelled
# differently on BSD and GNU. Written through a temp file, readable by its
# owner only, since the file holds the service-role key.
set_env() {
	_file=$1
	_key=$2
	_value=$3
	_tmp="$_file.tmp.$$"
	# The redirect sits inside the subshell so the temp file is created under
	# its umask; opened outside, it would take the caller's and be readable by
	# everyone on the machine.
	(
		umask 077
		_found=0
		{
			while IFS= read -r _line || [ -n "$_line" ]; do
				if [ "${_line%%=*}" = "$_key" ]; then
					printf '%s=%s\n' "$_key" "$_value"
					_found=1
				else
					printf '%s\n' "$_line"
				fi
			done <"$_file"
			[ "$_found" -eq 1 ] || printf '%s=%s\n' "$_key" "$_value"
		} >"$_tmp"
	)
	mv "$_tmp" "$_file"
}

# One instance: its directory, a copy of the compose file, and its .env.
configure() {
	_name=$1
	_port=$2
	_https=$3
	_dir="$BASE/$_name"
	_env="$_dir/.env"
	_origin="http://$ADDRESS:$_port"

	mkdir -p "$_dir"
	# Refreshed every run, so the stack always matches this checkout.
	cp "$ROOT/docker-compose.yml" "$_dir/docker-compose.yml"

	if [ ! -f "$_env" ]; then
		"$ROOT/scripts/generate-env.sh" --target "$_env" >/dev/null
		say "  $_name: wrote $_env with fresh credentials"
	else
		say "  $_name: kept the credentials in $_env"
	fi

	# Its own project, so the two stacks share no containers or volumes. The
	# compose file names a project of its own, which this overrides.
	set_env "$_env" COMPOSE_PROJECT_NAME "$_name"
	set_env "$_env" IMAGE_TAG "$TAG"
	set_env "$_env" PUBLIC_PORT "$_port"
	set_env "$_env" PUBLIC_HTTPS_PORT "$_https"
	set_env "$_env" PUBLIC_URL "$_origin"
	# The address for the other server, and localhost for a browser arriving
	# through an SSH tunnel.
	set_env "$_env" PUBLIC_HOSTNAME "$ADDRESS,localhost"
	set_env "$_env" FEDERATION_ORIGIN "$_origin"
	set_env "$_env" FEDERATION_ALLOW_PRIVATE_ADDRESSES true
}

say "Configuring two instances in $BASE, at $ADDRESS:"
configure hub-a "$PORT_A" "$HTTPS_A"
configure hub-b "$PORT_B" "$HTTPS_B"

# ---- Image ------------------------------------------------------------------

IMAGE="ghcr.io/spelling-creator/spelling-creator:$TAG"

if [ "$BUILD" -eq 1 ]; then
	say ""
	say "Building $IMAGE from $ROOT (a few minutes the first time)..."
	# From the checkout, with compose.build.yml naming the build. hub-a's .env
	# is only there to satisfy the compose file's required settings; nothing
	# from it ends up in the image.
	docker compose \
		-f "$ROOT/docker-compose.yml" -f "$ROOT/compose.build.yml" \
		--env-file "$BASE/hub-a/.env" \
		build app schema
elif [ "$START" -eq 1 ]; then
	docker image inspect "$IMAGE" >/dev/null 2>&1 || fail "There is no $IMAGE to run. Leave out --no-build to build it."
fi

if [ "$START" -eq 0 ]; then
	say ""
	say "Configured, not started. Start each with:"
	say "  cd $BASE/hub-a && docker compose up -d --pull never"
	say "  cd $BASE/hub-b && docker compose up -d --pull never"
	exit 0
fi

# ---- Start ------------------------------------------------------------------

say ""
for _name in hub-a hub-b; do
	say "Starting $_name..."
	# --pull never: the tag only exists here, and a pull would fail on it.
	(cd "$BASE/$_name" && docker compose -p "$_name" up -d --pull never)
done

# Up means the app answers through its gateway. The schema step waits for the
# identity service before the app starts, so the first start takes a while.
get() {
	if command -v curl >/dev/null 2>&1; then
		curl -fsS -o /dev/null --max-time 5 "$1" 2>/dev/null
	else
		wget -q -O /dev/null -T 5 "$1" 2>/dev/null
	fi
}

wait_for() {
	_url=$1
	_tries=0
	until get "$_url"; do
		_tries=$((_tries + 1))
		[ "$_tries" -lt 90 ] || return 1
		sleep 2
	done
}

say ""
for _pair in "hub-a $PORT_A" "hub-b $PORT_B"; do
	_name=${_pair% *}
	_port=${_pair#* }
	printf 'Waiting for %s on port %s... ' "$_name" "$_port"
	if wait_for "http://$ADDRESS:$_port/_health"; then
		say "up"
	else
		say "not answering"
		fail "Look at: cd $BASE/$_name && docker compose logs app gateway schema"
	fi
done

# The one thing that has to be true for federation and is easy to get wrong:
# each app container can reach the other instance at its origin. A host
# firewall that lets a browser in can still drop a container's request to the
# host's own address.
reach() {
	(cd "$BASE/$1" && docker compose -p "$1" exec -T app wget -q -O /dev/null -T 5 "$2/_health") >/dev/null 2>&1
}

say ""
REACH_OK=1
if reach hub-a "http://$ADDRESS:$PORT_B"; then say "hub-a can reach hub-b"; else
	say "hub-a CANNOT reach hub-b at http://$ADDRESS:$PORT_B"
	REACH_OK=0
fi
if reach hub-b "http://$ADDRESS:$PORT_A"; then say "hub-b can reach hub-a"; else
	say "hub-b CANNOT reach hub-a at http://$ADDRESS:$PORT_A"
	REACH_OK=0
fi
if [ "$REACH_OK" -eq 0 ]; then
	say "  Federation will not work until it can. Usually the host firewall: allow"
	say "  ports $PORT_A and $PORT_B from the Docker networks to $ADDRESS."
fi

# ---- What next --------------------------------------------------------------

cat <<-DONE

	Both instances are running:
	  hub-a  http://$ADDRESS:$PORT_A
	  hub-b  http://$ADDRESS:$PORT_B

	From another machine, either open those directly, or tunnel them:
	  ssh -L $PORT_A:localhost:$PORT_A -L $PORT_B:localhost:$PORT_B <this host>
	and open http://localhost:$PORT_A and http://localhost:$PORT_B.

	Sign in on each with "Create one" (username and password, no mail needed).
	When pasting a lesson address from one instance into the other, use the
	$ADDRESS form: the server fetches it, and localhost there is itself.

	Logs:      cd $BASE/hub-a && docker compose logs -f app
	Stop:      cd $BASE/hub-a && docker compose down        (and the same for hub-b)
	Start over: docker compose down -v in each, which deletes their data, then
	            delete $BASE and run this again.
DONE
