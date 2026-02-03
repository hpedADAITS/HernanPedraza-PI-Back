const { authService } = require("../services");
const { logger } = require("../utils");

class AuthController {
  async register(req, res, next) {
    try {
      const { email, password, displayName, role } = req.body;

      // Validation
      if (!email || !password || !displayName) {
        return res.status(400).json({
          success: false,
          error: { code: "MISSING_FIELDS", message: "Missing required fields" },
        });
      }

      const result = await authService.register(email, password, displayName, role);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error("Register error:", error);
      res.status(400).json({
        success: false,
        error: { code: "REGISTER_ERROR", message: error.message },
      });
    }
  }

  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: { code: "MISSING_FIELDS", message: "Email and password required" },
        });
      }

      const result = await authService.login(email, password);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error("Login error:", error);
      res.status(401).json({
        success: false,
        error: { code: "LOGIN_ERROR", message: error.message },
      });
    }
  }

  async refreshToken(req, res, next) {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({
          success: false,
          error: { code: "MISSING_TOKEN", message: "Token required" },
        });
      }

      const result = await authService.refreshToken(token);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error("Refresh token error:", error);
      res.status(401).json({
        success: false,
        error: { code: "TOKEN_ERROR", message: error.message },
      });
    }
  }

  async getCurrentUser(req, res, next) {
    try {
      const user = await authService.getCurrentUser(req.user.userId);

      res.json({
        success: true,
        data: { user },
      });
    } catch (error) {
      logger.error("Get current user error:", error);
      res.status(404).json({
        success: false,
        error: { code: "USER_NOT_FOUND", message: error.message },
      });
    }
  }
}

module.exports = new AuthController();
