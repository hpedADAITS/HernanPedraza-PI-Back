const debugService = require('../services/debug.service');
const { logger } = require('../utils');
const { httpStatus } = require('../constants');

class DebugController {
  async getAudioFingerprintStats(req, res, next) {
    try {
      const result = await debugService.getAudioFingerprintStats();

      res.status(httpStatus.OK).json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Get debug audio fingerprint stats error:', error);
      next(error);
    }
  }

  async createMockAccounts(req, res, next) {
    try {
      const result = await debugService.createMockAccounts();

      res.status(httpStatus.CREATED).json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Create debug mock accounts error:', error);
      next(error);
    }
  }
}

module.exports = new DebugController();
