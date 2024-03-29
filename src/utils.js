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

function convertMiliseconds(miliseconds, format) {
	let days, hours, minutes, seconds, total_hours, total_minutes, total_seconds;
	
	total_seconds = parseInt(Math.floor(miliseconds / 1000));
	total_minutes = parseInt(Math.floor(total_seconds / 60));
	total_hours = parseInt(Math.floor(total_minutes / 60));
	days = parseInt(Math.floor(total_hours / 24));
  
	seconds = parseInt(total_seconds % 60);
	minutes = parseInt(total_minutes % 60);
	hours = parseInt(total_hours % 24);
	
	switch(format) {
	  case 's':
		  return total_seconds;
	  case 'm':
		  return total_minutes;
	  case 'h':
		  return total_hours;
	  case 'd':
		  return days;
	  default:
		  return `${days ? `${days}d ` : ''}${hours ? `${hours}h ` : ''}${minutes ? `${minutes}m` : ''}`
	}
};

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
	convertMiliseconds,
	writeJSONToFile
};
