const PASSWORD_REGEX = /^(?=.*[A-Za-z0-9])[\x20-\x7E]{8,128}$/;
const SONG_TEXT_REGEX = /^[^<>{}\x00-\x1F\x7F]{1,200}$/;

function isValidPassword(password) {
  return typeof password === 'string' && PASSWORD_REGEX.test(password);
}

function isValidSongText(value) {
  return typeof value === 'string' && SONG_TEXT_REGEX.test(value);
}

module.exports = {
  PASSWORD_REGEX,
  SONG_TEXT_REGEX,
  isValidPassword,
  isValidSongText,
};
