const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TEST_DIR = '/tmp/test_keeper_' + Date.now();
process.env.DATA_DIR = TEST_DIR;
process.env.BOT_CONFIG = path.join(__dirname, '..', 'bots', 'billy.js');

const chatScope = require('../src/chatScope');
const memory = require('../src/memory');
const { applyMemoryOps, knownParticipants, dialogTail, buildKeeperInput, updateMemory } = require('../src/memoryKeeper');

const CHAT = '-100555';
const inChat = fn => chatScope.run(CHAT, fn);
const people = () => new Map([['@Alice', 'Алиса'], ['@bob', 'Боб']]);

describe('memoryKeeper', () => {
	beforeEach(() => {
		fs.mkdirSync(path.join(TEST_DIR, CHAT, 'billy'), { recursive: true });
		fs.writeFileSync(path.join(TEST_DIR, CHAT, 'players.json'), JSON.stringify({ 1: { telegram: '@bob', name: 'Боб' } }));
	});
	afterEach(() => fs.rmSync(TEST_DIR, { recursive: true, force: true }));

	it('adds rules to global and facts to the person they are about', () => inChat(() => {
		const changes = applyMemoryOps([
			{ op: 'add', target: 'global', text: 'В ответах @bob добавлять "ура" (попросила @Alice)' },
			{ op: 'add', target: '@alice', text: 'ездит на мопеде' },
		], { participants: people(), by: '@Alice' });
		assert.equal(changes.length, 2);
		const summary = memory.getMemorySummary();
		assert.ok(summary.includes('В ответах @bob добавлять "ура"'));
		assert.ok(summary.includes('@Alice:\n  - ездит на мопеде'), 'target is normalised to the known tag');
	}));

	it('rejects unknown targets, empty text and duplicates', () => inChat(() => {
		memory.addFact('@bob', 'любит кофе');
		const changes = applyMemoryOps([
			{ op: 'add', target: '@stranger', text: 'кто-то' },
			{ op: 'add', target: '@bob', text: '  ' },
			{ op: 'add', target: '@bob', text: 'Любит кофе.' },
		], { participants: people() });
		assert.deepEqual(changes, []);
		assert.ok(!memory.getMemorySummary().includes('кто-то'));
	}));

	it('updates and deletes existing entries by id, ignoring unknown ids', () => inChat(() => {
		const rule = memory.addFact('global', 'старое правило');
		const fact = memory.addFact('@bob', 'есть кот');
		const changes = applyMemoryOps([
			{ op: 'update', id: rule.id, text: 'новое правило' },
			{ op: 'delete', id: fact.id },
			{ op: 'delete', id: 'm999' },
		], { participants: people() });
		assert.deepEqual(changes, ['обновлено: новое правило', 'удалено: есть кот']);
		const summary = memory.getMemorySummary();
		assert.ok(summary.includes('новое правило') && !summary.includes('есть кот'));
	}));

	it('caps the number of operations taken from one reply', () => inChat(() => {
		const ops = Array.from({ length: 9 }, (_, i) => ({ op: 'add', target: '@bob', text: `факт ${i}` }));
		assert.equal(applyMemoryOps(ops, { participants: people() }).length, 5);
	}));

	it('collects participants from players, stored facts, chat log and the author', () => inChat(() => {
		memory.addFact('@carol', 'x');
		memory.saveChatMessage({ from: '@dave', name: 'Дэйв', text: 'hi', ts: Math.floor(Date.now() / 1000), type: 'text' });
		memory.saveChatMessage({ from: 'billy', name: 'Billy', text: 'yo', ts: Math.floor(Date.now() / 1000), type: 'bot' });
		const p = knownParticipants('@eve');
		assert.deepEqual([...p.keys()].sort(), ['@bob', '@carol', '@dave', '@eve']);
		assert.equal(p.get('@bob'), 'Боб');
		assert.equal(p.get('@dave'), 'Дэйв');
	}));

	it('takes the last user turn as the message and earlier turns as dialog', () => {
		const { message, dialog } = dialogTail([
			{ role: 'system', content: 'sys' },
			{ role: 'user', content: '[@bob]: первый' },
			{ role: 'assistant', content: null, tool_calls: [{ id: 'a' }] },
			{ role: 'tool', tool_call_id: 'a', content: '{}' },
			{ role: 'assistant', content: 'ответ' },
			{ role: 'user', content: [{ type: 'text', text: '[@bob]: второй' }, { type: 'image_url', image_url: { url: 'x' } }] },
		]);
		assert.equal(message, '[@bob]: второй');
		assert.deepEqual(dialog, ['[@bob]: первый', '[Billy]: ответ']);
	});

	it('shows memory with ids and the new message to the keeper', () => inChat(() => {
		const rule = memory.addFact('global', 'правило');
		const input = buildKeeperInput({ participants: people(), authorTag: '@bob', dialog: [], message: '[@bob]: привет' });
		assert.ok(input.includes(`[${rule.id}] правило`));
		assert.ok(input.includes('УЧАСТНИКИ: @Alice (Алиса), @bob (Боб)'));
		assert.ok(input.endsWith('[@bob]: привет'));
	}));

	it('applies model output and never throws when the model call fails', async () => inChat(async () => {
		const client = { chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify({ ops: [{ op: 'add', target: '@bob', text: 'работает в казино' }] }) } }] }) } } };
		const messages = [{ role: 'user', content: '[@bob]: я работаю в казино' }];
		assert.deepEqual(await updateMemory(client, { messages, authorTag: '@bob' }), ['добавлен факт о @bob: работает в казино']);
		const broken = { chat: { completions: { create: async () => { throw new Error('boom'); } } } };
		assert.deepEqual(await updateMemory(broken, { messages, authorTag: '@bob' }), []);
	}));
});
