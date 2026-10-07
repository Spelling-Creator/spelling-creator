// CollabRoom, exercised as a real Durable Object in workerd.
//
// The point of running it for real (rather than unit-testing the message handler
// against fakes) is that the things most likely to break are runtime behaviours:
// that Yjs merges correctly inside the room, that the merged state survives in
// SQLite well enough to hand to a late joiner, and that an update from one peer
// actually reaches the others. None of that is observable from a mock.
//
// These drive the DO stub directly, which bypasses handleCollab's Supabase JWT
// gate. That's deliberate: authentication is the Worker's job, not the room's.

import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

// Frame types — must match T in collab-room.js.
const T = { HELLO: 0, UPDATE: 1, CURSOR: 2, CHAT: 3, PRESENCE: 4, ADMITTED: 5, ADMIT: 8, REMOVE: 9, EDITED: 10 };

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function frame(type, payload) {
	const b = new Uint8Array(1 + payload.length);
	b[0] = type;
	b.set(payload, 1);
	return b;
}

function slotFrame(type, slot) {
	const b = new Uint8Array(3);
	b[0] = type;
	b[1] = (slot >> 8) & 0xff;
	b[2] = slot & 0xff;
	return b;
}

// A connected participant: the socket, plus a queue so a test can await the next
// frame of a given type without racing the ones that arrive alongside it.
function participant(ws) {
	const queue = [];
	const waiting = [];
	ws.addEventListener('message', (ev) => {
		const bytes = new Uint8Array(ev.data);
		const next = waiting.shift();
		if (next) next(bytes);
		else queue.push(bytes);
	});

	const next = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => waiting.push(resolve)));

	return {
		send: (bytes) => ws.send(bytes),
		close: () => ws.close(1000, 'bye'),
		next,
		async nextOf(type) {
			for (;;) {
				const f = await next();
				if (f[0] === type) return f;
			}
		},
		// Wait for a roster that actually contains someone awaiting admission (the
		// host also receives a roster when it connects, and again for every change).
		async nextRequest() {
			for (;;) {
				const f = await this.nextOf(T.PRESENCE);
				const roster = JSON.parse(decoder.decode(f.subarray(1)));
				if (roster.requests?.length) return roster.requests[0];
			}
		},
	};
}

async function connect(code, { create = false, uid = 'u', name = 'User', email = 'u@school.org' } = {}) {
	const stub = env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(code));
	const res = await stub.fetch(`https://collab/${code}${create ? '?create=1' : ''}`, {
		headers: {
			Upgrade: 'websocket',
			'X-Collab-Uid': uid,
			'X-Collab-Name': encodeURIComponent(name),
			'X-Collab-Email': encodeURIComponent(email),
			'X-Collab-Avatar': '',
		},
	});
	return { status: res.status, ws: res.webSocket };
}

async function join(code, opts) {
	const { status, ws } = await connect(code, opts);
	expect(status).toBe(101);
	ws.accept();
	return participant(ws);
}

// A Y.Doc shaped like a lesson, plus a tap on the updates it produces so a test
// can ship them over the wire the way the client does.
function peer() {
	const ydoc = new Y.Doc();
	const outbox = [];
	ydoc.on('update', (update, origin) => {
		if (origin !== 'remote') outbox.push(update);
	});
	return { ydoc, outbox };
}

function seed(ydoc) {
	const lesson = ydoc.getMap('lesson');
	ydoc.transact(() => {
		lesson.set('title', 'Week 1');
		const blocks = new Y.Array();
		const b1 = new Y.Map();
		b1.set('id', 'b1');
		b1.set('text', 'one');
		const b2 = new Y.Map();
		b2.set('id', 'b2');
		b2.set('text', 'two');
		blocks.push([b1, b2]);
		lesson.set('blocks', blocks);
	});
}

const read = (ydoc) => ydoc.getMap('lesson').toJSON();

