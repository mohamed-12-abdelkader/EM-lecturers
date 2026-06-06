"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gameRoutes = void 0;
const express_1 = require("express");
const GameController_1 = require("../controllers/GameController");
const router = (0, express_1.Router)();
exports.gameRoutes = router;
// Mount game routes
router.use('/game', GameController_1.router);
