require('dotenv').config();
const fs = require('node:fs');

const { STRATZ_API_URL } = require('./constants');
const { STRATZ_TOKEN } = process.env;

async function request(path, params) {
	return await fetch(STRATZ_API_URL + path + getParamsString(params), {
		headers: { Authorization: `Bearer ${STRATZ_TOKEN}` }
	})
}

function getParamsString(params = {}) {
	const paramsArray = [];

	Object.entries(params).forEach(([key, value]) => {
		paramsArray.push(`${key}=${value}`);
	});

	const paramsString = paramsArray.join('&');

	return paramsString ? `?${paramsString}` : '';
}

function secondsToTime(totalSeconds) {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;

	function padTo2Digits(num) {
		return num.toString().padStart(2, '0');
	}

	return `${padTo2Digits(minutes)}:${padTo2Digits(seconds)}`;
}

function writeJSONToFile(data) {
	fs.writeFile('./output.json', JSON.stringify(data), err => {
		if (err) {
		console.error(err);
		}
	})
}

module.exports = {
	request,
	secondsToTime,
	writeJSONToFile
};
