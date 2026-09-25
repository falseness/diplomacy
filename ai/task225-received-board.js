'use strict';
// Observe inbound transport bytes only. Never read or change a browser board.
const assert = require('node:assert/strict');
const events = new Set(['playYourTurn', 'waitYouTurn']);
function receivedBoard(packet, secrets = []) {
 if (packet.direction !== 'received') return null;
 const match = /^42\d*(\[.*)$/s.exec(packet.text);
 if (!match) return null;
 const args = JSON.parse(match[1]);
 if (!events.has(args[0])) return null;
 let board = typeof args[1] === 'string' ? JSON.parse(args[1]) : args[1];
 assert(board && Array.isArray(board.grid) && Array.isArray(board.players), 'full inbound board');
 assert(board.coopCommit && Number.isInteger(board.whooseTurn), 'inbound commit and recipient');
 // Preserve every gameplay field; redact credentials recursively, before writing.
 const sanitize = value => {
  if (typeof value === 'string') return secrets.reduce((s, secret) => secret ? s.split(secret).join('[redacted]') : s, value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
   [key, /password|token|credential/i.test(key) ? '[redacted]' : sanitize(item)]));
  return value;
 };
 board = sanitize(board);
 return {schemaVersion: 1, kind: 'sanitized-inbound-board', at: new Date().toISOString(),
  player: packet.player, transport: packet.transport, direction: packet.direction, event: args[0], board};
}
module.exports = {receivedBoard};
