const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const alphanumericRegex = /^[a-zA-Z0-9]+$/;
const strongPasswordRegex =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

const validators = {
  email: (email) => {
    if (!email || typeof email !== 'string') return false;
    return emailRegex.test(email);
  },

  password: (password) => {
    if (!password || typeof password !== 'string') return false;
    return password.length >= 6; // Basic validation; adjust as needed
  },

  strongPassword: (password) => {
    if (!password || typeof password !== 'string') return false;
    return strongPasswordRegex.test(password);
  },

  displayName: (name) => {
    if (!name || typeof name !== 'string') return false;
    return name.trim().length >= 2 && name.trim().length <= 100;
  },

  eventName: (name) => {
    if (!name || typeof name !== 'string') return false;
    return name.trim().length >= 3 && name.trim().length <= 200;
  },

  songTitle: (title) => {
    if (!title || typeof title !== 'string') return false;
    return title.trim().length >= 1 && title.trim().length <= 255;
  },

  nickname: (nickname) => {
    if (!nickname || typeof nickname !== 'string') return false;
    return (
      nickname.trim().length >= 2 &&
      nickname.trim().length <= 50 &&
      /^[a-zA-Z0-9_-]+$/.test(nickname.trim())
    );
  },

  objectId: (id) => {
    if (!id || typeof id !== 'string') return false;
    return /^[a-f\d]{24}$/i.test(id);
  },

  nonNegativeNumber: (value) => {
    return Number.isInteger(value) && value >= 0;
  },

  positiveNumber: (value) => {
    return Number.isInteger(value) && value > 0;
  },

  eventCode: (code) => {
    if (!code || typeof code !== 'string') return false;
    /* Event codes are typically 6-8 alphanumeric characters */
    return alphanumericRegex.test(code) && code.length >= 6 && code.length <= 8;
  },
};

module.exports = { validators };
