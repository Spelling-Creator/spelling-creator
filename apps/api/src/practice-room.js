// PracticeRoom: the relay that keeps a letterboard in step with a Practice page,
// one Durable Object instance per share code (env.PRACTICE_ROOM.idFromName(code)).
//
// The Practice page in a browser (the HOST, signed in to the hub) runs the
// lesson and owns the step. A letterboard tablet running Spelling Creator Board
// (a BOARD, anonymous, joined by code alone) follows: it shows the same step,
// and what is spelled on it appears in the host's answer box as it is spelled.
// The contract is docs/live-sync.md in the board's repository, and this is the
// hub side of it.
//
// It is the collaboration room (collab-room.js) with everything taken out that a
// letterboard doesn't need: no Yjs, no admission, no roster, no agents. One host
// and any number of boards; the host's `state` is kept so a board that joins late
// is caught up in its `hello`; a board's `text`, `answer` and `step` go to the
// host only, and the host decides where everyone is. When the host's socket
// closes the room tells every board and shuts.
//
// Messages are JSON text frames, one object each, with a `type`. Anything the
// room relays is rebuilt from the fields the contract lists, never forwarded as
// received, so a participant can't smuggle extra fields to the other side.
// Unknown types are ignored on both sides, which is what lets either side add a
// message later without breaking the other.
//
// The Worker (routes/practice.js) decides who is the host: it verifies the
// Supabase JWT, applies the join limits, and hands the role over in
// X-Practice-Role. Nothing here looks at a token or a query string.
import { DurableObject } from 'cloudflare:workers';

import { MAX_RESPONSE_LENGTH } from '@spelling-creator/core/interactive';

// Boards in one session. A session is one speller and a partner, so this is
// headroom for a second screen or a reconnect, not a classroom.
const MAX_BOARDS = 10;
// One frame. The largest legitimate message is a `state` or `text` carrying a
// whole answer (MAX_RESPONSE_LENGTH characters), so this is a few times that.
const MAX_MESSAGE_BYTES = 32 * 1024;
// A lesson id, as the hub stores it (a uuid); the same cap routes/lessonResponses
// uses for ids.
const MAX_ID_LENGTH = 100;
// A step index far past any real lesson (the largest run to a few dozen steps).
const MAX_STEP = 100_000;
// Per-connection message budgets, in messages per second (token bucket). `text`
// is the board's sentence, sent on every letter; `state` is the host's answer box,
// sent on every keystroke. The two moves are human taps. Everything else (a
// board's one `join`, a type added later, a frame that isn't JSON at all) shares
// the `other` budget: dropped either way, but never free to send without limit.
const RATE = { text: 30, state: 30, answer: 5, step: 5, other: 10 };
// A connection that keeps exceeding its budget this often is closed as abusive.
const MAX_VIOLATIONS = 100;

const HOST_LEFT = 'The host ended the session.';
const NO_SESSION = 'No session with that code. Check it on the Practice page.';
const FULL = 'This session is full.';
const REFUSED_CLOSE = 1008; // policy violation: the one close code for a refusal

export class PracticeRoom extends DurableObject {
	constructor(ctx, env) {
		super(ctx, env);
		this.ctx = ctx;
		this.env = env;
		// Per-connection rate buckets and violation counts, by connection id. In
		// memory only: an eviction while the sockets hibernate resets them to full,
		// which is lenient and acceptable.
		this.buckets = new Map();
		this.violations = new Map();
		// The host's last state, in SQLite (see loadState). Synchronous, so the
		// constructor can create the table without blocking concurrency.
		ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (k TEXT PRIMARY KEY, v TEXT)');
		// Keep-alive. The board sends a WebSocket ping every 25 seconds, which the
		// runtime answers on its own. The browser can't send a protocol ping from
		// JavaScript, so the host sends a "ping" text message instead (as the
		// collaboration client does), answered here without waking this object.
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
	}

	// ----- the last state --------------------------------------------------------
	// The host's latest `state`, kept in storage rather than memory so a board that
	// joins after this object has been evicted and woken still gets it in `hello`.
	//
	// SQLite rather than the async key-value API, because writing it sits on the
	// path of every keystroke the host types: the synchronous write lets the
	// broadcast to the boards go out in the same turn instead of after an await.
	// The output gate still holds those messages until the write is durable, so a
	// board is never told about a state the room could forget.
	loadState() {
		const raw = this.ctx.storage.sql.exec("SELECT v FROM room WHERE k = 'state'").toArray()[0]?.v;
		if (typeof raw !== 'string') return {};
		try {
			return JSON.parse(raw);
		} catch {
			return {}; // a bad row is forgotten, not fatal
		}
	}

