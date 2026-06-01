const ackSuccess = (callback, data) => {
  callback({ success: true, data, error: null });
};

const ackError = (callback, error) => {
  callback({ success: false, data: null, error: error.message });
};

module.exports = {
  ackSuccess,
  ackError,
};
