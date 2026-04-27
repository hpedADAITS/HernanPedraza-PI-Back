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

class AuthService {
  async register(email, password, displayName, role = 'ATTENDEE') {
    // Validate input
    validateRegistration({ email, password, displayName, role });

    // Check if user exists
    const existingUser = await UserModel.findOne({
      email: email.toLowerCase(),
    });
    if (existingUser) {
      throw new ValidationError(messages.AUTH.USER_ALREADY_EXISTS);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const user = new UserModel({
      email,
      passwordHash,
      displayName,
      role,
    });

    await user.save();
    logger.info(`User registered: ${email}`);

    // Generate token for new user with user metadata
    const token = generateToken({
      userId: user._id,
      email: user.email,
      role: user.role,
    });

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
    // Validate input
    validateLogin({ email, password });

    // Find user with password field
    const user = await UserModel.findOne({
      email: email.toLowerCase(),
    }).select('+passwordHash');
    if (!user) {
      throw new UnauthorizedError(messages.AUTH.INVALID_CREDENTIALS);
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError(messages.AUTH.INVALID_CREDENTIALS);
    }

    // Update last login
    user.lastLoginAt = new Date();
    await user.save();

    // Generate token with user metadata
    const token = generateToken({
      userId: user._id,
      email: user.email,
      role: user.role,
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
    // Validate input
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
}

module.exports = new AuthService();
