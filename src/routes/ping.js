const { Router } = require("express");

const router = Router();

router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "La API de SyncRekuest está ejecutándose",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
