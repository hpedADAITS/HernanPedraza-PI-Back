const ackSuccess = (callback, data) => {
  if (typeof callback !== 'function') return;
  callback({ success: true, data, error: null });
};

const ackError = (callback, error) => {
  if (typeof callback !== 'function') return;
  const code = error?.code || error?.name || 'ERROR';
  callback({ success: false, data: null, error: error.message, code });
};

module.exports = {
  ackSuccess,
  ackError,
};
