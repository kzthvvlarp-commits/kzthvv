const express = require('express');

const app = express();

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'kzthvv',
    status: 'online',
    timestamp: new Date().toISOString(),
    discord: 'connected'
  });
});

app.get('/ping', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'kzthvv',
    status: 'pong',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'kzthvv',
    status: 'online',
    endpoints: ['/health', '/ping']
  });
});

module.exports = app;
