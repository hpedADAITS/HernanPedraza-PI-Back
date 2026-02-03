const { Router } = require("express");
const { authController } = require("../controllers");
const { authenticate } = require("../middleware");

const router = Router();

// Public routes
router.post("/register", authController.register.bind(authController));
router.post("/login", authController.login.bind(authController));
router.post("/refresh", authController.refreshToken.bind(authController));

// Protected routes
router.get("/me", authenticate, authController.getCurrentUser.bind(authController));

module.exports = router;
