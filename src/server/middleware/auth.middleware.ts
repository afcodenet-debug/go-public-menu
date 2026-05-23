// src/server/middleware/auth.middleware.ts
import { Request, Response, NextFunction } from 'express';

export interface AuthenticatedRequest extends Request {
  user?: { id: string; role: string };
  businessId?: string;
  branchId?: string | null;
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  // Version minimale pour le développement
  // À remplacer plus tard par une vraie validation JWT Supabase
  req.user = { id: 'system', role: 'admin' };
  req.businessId = 'default-business'; // temporaire en mode single business
  req.branchId = null;

  next();
}
