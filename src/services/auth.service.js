const bcrypt = require("bcryptjs");
const { UserModel } = require("../models");
const { generateToken, verifyToken } = require("../utils/jwt.utils");
const { logger } = require("../utils");
const { ValidationError, UnauthorizedError, NotFoundError } = require("../errors");
const { messages } = require("../constants");
const {
  validateRegistration,
  validateLogin,
  validateTokenRefresh,
} = require("../validators/auth.validator");

class AuthService {
  async register(email, password, displayName, role = "ATTENDEE") {
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
    }).select("+passwordHash");
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
      role: user.role,
      lastLoginAt: user.lastLoginAt,
    };
  }
}

module.exports = new AuthService();