// Set a block's text, and return the update that change produced.
function edit(p, blockId, text) {
	p.outbox.length = 0;
	const blocks = p.ydoc.getMap('lesson').get('blocks');
	for (const block of blocks) {
		if (block.get('id') === blockId) block.set('text', text);
	}
	return p.outbox[p.outbox.length - 1];
}

describe('CollabRoom', () => {
	it('refuses a code nobody is hosting', async () => {
		const { status } = await connect('empty-room');
		expect(status).toBe(404);
	});

	it('hands a newly admitted guest the lesson the host seeded', async () => {
		const host = await join('room-seed', { create: true, uid: 'host' });
		const hello = await host.nextOf(T.HELLO);
		expect(hello[3]).toBe(1); // role byte: host

		const hostPeer = peer();
		seed(hostPeer.ydoc);
		host.send(frame(T.UPDATE, Y.encodeStateAsUpdate(hostPeer.ydoc)));

		const guest = await join('room-seed', { uid: 'guest', email: 'g@school.org' });
		await guest.nextOf(T.HELLO);

		const pending = await host.nextRequest();
		expect(pending.email).toBe('g@school.org');
		host.send(slotFrame(T.ADMIT, pending.slot));

		// The room merged the host's seed and handed the whole document over.
		const admitted = await guest.nextOf(T.ADMITTED);
		const guestPeer = peer();
		Y.applyUpdate(guestPeer.ydoc, admitted.subarray(1), 'remote');

		expect(read(guestPeer.ydoc)).toEqual({
			title: 'Week 1',
			blocks: [
				{ id: 'b1', text: 'one' },
				{ id: 'b2', text: 'two' },
			],
		});
	});

	it('merges concurrent edits to different blocks and relays them', async () => {
		// The behaviour the whole migration exists for: under the old whole-document
		// last-write-wins relay, one of these two edits was silently lost.
		const host = await join('room-merge', { create: true, uid: 'host' });
		await host.nextOf(T.HELLO);

		const hostPeer = peer();
		seed(hostPeer.ydoc);
		host.send(frame(T.UPDATE, Y.encodeStateAsUpdate(hostPeer.ydoc)));

		const guest = await join('room-merge', { uid: 'guest', email: 'g@school.org' });
		await guest.nextOf(T.HELLO);
		const pending = await host.nextRequest();
		host.send(slotFrame(T.ADMIT, pending.slot));

		const admitted = await guest.nextOf(T.ADMITTED);
		const guestPeer = peer();
		Y.applyUpdate(guestPeer.ydoc, admitted.subarray(1), 'remote');

		// Each edits a different block, neither having seen the other's change.
		const hostUpdate = edit(hostPeer, 'b1', 'host edited');
		const guestUpdate = edit(guestPeer, 'b2', 'guest edited');
		host.send(frame(T.UPDATE, hostUpdate));
		guest.send(frame(T.UPDATE, guestUpdate));

		// Each receives the other's update from the room and merges it.
		Y.applyUpdate(guestPeer.ydoc, (await guest.nextOf(T.UPDATE)).subarray(1), 'remote');
		Y.applyUpdate(hostPeer.ydoc, (await host.nextOf(T.UPDATE)).subarray(1), 'remote');

		const expected = {
			title: 'Week 1',
			blocks: [
				{ id: 'b1', text: 'host edited' },
				{ id: 'b2', text: 'guest edited' },
			],
		};
		expect(read(hostPeer.ydoc)).toEqual(expected);
		expect(read(guestPeer.ydoc)).toEqual(expected);
	});

	it('gives a guest admitted later every edit made before they arrived', async () => {
		// Exercises the room's own merged state, not a replay of relayed traffic: the
		// late guest was not connected when any of these edits happened.
		const host = await join('room-late', { create: true, uid: 'host' });
		await host.nextOf(T.HELLO);

		const hostPeer = peer();
		seed(hostPeer.ydoc);
		host.send(frame(T.UPDATE, Y.encodeStateAsUpdate(hostPeer.ydoc)));
		host.send(frame(T.UPDATE, edit(hostPeer, 'b1', 'edited before you joined')));

		const guest = await join('room-late', { uid: 'late', email: 'late@school.org' });
		await guest.nextOf(T.HELLO);
		const pending = await host.nextRequest();
		host.send(slotFrame(T.ADMIT, pending.slot));

		const admitted = await guest.nextOf(T.ADMITTED);
		const guestPeer = peer();
		Y.applyUpdate(guestPeer.ydoc, admitted.subarray(1), 'remote');

		expect(read(guestPeer.ydoc).blocks[0].text).toBe('edited before you joined');
	});

	it('says whose edit an update is, so version history can credit them', async () => {
		const host = await join('room-credit', { create: true, uid: 'host' });
		const hello = await host.nextOf(T.HELLO);
		const hostSlot = (hello[1] << 8) | hello[2];

		const hostPeer = peer();
		seed(hostPeer.ydoc);
		host.send(frame(T.UPDATE, Y.encodeStateAsUpdate(hostPeer.ydoc)));

		const guest = await join('room-credit', { uid: 'guest-uid', email: 'g@school.org' });
		await guest.nextOf(T.HELLO);
		const pending = await host.nextRequest();
		host.send(slotFrame(T.ADMIT, pending.slot));
		await guest.nextOf(T.ADMITTED);

		// The roster carries the account id, which is what a commit credits.
		for (;;) {
			const roster = JSON.parse(decoder.decode((await guest.nextOf(T.PRESENCE)).subarray(1)));
			if (roster.participants.length === 2) {
				expect(roster.participants.map((p) => p.uid).sort()).toEqual(['guest-uid', 'host']);
				break;
			}
		}

		// The room stamps the sender's slot on an EDITED frame just ahead of the update.
		const update = edit(hostPeer, 'b1', 'host edited');
		host.send(frame(T.UPDATE, update));
		const edited = await guest.nextOf(T.EDITED);
		expect((edited[1] << 8) | edited[2]).toBe(hostSlot);
		expect(edited.length).toBe(3);
		await guest.nextOf(T.UPDATE);

		// Sending the same update again changes nothing, so it is relayed but earns
		// no credit: the next frame is the bare UPDATE, and the EDITED after it
		// belongs to the real edit that follows.
		host.send(frame(T.UPDATE, update));
		host.send(frame(T.UPDATE, edit(hostPeer, 'b2', 'a real change')));
		const types = [];
		while (types.length < 3) {
			const f = await guest.next();
			if (f[0] === T.UPDATE || f[0] === T.EDITED) types.push(f[0]);
		}
		expect(types).toEqual([T.UPDATE, T.EDITED, T.UPDATE]);
	});
});

