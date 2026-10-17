// PracticeRoom, exercised as a real Durable Object in workerd.
//
// The room is the hub side of the letterboard contract (docs/live-sync.md in the
// board's repository): a Practice page hosts, letterboards follow. What these
// check is the contract as a board would see it: what a late board is told, what
// reaches the host and in what shape, and how a session ends.
//
// These drive the DO stub directly, which bypasses handlePractice's JWT gate and
// join limits. That's deliberate: who may be the host is the Worker's job, not
// the room's; the room trusts the role header the Worker sets.

import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// A connected participant: the socket, plus a queue so a test can await the next
// message of a given type without racing the ones that arrive alongside it.
function participant(ws) {
	const queue = [];
	const waiting = [];
	let closed = null;
	const closeWaiters = [];
	ws.addEventListener('message', (ev) => {
		const msg = JSON.parse(ev.data);
		const next = waiting.shift();
		if (next) next(msg);
		else queue.push(msg);
	});
	ws.addEventListener('close', (ev) => {
		closed = { code: ev.code, reason: ev.reason };
		for (const resolve of closeWaiters.splice(0)) resolve(closed);
	});

	const next = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => waiting.push(resolve)));

	return {
		send: (msg) => ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)),
		close: () => ws.close(1000, 'bye'),
		next,
		async nextOf(type) {
			for (;;) {
				const m = await next();
				if (m.type === type) return m;
			}
		},
		closedWith: () => (closed ? Promise.resolve(closed) : new Promise((resolve) => closeWaiters.push(resolve))),
	};
}

async function connect(code, role) {
	const stub = env.PRACTICE_ROOM.get(env.PRACTICE_ROOM.idFromName(code));
	const res = await stub.fetch(`https://hub/practice/${code}`, {
		headers: { Upgrade: 'websocket', 'X-Practice-Role': role },
	});
	return { status: res.status, ws: res.webSocket };
}

async function join(code, role) {
	const { status, ws } = await connect(code, role);
	expect(status).toBe(101);
	ws.accept();
	return participant(ws);
}

// The state row as stored, or undefined when there is none.
const storedState = (code) =>
	runInDurableObject(env.PRACTICE_ROOM.get(env.PRACTICE_ROOM.idFromName(code)), (room) => {
		const row = room.ctx.storage.sql.exec("SELECT v FROM room WHERE k = 'state'").toArray()[0];
		return row ? JSON.parse(row.v) : undefined;
	});

