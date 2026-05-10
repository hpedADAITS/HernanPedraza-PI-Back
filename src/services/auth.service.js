const bcrypt = require('bcryptjs');
const { UserModel } = require('../models');
const { generateToken, verifyToken } = require('../utils/jwt.utils');
const { logger } = require('../utils');
const {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
} = require('../errors');
const { messages } = require('../constants');
const {
  validateRegistration,
  validateLogin,
  validateTokenRefresh,
} = require('../validators/auth.validator');
const emailService = require('./email.service');

class AuthService {
  async register(email, password, displayName, role = 'ATTENDEE') {
    /* Validate input */
    validateRegistration({ email, password, displayName, role });

    /* Check if user exists */
    const existingUser = await UserModel.findOne({
      email: email.toLowerCase(),
    });
    if (existingUser) {
      throw new ValidationError(messages.AUTH.USER_ALREADY_EXISTS);
    }

    /* Hash password */
    const passwordHash = await bcrypt.hash(password, 10);

    /* Create user */
    const user = new UserModel({
      email,
      passwordHash,
      displayName,
      role,
    });

    await user.save();
    logger.info(`User registered: ${email}`);

    /* Generate token for new user with user metadata */
    const token = generateToken({
      userId: user._id,
      email: user.email,
      role: user.role,
      type: 'default',
    });

    if (role === 'DJ') {
      await emailService.sendWelcomeEmail(user, displayName).catch((err) => {
        logger.error(`Failed to send welcome email to ${email}:`, err);
      });
    }

    return {
      token,
      user: {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
    };
  }

  async login(email, password) {
    /* Validate input */
    validateLogin({ email, password });

    /* Find user with password field */
    const user = await UserModel.findOne({
      email: email.toLowerCase(),
    }).select('+passwordHash');
    if (!user) {
      throw new UnauthorizedError(messages.AUTH.INVALID_CREDENTIALS);
    }

    /* Verify password */
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError(messages.AUTH.INVALID_CREDENTIALS);
    }

    /* Update last login */
    user.lastLoginAt = new Date();
    await user.save();

    /* Generate token with user metadata */
    const token = generateToken({
      userId: user._id,
      email: user.email,
      role: user.role,
      type: 'default',
    });

    logger.info(`User logged in: ${email}`);

    return {
      token,
      user: {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
    };
  }

  async refreshToken(token) {
    validateTokenRefresh({ token });

    try {
      const decoded = verifyToken(token);
      const user = await UserModel.findById(decoded.userId);

      if (!user) {
        throw new NotFoundError(messages.AUTH.USER_NOT_FOUND);
      }

      const newToken = generateToken({
        userId: user._id,
        email: user.email,
        role: user.role,
        type: 'default',
      });

      return { token: newToken };
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new UnauthorizedError(messages.AUTH.INVALID_TOKEN);
    }
  }

  async getCurrentUser(userId) {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new NotFoundError(messages.AUTH.USER_NOT_FOUND);
    }

    return {
      id: user._id,
      email: user.email,
      displayName: user.displayName,
      profilePicture: user.profilePicture,
      role: user.role,
      lastLoginAt: user.lastLoginAt,
      emailRegistered: user.emailRegistered,
      emailRegisteredAt: user.emailRegisteredAt,
    };
  }

  async updateProfile(userId, updates) {
    const { displayName } = updates;

    if (!userId) {
      throw new ValidationError(messages.VALIDATION.REQUIRED_FIELD);
    }

    if (displayName && displayName.trim().length < 2) {
      throw new ValidationError('Display name must be at least 2 characters');
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      throw new NotFoundError(messages.AUTH.USER_NOT_FOUND);
    }

    if (displayName) {
      user.displayName = displayName.trim();
    }

    await user.save();
    logger.info(`User profile updated: ${user.email}`);

    return {
      id: user._id,
      email: user.email,
      displayName: user.displayName,
      profilePicture: user.profilePicture,
      role: user.role,
    };
  }

  async updateProfilePicture(userId, profilePicture) {
    if (!userId) {
      throw new ValidationError(messages.VALIDATION.REQUIRED_FIELD);
    }

    if (!profilePicture || typeof profilePicture !== 'string') {
      throw new ValidationError('Profile picture must be a valid string');
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      throw new NotFoundError(messages.AUTH.USER_NOT_FOUND);
    }

    user.profilePicture = profilePicture;
    await user.save();
    logger.info(`User profile picture updated: ${user.email}`);

    return {
      id: user._id,
      email: user.email,
      displayName: user.displayName,
      profilePicture: user.profilePicture,
      role: user.role,
    };
  }

  async verifyEmail(userId) {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new NotFoundError(messages.AUTH.USER_NOT_FOUND);
    }

    if (user.emailRegistered) {
      throw new ValidationError('Email already verified');
    }

    if (user.role !== 'DJ') {
      throw new ValidationError('Only DJ accounts require email verification');
    }

    try {
      const emailResult = await emailService.sendWelcomeEmail(user, user.displayName);
      logger.info(`Verification email resent to: ${user.email}`);
      return { success: true, token: emailResult.token };
    } catch (error) {
      if (error.message.includes('cooldown')) {
        throw new ValidationError(messages.AUTH.EMAIL_VERIFICATION_COOLDOWN);
      }
      if (error.message.includes('Too many')) {
        throw new ValidationError(messages.AUTH.EMAIL_VERIFICATION_LIMIT);
      }
      throw error;
    }
  }

  async verifyEmailToken(token) {
    try {
      const decoded = verifyToken(token);

      /* Check token type */
      if (decoded.type !== 'email-verification') {
        throw new UnauthorizedError('Invalid token type');
      }

      const user = await UserModel.findById(decoded.userId);
      if (!user) {
        throw new NotFoundError(messages.AUTH.USER_NOT_FOUND);
      }

      user.emailRegistered = true;
      user.emailRegisteredAt = new Date();
      await user.save();
      logger.info(`Email verified via token for user: ${user.email}`);

      return {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        emailRegistered: user.emailRegistered,
      };
    } catch (error) {
      if (
        error instanceof NotFoundError ||
        error instanceof UnauthorizedError
      ) {
        throw error;
      }
      throw new UnauthorizedError('Invalid or expired verification link');
    }
  }

}

module.exports = new AuthService();