// ---- agents: participants with no socket -------------------------------------
//
// An AI assistant joins through the MCP server, which can't hold a connection
// between tool calls, so the room keeps it as a record and answers its asks over
// HTTP. These check that such a participant goes through the same admission as
// a socket, that what it is told matches what a socket would have been sent,
// and that it is let go the same ways.

const AGENT = {
	'X-Collab-Uid': 'agent-uid',
	'X-Collab-Name': encodeURIComponent('User · Claude'),
	'X-Collab-Email': encodeURIComponent('u@school.org'),
	'X-Collab-Avatar': '',
	'X-Collab-Bot': '1',
};

const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function agentJoin(code, headers = AGENT) {
	const stub = env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(code));
	const res = await stub.fetch(`https://collab/collab/${code}/agent`, { method: 'POST', headers });
	return { status: res.status, body: await res.json().catch(() => null) };
}

// The asks an admitted (or waiting) agent makes, each one request.
function agent(code, token, identity = AGENT) {
	const stub = env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(code));
	const headers = { ...identity, 'X-Collab-Agent': token };
	const base = `https://collab/collab/${code}/agent`;
	const answer = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });
	return {
		state: (wait) => stub.fetch(wait ? `${base}?wait=${wait}` : base, { headers }).then(answer),
		update: (bytes) =>
			stub
				.fetch(`${base}/update`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: bytes })
				.then(answer),
		chat: (text) =>
			stub
				.fetch(`${base}/chat`, {
					method: 'POST',
					headers: { ...headers, 'Content-Type': 'application/json' },
					body: JSON.stringify({ text }),
				})
				.then(answer),
		leave: () => stub.fetch(base, { method: 'DELETE', headers }).then(answer),
	};
}

