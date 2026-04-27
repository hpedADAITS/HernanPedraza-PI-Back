const { authService } = require('../services');
const { logger } = require('../utils');
const { httpStatus, messages } = require('../constants');
const { ValidationError } = require('../errors');

class AuthController {
  async register(req, res, next) {
    try {
      const { email, password, displayName, role } = req.body;

      // Validation will be done in service
      const result = await authService.register(
        email,
        password,
        displayName,
        role,
      );

      res.status(httpStatus.CREATED).json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Register error:', error);
      next(error);
    }
  }

  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      // Basic validation
      if (!email || !password) {
        throw new ValidationError(messages.VALIDATION.REQUIRED_FIELD);
      }

      const result = await authService.login(email, password);

      res.status(httpStatus.OK).json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Login error:', error);
      next(error);
    }
  }

  async refreshToken(req, res, next) {
    try {
      const { token } = req.body;

      // Validation will be done in service
      const result = await authService.refreshToken(token);

      res.status(httpStatus.OK).json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Refresh token error:', error);
      next(error);
    }
  }

  async getCurrentUser(req, res, next) {
    try {
      const user = await authService.getCurrentUser(req.user.userId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { user },
      });
    } catch (error) {
      logger.error('Get current user error:', error);
      next(error);
    }
  }
  async updateProfile(req, res, next) {
    try {
      const { displayName } = req.body;

      const user = await authService.updateProfile(req.user.userId, {
        displayName,
      });

      res.status(httpStatus.OK).json({
        success: true,
        data: { user },
      });
    } catch (error) {
      logger.error('Update profile error:', error);
      next(error);
    }
  }

  async updateProfilePicture(req, res, next) {
    try {
      const { profilePicture } = req.body;

      const user = await authService.updateProfilePicture(
        req.user.userId,
        profilePicture,
      );

      res.status(httpStatus.OK).json({
        success: true,
        data: { user },
      });
    } catch (error) {
      logger.error('Update profile picture error:', error);
      next(error);
    }
  }
}

module.exports = new AuthController();
