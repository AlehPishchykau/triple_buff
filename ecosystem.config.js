module.exports = {
	apps: [
		{
			name: 'billy',
			script: 'src/index.js',
			node_args: '--dns-result-order=ipv4first',
			time: true,
			env: {
				BOT_CONFIG: './bots/billy.js',
			},
		},
		{
			name: 'gofman',
			script: 'src/index.js',
			node_args: '--dns-result-order=ipv4first',
			time: true,
			env: {
				BOT_CONFIG: './bots/gofman.js',
			},
		},
		{
			name: 'jesus',
			script: 'src/index.js',
			node_args: '--dns-result-order=ipv4first',
			time: true,
			env: {
				BOT_CONFIG: './bots/jesus.js',
			},
		},
	],
};
