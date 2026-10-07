// The Worker's half of an AI fix: asking a model to fix one lesson check finding.
//
// The editor sends the lesson and the key of the finding to fix. The finding is
// looked up again here, from the lesson, rather than taken from the request, so
// the prompt is built from the checker's own words. What the model may change,
// and whether its fix is any good, is decided by
// @spelling-creator/core/lessonAiFixes, which the editor runs too.
//
// A fix is only returned once it passes checkFix: the finding is gone, and the
// fix caused no problem of its own and dropped no footnote. If the first try
// fails, the model is told why and asked once more. Two tries cost two model
// calls but one rate-limit token, since the author asked for one fix.

import { validateLesson } from '@spelling-creator/core/lessonChecks';
import { aiEditsToOperations, checkFix, fixContext, hasAiFix } from '@spelling-creator/core/lessonAiFixes';
import { generateWithFallback } from './ai/index.js';

/** How many times the model is asked before the Worker gives up. */
export const FIX_ATTEMPTS = 2;

/** The largest lesson, as JSON, a fix request may carry. */
export const MAX_FIX_DOC_CHARS = 300000;

const STRINGS = { type: 'array', items: { type: 'string' } };

// Every field is required because strict structured output (OpenAI's) insists
// on it; an empty string or list means "keep this as it is" (see
// aiEditsToOperations).
export const FIX_SCHEMA = {
	type: 'object',
	properties: {
		explanation: { type: 'string' },
		edits: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					blockId: { type: 'string' },
					text: { type: 'string' },
					words: STRINGS,
					questionType: { type: 'string' },
					prompt: { type: 'string' },
					answer: { type: 'string' },
					answers: STRINGS,
					steps: STRINGS,
				},
				required: ['blockId', 'text', 'words', 'questionType', 'prompt', 'answer', 'answers', 'steps'],
				additionalProperties: false,
			},
		},
	},
	required: ['explanation', 'edits'],
	additionalProperties: false,
};

/** Why a fix couldn't be made, with the HTTP status the route answers with. */
export class FixError extends Error {
	constructor(message, status) {
		super(message);
		this.status = status;
	}
}

/**
 * The lesson in a request, reduced to what the checks read. Image blocks keep
 * only their id and type: an old lesson can still hold an image inline as a
 * data URL, and nothing here looks at it.
 * @param {unknown} doc
 * @returns {{ title: string, sources: any[], sections: any[] }|null}
 */
export function cleanFixDoc(doc) {
	if (!doc || typeof doc !== 'object' || !Array.isArray(doc.sections)) return null;
	return {
		title: typeof doc.title === 'string' ? doc.title : '',
		sources: Array.isArray(doc.sources) ? doc.sources : [],
		sections: doc.sections
			.filter((s) => s && typeof s === 'object')
			.map((s) => ({
				id: s.id,
				name: s.name,
				blocks: (Array.isArray(s.blocks) ? s.blocks : []).map((b) => (b?.type === 'image' ? { id: b.id, type: 'image' } : b)),
			})),
	};
}

/**
 * The finding a request asks about, found again in the lesson.
 * @throws {FixError} when it isn't there any more, or isn't one a model fixes.
 */
export function findFinding(doc, key) {
	const { errors, warnings } = validateLesson(doc);
	const finding = [...errors, ...warnings].find((f) => f.key === key);
	if (!finding) throw new FixError('That problem is no longer in the lesson.', 409);
	if (!hasAiFix(finding)) throw new FixError("That problem can't be fixed with AI.", 400);
	return finding;
}

/**
 * The prompt for one try. `retry` carries the last try's edits and what was
 * wrong with them.
 */
