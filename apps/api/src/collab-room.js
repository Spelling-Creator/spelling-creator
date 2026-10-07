// CollabRoom — the server-authoritative coordinator for a live collaboration
// session, one Durable Object instance per session (addressed by the host's
// random share code via env.COLLAB_ROOM.idFromName(code)).
//
// This replaces the old PeerJS/WebRTC peer-to-peer relay (the host used to be
// the relay). Now every participant connects a single WebSocket to this DO,
// which is the authority and relay: it caches the current document, relays
// edits/cursors/chat between admitted collaborators, tracks presence, and routes
// the host's admit/remove decisions. The Worker (apps/api/src/index.js) verifies
// the Supabase JWT before any connection reaches here, so only logged-in users
// arrive and their identity (uid/name/email/avatar) is trusted server-side
// rather than self-asserted (the old metadata model was spoofable).
//
// Sync model — a CRDT (Yjs), not last-write-wins. The room holds the session's
// authoritative Y.Doc: it merges each incoming update into it, persists the
// merged state, and relays the update to the other admitted peers. Two people
// editing different blocks therefore both keep their work, where the old
// whole-document last-write-wins model silently dropped one of them. See
// apps/web/src/lib/ydoc.js for the document model and the plain-JSON bridge.
//
// Every relayed update is preceded by an EDITED frame naming its sender's slot,
// which is how version history knows whom to credit for a session's edits.
//
// Wire protocol — binary frames for speed, defined once in
// packages/core/src/collabFrames.js and spoken by the room and the browser
// (apps/web/src/lib/collab.js). Read that file for the frame shapes; a sender is
// identified there by a server-assigned u16 "slot" rather than by name or email,
// which makes packets smaller and identities unspoofable.
//
// Agents: participants with no socket. An AI assistant joins through the MCP
// server (apps/mcp/src/collab.js), and that server cannot hold a connection open
// between tool calls: on the remote transport it runs inside a Durable Object
// that is built to hibernate between requests. So an assistant is a *record* in
// this room rather than a connection. It joins, is admitted and removed, and
// appears in the roster exactly like anyone else, but it reads the document and
// its chat by asking (plain HTTP, see agentFetch) instead of being told, and the
// room keeps an inbox of chat for it between asks. Nothing about the consent
// model changes: the host sees the request, admits it or not, and can remove it
// at any moment, all with the same ADMIT and REMOVE frames. What an agent can't
// do is disconnect by vanishing, so a sweep (alarm) lets go of one that stops
// asking.
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';

import { T, frameBytes, frameJson, frameWithSlot } from '@spelling-creator/core/collabFrames';

import { rateLimitStore } from './platform/index.js';

// Hard limits (the "strict" rate-limit profile). The Worker additionally caps
// how often a user may open a connection and how many rooms they may host; these
// are the per-room / per-connection caps enforced here.
const MAX_PARTICIPANTS = 10; // people in a single room (incl. host)
// A single update payload. Incremental edits are tiny; this ceiling exists for
// the one genuinely large update — the host's opening seed of a whole lesson.
const MAX_UPDATE_BYTES = 512 * 1024;
const MAX_CURSOR_BYTES = 1024; // a cursor payload
const MAX_CHAT_BYTES = 8192; // a chat payload (~2000 UTF-8 chars)
// Per-connection message budgets, in messages per second (token-bucket). The
// document budget is generous because CRDT updates are small and frequent — one
// per edit — where the old whole-document messages were fat and slow.
const RATE = { [T.UPDATE]: 30, [T.CURSOR]: 15, [T.CHAT]: 2 };
// Close a connection that keeps exceeding its budget this many times — a sender
// that ignores back-pressure is treated as abusive rather than throttled forever.
const MAX_VIOLATIONS = 100;

// Agent lifetimes. An agent has no socket to close, so these are how the room
// learns it has gone. A request nobody has answered is withdrawn after the
// PENDING ttl (a teacher who hasn't clicked in five minutes isn't going to); an
// admitted agent that has stopped asking is let go after the IDLE ttl, which is
// long because a conversation pauses while the user thinks and types. A GONE
// record is a tombstone: it stays so the agent's next ask can be told *why* it
// is no longer in the session, then is swept.
const AGENT_PENDING_TTL_MS = 5 * 60_000;
const AGENT_IDLE_TTL_MS = 30 * 60_000;
const AGENT_GONE_TTL_MS = 10 * 60_000;
const AGENT_SWEEP_MS = 60_000;
// Chat kept for an agent between asks. Bounded so an agent that joins and never
// reads can't make the room grow without limit.
const AGENT_INBOX_MAX = 200;
// The longest a single ask may wait for admission before answering "not yet".
// Kept well under a minute so it never collides with an MCP client's own
// request timeout; the asker simply asks again.
const AGENT_WAIT_MAX_MS = 25_000;
const AGENT_CHAT_MAX_CHARS = 2000;

