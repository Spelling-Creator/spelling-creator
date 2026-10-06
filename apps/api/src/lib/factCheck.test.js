import { describe, it, expect } from 'vitest';
import { FACT_PROPERTY_KEYS } from '@spelling-creator/core/factCheck';
import { FACT_CLAIMS_SCHEMA, MAX_PASSAGES, cleanPassages, factCheckPrompt, placeClaims } from './factCheck.js';
import { toGeminiSchema } from './ai/jsonSchema.js';

const passages = [
	{ blockId: 'a', text: 'MOUNT EVEREST is 8,849 METRES tall.' },
	{ blockId: 'b', text: 'The NILE flows for about 6,650   km.' },
];

describe('cleanPassages', () => {
	it('keeps non-empty text and caps how many', () => {
		expect(cleanPassages(null)).toEqual([]);
		expect(cleanPassages([{ blockId: 'x', text: '  ' }, { text: 'Hi' }])).toEqual([{ blockId: '', text: 'Hi' }]);
		const many = Array.from({ length: MAX_PASSAGES + 5 }, (_, i) => ({ blockId: String(i), text: 'x' }));
		expect(cleanPassages(many)).toHaveLength(MAX_PASSAGES);
	});
});

describe('placeClaims', () => {
	it('keeps a claim whose quote is in its passage, ignoring case and spacing', () => {
		const [claim] = placeClaims([{ passage: 2, quote: 'about 6,650 KM', unit: 'km' }], passages);
		expect(claim).toMatchObject({ passage: 1, unit: 'km' });
	});

	it('moves a claim the model numbered wrong, and drops one quoted from nowhere', () => {
		const placed = placeClaims(
			[
				{ passage: 2, quote: '8,849 METRES', unit: 'm' },
				{ passage: 1, quote: '9,000 METRES', unit: 'm' },
			],
			passages,
		);
		expect(placed).toEqual([{ passage: 0, quote: '8,849 METRES', unit: 'm' }]);
	});

	it('turns the "none" unit back into no unit', () => {
		const [claim] = placeClaims([{ passage: 1, quote: '8,849', unit: 'none' }], passages);
		expect(claim.unit).toBe('');
	});
});

describe('the extraction request', () => {
	it('numbers the passages and offers every property', () => {
		const prompt = factCheckPrompt(passages, 'Big Things');
		expect(prompt).toContain('[1]\nMOUNT EVEREST');
		expect(prompt).toContain('[2]\nThe NILE');
		expect(prompt).toContain('"Big Things"');
		// A named fact's name goes in "stated".
		expect(prompt).toContain('"stated"');
		for (const key of FACT_PROPERTY_KEYS) expect(prompt).toContain(`- ${key}:`);
	});

	it('has no empty enum value, which not every provider accepts', () => {
		const item = FACT_CLAIMS_SCHEMA.properties.claims.items;
		expect(item.properties.unit.enum).not.toContain('');
		expect(item.properties.unit.enum).toContain('none');
		// Every field is required, as OpenAI's strict mode demands.
		expect(item.required.sort()).toEqual(Object.keys(item.properties).sort());
		expect(toGeminiSchema(FACT_CLAIMS_SCHEMA).properties.claims.items.properties.passage.type).toBe('INTEGER');
	});
});