	saveState(state) {
		this.ctx.storage.sql.exec("INSERT OR REPLACE INTO room (k, v) VALUES ('state', ?)", JSON.stringify(state));
	}

	clearState() {
		this.ctx.storage.sql.exec("DELETE FROM room WHERE k = 'state'");
	}

	// ----- connections -----------------------------------------------------------
	state(ws) {
		return ws.deserializeAttachment() || null;
	}

	// A socket on its way out: refused, left behind by a host who has gone, or the
	// departed host itself. It stays in getWebSockets() until its close handshake
	// finishes, so it is marked, and everything that counts or addresses
	// participants skips it. Otherwise a board from an ended session would be
	// counted for, and sent the state of, a new host who took the code over in
	// that window, and a refused board would count against MAX_BOARDS.
	retire(ws, s = this.state(ws)) {
		if (!s || s.done) return;
		try {
			ws.serializeAttachment({ ...s, done: true });
		} catch {
			/* already fully closed, so already out of getWebSockets() */
		}
	}

	hostSocket() {
		for (const ws of this.ctx.getWebSockets()) {
			const s = this.state(ws);
			if (s && s.host && !s.done) return ws;
		}
		return null;
	}

	// The boards in the session, leaving out any on their way out (see retire).
	boards() {
		const out = [];
		for (const ws of this.ctx.getWebSockets()) {
			const s = this.state(ws);
			if (s && !s.host && !s.done) out.push(ws);
		}
		return out;
	}

	// The next free connection id: one past the highest in use, so it stays
	// correct across hibernation (a counter in memory wouldn't).
	nextId() {
		let max = -1;
		for (const ws of this.ctx.getWebSockets()) {
			const s = this.state(ws);
			if (s && s.id > max) max = s.id;
		}
		return max + 1;
	}

	send(ws, message) {
		try {
			ws.send(JSON.stringify(message));
		} catch {
			/* a socket mid-close; its close handler cleans up */
		}
	}

	close(ws, code, reason) {
		try {
			ws.close(code, reason);
		} catch {
			/* already closing */
		}
	}

	// Tell the host how many boards are listening. Not in the board contract (a
	// board never receives it); it is what the Practice page shows beside the code.
	tellHostBoards() {
		const host = this.hostSocket();
		if (host) this.send(host, { type: 'boards', count: this.boards().length });
	}

	// ----- rate limiting ---------------------------------------------------------
	// `type` is the message's own type, or null for a frame that didn't parse.
	rateOk(id, type) {
		const bucket = Object.hasOwn(RATE, type) ? type : 'other';
		const perSec = RATE[bucket];
		let b = this.buckets.get(id);
		if (!b) {
			b = {};
			this.buckets.set(id, b);
		}
		const now = Date.now();
		let s = b[bucket];
		if (!s) {
			s = { tokens: perSec, last: now };
			b[bucket] = s;
		}
		s.tokens = Math.min(perSec, s.tokens + ((now - s.last) / 1000) * perSec);
		s.last = now;
		if (s.tokens < 1) {
			this.violations.set(id, (this.violations.get(id) || 0) + 1);
			return false;
		}
		s.tokens -= 1;
		return true;
	}

	abusive(id) {
		return (this.violations.get(id) || 0) > MAX_VIOLATIONS;
	}

	// ----- joining ---------------------------------------------------------------
	async fetch(request) {
		if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
			return new Response('Expected a WebSocket upgrade.', { status: 426 });
		}
		const host = request.headers.get('X-Practice-Role') === 'host';
		const existingHost = this.hostSocket();

		// The code is the only secret, so a second host is refused rather than
		// replacing the first: whoever holds the code could otherwise take the
		// session over from the partner running it.
		if (host && existingHost) {
			return new Response('This session already has a host.', { status: 409 });
		}

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		this.ctx.acceptWebSocket(server);

		if (!host) {
			// A board is refused over the socket it opened, with an `error` message
			// saying why, rather than with an HTTP status it would only see as a
			// failed connection. The contract names `error` for exactly this.
			const refusal = !existingHost ? NO_SESSION : this.boards().length >= MAX_BOARDS ? FULL : null;
			if (refusal) {
				server.serializeAttachment({ id: -1, host: false, done: true });
				this.send(server, { type: 'error', message: refusal });
				this.close(server, REFUSED_CLOSE, refusal);
				return new Response(null, { status: 101, webSocket: client });
			}
		}