describe('PracticeRoom', () => {
	it('tells a board, over its own socket, when nobody is hosting the code', async () => {
		// A refusal arrives as an `error` message rather than an HTTP status: a
		// board only ever sees the latter as a connection that failed, with no
		// way to say why.
		const board = await join('empty', 'board');
		expect(await board.next()).toEqual({ type: 'error', message: expect.stringMatching(/No session with that code/) });
		expect((await board.closedWith()).code).toBe(1008);
	});

	it('refuses a second host', async () => {
		const host = await join('two-hosts', 'host');
		expect(await host.nextOf('hello')).toEqual({ type: 'hello', boards: 0 });
		const { status } = await connect('two-hosts', 'host');
		expect(status).toBe(409);
	});

	it('catches a late board up with the last state, and counts it for the host', async () => {
		const host = await join('late-board', 'host');
		await host.nextOf('hello');
		host.send({ type: 'state', lessonId: 'lesson-1', step: 3, text: 'the ca' });

		// Kept in storage, not memory, so it survives an eviction.
		for (let i = 0; i < 50 && !(await storedState('late-board')); i++) await new Promise((r) => setTimeout(r, 10));
		expect(await storedState('late-board')).toEqual({ lessonId: 'lesson-1', step: 3, text: 'the ca' });

		const board = await join('late-board', 'board');
		expect(await board.nextOf('hello')).toEqual({ type: 'hello', lessonId: 'lesson-1', step: 3, text: 'the ca' });
		expect(await host.nextOf('boards')).toEqual({ type: 'boards', count: 1 });

		board.close();
		expect(await host.nextOf('boards')).toEqual({ type: 'boards', count: 0 });
	});

	it('says what is open before any lesson is, and keeps only the fields the host sent', async () => {
		const host = await join('no-lesson', 'host');
		await host.nextOf('hello');
		const early = await join('no-lesson', 'board');
		// No lessonId: the board shows "waiting for the host".
		expect(await early.nextOf('hello')).toEqual({ type: 'hello' });

		// A state with only a step doesn't clear a sentence by carrying text: "".
		host.send({ type: 'state', step: 2, extra: 'dropped' });
		expect(await early.nextOf('state')).toEqual({ type: 'state', step: 2 });
	});

	it('broadcasts state to every board, and relays a board to the host only, rebuilt', async () => {
		const host = await join('relay', 'host');
		await host.nextOf('hello');
		const one = await join('relay', 'board');
		const two = await join('relay', 'board');
		await one.nextOf('hello');
		await two.nextOf('hello');
		// Each arrival is counted for the host before any board speaks.
		await host.nextOf('boards');
		expect(await host.nextOf('boards')).toEqual({ type: 'boards', count: 2 });

		host.send({ type: 'state', lessonId: 'lesson-2', step: 0, text: '' });
		expect(await one.nextOf('state')).toEqual({ type: 'state', lessonId: 'lesson-2', step: 0, text: '' });
		expect(await two.nextOf('state')).toEqual({ type: 'state', lessonId: 'lesson-2', step: 0, text: '' });

		// Each board message reaches the host as the one field the contract lists,
		// and nothing else that was sent.
		one.send({ type: 'text', text: 'd', smuggled: true });
		expect(await host.next()).toEqual({ type: 'text', text: 'd' });
		one.send({ type: 'answer', text: 'dog' });
		expect(await host.next()).toEqual({ type: 'answer', text: 'dog' });
		one.send({ type: 'step', step: 1 });
		expect(await host.next()).toEqual({ type: 'step', step: 1 });

		// The other board heard none of that: the next thing it gets is the
		// host's next state.
		host.send({ type: 'state', lessonId: 'lesson-2', step: 1, text: '' });
		expect(await two.next()).toEqual({ type: 'state', lessonId: 'lesson-2', step: 1, text: '' });
	});

	it('drops what is malformed, unknown or out of range, and caps a long text', async () => {
		const host = await join('junk', 'host');
		await host.nextOf('hello');
		const board = await join('junk', 'board');
		await board.nextOf('hello');
		await host.nextOf('boards');

		board.send('not json');
		board.send({ type: 'bogus', text: 'x' });
		board.send({ type: 'step', step: -1 });
		board.send({ type: 'step', step: 1.5 });
		board.send({ type: 'step', step: '2' });
		board.send({ type: 'text', text: 42 });
		board.send({ type: 'join', client: 'board' });
		board.send({ type: 'text', text: 'a'.repeat(6000) });

		const got = await host.next();
		expect(got.type).toBe('text');
		expect(got.text.length).toBe(5000);
	});

	it('ends the session for every board when the host leaves, and forgets the state', async () => {
		const host = await join('host-leaves', 'host');
		await host.nextOf('hello');
		host.send({ type: 'state', lessonId: 'lesson-3', step: 1 });
		const board = await join('host-leaves', 'board');
		await board.nextOf('hello');

		host.close();
		expect(await board.nextOf('removed')).toEqual({ type: 'removed', message: 'The host ended the session.' });
		expect((await board.closedWith()).code).toBe(1000);

		for (let i = 0; i < 50 && (await storedState('host-leaves')); i++) await new Promise((r) => setTimeout(r, 10));
		expect(await storedState('host-leaves')).toBeUndefined();

		// The code is dead until somebody hosts it again.
		const late = await join('host-leaves', 'board');
		expect((await late.next()).type).toBe('error');
	});

	it('refuses a board past the limit without counting it', async () => {
		const code = 'full';
		const host = await join(code, 'host');
		await host.nextOf('hello');
		const boards = [];
		for (let i = 0; i < 10; i++) {
			const board = await join(code, 'board');
			await board.nextOf('hello');
			boards.push(board);
		}
		for (let n = 0; n < 10; n++) await host.nextOf('boards');

		const extra = await join(code, 'board');
		expect(await extra.next()).toEqual({ type: 'error', message: 'This session is full.' });

		// The refused socket may still be closing, and must not be counted either
		// way: one board leaving is reported as nine, not ten.
		const stub = env.PRACTICE_ROOM.get(env.PRACTICE_ROOM.idFromName(code));
		expect(await runInDurableObject(stub, (room) => room.boards().length)).toBe(10);
		boards[0].close();
		expect(await host.nextOf('boards')).toEqual({ type: 'boards', count: 9 });
	});

	it('stops counting or addressing the boards of a host who left', async () => {
		const code = 'left-behind';
		const stub = env.PRACTICE_ROOM.get(env.PRACTICE_ROOM.idFromName(code));
		const host = await join(code, 'host');
		await host.nextOf('hello');
		const board = await join(code, 'board');
		await board.nextOf('hello');

		host.close();
		await board.nextOf('removed');
		// Marked on its way out the moment the host went, however long its own
		// close takes, so a new host taking the code over meanwhile never has it.
		expect(await runInDurableObject(stub, (room) => room.boards().length)).toBe(0);
		const next = await join(code, 'host');
		expect(await next.nextOf('hello')).toEqual({ type: 'hello', boards: 0 });
	});

	it('budgets messages of no known type, and closes a board that floods them', async () => {
		const host = await join('flood', 'host');
		await host.nextOf('hello');
		const board = await join('flood', 'board');
		await board.nextOf('hello');
		for (let i = 0; i < 150; i++) board.send(i % 2 ? 'not json' : { type: 'made-up' });
		expect((await board.closedWith()).code).toBe(1008);
	});

	it('starts a new session in a used object clean', async () => {
		const first = await join('reused', 'host');
		await first.nextOf('hello');
		first.send({ type: 'state', lessonId: 'old-lesson', step: 5, text: 'old' });
		for (let i = 0; i < 50 && !(await storedState('reused')); i++) await new Promise((r) => setTimeout(r, 10));
		first.close();
		await new Promise((r) => setTimeout(r, 20));

		const second = await join('reused', 'host');
		await second.nextOf('hello');
		const board = await join('reused', 'board');
		expect(await board.nextOf('hello')).toEqual({ type: 'hello' });
	});
});
