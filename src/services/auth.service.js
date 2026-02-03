const bcrypt = require("bcryptjs");
const { UserModel } = require("../mongo_schema");
const { generateToken, verifyToken } = require("../utils/jwt.utils");
const { logger } = require("../utils");

class AuthService {
  async register(email, password, displayName, role = "ATTENDEE") {
    // Check if user exists
    const existingUser = await UserModel.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      throw new Error("Email already registered");
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
    // Find user with password field
    const user = await UserModel.findOne({ email: email.toLowerCase() }).select("+passwordHash");
    if (!user) {
      throw new Error("Invalid email or password");
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new Error("Invalid email or password");
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
    try {
      const decoded = verifyToken(token);
      const user = await UserModel.findById(decoded.userId);

      if (!user) {
        throw new Error("User not found");
      }

      const newToken = generateToken({
        userId: user._id,
        email: user.email,
        role: user.role,
      });

      return { token: newToken };
    } catch (error) {
      throw new Error("Invalid or expired token");
    }
  }

  async getCurrentUser(userId) {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new Error("User not found");
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
