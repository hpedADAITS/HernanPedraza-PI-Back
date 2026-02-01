const { Router } = require("express");
const ping = require("./ping");

const router = Router();

// Server is running lolol
router.use("/ping", ping);

module.exports = router;