// Reasons an agent record ends, in words the assistant will read back to the
// user. "removed" is special: it is also what a declined socket sees, and the
// client turns it into "the host declined" or "the host removed you" by context.
const GONE_REMOVED = 'removed';
const GONE_HOST_LEFT = 'The host ended the session.';
const GONE_IDLE = 'the room let you go after half an hour without a request';
const GONE_UNANSWERED = 'nobody admitted the request to join within five minutes';
const GONE_ABUSIVE = 'Rate limit exceeded.';

const enc = new TextEncoder();
const decoder = new TextDecoder();

// The one frame shape that is the room's alone to build: HELLO tells a socket
// its own slot and role, so nothing else ever sends it.
function frameHello(slot, host) {
	const b = new Uint8Array(4);
	b[0] = T.HELLO;
	b[1] = (slot >> 8) & 0xff;
	b[2] = slot & 0xff;
	b[3] = host ? 1 : 0;
	return b;
}

// Identity, as the Worker forwards it from the verified Supabase user. URL-
// encoded so non-ASCII names survive an HTTP header.
function identityFrom(request) {
	const dec = (h) => {
		try {
			return decodeURIComponent(request.headers.get(h) || '');
		} catch {
			return '';
		}
	};
	return {
		uid: dec('X-Collab-Uid'),
		name: dec('X-Collab-Name'),
		email: dec('X-Collab-Email'),
		avatarUrl: dec('X-Collab-Avatar'),
		// Set by the Worker when the connection declared itself an AI assistant
		// acting for this account (see handleCollab). Carried through to the
		// roster so the host can tell a person from an assistant at a glance.
		bot: request.headers.get('X-Collab-Bot') === '1',
	};
}

// Which agent endpoint a path names, or null for the WebSocket path. The Worker
// forwards the full URL (/collab/<code>/agent[/update|/chat]). Anchored on the
// code segment, so a session whose share code happens to be "agent" is still a
// WebSocket path (/collab/agent) and not an agent ask.
function agentAction(pathname) {
	const m = /^\/collab\/[^/]+\/agent(?:\/(update|chat))?\/?$/.exec(pathname);
	return m ? m[1] || 'session' : null;
}

// An agent row's JSON, or null for a corrupt one: skipped rather than allowed
// to take the room down.
function rowToAgent(row) {
	if (!row) return null;
	try {
		return JSON.parse(row.v);
	} catch {
		return null;
	}
}

// A document travels to an agent as base64 inside JSON. Built in chunks: one
// String.fromCharCode over a whole lesson would overflow the argument list.
function toBase64(bytes) {
	let s = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
	}
	return btoa(s);
}

// 256 bits of randomness, as hex. What an agent presents on every later ask to
// say which record is its own.
function randomToken() {
	return [crypto.randomUUID(), crypto.randomUUID()].join('').replace(/-/g, '');
}

const json = (body, status = 200) => Response.json(body, { status });

