const ackSuccess = (callback, data) => {
  if (typeof callback !== 'function') return;
  callback({ success: true, data, error: null });
};

const ackError = (callback, error) => {
  if (typeof callback !== 'function') return;
  callback({ success: false, data: null, error: error.message });
};

module.exports = {
  ackSuccess,
  ackError,
};
