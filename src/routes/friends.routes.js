const { Router } = require('express');
const { friendsController } = require('../controllers');
const { authenticate } = require('../middleware');

const router = Router();

router.use(authenticate);

/* Friendships */
router.get('/', friendsController.listFriends.bind(friendsController));
router.delete(
  '/:friendId',
  friendsController.unfriend.bind(friendsController),
);

/* Friend requests */
router.post(
  '/requests',
  friendsController.sendRequest.bind(friendsController),
);
router.get(
  '/requests',
  friendsController.listRequests.bind(friendsController),
);
router.patch(
  '/requests/:id',
  friendsController.respondRequest.bind(friendsController),
);
router.delete(
  '/requests/:id',
  friendsController.cancelRequest.bind(friendsController),
);

/* Event invites */
router.post(
  '/invites',
  friendsController.sendInvite.bind(friendsController),
);
router.get(
  '/invites',
  friendsController.listInvites.bind(friendsController),
);
router.patch(
  '/invites/:id',
  friendsController.respondInvite.bind(friendsController),
);

module.exports = router;
