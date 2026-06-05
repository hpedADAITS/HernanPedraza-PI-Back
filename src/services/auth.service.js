const bcrypt = require('bcryptjs');
const config = require('../config');
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
} = require('../validators/auth.validator');
const emailService = require('./email.service');

class AuthService {
  buildAuthToken(user) {
    return generateToken({
      userId: user._id,
      email: user.email,
      role: user.role === 'ADMIN' ? 'DJ' : user.role,
      type: 'default',
      tokenVersion: user.authTokenVersion || 0,
    });
  }

  async validateDefaultToken(token) {
    const decoded = verifyToken(token);

    if (decoded.type && decoded.type !== 'default') {
      throw new UnauthorizedError('Invalid token type');
    }

    if (!Number.isInteger(decoded.tokenVersion)) {
      throw new UnauthorizedError(messages.AUTH.INVALID_TOKEN);
    }

    decoded.userId = decoded.userId?.toString();

    const user = await UserModel.findById(decoded.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedError(messages.AUTH.INVALID_TOKEN);
    }

    if ((user.authTokenVersion || 0) !== decoded.tokenVersion) {
      throw new UnauthorizedError(messages.AUTH.INVALID_TOKEN);
    }

    const normalizedUser = { ...user };
    if (normalizedUser.role === 'ADMIN') {
      normalizedUser.role = 'DJ';
    }

    return { decoded, user: normalizedUser };
  }

  async register(email, password, displayName, role = 'ATTENDEE') {
    /* Validate input */
    validateRegistration({ email, password, displayName, role });

    /* Role assignment: the server decides. Public registration always
       creates an ATTENDEE — the only way to escalate is DEBUG_MODE=true
       (development only; config.js refuses to start the server with
       DEBUG_MODE=true in production). This closes the self-registration
       privilege escalation where a client could POST role:'ADMIN' and
       become an admin. */
    const callerRole = config.debugMode ? role : 'ATTENDEE';
    if (callerRole !== role) {
      logger.warn(
        `Register: client supplied role=${role} but DEBUG_MODE is off; forcing ATTENDEE for ${email}`,
      );
    }

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
      role: callerRole,
    });

    await user.save();
    logger.info(`User registered: ${email}`);

    /* Generate token for new user with user metadata */
    const token = this.buildAuthToken(user);

    let emailVerificationToken;
    /* Only DJ accounts need email verification; ATTENDEEs are unverified
       by design and are gated by the EventMember model per-event. */
    if (callerRole === 'DJ') {
      try {
        const emailResult = await emailService.sendWelcomeEmail(user, displayName);
        if (emailResult?.token) {
          emailVerificationToken = emailResult.token;
        }
      } catch (err) {
        logger.error(`Failed to send welcome email to ${email}:`, err);
      }
    }

    return {
      token,
      ...(emailVerificationToken && { emailVerificationToken }),
      user: {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        profilePicture: user.profilePicture,
        role: user.role,
        emailRegistered: user.emailRegistered,
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

    /* Update last login and invalidate older auth tokens */
    user.lastLoginAt = new Date();
    user.authTokenVersion = (user.authTokenVersion || 0) + 1;
    if (!user.hasSeenTutorial) {
      user.hasSeenTutorial = false; // Will be set to true after tutorial is shown
    }
    await user.save();

    /* Generate token with user metadata */
    const token = this.buildAuthToken(user);

    logger.info(`User logged in: ${email}`);

    return {
      token,
      user: {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        profilePicture: user.profilePicture,
        role: user.role,
        emailRegistered: user.emailRegistered,
        hasSeenTutorial: user.hasSeenTutorial,
      },
    };
  }

  async logout(userId) {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new NotFoundError(messages.AUTH.USER_NOT_FOUND);
    }

    user.authTokenVersion = (user.authTokenVersion || 0) + 1;
    await user.save();
    logger.info(`User logged out: ${user.email}`);

    return { success: true };
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
      hasSeenTutorial: user.hasSeenTutorial,
    };
  }

  async markTutorialAsSeen(userId) {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new NotFoundError(messages.AUTH.USER_NOT_FOUND);
    }
    user.hasSeenTutorial = true;
    await user.save();
    return { success: true };
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

    if (profilePicture !== null && typeof profilePicture !== 'string') {
      throw new ValidationError('Profile picture must be a valid string or null');
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
      return {
        success: true,
        ...(emailResult?.token && { emailVerificationToken: emailResult.token }),
      };
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
    /* Check 1: null check */
    if (!token) {
      throw new UnauthorizedError('Verification token is missing');
    }

    /* Check 2: string type */
    if (typeof token !== 'string') {
      throw new UnauthorizedError('Invalid token format');
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (verifyError) {
      logger.error('Token verification failed:', { message: verifyError.message });
      throw new UnauthorizedError('Invalid or expired verification link');
    }

    if (!decoded) {
      throw new UnauthorizedError('Invalid verification token');
    }

    /* Check token type */
    if (decoded.type !== 'email-verification') {
      throw new UnauthorizedError('Invalid token type');
    }

    if (!decoded.verificationTokenId) {
      throw new UnauthorizedError('Invalid verification token');
    }

    const user = await UserModel.findById(decoded.userId);
    if (!user) {
      throw new NotFoundError(messages.AUTH.USER.USER_NOT_FOUND);
    }

    if (user.role !== 'DJ') {
      throw new ValidationError('Only DJ accounts require email verification');
    }

    if (!user.emailVerificationTokenId) {
      throw new UnauthorizedError('Verification token already used or replaced');
    }

    if (decoded.verificationTokenId !== user.emailVerificationTokenId) {
      throw new UnauthorizedError('Verification token already used or replaced');
    }

    if (user.emailRegistered) {
      return {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        emailRegistered: user.emailRegistered,
      };
    }

    user.emailRegistered = true;
    user.emailRegisteredAt = new Date();
    user.emailVerificationTokenId = null;
    await user.save();
    logger.info(`Email verified via token for user: ${user.email}`);

    // Generate new token with updated emailRegistered status
    const newToken = this.buildAuthToken(user);

    return {
      token: newToken,
      user: {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        profilePicture: user.profilePicture,
        role: user.role,
        emailRegistered: user.emailRegistered,
      },
    };
  }

}

module.exports = new AuthService();
