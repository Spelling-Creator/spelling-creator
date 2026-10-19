// The one input on a lesson save that is a URL somebody else's server will be
// shown: where a remote fork came from. It is dropped rather than refused when
// it is not one, like a bad `forkedFrom`, so this pins down what counts.

import { describe, expect, it } from 'vitest';

import { forkedFromUrlOf, rowToLesson } from './lesson.js';

describe('forkedFromUrlOf', () => {
	it('keeps a web address, trimmed and normalized', () => {
		expect(forkedFromUrlOf(' https://other.example/hub/abc ')).toBe('https://other.example/hub/abc');
		expect(forkedFromUrlOf('http://localhost:8787/hub/abc')).toBe('http://localhost:8787/hub/abc');
	});

	it('drops anything that is not one', () => {
		expect(forkedFromUrlOf(undefined)).toBeNull();
		expect(forkedFromUrlOf('')).toBeNull();
		expect(forkedFromUrlOf('other.example/hub/abc')).toBeNull();
		expect(forkedFromUrlOf('javascript:alert(1)')).toBeNull();
		expect(forkedFromUrlOf('ftp://other.example/x')).toBeNull();
		expect(forkedFromUrlOf(`https://other.example/${'a'.repeat(2048)}`)).toBeNull();
		expect(forkedFromUrlOf(42)).toBeNull();
	});
});

describe('rowToLesson', () => {
	it('carries both pointers home, null when absent', () => {
		const lesson = rowToLesson({ id: 'x', author_id: 'a', title: 't', forked_from_url: 'https://other.example/hub/y' });
		expect(lesson.forkedFrom).toBeNull();
		expect(lesson.forkedFromUrl).toBe('https://other.example/hub/y');
		expect(rowToLesson({ id: 'x', author_id: 'a', title: 't' }).forkedFromUrl).toBeNull();
	});
});
