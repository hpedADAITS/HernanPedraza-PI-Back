const { Router } = require('express');
const { authController } = require('../controllers');
const { authenticate } = require('../middleware');

const router = Router();

/* Public routes */
router.post('/register', authController.register.bind(authController));
router.post('/login', authController.login.bind(authController));

/* Protected routes */
router.post(
  '/logout',
  authenticate,
  authController.logout.bind(authController),
);

router.get(
  '/me',
  authenticate,
  authController.getCurrentUser.bind(authController),
);

router.patch(
  '/me',
  authenticate,
  authController.updateProfile.bind(authController),
);

router.patch(
  '/me/picture',
  authenticate,
  authController.updateProfilePicture.bind(authController),
);

router.post(
  '/verify-email',
  authenticate,
  authController.verifyEmail.bind(authController),
);

/* Verify email via token (public endpoint, for email link access) */
router.get(
  '/verify-email/:token',
  authController.verifyEmailToken.bind(authController),
);

module.exports = router;
