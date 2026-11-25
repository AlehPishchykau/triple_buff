const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.BOT_CONFIG = path.join(__dirname, '..', 'bots', 'billy.js');

const { buildDotaContext, describeAuthor, ROSTER_MARKER } = require('../src/askPrompts');
const { getPersonaTools, DOTA_TOOL_NAMES, ASK_TOOL_HANDLERS } = require('../src/askTools');

const playersMap = { 100: { name: 'Олег', nick: 'Oleg Tango' }, 200: { name: 'Владимир', nick: 'vova' } };
const telegramMap = { 100: '@midsummer314' };

describe('askPrompts', () => {
	it('lists every player with nick, id and telegram', () => {
		const ctx = buildDotaContext({ playersMap, telegramMap, authorTag: '@midsummer314', today: '2026-11-25' });
		assert.ok(ctx.includes(ROSTER_MARKER));
		assert.ok(ctx.includes('- Олег — Oleg Tango — 100 — @midsummer314'));
		assert.ok(ctx.includes('- Владимир — vova — 200 — нет'));
		assert.ok(ctx.includes('Сегодня 2026-11-25'));
	});

	it('ties the author to their player entry', () => {
		assert.ok(describeAuthor('@midsummer314', playersMap, telegramMap).includes('это Олег, player_id 100'));
		assert.ok(describeAuthor('@stranger', playersMap, telegramMap).includes('не из списка игроков'));
	});

	it('mentions every Dota tool by name so the model knows when to use it', () => {
		const ctx = buildDotaContext({ playersMap, telegramMap, authorTag: '@x', today: '2026-11-25' });
		for (const name of DOTA_TOOL_NAMES) assert.ok(ctx.includes(name), `${name} missing from prompt`);
	});
});

describe('askTools', () => {
	it("expands the 'dota' alias and has a handler for every tool", () => {
		const names = getPersonaTools().map(t => t.function.name);
		for (const name of DOTA_TOOL_NAMES) assert.ok(names.includes(name));
		assert.ok(names.includes('web_search'));
		for (const name of names) assert.equal(typeof ASK_TOOL_HANDLERS[name], 'function');
	});
});
