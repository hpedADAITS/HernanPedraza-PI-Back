// Shared helpers and small validators for the socket layer.

const isValidId = (v) => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);
const isValidVoteValue = (v) => v === 1 || v === -1;

module.exports = { isValidId, isValidVoteValue };
