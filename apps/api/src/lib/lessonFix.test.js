import { describe, it, expect } from 'vitest';
import { FIX_ATTEMPTS, FIX_SCHEMA, FixError, cleanFixDoc, findFinding, fixPrompt, suggestLessonFix } from './lessonFix.js';
import { fixContext } from '@spelling-creator/core/lessonAiFixes';
import { toGeminiSchema, toOpenAiStrictSchema } from './ai/jsonSchema.js';

// A section whose green answer isn't in its passage (E_GROUNDING_SINGLE).
function lesson() {
	return {
		title: 'Rivers',
		sections: [
			{
				id: 's1',
				name: 'Rivers',
				blocks: [
					{ id: 't1', type: 'text', text: 'A river carries SEDIMENT down to the sea.' },
					{ id: 'img', type: 'image', src: 'data:image/png;base64,AAAA' },
					{ id: 'q1', type: 'question', questionType: 'single', prompt: 'What does a river carry?', answer: 'gravel' },
				],
			},
		],
	};
}

const key = 'E_GROUNDING_SINGLE:q1:GRAVEL';

// A stand-in for generateWithFallback that answers with each reply in turn and
// remembers the prompts it was given.
function model(...replies) {
	const prompts = [];
	const generate = async ({ prompt }) => {
		prompts.push(prompt);
		const reply = replies[prompts.length - 1];
		return { text: typeof reply === 'string' ? reply : JSON.stringify(reply) };
	};
	return { generate, prompts };
}

const edit = (fields) => ({
	blockId: 'q1',
	text: '',
	words: [],
	questionType: '',
	prompt: '',
	answer: '',
	answers: [],
	steps: [],
	...fields,
});

describe('cleanFixDoc', () => {
	it('drops image data and refuses anything that is not a lesson', () => {
		expect(cleanFixDoc(null)).toBeNull();
		expect(cleanFixDoc({ sections: 'no' })).toBeNull();
		expect(cleanFixDoc(lesson()).sections[0].blocks[1]).toEqual({ id: 'img', type: 'image' });
	});
});

describe('findFinding', () => {
	it('finds the finding again by its key, with the validation pass it came from', () => {
		const { finding, validation } = findFinding(cleanFixDoc(lesson()), key);
		expect(finding.code).toBe('E_GROUNDING_SINGLE');
		// The pass is handed back so suggestLessonFix never reruns it on the
		// unchanged lesson.
		expect(validation.errors.some((f) => f.key === key)).toBe(true);
	});

	it('refuses a finding that has gone, or one a model does not fix', () => {
		const doc = cleanFixDoc(lesson());
		expect(() => findFinding(doc, 'E_GROUNDING_SINGLE:q1:SAND')).toThrow(FixError);
		// A one-section lesson is flagged, but no model call can fix that.
		expect(() => findFinding(doc, 'W_SECTION_COUNT:1')).toThrow(expect.objectContaining({ status: 400 }));
	});
});

describe('fixPrompt', () => {
	it('carries the section, the checker message and, on a retry, what went wrong', () => {
		const doc = cleanFixDoc(lesson());
		const { finding } = findFinding(doc, key);
		const context = fixContext(doc, finding);
		const first = fixPrompt({ title: doc.title, finding, context });
		expect(first).toContain('"gravel"');
		expect(first).toContain(finding.message);
		expect(first).not.toContain('not accepted');
		const retry = fixPrompt({ title: doc.title, finding, context, retry: { edits: [], problems: ['Still there.'] } });
		expect(retry).toContain('not accepted');
		expect(retry).toContain('- Still there.');
	});
});

describe('suggestLessonFix', () => {
	const run = (generate) => {
		const doc = cleanFixDoc(lesson());
		const { finding, validation } = findFinding(doc, key);
		return suggestLessonFix(doc, finding, { env: {}, generate, before: validation });
	};

	it('returns a fix that passes the checks', async () => {
		const { generate, prompts } = model({ explanation: 'Used the passage word.', edits: [edit({ answer: 'sediment' })] });
		const fix = await run(generate);
		expect(prompts).toHaveLength(1);
		expect(fix.explanation).toBe('Used the passage word.');
		expect(fix.operations).toEqual([
			{
				op: 'replace_block',
				blockId: 'q1',
				block: { type: 'question', questionType: 'single', prompt: 'What does a river carry?', answer: 'sediment' },
			},
		]);
	});

	it('asks again, saying why, when the first fix fails', async () => {
		const { generate, prompts } = model(
			{ explanation: '', edits: [edit({ answer: 'pebbles' })] },
			{ explanation: 'Fixed.', edits: [edit({ answer: 'sediment' })] },
		);
		const fix = await run(generate);
		expect(prompts).toHaveLength(2);
		expect(prompts[1]).toContain('not accepted');
		expect(fix.operations[0].block.answer).toBe('sediment');
	});

	it('gives up after its last try', async () => {
		const replies = Array.from({ length: FIX_ATTEMPTS }, () => 'not json');
		const { generate, prompts } = model(...replies);
		await expect(run(generate)).rejects.toMatchObject({ status: 422 });
		expect(prompts).toHaveLength(FIX_ATTEMPTS);
	});

	it('does not let a fix reach outside the section', async () => {
		const { generate } = model(
			{ explanation: '', edits: [edit({ blockId: 'img', text: 'x' })] },
			{ explanation: '', edits: [edit({ blockId: 'nowhere', answer: 'x' })] },
		);
		await expect(run(generate)).rejects.toMatchObject({ status: 422 });
	});
});

describe('FIX_SCHEMA', () => {
	it('converts for the providers that take a schema', () => {
		expect(toGeminiSchema(FIX_SCHEMA).properties.edits.items.properties.answers.type).toBe('ARRAY');
		expect(toOpenAiStrictSchema(FIX_SCHEMA).properties.edits.items.required).toContain('steps');
	});
});
