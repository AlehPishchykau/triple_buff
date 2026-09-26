const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

describe('persona', () => {
	it('loads billy config', () => {
		process.env.BOT_CONFIG = path.join(__dirname, '..', 'bots', 'billy.js');
		delete require.cache[require.resolve('../src/persona')];
		const persona = require('../src/persona');
		assert.equal(persona.name, 'Billy');
		assert.equal(persona.command, 'billy');
		assert.ok(persona.triggerRegex instanceof RegExp);
		assert.ok(persona.triggerRegex.test('билли'));
		assert.ok(persona.triggerRegex.test('billy'));
		assert.ok(!persona.triggerRegex.test('гофман'));
	});

	it('loads gofman config', () => {
		process.env.BOT_CONFIG = path.join(__dirname, '..', 'bots', 'gofman.js');
		delete require.cache[require.resolve('../src/persona')];
		const persona = require('../src/persona');
		assert.equal(persona.name, 'Игорь Авраалович');
		assert.equal(persona.command, 'gofman');
		assert.ok(persona.triggerRegex.test('гофман'));
		assert.ok(persona.triggerRegex.test('авраал'));
		assert.ok(persona.triggerRegex.test('аврал'));
		assert.ok(!persona.triggerRegex.test('billy'));
	});

	it('has required prompt fields', () => {
		process.env.BOT_CONFIG = path.join(__dirname, '..', 'bots', 'billy.js');
		delete require.cache[require.resolve('../src/persona')];
		const persona = require('../src/persona');
		const required = ['identity', 'style', 'styleShort', 'reportStyle', 'reportBonus',
			'challengeStyle', 'analysisStyle', 'moodLow', 'moodMid', 'moodHigh'];
		for (const key of required) {
			assert.ok(persona.prompts[key], `missing prompt: ${key}`);
		}
	});

	it('has crossBot config', () => {
		process.env.BOT_CONFIG = path.join(__dirname, '..', 'bots', 'billy.js');
		delete require.cache[require.resolve('../src/persona')];
		const persona = require('../src/persona');
		assert.ok(persona.crossBot);
		assert.equal(typeof persona.crossBot.replyChance, 'number');
		assert.equal(typeof persona.crossBot.maxChain, 'number');
		assert.equal(typeof persona.crossBot.cooldownMs, 'number');
		assert.equal(typeof persona.crossBot.randomChance, 'number');
	});

	it('has commands array', () => {
		process.env.BOT_CONFIG = path.join(__dirname, '..', 'bots', 'billy.js');
		delete require.cache[require.resolve('../src/persona')];
		const persona = require('../src/persona');
		assert.ok(Array.isArray(persona.commands));
		assert.ok(persona.commands.includes('report'));
	});

	it('has tools array', () => {
		process.env.BOT_CONFIG = path.join(__dirname, '..', 'bots', 'billy.js');
		delete require.cache[require.resolve('../src/persona')];
		const persona = require('../src/persona');
		assert.ok(Array.isArray(persona.tools));
		assert.ok(persona.tools.includes('get_player_winrate'));
	});
});
