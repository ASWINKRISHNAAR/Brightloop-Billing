import { Router } from 'express';
import { authController } from './auth.controller.js';
import { requireAuth } from '../../common/authMiddleware.js';

export const authRouter = Router();

authRouter.post('/register', (req, res, next) => authController.register(req, res, next));
authRouter.post('/login', (req, res, next) => authController.login(req, res, next));
authRouter.post('/refresh', (req, res, next) => authController.refresh(req, res, next));
authRouter.post('/logout', (req, res, next) => authController.logout(req, res, next));
authRouter.post('/forgot-password', (req, res, next) => authController.forgotPassword(req, res, next));
authRouter.post('/reset-password', (req, res, next) => authController.resetPassword(req, res, next));
authRouter.get('/me', requireAuth, (req, res, next) => authController.getMe(req, res, next));
