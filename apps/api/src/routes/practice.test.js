// The share code in a letterboard session path (parsePracticeCode in practice.js).
//
// The code is the only thing that identifies a session, so the parse has to hold
// it to the collaboration rule, and to fold case: the Practice page shows a code
// in capitals and a partner typing it on a tablet may not.

import { describe, expect, it } from 'vitest';

import { handlePracticeInfo, parsePracticeCode } from './practice.js';

describe('handlePracticeInfo', () => {
	it('says whether this hub can host letterboard sessions', async () => {
		expect(await handlePracticeInfo({ PRACTICE_ROOM: {} }, {}).json()).toEqual({ available: true });
		expect(await handlePracticeInfo({}, {}).json()).toEqual({ available: false });
	});
});

describe('parsePracticeCode', () => {
	it('reads the code from the session path, in capitals', () => {
		expect(parsePracticeCode('/practice/K7PM2X')).toBe('K7PM2X');
		expect(parsePracticeCode('/practice/k7pm2x')).toBe('K7PM2X');
		expect(parsePracticeCode('/practice/k7pm2x/')).toBe('K7PM2X');
	});

	it('is only the session path', () => {
		expect(parsePracticeCode('/practice')).toBeNull();
		expect(parsePracticeCode('/practice/')).toBeNull();
		expect(parsePracticeCode('/practice/abc/agent')).toBeNull();
		expect(parsePracticeCode('/collab/abc')).toBeNull();
	});

	it('holds the code to the characters the collaboration path allows', () => {
		expect(parsePracticeCode('/practice/has%20space')).toBeNull();
		expect(parsePracticeCode('/practice/%E2%9C%93')).toBeNull();
		expect(parsePracticeCode(`/practice/${'a'.repeat(129)}`)).toBeNull();
		expect(parsePracticeCode('/practice/%ZZ')).toBeNull();
	});
});
