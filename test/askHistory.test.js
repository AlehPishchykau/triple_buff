const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { compactHistory, toolsWithData, KEEP_TOOL_RESULTS, STALE } = require('../src/askHistory');

const call = (id, name) => ({ id, type: 'function', function: { name, arguments: '{}' } });
const toolMsg = (id, content = '{"ok":1}') => ({ role: 'tool', tool_call_id: id, content });

describe('askHistory', () => {
	it('keeps tool calls together with their results', () => {
		const history = [
			{ role: 'system', content: 'sys' },
			{ role: 'user', content: 'q' },
			{ role: 'assistant', content: null, tool_calls: [call('a', 'get_match_details')] },
			toolMsg('a', '{"match_id":1}'),
			{ role: 'assistant', content: 'answer' },
		];
		const out = compactHistory(history);
		assert.equal(out.length, 5);
		assert.equal(out[3].content, '{"match_id":1}');
		assert.equal(out[3]._tool, undefined);
		assert.deepEqual(toolsWithData(out), ['get_match_details']);
	});

	it('drops a tool call whose result is missing, so the API never sees a dangling call', () => {
		const out = compactHistory([
			{ role: 'user', content: 'q' },
			{ role: 'assistant', content: null, tool_calls: [call('a', 'x'), call('b', 'y')] },
			toolMsg('a'),
			{ role: 'assistant', content: 'answer' },
		]);
		assert.deepEqual(out.map(m => m.role), ['user', 'assistant']);
		assert.equal(out[1].content, 'answer');
	});

	it('always expires chat history results', () => {
		const out = compactHistory([
			{ role: 'assistant', content: null, tool_calls: [call('a', 'get_chat_history')] },
			toolMsg('a', '{"messages":[]}'),
		]);
		assert.equal(out[1].content, STALE);
		assert.deepEqual(toolsWithData(out), []);
	});

	it('keeps only the most recent tool results in full', () => {
		const history = [];
		const total = KEEP_TOOL_RESULTS + 2;
		for (let i = 0; i < total; i++) {
			history.push({ role: 'assistant', content: null, tool_calls: [call(`c${i}`, 'get_match_details')] }, toolMsg(`c${i}`, `{"n":${i}}`));
		}
		const tools = compactHistory(history).filter(m => m.role === 'tool');
		assert.equal(tools.length, total);
		assert.equal(tools.filter(m => m.content === STALE).length, 2);
		assert.equal(tools[0].content, STALE);
		assert.equal(tools[total - 1].content, `{"n":${total - 1}}`);
	});
});