export class CollabRoom extends DurableObject {
	constructor(ctx, env) {
		super(ctx, env);
		this.ctx = ctx;
		this.env = env;
		// Per-connection message-rate buckets and violation counts, keyed by slot.
		// In-memory only: if the DO is evicted while sockets hibernate these reset,
		// which is lenient (a fresh full bucket) on the next message — acceptable.
		this.buckets = new Map();
		this.violations = new Map();
		// Agents waiting (inside a long-poll) to hear they were admitted, by their
		// token. Keyed by token rather than slot because a slot can be reissued
		// after its agent leaves, and a wait must only ever be answered about the
		// record that started it. In-memory by nature: a waiter is an open
		// request, and an open request keeps this object awake.
		this.agentWaiters = new Map();
		// The document is cached in SQLite (not a DO storage value) so it survives
		// hibernation/eviction and can exceed the 128 KiB key-value limit; a late
		// joiner is served the cached copy on admission.
		//
		// The room's authoritative Y.Doc is rebuilt from that cache here rather than
		// merely held in memory: this object can be evicted while its WebSockets
		// hibernate, and waking up with an empty CRDT would lose the lesson. We store
		// the *merged state*, not a log of updates, so waking costs one applyUpdate
		// and the stored blob stays compact however long the session runs.
		//
		// Agents and their chat inboxes live in SQLite for the same reason: they
		// are what makes a participant exist between requests, so they have to
		// outlive the object's memory.
		ctx.blockConcurrencyWhile(async () => {
			ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (k TEXT PRIMARY KEY, v BLOB)');
			ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS agents (slot INTEGER PRIMARY KEY, token TEXT UNIQUE, v TEXT)');
			ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS agent_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, slot INTEGER, v TEXT)');
			this.ydoc = new Y.Doc();
			const saved = this.getDocBytes();
			if (saved) Y.applyUpdate(this.ydoc, saved);
			// Where each participant's caret is, by slot. A socket learns this from
			// relayed CURSOR frames as they happen; an agent has to be told on its
			// next ask, so the room remembers the latest. Persisted (while an
			// admitted agent exists to read it) because an agent's asks are exactly
			// when this object has had time to be evicted.
			this.cursors = this.loadCursors();
			this.cursorReaders = false;
			this.refreshAgentFlags();
		});
		// Keep-alive. A backgrounded tab stops sending cursor/doc traffic, so its
		// otherwise-idle WebSocket gets dropped as inactive — the bug where leaving
		// the tab ends the session. Browsers can't send protocol-level ping frames
		// from JS, so the client sends a "ping" text message on a timer (see
		// collab.js) and the runtime answers "pong" here automatically — without
		// waking this object from hibernation — which keeps the connection alive.
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
	}

	// ----- document cache (SQLite) -------------------------------------------
	getDocBytes() {
		const rows = this.ctx.storage.sql.exec("SELECT v FROM room WHERE k = 'doc'").toArray();
		const v = rows[0]?.v;
		return v ? new Uint8Array(v) : null;
	}

	setDocBytes(bytes) {
		// Bind a standalone ArrayBuffer (the source is usually a subarray view of a
		// larger frame; copying avoids any ambiguity over byteOffset when SQLite
		// stores the BLOB).
		const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		this.ctx.storage.sql.exec("INSERT OR REPLACE INTO room (k, v) VALUES ('doc', ?)", buf);
	}

	// Write the room's merged CRDT state back to SQLite, so a late joiner (or this
	// object waking from hibernation) sees every edit made so far.
	persist() {
		this.setDocBytes(Y.encodeStateAsUpdate(this.ydoc));
	}

	// ----- cursors ------------------------------------------------------------
	loadCursors() {
		const rows = this.ctx.storage.sql.exec("SELECT v FROM room WHERE k = 'cursors'").toArray();
		const map = new Map();
		const raw = rows[0]?.v;
		if (typeof raw !== 'string') return map;
		try {
			for (const [slot, cursor] of Object.entries(JSON.parse(raw))) map.set(Number(slot), cursor);
		} catch {
			/* a bad row is forgotten, not fatal */
		}
		return map;
	}

	persistCursors() {
		// Only an admitted agent ever reads these back, so a room without one
		// writes nothing: a browser sends up to fifteen cursor frames a second,
		// and a pending request or a tombstone is not a reader.
		if (!this.cursorReaders) return;
		this.ctx.storage.sql.exec("INSERT OR REPLACE INTO room (k, v) VALUES ('cursors', ?)", JSON.stringify(Object.fromEntries(this.cursors)));
	}

	rememberCursor(slot, payload) {
		let cursor;
		try {
			cursor = JSON.parse(decoder.decode(payload));
		} catch {
			return;
		}
		if (cursor && typeof cursor === 'object') this.cursors.set(slot, cursor);
		else this.cursors.delete(slot);
		this.persistCursors();
	}

	// Forget cursors for anyone no longer in the session.
	pruneCursors(participants) {
		const present = new Set(participants.map((p) => p.slot));
		let changed = false;
		for (const slot of [...this.cursors.keys()]) {
			if (present.has(slot)) continue;
			this.cursors.delete(slot);
			changed = true;
		}
		if (changed) this.persistCursors();
	}

	// ----- agents (SQLite) ----------------------------------------------------
	agents() {
		return this.ctx.storage.sql.exec('SELECT v FROM agents').toArray().map(rowToAgent).filter(Boolean);
	}

	liveAgents() {
		return this.agents().filter((a) => !a.gone);
	}

	agentBySlot(slot) {
		return rowToAgent(this.ctx.storage.sql.exec('SELECT v FROM agents WHERE slot = ?', slot).toArray()[0]);
	}

	agentByToken(token) {
		return rowToAgent(this.ctx.storage.sql.exec('SELECT v FROM agents WHERE token = ?', token).toArray()[0]);
	}

	// Recompute what the agent table implies for the rest of the room: whether
	// any record exists at all (the sweep keeps running while one does), and
	// whether an admitted agent exists to read cursors back. The moment the
	// first reader appears, the cursors already in memory are written down, so
	// a caret the teacher parked before the assistant arrived survives an
	// eviction too; the moment the last one goes, the row is dropped.
	refreshAgentFlags() {
		const all = this.agents();
		this.hasAgents = all.length > 0;
		const readers = all.some((a) => !a.gone && a.admitted);
		if (readers && !this.cursorReaders) {
			this.cursorReaders = true;
			this.persistCursors();
		} else if (!readers && this.cursorReaders) {
			this.cursorReaders = false;
			this.ctx.storage.sql.exec("DELETE FROM room WHERE k = 'cursors'");
		}
	}

	saveAgent(a) {
		this.ctx.storage.sql.exec('INSERT OR REPLACE INTO agents (slot, token, v) VALUES (?, ?, ?)', a.slot, a.token, JSON.stringify(a));
		this.refreshAgentFlags();
	}

	// Forget an agent outright. Anyone waiting on it inside a long-poll is woken
	// first, so the wait ends now and finds the record gone, rather than
	// sleeping out its timeout and guessing at a reason.
	deleteAgent(a) {
		this.wakeAgent(a);
		this.ctx.storage.sql.exec('DELETE FROM agents WHERE slot = ?', a.slot);
		this.ctx.storage.sql.exec('DELETE FROM agent_inbox WHERE slot = ?', a.slot);
		this.buckets.delete(a.slot);
		this.violations.delete(a.slot);
		this.cursors.delete(a.slot);
		this.refreshAgentFlags();
	}

	// End an agent's part in the session, keeping the record as a tombstone so
	// its next ask learns the reason. Anyone waiting inside a long-poll is woken
	// to hear it now.
	endAgent(a, reason) {
		a.gone = reason;
		a.goneAt = Date.now();
		a.admitted = false;
		this.saveAgent(a);
		this.ctx.storage.sql.exec('DELETE FROM agent_inbox WHERE slot = ?', a.slot);
		this.wakeAgent(a);
	}

	inboxPush(slot, entry) {
		this.ctx.storage.sql.exec('INSERT INTO agent_inbox (slot, v) VALUES (?, ?)', slot, JSON.stringify(entry));
		this.ctx.storage.sql.exec(
			'DELETE FROM agent_inbox WHERE slot = ? AND id NOT IN (SELECT id FROM agent_inbox WHERE slot = ? ORDER BY id DESC LIMIT ?)',
			slot,
			slot,
			AGENT_INBOX_MAX,
		);
	}

	inboxDrain(slot) {
		const rows = this.ctx.storage.sql.exec('SELECT v FROM agent_inbox WHERE slot = ? ORDER BY id', slot).toArray();
		this.ctx.storage.sql.exec('DELETE FROM agent_inbox WHERE slot = ?', slot);
		const out = [];
		for (const row of rows) {
			try {
				out.push(JSON.parse(row.v));
			} catch {
				/* skip */
			}
		}
		return out;
	}

	// A long-poll: resolve when the agent is admitted, ended or forgotten, or
	// when `ms` runs out, whichever is first. The caller re-reads the record by
	// token afterwards; this promises nothing about what it will find.
	waitForAgent(a, ms) {
		return new Promise((resolve) => {
			let waiters = this.agentWaiters.get(a.token);
			if (!waiters) {
				waiters = new Set();
				this.agentWaiters.set(a.token, waiters);
			}
			const done = () => {
				clearTimeout(timer);
				waiters.delete(done);
				// Only drop the map entry if it is still ours: a later wait on the
				// same token may have started its own set since.
				if (!waiters.size && this.agentWaiters.get(a.token) === waiters) {
					this.agentWaiters.delete(a.token);
				}
				resolve();
			};
			const timer = setTimeout(done, ms);
			waiters.add(done);
		});
	}

	wakeAgent(a) {
		const waiters = this.agentWaiters.get(a.token);
		if (!waiters) return;
		for (const done of [...waiters]) done();
	}

	// The sweep that stands in for a socket's close event. Armed when an agent
	// joins, re-armed while any agent record remains.
	async ensureSweep() {
		if ((await this.ctx.storage.getAlarm()) === null) {
			await this.ctx.storage.setAlarm(Date.now() + AGENT_SWEEP_MS);
		}
	}

	async alarm() {
		const now = Date.now();
		let changed = false;
		for (const a of this.agents()) {
			if (a.gone) {
				if (now - a.goneAt > AGENT_GONE_TTL_MS) this.deleteAgent(a);
				continue;
			}
			// A pending request is measured from when it was made, not from the
			// assistant's last ask: it is the host's silence that withdraws it, and
			// an assistant that keeps asking must not keep it in their dialog
			// forever. An admitted agent is measured from its last ask, because
			// asking is the only sign of life it has.
			const expired = a.admitted ? now - a.lastSeen > AGENT_IDLE_TTL_MS : now - a.joinedAt > AGENT_PENDING_TTL_MS;
			if (expired) {
				this.endAgent(a, a.admitted ? GONE_IDLE : GONE_UNANSWERED);
				changed = true;
			}
		}
		if (changed) this.broadcastPresence();
		if (this.agents().length) await this.ctx.storage.setAlarm(now + AGENT_SWEEP_MS);
	}

	// ----- connection helpers -------------------------------------------------
	state(ws) {
		return ws.deserializeAttachment() || null;
	}

	hostSocket() {
		for (const ws of this.ctx.getWebSockets()) {
			const s = this.state(ws);
			if (s && s.host) return ws;
		}
		return null;
	}

	socketBySlot(slot) {
		for (const ws of this.ctx.getWebSockets()) {
			const s = this.state(ws);
			if (s && s.slot === slot) return ws;
		}
		return null;
	}

	// The next free slot: one past the highest slot in use, by a socket or an
	// agent record. Derived from what exists (not a counter) so it stays correct
	// across hibernation. Tombstoned agents count, so a slot isn't reissued
	// while a late ask could still name it.
	nextSlot() {
		let max = -1;
		for (const ws of this.ctx.getWebSockets()) {
			const s = this.state(ws);
			if (s && s.slot > max) max = s.slot;
		}
		const rows = this.ctx.storage.sql.exec('SELECT MAX(slot) AS m FROM agents').toArray();
		const m = rows[0]?.m;
		if (typeof m === 'number' && m > max) max = m;
		return max + 1;
	}

	participantCount() {
		return this.ctx.getWebSockets().length + this.liveAgents().length;
	}

	send(ws, frame) {
		try {
			ws.send(frame);
		} catch {
			/* a socket mid-close; its close handler will clean it up */
		}
	}

	// ----- presence -----------------------------------------------------------
	// A roster entry, the same shape for a socket's state and an agent record.
	entryFor(s) {
		return {
			slot: s.slot,
			// The account id, verified by the Worker. Version history signs a
			// collaborator's credit with it rather than with their email, and it
			// is already public on their profile.
			uid: s.uid,
			name: s.name,
			email: s.email,
			avatarUrl: s.avatarUrl,
			host: Boolean(s.host),
			// Self-declared by the connection and passed through by the Worker.
			// The UI labels it; nothing is gated on it. See handleCollab.
			bot: Boolean(s.bot),
		};
	}

	// Who is in the session and who is waiting to be, sockets and agents alike.
	roster() {
		const participants = [];
		const requests = [];
		for (const ws of this.ctx.getWebSockets()) {
			const s = this.state(ws);
			if (!s) continue;
			(s.admitted ? participants : requests).push(this.entryFor(s));
		}
		for (const a of this.liveAgents()) {
			(a.admitted ? participants : requests).push(this.entryFor(a));
		}
		participants.sort((a, b) => (a.host ? -1 : b.host ? 1 : a.slot - b.slot));
		return { participants, requests };
	}

	// Publish the roster. The host sees both the admitted participants and the
	// pending requests; admitted guests see only the participant list (a non-empty
	// list is their signal they're in the lesson). Pending guests get nothing yet.
	// Agents aren't sent anything: they read the roster on their next ask.
	broadcastPresence() {
		const { participants, requests } = this.roster();
		const hostFrame = frameJson(T.PRESENCE, { participants, requests });
		const guestFrame = frameJson(T.PRESENCE, { participants, requests: [] });
		for (const ws of this.ctx.getWebSockets()) {
			const s = this.state(ws);
			if (!s) continue;
			if (s.host) this.send(ws, hostFrame);
			else if (s.admitted) this.send(ws, guestFrame);
		}
		this.pruneCursors(participants);
	}

	// ----- rate limiting ------------------------------------------------------
	// Token-bucket check for one message of `type` from `slot`. Returns true if
	// the message is within budget. Sustained over-budget traffic trips a
	// violation counter that eventually closes the socket.
	rateOk(slot, type) {
		const perSec = RATE[type];
		if (!perSec) return true;
		let b = this.buckets.get(slot);
		if (!b) {
			b = {};
			this.buckets.set(slot, b);
		}
		const now = Date.now();
		let s = b[type];
		if (!s) {
			s = { tokens: perSec, last: now };
			b[type] = s;
		}
		s.tokens = Math.min(perSec, s.tokens + ((now - s.last) / 1000) * perSec);
		s.last = now;
		if (s.tokens < 1) {
			this.violations.set(slot, (this.violations.get(slot) || 0) + 1);
			return false;
		}
		s.tokens -= 1;
		return true;
	}

	abusive(slot) {
		return (this.violations.get(slot) || 0) > MAX_VIOLATIONS;
	}

	// ----- the document and chat, from whoever sent them ----------------------
	// Merge an update into the room's authoritative state, persist it, then relay
	// the update itself to the other admitted sockets. Relaying the raw bytes
	// (not a re-encode of our state) keeps this cheap and keeps every peer's Yjs
	// document converging on exactly the same history. Returns whether the update
	// changed anything, or null if it was malformed.
	applyUpdateFrom(slot, payload) {
		// Yjs emits 'update' only for a transaction that changed something, so
		// this says whether the update was news to the room or one it already
		// held (a resend, or something already merged from someone else).
		let changed = false;
		const markChanged = () => {
			changed = true;
		};
		this.ydoc.on('update', markChanged);
		try {
			Y.applyUpdate(this.ydoc, payload);
		} catch {
			return null; // a malformed update must not be able to take the room down
		} finally {
			this.ydoc.off('update', markChanged);
		}
		this.persist();
		// Say whose edit it is first, so a peer knows by the time the update
		// lands. Stamped here, like a cursor's slot, so it can't be claimed
		// by anyone else. Version history credits people from it, so it goes
		// out only for an update that changed the lesson: replaying one the
		// room already holds must not earn anybody credit for a commit.
		if (changed) this.relay(slot, frameWithSlot(T.EDITED, slot, null), true);
		this.relay(slot, frameBytes(T.UPDATE, payload), true);
		// Agents aren't pushed the update: they fetch the whole document on
		// their next ask, which is the same bytes however many edits preceded.
		return changed;
	}

	// A chat message from `sender` ({ slot, name }): to every admitted socket
	// now, and into every other admitted agent's inbox for when it next asks.
	// The sender is named at this moment, so someone who has since left is
	// still credited by name rather than by a slot nobody can resolve.
	relayChatFrom(sender, payload) {
		this.relay(sender.slot, frameWithSlot(T.CHAT, sender.slot, payload), true);
		let msg;
		try {
			msg = JSON.parse(decoder.decode(payload));
		} catch {
			return;
		}
		const entry = {
			from: sender.slot,
			name: sender.name,
			text: String(msg?.text || ''),
			ts: Number(msg?.ts) || Date.now(),
		};
		for (const a of this.liveAgents()) {
			if (a.admitted && a.slot !== sender.slot) this.inboxPush(a.slot, entry);
		}
	}

	// ----- connection lifecycle ----------------------------------------------
	async fetch(request) {
		const url = new URL(request.url);
		const action = agentAction(url.pathname);
		if (action) return this.agentFetch(request, url, action);

		if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
			return new Response('Expected a WebSocket upgrade.', { status: 426 });
		}
		const create = url.searchParams.get('create') === '1';
		const identity = identityFrom(request);

		const existingHost = this.hostSocket();
		let host = false;
		if (create && !existingHost) {
			host = true;
			// A new session in an object a previous one used. Any agent record
			// left is a tombstone from that session; it must not name a slot or
			// answer an ask in this one.
			for (const a of this.agents()) this.deleteAgent(a);
		} else if (!existingHost) {
			// Joining a code that nobody is hosting — mirrors the old "no session for
			// that code" failure when a PeerJS host id wasn't found.
			return new Response('Session not found', { status: 404 });
		}

		if (this.participantCount() >= MAX_PARTICIPANTS) {
			return new Response('This session is full.', { status: 403 });
		}

		const slot = this.nextSlot();
		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({
			slot,
			uid: identity.uid,
			name: identity.name,
			email: identity.email,
			avatarUrl: identity.avatarUrl,
			bot: identity.bot,
			host,
			admitted: host, // the host is implicitly part of their own lesson
		});

		this.send(server, frameHello(slot, host));
		this.broadcastPresence();

		return new Response(null, { status: 101, webSocket: client });
	}

	// ----- agents over HTTP ---------------------------------------------------
	//
	//   POST   /agent          join: a pending request the host sees in the roster
	//   GET    /agent[?wait=s] the session as it stands: admitted?, roster, chat
	//                          since the last ask, cursors, the document; waits
	//                          up to `wait` seconds for admission if not yet in
	//   POST   /agent/update   a Yjs update to merge, as raw bytes
	//   POST   /agent/chat     { text }: say something to the session
	//   DELETE /agent          leave
	//
	// Every ask but the join carries X-Collab-Agent, the token the join issued,
	// and is answered 410 with { gone: reason } once the session has let that
	// agent go (declined, removed, host left, swept). The Worker has already
	// verified who is asking (X-Collab-Uid), and the record has to be theirs.
	//
	// Order matters here. A request body is read BEFORE the record is looked up
	// and checked, and a long-poll re-reads the record by token AFTER waking, so
	// that nothing authorised on one side of an await acts on the other side of
	// it: the host may have removed the agent, or it may have left, in between.
	async agentFetch(request, url, action) {
		const identity = identityFrom(request);
		const method = request.method;

		if (action === 'session' && method === 'POST') {
			if (!this.hostSocket()) return json({ error: 'Session not found' }, 404);
			if (this.participantCount() >= MAX_PARTICIPANTS) return json({ error: 'This session is full.' }, 403);
			const now = Date.now();
			const a = {
				slot: this.nextSlot(),
				token: randomToken(),
				uid: identity.uid,
				name: identity.name,
				email: identity.email,
				avatarUrl: identity.avatarUrl,
				bot: true,
				host: false,
				admitted: false,
				joinedAt: now,
				lastSeen: now,
				gone: null,
				goneAt: null,
			};
			this.saveAgent(a);
			this.broadcastPresence();
			await this.ensureSweep();
			return json({ token: a.token, ...this.agentEnvelope(a, { withDoc: false }) }, 201);
		}

		// The body first (see above). Only the two writes have one.
		let bytes = null;
		let text = '';
		if (action === 'update' && method === 'POST') {
			bytes = new Uint8Array(await request.arrayBuffer());
			if (bytes.length > MAX_UPDATE_BYTES) return json({ error: 'Update too large.' }, 413);
		} else if (action === 'chat' && method === 'POST') {
			const body = await request.json().catch(() => null);
			text = typeof body?.text === 'string' ? body.text.trim() : '';
			if (!text) return json({ error: 'Nothing to say.' }, 400);
			if (text.length > AGENT_CHAT_MAX_CHARS) return json({ error: 'Message too long.' }, 413);
		}

		const token = request.headers.get('X-Collab-Agent') || '';
		const a = token ? this.agentByToken(token) : null;
		if (!a) {
			return json({ error: 'No such participant in this session. It may have been let go after a long silence; join again.' }, 404);
		}
		if (a.uid !== identity.uid) return json({ error: 'Forbidden' }, 403);
		if (a.gone) {
			this.deleteAgent(a);
			return json({ gone: a.gone }, 410);
		}
		a.lastSeen = Date.now();
		this.saveAgent(a);

		if (action === 'session' && method === 'GET') {
			// `doc=0` leaves the document out, for an ask that only wants to know
			// whether it is still in the session and what has been said.
			const withDoc = url.searchParams.get('doc') !== '0';
			const wait = Math.min(AGENT_WAIT_MAX_MS, Math.max(0, Number(url.searchParams.get('wait')) || 0) * 1000);
			if (!a.admitted && wait > 0) {
				await this.waitForAgent(a, wait);
				// Woken, or timed out: either way, what is true now is whatever the
				// record under OUR token says. Never by slot, which may since have
				// been handed to somebody else.
				const fresh = this.agentByToken(a.token);
				if (!fresh) return json({ error: 'No such participant in this session any more.' }, 404);
				if (fresh.gone) {
					this.deleteAgent(fresh);
					return json({ gone: fresh.gone }, 410);
				}
				return json(this.agentEnvelope(fresh, { withDoc }));
			}
			return json(this.agentEnvelope(a, { withDoc }));
		}

		if (action === 'session' && method === 'DELETE') {
			this.deleteAgent(a);
			this.broadcastPresence();
			return json({ left: true });
		}

		if (action === 'update' && method === 'POST') {
			if (!a.admitted) return json({ error: 'Not admitted to the session yet.' }, 409);
			const over = this.overBudget(a, T.UPDATE);
			if (over) return over;
			const changed = this.applyUpdateFrom(a.slot, bytes);
			if (changed === null) return json({ error: 'Malformed update.' }, 400);
			return json({ changed, ...this.agentEnvelope(a, { withDoc: false }) });
		}

		if (action === 'chat' && method === 'POST') {
			if (!a.admitted) return json({ error: 'Not admitted to the session yet.' }, 409);
			const payload = enc.encode(JSON.stringify({ text, ts: Date.now() }));
			if (payload.length > MAX_CHAT_BYTES) return json({ error: 'Message too long.' }, 413);
			const over = this.overBudget(a, T.CHAT);
			if (over) return over;
			this.relayChatFrom(a, payload);
			return json(this.agentEnvelope(a, { withDoc: false }));
		}

		return json({ error: 'Method not allowed.' }, 405);
	}

	// The same flood control a socket gets, answered in HTTP: a 429 while the
	// budget is merely exceeded, and the end of the agent's part in the session
	// once it has ignored that often enough.
	overBudget(a, type) {
		if (this.rateOk(a.slot, type)) return null;
		if (this.abusive(a.slot)) {
			this.endAgent(a, GONE_ABUSIVE);
			this.broadcastPresence();
			return json({ gone: GONE_ABUSIVE }, 410);
		}
		return json({ error: 'Too many messages too quickly. Wait a moment.' }, 429);
	}

	// What an agent is told on every ask. A pending agent learns nothing about
	// the room, exactly like a pending socket, which is sent no roster until the
	// host admits it.
	agentEnvelope(a, { withDoc }) {
		const out = { slot: a.slot, admitted: a.admitted, participants: [], chat: [], cursors: {} };
		if (!a.admitted) return out;
		const { participants } = this.roster();
		out.participants = participants;
		out.chat = this.inboxDrain(a.slot);
		const present = new Set(participants.map((p) => p.slot));
		for (const [slot, cursor] of this.cursors) {
			if (slot !== a.slot && present.has(slot)) out.cursors[slot] = cursor;
		}
		if (withDoc) out.doc = toBase64(Y.encodeStateAsUpdate(this.ydoc));
		return out;
	}

	async webSocketMessage(ws, message) {
		const bytes = typeof message === 'string' ? enc.encode(message) : new Uint8Array(message);
		if (bytes.length < 1) return;
		const s = this.state(ws);
		if (!s) return;
		const type = bytes[0];
		const payload = bytes.subarray(1);

		// Per-connection flood control for the relayed message types.
		if (type === T.UPDATE || type === T.CURSOR || type === T.CHAT) {
			if (!this.rateOk(s.slot, type)) {
				if (this.abusive(s.slot)) {
					try {
						ws.close(1008, 'Rate limit exceeded.');
					} catch {
						/* ignore */
					}
				}
				return; // drop the over-budget frame
			}
		}

		switch (type) {
			case T.UPDATE: {
				if (!s.admitted) return;
				if (payload.length > MAX_UPDATE_BYTES) return;
				this.applyUpdateFrom(s.slot, payload);
				break;
			}
			case T.CURSOR: {
				if (!s.admitted || payload.length > MAX_CURSOR_BYTES) return;
				// Stamp the sender's slot server-side so a peer can't spoof whose caret
				// it is, then relay to the other admitted peers.
				this.relay(s.slot, frameWithSlot(T.CURSOR, s.slot, payload), true);
				this.rememberCursor(s.slot, payload);
				break;
			}
			case T.CHAT: {
				if (!s.admitted || payload.length > MAX_CHAT_BYTES) return;
				this.relayChatFrom(s, payload);
				break;
			}
			case T.ADMIT: {
				if (!s.host || payload.length < 2) return;
				this.admit((payload[0] << 8) | payload[1]);
				break;
			}
			case T.REMOVE: {
				if (!s.host || payload.length < 2) return;
				this.removeBySlot((payload[0] << 8) | payload[1]);
				break;
			}
			default:
				break;
		}
	}

	// Relay a prepared frame to admitted sockets other than the sender.
	relay(senderSlot, frame, admittedOnly) {
		for (const ws of this.ctx.getWebSockets()) {
			const s = this.state(ws);
			if (!s || s.slot === senderSlot) continue;
			if (admittedOnly && !s.admitted) continue;
			this.send(ws, frame);
		}
	}

	// Host admitted a pending guest: flip them to admitted, hand them the lesson as
	// it stands, and refresh everyone's roster. For a socket the payload is the
	// room's whole Y.Doc encoded as one update, which the guest simply applies
	// through the same code path as any incremental edit. An agent is woken
	// instead, and gets the document on the ask that was waiting.
	admit(slot) {
		const ws = this.socketBySlot(slot);
		if (ws) {
			const s = this.state(ws);
			if (!s || s.admitted) return;
			s.admitted = true;
			ws.serializeAttachment(s);
			this.send(ws, frameBytes(T.ADMITTED, Y.encodeStateAsUpdate(this.ydoc)));
			this.broadcastPresence();
			return;
		}
		const a = this.agentBySlot(slot);
		if (!a || a.gone || a.admitted) return;
		a.admitted = true;
		a.lastSeen = Date.now();
		this.saveAgent(a);
		this.wakeAgent(a);
		this.broadcastPresence();
	}

	// Host declined a pending guest or removed a collaborator.
	removeBySlot(slot) {
		const ws = this.socketBySlot(slot);
		if (ws) {
			const s = this.state(ws);
			if (!s || s.host) return; // the host can't remove themselves this way
			this.send(ws, frameBytes(T.REMOVED, enc.encode(GONE_REMOVED)));
			try {
				ws.close(1000, 'removed');
			} catch {
				/* the close handler runs the cleanup either way */
			}
			return;
		}
		const a = this.agentBySlot(slot);
		if (!a || a.gone) return;
		this.endAgent(a, GONE_REMOVED);
		this.broadcastPresence();
	}

	async webSocketClose(ws) {
		await this.onGone(ws);
	}

	async webSocketError(ws) {
		await this.onGone(ws);
	}

	// A connection went away. Forget its rate-limit state; if the host left, end
	// the session for everyone and release the host's room slot; otherwise just
	// refresh presence.
	async onGone(ws) {
		const s = this.state(ws);
		if (s) {
			this.buckets.delete(s.slot);
			this.violations.delete(s.slot);
		}
		if (s && s.host) {
			const bye = frameBytes(T.REMOVED, enc.encode(GONE_HOST_LEFT));
			for (const other of this.ctx.getWebSockets()) {
				if (other === ws) continue;
				this.send(other, bye);
				try {
					other.close(1000, 'host left');
				} catch {
					/* ignore */
				}
			}
			// An agent has no socket to close; it finds out on its next ask.
			for (const a of this.liveAgents()) this.endAgent(a, GONE_HOST_LEFT);
			// The room dies with its host, so drop the cached lesson and start from a
			// clean CRDT — a later session reusing this object must not inherit the
			// previous one's document.
			this.ctx.storage.sql.exec("DELETE FROM room WHERE k = 'doc'");
			this.ctx.storage.sql.exec("DELETE FROM room WHERE k = 'cursors'");
			this.cursors.clear();
			this.ydoc = new Y.Doc();
			await this.releaseRoom(s.uid);
		} else {
			this.broadcastPresence();
		}
	}

	// Best-effort decrement of the host's concurrent-room counter that the Worker
	// incremented when the session was created.
	async releaseRoom(uid) {
		const kv = rateLimitStore(this.env);
		if (!uid || !kv) return;
		try {
			const key = `collab-rooms:${uid}`;
			const n = parseInt((await kv.get(key)) || '0', 10) || 0;
			if (n <= 1) await kv.delete(key);
			else await kv.put(key, String(n - 1), { expirationTtl: 7200 });
		} catch {
			/* best-effort; the TTL lets a stale count expire on its own */
		}
	}
}