		const id = this.nextId();
		server.serializeAttachment({ id, host });

		if (host) {
			// A new session in an object a previous one used: nothing of the old
			// session may reach this one's boards.
			this.clearState();
			this.send(server, { type: 'hello', boards: this.boards().length });
		} else {
			// Whatever the host has open, so a board joining mid-lesson lands on the
			// right step with the sentence so far.
			this.send(server, { type: 'hello', ...this.loadState() });
			this.tellHostBoards();
		}

		return new Response(null, { status: 101, webSocket: client });
	}

	// ----- messages --------------------------------------------------------------
	async webSocketMessage(ws, message) {
		const s = this.state(ws);
		if (!s || s.done) return;

		// Parsed before the budget is checked, since the budget is per type, but
		// counted against `other` when it doesn't parse: junk is not free either.
		let msg = null;
		if (typeof message === 'string' && message.length <= MAX_MESSAGE_BYTES) {
			try {
				msg = JSON.parse(message);
			} catch {
				msg = null;
			}
		}
		const valid = msg && typeof msg === 'object' && typeof msg.type === 'string';

		if (!this.rateOk(s.id, valid ? msg.type : null)) {
			if (this.abusive(s.id)) this.close(ws, REFUSED_CLOSE, 'Rate limit exceeded.');
			return;
		}
		if (!valid) return;

		if (s.host) this.fromHost(msg);
		else this.fromBoard(msg);
	}

	// The host's one message: where everyone is now. Kept for late boards and sent
	// to every board, rebuilt from the three fields the contract lists.
	fromHost(msg) {
		if (msg.type !== 'state') return;
		const state = readState(msg);
		this.saveState(state);
		const frame = { type: 'state', ...state };
		for (const board of this.boards()) this.send(board, frame);
	}

	// A board's messages go to the host only, each rebuilt from its one field.
	fromBoard(msg) {
		const host = this.hostSocket();
		if (!host) return;
		switch (msg.type) {
			case 'join':
				// Answered already: `hello` went out when the socket was accepted.
				break;
			case 'text':
			case 'answer': {
				const text = readText(msg.text);
				if (text === null) return;
				this.send(host, { type: msg.type, text });
				break;
			}
			case 'step': {
				const step = readStep(msg.step);
				if (step === null) return;
				this.send(host, { type: 'step', step });
				break;
			}
			default:
				break;
		}
	}

	// ----- leaving ---------------------------------------------------------------
	async webSocketClose(ws) {
		await this.onGone(ws);
	}

	async webSocketError(ws) {
		await this.onGone(ws);
	}

	// The room dies with its host: every board is told and closed, and the state
	// is dropped so a later session in this object starts clean.
	async onGone(ws) {
		const s = this.state(ws);
		if (!s || s.done) return;
		this.retire(ws, s);
		this.buckets.delete(s.id);
		this.violations.delete(s.id);
		if (s.host) {
			const bye = { type: 'removed', message: HOST_LEFT };
			for (const board of this.boards()) {
				this.send(board, bye);
				this.retire(board);
				this.close(board, 1000, 'host left');
			}
			this.clearState();
		} else {
			this.tellHostBoards();
		}
	}
}

// ----- field readers --------------------------------------------------------------
// Each takes what a participant sent and returns the one value the contract
// allows there, or null for anything else. Nothing a participant sends reaches
// the other side as sent.

// A `state`: the lesson that is open (none means no lesson), the step index and
// the answer box. Only the fields that were sent and valid are kept, so a host
// that omits `text` doesn't clear a board's sentence by accident.
function readState(msg) {
	const out = {};
	if (typeof msg.lessonId === 'string' && msg.lessonId && msg.lessonId.length <= MAX_ID_LENGTH) {
		out.lessonId = msg.lessonId;
	}
	const step = readStep(msg.step);
	if (step !== null) out.step = step;
	const text = readText(msg.text);
	if (text !== null) out.text = text;
	return out;
}

function readText(value) {
	if (typeof value !== 'string') return null;
	return value.length > MAX_RESPONSE_LENGTH ? value.slice(0, MAX_RESPONSE_LENGTH) : value;
}

function readStep(value) {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_STEP) return null;
	return value;
}