export function fixPrompt({ title, finding, context, retry }) {
	const section = context.sectionName ? `section ${context.sectionNumber}, "${context.sectionName}"` : `section ${context.sectionNumber}`;
	const used = context.usedElsewhere.length ? context.usedElsewhere.map((w) => `"${w}"`).join(', ') : '(none)';
	const lines = [
		'You are fixing one problem in a lesson for Spelling to Communicate (S2C). A nonspeaking speller listens to the passage read aloud, then answers each question by pointing to letters on a letterboard, so every answer must be short and exact.',
		'',
		`The lesson is titled "${title || 'Untitled'}". Here is ${section}, block by block:`,
		JSON.stringify(context.blocks, null, 2),
		'',
		'The problem the lesson checker found:',
		finding.message,
		'',
		'How these lessons work:',
		'- Text blocks are the passage. Words in ALL CAPS are the learning vocabulary. Text uses a small markup: **bold**, *italic*, <u>underline</u>, and footnotes written ^[...].',
		'- "single" (green): one answer that appears word for word in the passage.',
		'- "number" (purple): a numeric answer. With no "steps" it is a number the passage states. With "steps" it is a word problem, and "steps" is its worked solution, one step per item.',
		'- "multiple" (orange): the prompt quotes a sentence of the passage with its list blanked out as ______, and "answers" is every item of that one list, each a single word the passage uses.',
		'- "multiple_open" (orange): asks for something the speller supplies, like a synonym. Its "answers" are suggestions, not held to the passage.',
		'- "background" (blue): needs knowledge the passage does not give, so its answer must not be in the passage.',
		'- "open" (pink), "paraphrase" and "wyr" have no stored answer. A "wyr" prompt reads "Would you rather A or B?".',
		'- Spelling words are 6 to 9 letters, are not ALL-CAPS words from the passage, and never appear inside any answer.',
		'- No prompt may contain a word that another question in the section expects as its answer.',
		`- These are spelling words or answers elsewhere in the lesson, so do not use any of them as a new spelling word or answer: ${used}`,
		'',
		'Rules for your fix:',
		'- Fix this one problem and change as little as you can. Usually that means changing only the block the problem is about.',
		'- Never change a fact, number, date or name. If the passage has to change, keep its facts, its other sentences and every ^[...] footnote exactly as they are, and add or reword only what the fix needs.',
		'- Only blocks with "editable": true can change.',
		'- Write plain, natural English. Do not use em dashes.',
		'',
		'Reply with JSON. "explanation" is one or two sentences for the lesson\'s author saying what you changed and why. "edits" lists each block you change, naming it by its "id" in "blockId". In an edit, fill in only the fields you change and leave every other field as "" or []: "text" for a text block (the whole new text), "words" for a spelling block (the whole new list), and for a question "questionType" (only to change its type), "prompt", "answer", "answers" (the whole new list) and "steps" (the whole new list).',
	];
	if (retry) {
		lines.push(
			'',
			'Your last fix was not accepted:',
			JSON.stringify(retry.edits),
			'What was wrong with it:',
			...retry.problems.map((p) => `- ${p}`),
			'Try again with a different fix.',
		);
	}
	return lines.join('\n');
}

/**
 * Ask the model for a fix, check it, and ask once more if it fails.
 * @param {object} doc      From cleanFixDoc.
 * @param {object} finding  From findFinding.
 * @returns {Promise<{ operations: any[], explanation: string, newWarnings: number }>}
 * @throws {FixError} 422 when no try passed; an upstream error when no AI
 *   provider answered.
 */
export async function suggestLessonFix(doc, finding, { env, generate = generateWithFallback }) {
	const context = fixContext(doc, finding);
	if (!context) throw new FixError('That section is no longer in the lesson.', 409);
	let retry = null;
	for (let attempt = 0; attempt < FIX_ATTEMPTS; attempt += 1) {
		const response = await generate({
			prompt: fixPrompt({ title: doc.title, finding, context, retry }),
			schema: FIX_SCHEMA,
			env,
		});
		let parsed;
		try {
			parsed = JSON.parse(response.text);
		} catch {
			retry = { edits: [], problems: ['The reply was not valid JSON.'] };
			continue;
		}
		const edits = Array.isArray(parsed?.edits) ? parsed.edits : [];
		let operations;
		try {
			operations = aiEditsToOperations(doc, finding, edits);
		} catch (err) {
			retry = { edits, problems: [err.message] };
			continue;
		}
		const result = checkFix(doc, operations, finding);
		if (result.ok) {
			return {
				operations,
				explanation: typeof parsed.explanation === 'string' ? parsed.explanation.trim() : '',
				newWarnings: result.newWarnings.length,
			};
		}
		retry = { edits, problems: result.problems };
	}
	throw new FixError('No fix passed the lesson checks. Try again, or fix it by hand.', 422);
}
