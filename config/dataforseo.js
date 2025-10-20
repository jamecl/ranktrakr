const axios = require('axios');

const DATAFORSEO_API_URL = 'https://api.dataforseo.com/v3';
const DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD;

const dataforSEOClient = axios.create({
  baseURL: DATAFORSEO_API_URL,
  auth: {
    username: DATAFORSEO_LOGIN,
    password: DATAFORSEO_PASSWORD
  },
  headers: {
    'Content-Type': 'application/json'
  }
});

module.exports = { dataforSEOClient };