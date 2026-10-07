import { chatCompletion, firstModelThatAnswers, modelList } from './chatCompletions.js';

// Fireworks serves gpt-oss-120b serverless but not the 20b (that one is
// on-demand deployments only), so it can't share the Groq/Novita default pair.
// glm-5p3-flash is the other cheap general-purpose serverless model (checked
// 2026-10-07). Re-check https://fireworks.ai/models if this ever starts
// erroring, since the serverless lineup turns over.
const DEFAULT_MODELS = ['accounts/fireworks/models/gpt-oss-120b', 'accounts/fireworks/models/glm-5p3-flash'];

const ENDPOINT = 'https://api.fireworks.ai/inference/v1/chat/completions';

export const id = 'fireworks';

export function isConfigured(env) {
	return Boolean(env.FIREWORKS_API_KEY);
}

export async function generate({ prompt, schema, env }) {
	return await firstModelThatAnswers(modelList(env.FIREWORKS_MODELS, DEFAULT_MODELS), (model) =>
		chatCompletion({
			endpoint: ENDPOINT,
			apiKey: env.FIREWORKS_API_KEY,
			model,
			prompt,
			schema,
			// Fireworks accepts `json_schema`, but how well a model copes with
			// constrained decoding varies (reasoning models especially), and
			// FIREWORKS_MODELS can name any of them. Same call as Groq and Novita:
			// json_object mode, with the exact shape described in the prompt.
			jsonMode: 'object',
			label: 'Fireworks',
		}),
	);
}
