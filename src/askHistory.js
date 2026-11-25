// Reply chains keep earlier tool calls so follow-ups ("а что по предметам?", "дай ссылку")
// can use real match_ids and numbers instead of guessing. This trims that history so it
// stays valid for the API and bounded in size.

const KEEP_TOOL_RESULTS = 6;
const STALE = JSON.stringify({ note: 'Результат устарел и убран из истории. Нужны эти данные — вызови функцию заново.' });
const ALWAYS_REFETCH = new Set(['get_chat_history']);

function compactHistory(messages) {
	const kept = [];
	for (let i = 0; i < messages.length; i++) {
		const m = messages[i];
		if (m.role === 'system' || m.role === 'user') {
			kept.push(m);
		} else if (m.role === 'assistant' && !m.tool_calls?.length) {
			if (typeof m.content === 'string') kept.push(m);
		} else if (m.role === 'assistant') {
			// A tool-call message is only valid when every call is answered right after it.
			const ids = m.tool_calls.map(tc => tc.id);
			const answers = [];
			let j = i + 1;
			while (j < messages.length && messages[j].role === 'tool') answers.push(messages[j++]);
			const complete = ids.every(id => answers.some(a => a.tool_call_id === id));
			if (complete) {
				const names = new Map(m.tool_calls.map(tc => [tc.id, tc.function?.name]));
				kept.push(m, ...answers.filter(a => names.has(a.tool_call_id)).map(a => ({ ...a, _tool: names.get(a.tool_call_id) })));
			}
			i = j - 1;
		}
	}

	let budget = KEEP_TOOL_RESULTS;
	for (let i = kept.length - 1; i >= 0; i--) {
		const m = kept[i];
		if (m.role !== 'tool') continue;
		const { _tool, ...clean } = m;
		kept[i] = ALWAYS_REFETCH.has(_tool) || budget-- <= 0 ? { ...clean, content: STALE } : clean;
	}
	return kept;
}

// Names of tools whose (non-stale) results are present in the conversation.
function toolsWithData(messages) {
	const names = new Map();
	for (const m of messages) {
		if (m.role === 'assistant') for (const tc of m.tool_calls || []) names.set(tc.id, tc.function?.name);
	}
	return [...new Set(messages
		.filter(m => m.role === 'tool' && m.content !== STALE && names.has(m.tool_call_id))
		.map(m => names.get(m.tool_call_id)))];
}

module.exports = { compactHistory, toolsWithData, KEEP_TOOL_RESULTS, STALE };
