(function attachBackupCrypto(root, factory) {
  const cryptoApi = root.crypto || (typeof require === 'function' ? require('node:crypto').webcrypto : null);
  const implementation = factory(cryptoApi);
  if (typeof module === 'object' && module.exports) module.exports = implementation;
  if (root) root.NexusBackupCrypto = implementation;
})(globalThis, cryptoApi => {
  'use strict';
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const iterations = 310000;

  function toBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
    }
    return btoa(binary);
  }
  function fromBase64(value) {
    if (typeof value !== 'string' || value.length > 64 * 1024 * 1024) throw new Error('Backup criptografado inválido.');
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  async function deriveKey(passphrase, salt, usage) {
    if (!cryptoApi?.subtle) throw new Error('WebCrypto não está disponível neste navegador.');
    if (typeof passphrase !== 'string' || passphrase.length < 12) throw new Error('Use uma senha com pelo menos 12 caracteres.');
    const material = await cryptoApi.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return cryptoApi.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material,
      { name: 'AES-GCM', length: 256 }, false, [usage]);
  }
  async function digest(value) {
    const bytes = await cryptoApi.subtle.digest('SHA-256', encoder.encode(JSON.stringify(value)));
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function encryptBackup(payload, passphrase, expectedDigest) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Conteúdo de backup inválido.');
    const contentDigest = await digest(payload);
    if (expectedDigest && contentDigest !== expectedDigest) throw new Error('O conteúdo exportado não corresponde ao digest do núcleo.');
    const salt = cryptoApi.getRandomValues(new Uint8Array(16));
    const iv = cryptoApi.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt, 'encrypt');
    const ciphertext = await cryptoApi.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(payload)));
    return {
      format: 'nexus-encrypted-export-v1', kdf: 'PBKDF2-SHA-256', iterations,
      cipher: 'AES-256-GCM', salt: toBase64(salt), iv: toBase64(iv), digest: contentDigest,
      ciphertext: toBase64(new Uint8Array(ciphertext))
    };
  }
  async function decryptBackup(envelope, passphrase) {
    if (!envelope || envelope.format !== 'nexus-encrypted-export-v1' || envelope.kdf !== 'PBKDF2-SHA-256' ||
        envelope.iterations !== iterations || envelope.cipher !== 'AES-256-GCM' || !/^[a-f0-9]{64}$/.test(envelope.digest || '')) {
      throw new Error('Formato de backup ou parâmetros criptográficos inválidos.');
    }
    const salt = fromBase64(envelope.salt); const iv = fromBase64(envelope.iv); const ciphertext = fromBase64(envelope.ciphertext);
    if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new Error('Backup criptografado incompleto.');
    const key = await deriveKey(passphrase, salt, 'decrypt');
    let plaintext;
    try { plaintext = await cryptoApi.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext); }
    catch (_error) { throw new Error('Senha incorreta ou backup adulterado.'); }
    let payload;
    try { payload = JSON.parse(decoder.decode(plaintext)); }
    catch (_error) { throw new Error('Conteúdo descriptografado não é JSON válido.'); }
    if (await digest(payload) !== envelope.digest) throw new Error('A integridade do conteúdo não foi confirmada.');
    return payload;
  }
  return { encryptBackup, decryptBackup };
});