// A hosted, seeded room with an agent admitted into it.
async function hostedWithAgent(code) {
	const host = await join(code, { create: true, uid: 'host' });
	const hello = await host.nextOf(T.HELLO);
	const hostSlot = (hello[1] << 8) | hello[2];
	const hostPeer = peer();
	seed(hostPeer.ydoc);
	host.send(frame(T.UPDATE, Y.encodeStateAsUpdate(hostPeer.ydoc)));

	const joined = await agentJoin(code);
	expect(joined.status).toBe(201);
	const pending = await host.nextRequest();
	host.send(slotFrame(T.ADMIT, pending.slot));
	const me = agent(code, joined.body.token);
	return { host, hostSlot, hostPeer, me, slot: joined.body.slot };
}

describe('CollabRoom agents', () => {
	it('tells an agent when nobody is hosting the code', async () => {
		const { status, body } = await agentJoin('agent-empty');
		expect(status).toBe(404);
		expect(body.error).toMatch(/not found/i);
	});

	it('still treats a session whose code is "agent" as a socket path', async () => {
		const stub = env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName('agent'));
		const res = await stub.fetch('https://collab/collab/agent', {
			headers: { Upgrade: 'websocket', 'X-Collab-Uid': 'u', 'X-Collab-Name': 'User', 'X-Collab-Email': '', 'X-Collab-Avatar': '' },
		});
		expect(res.status).toBe(404);
		expect(await res.text()).toBe('Session not found');
	});

	it('admits an agent the way it admits anyone, then hands it the lesson when it asks', async () => {
		const host = await join('agent-admit', { create: true, uid: 'host' });
		await host.nextOf(T.HELLO);
		const hostPeer = peer();
		seed(hostPeer.ydoc);
		host.send(frame(T.UPDATE, Y.encodeStateAsUpdate(hostPeer.ydoc)));

		const joined = await agentJoin('agent-admit');
		expect(joined.status).toBe(201);
		expect(joined.body.admitted).toBe(false);
		expect(joined.body.participants).toEqual([]); // a pending guest is told nothing
		expect(typeof joined.body.token).toBe('string');

		// The host sees the request, badged as an assistant, with the account id
		// version history will credit.
		const pending = await host.nextRequest();
		expect(pending.slot).toBe(joined.body.slot);
		expect(pending.bot).toBe(true);
		expect(pending.uid).toBe('agent-uid');
		expect(pending.name).toBe('User · Claude');

		const me = agent('agent-admit', joined.body.token);
		expect((await me.state()).body.admitted).toBe(false);

		host.send(slotFrame(T.ADMIT, pending.slot));

		const { status, body } = await me.state();
		expect(status).toBe(200);
		expect(body.admitted).toBe(true);
		expect(body.participants.map((p) => [p.uid, p.bot])).toEqual([
			['host', false],
			['agent-uid', true],
		]);
		const replica = new Y.Doc();
		Y.applyUpdate(replica, fromBase64(body.doc));
		expect(read(replica)).toEqual({
			title: 'Week 1',
			blocks: [
				{ id: 'b1', text: 'one' },
				{ id: 'b2', text: 'two' },
			],
		});
	});

	it('answers a waiting agent the moment the host admits it', async () => {
		const host = await join('agent-wait', { create: true, uid: 'host' });
		await host.nextOf(T.HELLO);
		const joined = await agentJoin('agent-wait');
		const me = agent('agent-wait', joined.body.token);

		const started = Date.now();
		const waiting = me.state(20);
		const pending = await host.nextRequest();
		host.send(slotFrame(T.ADMIT, pending.slot));

		const { body } = await waiting;
		expect(body.admitted).toBe(true);
		expect(Date.now() - started).toBeLessThan(5000);
	});

	it("relays an agent's edit to the host, credited to the agent's slot", async () => {
		const { host, hostPeer, me, slot } = await hostedWithAgent('agent-edit');
		const { body } = await me.state();

		// Edit on a replica of what the room sent, send only the difference.
		const replica = new Y.Doc();
		Y.applyUpdate(replica, fromBase64(body.doc));
		const before = Y.encodeStateVector(replica);
		for (const block of replica.getMap('lesson').get('blocks')) {
			if (block.get('id') === 'b2') block.set('text', 'agent edited');
		}
		const res = await me.update(Y.encodeStateAsUpdate(replica, before));
		expect(res.status).toBe(200);
		expect(res.body.changed).toBe(true);

		const edited = await host.nextOf(T.EDITED);
		expect((edited[1] << 8) | edited[2]).toBe(slot);
		Y.applyUpdate(hostPeer.ydoc, (await host.nextOf(T.UPDATE)).subarray(1), 'remote');
		expect(read(hostPeer.ydoc).blocks[1].text).toBe('agent edited');
	});

	it("keeps the host's chat and cursor for the agent's next ask, and relays the agent's chat", async () => {
		const { host, hostSlot, me, slot } = await hostedWithAgent('agent-chat');
		await me.state(); // drain the roster change

		host.send(frame(T.CHAT, encoder.encode(JSON.stringify({ text: 'Can you do section 2?', ts: 1700000000000 }))));
		host.send(frame(T.CURSOR, encoder.encode(JSON.stringify({ field: 'b1', start: 0, end: 0 }))));

		// The frames may land between two asks. Chat is drained by each ask, so it
		// is collected across them; the cursor is kept, so the latest ask has it.
		const chat = [];
		let body;
		for (let i = 0; i < 30; i++) {
			body = (await me.state()).body;
			chat.push(...body.chat);
			if (chat.length && body.cursors[hostSlot]) break;
			await new Promise((r) => setTimeout(r, 10));
		}
		expect(chat).toEqual([{ from: hostSlot, name: 'User', text: 'Can you do section 2?', ts: 1700000000000 }]);
		expect(body.cursors[hostSlot].field).toBe('b1');
		expect((await me.state()).body.chat).toEqual([]); // drained, not repeated

		const said = await me.chat('On it.');
		expect(said.status).toBe(200);
		const relayed = await host.nextOf(T.CHAT);
		expect((relayed[1] << 8) | relayed[2]).toBe(slot);
		expect(JSON.parse(decoder.decode(relayed.subarray(3))).text).toBe('On it.');
	});

	it('tells a removed agent why, once, then forgets it', async () => {
		const { host, me, slot } = await hostedWithAgent('agent-remove');
		await me.state();
		host.send(slotFrame(T.REMOVE, slot));

		let res;
		for (let i = 0; i < 20 && (!res || res.status === 200); i++) {
			res = await me.state();
			if (res.status === 200) await new Promise((r) => setTimeout(r, 10));
		}
		expect(res.status).toBe(410);
		expect(res.body.gone).toBe('removed');
		expect((await me.state()).status).toBe(404);
	});

	it('declines a pending agent the same way', async () => {
		const host = await join('agent-decline', { create: true, uid: 'host' });
		await host.nextOf(T.HELLO);
		const joined = await agentJoin('agent-decline');
		const pending = await host.nextRequest();
		host.send(slotFrame(T.REMOVE, pending.slot));

		const me = agent('agent-decline', joined.body.token);
		let res;
		for (let i = 0; i < 20 && (!res || res.status === 200); i++) {
			res = await me.state();
			if (res.status === 200) await new Promise((r) => setTimeout(r, 10));
		}
		expect(res.status).toBe(410);
		expect(res.body.gone).toBe('removed');
	});

	it("ends the agent's part when the host leaves", async () => {
		const { host, me } = await hostedWithAgent('agent-host-left');
		await me.state();
		host.close();

		let res;
		for (let i = 0; i < 50 && (!res || res.status === 200); i++) {
			res = await me.state();
			if (res.status === 200) await new Promise((r) => setTimeout(r, 20));
		}
		expect(res.status).toBe(410);
		expect(res.body.gone).toBe('The host ended the session.');
	});

	it("refuses another account's token, and an ask with no token", async () => {
		const { me, host } = await hostedWithAgent('agent-forbidden');
		await me.state();
		const joined = await agentJoin('agent-forbidden'); // a second agent, same account
		const other = agent('agent-forbidden', joined.body.token, { ...AGENT, 'X-Collab-Uid': 'somebody-else' });
		expect((await other.state()).status).toBe(403);
		expect((await agent('agent-forbidden', '').state()).status).toBe(404);
		void host;
	});

	it('answers a waiting ask at once when the agent leaves, not after the timeout', async () => {
		// A wait that outlived its record would otherwise sleep out its timeout
		// and then report on whatever the slot holds by then, which may be
		// somebody else's record.
		const host = await join('agent-leave-waiting', { create: true, uid: 'host' });
		await host.nextOf(T.HELLO);
		const joined = await agentJoin('agent-leave-waiting');
		const me = agent('agent-leave-waiting', joined.body.token);

		const started = Date.now();
		const waiting = me.state(20);
		await new Promise((r) => setTimeout(r, 20));
		expect((await me.leave()).body).toEqual({ left: true });

		const res = await waiting;
		expect(res.status).toBe(404);
		expect(Date.now() - started).toBeLessThan(5000);

		// The slot is reissued to a second agent, who is admitted; the first
		// agent's token learns nothing about it.
		const second = await agentJoin('agent-leave-waiting');
		expect(second.body.slot).toBe(joined.body.slot);
		const pending = await host.nextRequest();
		host.send(slotFrame(T.ADMIT, pending.slot));
		expect((await agent('agent-leave-waiting', second.body.token).state()).body.admitted).toBe(true);
		expect((await me.state()).status).toBe(404);
	});

	it('sweeps a request nobody answered, an agent that stopped asking, and the tombstones after them', async () => {
		const code = 'agent-sweep';
		const stub = env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(code));
		const host = await join(code, { create: true, uid: 'host' });
		await host.nextOf(T.HELLO);

		// One pending request the assistant keeps polling, one admitted agent.
		const pendingJoin = await agentJoin(code);
		const admittedJoin = await agentJoin(code, { ...AGENT, 'X-Collab-Uid': 'other-agent' });
		for (;;) {
			const roster = JSON.parse(decoder.decode((await host.nextOf(T.PRESENCE)).subarray(1)));
			if (roster.requests.length === 2) break;
		}
		host.send(slotFrame(T.ADMIT, admittedJoin.body.slot));
		const pendingAgent = agent(code, pendingJoin.body.token);
		const admittedAgent = agent(code, admittedJoin.body.token, { ...AGENT, 'X-Collab-Uid': 'other-agent' });
		expect((await admittedAgent.state()).body.admitted).toBe(true);

		// Joining armed the sweep. Nothing is old yet, so it lets everyone be,
		// and re-arms while records remain.
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		expect((await pendingAgent.state()).body.admitted).toBe(false);
		await runInDurableObject(stub, async (room) => {
			expect(await room.ctx.storage.getAlarm()).not.toBeNull();
		});

		// Six minutes on: the request was made too long ago, however recently it
		// was polled; the admitted agent has asked recently and stays.
		await runInDurableObject(stub, (room) => {
			for (const a of room.agents()) {
				a.joinedAt -= 6 * 60_000;
				a.lastSeen = Date.now();
				room.saveAgent(a);
			}
		});
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		let res = await pendingAgent.state();
		expect(res.status).toBe(410);
		expect(res.body.gone).toMatch(/nobody admitted/);
		expect((await admittedAgent.state()).body.admitted).toBe(true);

		// Half an hour of silence from the admitted agent, and it is let go too.
		await runInDurableObject(stub, (room) => {
			for (const a of room.agents()) {
				a.lastSeen -= 31 * 60_000;
				room.saveAgent(a);
			}
		});
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		res = await admittedAgent.state();
		expect(res.status).toBe(410);
		expect(res.body.gone).toMatch(/half an hour/);

		// Both asked, so both tombstones are already gone and nothing remains:
		// the sweep runs once more and does not re-arm.
		await runInDurableObject(stub, (room) => {
			expect(room.agents()).toEqual([]);
		});
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		await runInDurableObject(stub, async (room) => {
			expect(await room.ctx.storage.getAlarm()).toBeNull();
		});

		// A tombstone nobody asks about is swept after its own ttl.
		const late = await agentJoin(code);
		await runInDurableObject(stub, (room) => {
			for (const a of room.agents()) {
				a.joinedAt -= 6 * 60_000;
				room.saveAgent(a);
			}
		});
		expect(await runDurableObjectAlarm(stub)).toBe(true); // ends it
		await runInDurableObject(stub, (room) => {
			const [a] = room.agents();
			expect(a.gone).toMatch(/nobody admitted/);
			a.goneAt -= 11 * 60_000;
			room.saveAgent(a);
		});
		expect(await runDurableObjectAlarm(stub)).toBe(true); // forgets it
		expect((await agent(code, late.body.token).state()).status).toBe(404);
	});

	it('writes cursors down only while an admitted agent exists to read them', async () => {
		const code = 'agent-cursor-persist';
		const stub = env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(code));
		const host = await join(code, { create: true, uid: 'host' });
		const hello = await host.nextOf(T.HELLO);
		const hostSlot = (hello[1] << 8) | hello[2];
		const stored = () =>
			runInDurableObject(stub, (room) => {
				const rows = room.ctx.storage.sql.exec("SELECT v FROM room WHERE k = 'cursors'").toArray();
				return rows[0] ? JSON.parse(rows[0].v) : null;
			});

		// The teacher parks a caret before anyone else is here: remembered, not
		// written, since nobody can ask for it.
		host.send(frame(T.CURSOR, encoder.encode(JSON.stringify({ field: 'b1', start: 0, end: 0 }))));
		await new Promise((r) => setTimeout(r, 20));
		expect(await stored()).toBeNull();

		// A pending request is not a reader either.
		const joined = await agentJoin(code);
		const pending = await host.nextRequest();
		expect(await stored()).toBeNull();

		// Admission makes a reader, and the caret parked earlier is written down
		// at that moment, so it would survive an eviction before the first ask.
		host.send(slotFrame(T.ADMIT, pending.slot));
		const me = agent(code, joined.body.token);
		expect((await me.state()).body.cursors[hostSlot].field).toBe('b1');
		expect((await stored())[hostSlot].field).toBe('b1');

		// Leaving takes the last reader away, and the row with it.
		await me.leave();
		expect(await stored()).toBeNull();
	});

	it('frees the slot when an agent leaves', async () => {
		const { host, me } = await hostedWithAgent('agent-leave');
		await me.state();
		expect((await me.leave()).body).toEqual({ left: true });

		for (;;) {
			const roster = JSON.parse(decoder.decode((await host.nextOf(T.PRESENCE)).subarray(1)));
			if (roster.participants.length === 1) break;
		}
		expect((await me.state()).status).toBe(404);
	});
});
