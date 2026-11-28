'use strict';

const path = require('node:path');

const port = Number(process.argv[2]);
const token = String(process.argv[3] || '');
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
  throw new Error('Configuração nativa do servidor local inválida.');
}

process.chdir(__dirname);
process.env.NEXUS_PREVIEW_PORT = String(port);
process.env.NEXUS_DEVICE_TOKEN = token;
// The native app has no external shell to configure an admin secret. Reuse its
// random per-install device token for local setup administration as well.
process.env.NEXUS_PREVIEW_ADMIN_TOKEN = token;
require(path.join(__dirname, 'app', 'server.js')).start();
