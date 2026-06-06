import { Router } from 'express';
import { router as gameRouter } from '../controllers/GameController';

const router = Router();

// Mount game routes
router.use('/game', gameRouter);

export { router as gameRoutes };
