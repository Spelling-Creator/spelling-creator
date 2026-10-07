import { chatCompletion, firstModelThatAnswers, modelList } from './chatCompletions.js';

// OpenRouter lists the same gpt-oss pair Groq and Novita do, under the same ids,
// and they are among the cheapest general-purpose models it routes to (checked
// 2026-10-07 against the public https://openrouter.ai/api/v1/models). Re-check
// that list if this ever starts erroring.
const DEFAULT_MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export const id = 'openrouter';

export function isConfigured(env) {
	return Boolean(env.OPENROUTER_API_KEY);
}

export async function generate({ prompt, schema, env }) {
	return await firstModelThatAnswers(modelList(env.OPENROUTER_MODELS, DEFAULT_MODELS), (model) =>
		chatCompletion({
			endpoint: ENDPOINT,
			apiKey: env.OPENROUTER_API_KEY,
			model,
			prompt,
			schema,
			// OpenRouter routes each request to one of several upstream hosts, and
			// whether `json_schema` is enforced depends on which one it picks and on
			// which of its hundreds of models OPENROUTER_MODELS names. json_object
			// with the shape in the prompt still works when a host ignores it.
			jsonMode: 'object',
			label: 'OpenRouter',
		}),
	);
}
