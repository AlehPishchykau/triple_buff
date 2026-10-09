module.exports = {
	apps: [
		{
			name: 'billy',
			script: 'src/index.js',
			env: {
				BOT_CONFIG: './bots/billy.js',
			},
		},
		{
			name: 'gofman',
			script: 'src/index.js',
			env: {
				BOT_CONFIG: './bots/gofman.js',
			},
		},
		{
			name: 'jesus',
			script: 'src/index.js',
			env: {
				BOT_CONFIG: './bots/jesus.js',
			},
		},
	],
};
