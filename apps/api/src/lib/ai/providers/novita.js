import { chatCompletion, firstModelThatAnswers, modelList } from './chatCompletions.js';

// Novita lists the same gpt-oss pair Groq does, and they are among the cheapest
// general-purpose models it hosts (checked 2026-10-06). Its catalogue turns over
// quickly, so re-check https://novita.ai/models/llm (or the public
// https://api.novita.ai/openai/v1/models) if this ever starts erroring.
const DEFAULT_MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];

const ENDPOINT = 'https://api.novita.ai/openai/v1/chat/completions';

export const id = 'novita';

export function isConfigured(env) {
	return Boolean(env.NOVITA_API_KEY);
}

export async function generate({ prompt, schema, env }) {
	return await firstModelThatAnswers(modelList(env.NOVITA_MODELS, DEFAULT_MODELS), (model) =>
		chatCompletion({
			endpoint: ENDPOINT,
			apiKey: env.NOVITA_API_KEY,
			model,
			prompt,
			schema,
			// Novita enforces `json_schema` only on the models it flags as supporting
			// structured outputs, and NOVITA_MODELS can name any of the hundred-odd
			// others. Same call as Groq: plain json_object mode, with the exact shape
			// described in the prompt, works on all of them.
			jsonMode: 'object',
			label: 'Novita',
		}),
	);
}
