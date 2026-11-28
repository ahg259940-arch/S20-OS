'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const dgram = require('node:dgram');
const storage = require('../core/storage.js');

const defaultFile = path.join(__dirname, 'connections.json');
const MAX_CONNECTIONS = 30;
const MAX_PLAYERS = 100;
const MAX_EVENTS = 100;
const emptyConfig = () => ({ connections: [], authorizedPlayers: [], reconnect: false, events: [] });
const javaVarInt = value => {
  const out = [];
  do { let byte = value & 0x7f; value >>>= 7; if (value) byte |= 0x80; out.push(byte); } while (value);
  return Buffer.from(out);
};
function normalizeConfig(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('A configuração Minecraft não contém um objeto válido; os dados foram preservados.');
  }
  const config = {
    ...parsed,
    connections: parsed.connections ?? [],
    authorizedPlayers: parsed.authorizedPlayers ?? [],
    reconnect: parsed.reconnect ?? false,
    events: parsed.events ?? []
  };
  if (!Array.isArray(config.connections) || config.connections.length > MAX_CONNECTIONS ||
      !Array.isArray(config.authorizedPlayers) || config.authorizedPlayers.length > MAX_PLAYERS ||
      !Array.isArray(config.events) || config.events.length > MAX_EVENTS || typeof config.reconnect !== 'boolean') {
    throw new Error('A configuração Minecraft está inválida ou excede os limites; os dados foram preservados.');
  }
  return config;
}
function readConfig(filePath = defaultFile) {
  if (!fs.existsSync(filePath)) return emptyConfig();
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (_error) { throw new Error('A configuração Minecraft não pôde ser lida; os dados foram preservados.'); }
  return normalizeConfig(parsed);
}
function updateConfig(filePath, type, message, mutate) {
  try {
    return storage.updateJson(filePath, emptyConfig(), raw => {
      const config = normalizeConfig(raw);
      const result = mutate(config);
      config.events.push({ at: new Date().toISOString(), type, message });
      config.events = config.events.slice(-MAX_EVENTS);
      return { data: config, result };
    });
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('A configuração Minecraft não pôde ser lida; os dados foram preservados.');
    throw error;
  }
}
function validate(input) {
  const host = String(input.host || '').trim().toLowerCase();
  const edition = input.edition === 'bedrock' ? 'bedrock' : input.edition === 'java' ? 'java' : '';
  const port = Number(input.port || (edition === 'bedrock' ? 19132 : 25565));
  if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) && net.isIP(host) === 0) throw new Error('Informe um endereço IP ou domínio válido.');
  if (!edition || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Edição ou porta inválida.');
  return { id: String(input.id || `${edition}-${host}-${port}`).slice(0, 100), name: String(input.name || host).trim().slice(0, 80) || host, host, port, edition, auth: edition === 'java' ? 'Java Edition: status público ou RCON configurado no servidor' : 'Bedrock: status RakNet público; automação exige add-on/API autorizado' };
}
function encodeString(value) { const b = Buffer.from(value, 'utf8'); return Buffer.concat([javaVarInt(b.length), b]); }
function probeJava({ host, port }, timeout = 4500) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }); let buffer = Buffer.alloc(0); let done = false;
    const finish = (error, value) => { if (done) return; done = true; socket.destroy(); error ? reject(error) : resolve(value); };
    socket.setTimeout(timeout, () => finish(new Error('Tempo esgotado ao consultar o servidor Java.')));
    socket.on('error', () => finish(new Error('Não foi possível abrir TCP no endereço e porta informados.')));
    socket.on('connect', () => {
      const hostData = encodeString(host);
      const handshakeData = Buffer.concat([javaVarInt(0), javaVarInt(-1), hostData, Buffer.from([port >> 8, port & 255]), javaVarInt(1)]);
      const handshake = Buffer.concat([javaVarInt(handshakeData.length), handshakeData]);
      socket.write(Buffer.concat([handshake, Buffer.from([1, 0])]));
    });
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        let packetLength = 0, shift = 0, index = 0;
        for (; index < buffer.length; index++) { const byte = buffer[index]; packetLength |= (byte & 0x7f) << shift; shift += 7; if (!(byte & 0x80)) { index++; break; } if (shift > 28) throw new Error('Pacote Java inválido.'); }
        if (!packetLength || buffer.length < index + packetLength) return;
        let cursor = index; let packetId = 0; shift = 0;
        while (true) { const byte = buffer[cursor++]; packetId |= (byte & 0x7f) << shift; shift += 7; if (!(byte & 0x80)) break; }
        if (packetId !== 0) throw new Error('Resposta de status Java inesperada.');
        let stringLength = 0; shift = 0;
        while (true) { const byte = buffer[cursor++]; stringLength |= (byte & 0x7f) << shift; shift += 7; if (!(byte & 0x80)) break; }
        const status = JSON.parse(buffer.subarray(cursor, cursor + stringLength).toString('utf8'));
        finish(null, { online: true, edition: 'java', version: status.version?.name || 'Java', players: status.players || null, description: typeof status.description === 'string' ? status.description : status.description?.text || 'Online', latency: null, checkedAt: new Date().toISOString() });
      } catch (error) { finish(error); }
    });
  });
}
function probeBedrock({ host, port }, timeout = 4500) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4'); const time = BigInt(Date.now());
    const magic = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex');
    const timestamp = Buffer.alloc(8); timestamp.writeBigUInt64BE(time);
    const ping = Buffer.concat([Buffer.from([1]), timestamp, magic, Buffer.alloc(8)]);
    const timer = setTimeout(() => { socket.close(); reject(new Error('Sem resposta RakNet. Verifique UDP e porta Bedrock.')); }, timeout);
    socket.once('error', () => { clearTimeout(timer); socket.close(); reject(new Error('Falha no teste UDP Bedrock.')); });
    socket.once('message', packet => {
      clearTimeout(timer); socket.close();
      try {
        if (packet[0] !== 0x1c || packet.length < 35) throw new Error('Resposta RakNet inválida.');
        const length = packet.readUInt16BE(33); const parts = packet.toString('utf8', 35, 35 + length).split(';');
        resolve({ online: true, edition: 'bedrock', motd: parts[1] || parts[0] || 'Online', version: parts[3] || 'Bedrock', players: { online: Number(parts[4]) || null, max: Number(parts[5]) || null }, latency: null, checkedAt: new Date().toISOString() });
      } catch (error) { reject(error); }
    });
    socket.send(ping, port, host, error => { if (error) { clearTimeout(timer); socket.close(); reject(new Error('Não foi possível enviar a consulta RakNet.')); } });
  });
}
async function test(input) {
  const connection = validate(input);
  const start = Date.now();
  const result = connection.edition === 'java' ? await probeJava(connection) : await probeBedrock(connection);
  result.latency = Date.now() - start;
  return { connection, result };
}
function list(filePath = defaultFile) {
  const config = readConfig(filePath);
  return { connections: config.connections, authorizedPlayers: config.authorizedPlayers, reconnect: config.reconnect, events: config.events };
}
function upsert(input, filePath = defaultFile) {
  const connection = validate(input);
  updateConfig(filePath, 'connection_saved', `${connection.edition} ${connection.host}:${connection.port}`, config => {
    const index = config.connections.findIndex(item => item.id === connection.id);
    if (index < 0 && config.connections.length >= MAX_CONNECTIONS) throw new Error('Limite de 30 conexões atingido.');
    if (index < 0) config.connections.push(connection); else config.connections[index] = connection;
  });
  return list(filePath);
}
function updateAccess(input, filePath = defaultFile) {
  const players = Array.isArray(input.players) ? input.players.map(name => String(name).trim()).filter(name => /^[A-Za-z0-9_]{1,16}$/.test(name)).slice(0, MAX_PLAYERS) : [];
  const uniquePlayers = [...new Set(players)];
  const reconnect = input.reconnect === true;
  updateConfig(filePath, 'access_updated', `Lista autorizada: ${uniquePlayers.length} jogador(es); reconexão ${reconnect ? 'ativa' : 'inativa'}.`, config => {
    config.authorizedPlayers = uniquePlayers;
    config.reconnect = reconnect;
  });
  return list(filePath);
}
function createManager(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('O caminho da configuração precisa ser absoluto.');
  return {
    list: () => list(filePath),
    upsert: input => upsert(input, filePath),
    updateAccess: input => updateAccess(input, filePath),
    test,
    validate
  };
}
module.exports = { ...createManager(defaultFile), createManager, validate };
