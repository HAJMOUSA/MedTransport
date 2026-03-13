import { Request, Response, NextFunction } from 'express';
import { query } from '../db/pool';
import { logger } from '../lib/logger';

/**
 * Audit log middleware.
 * Logs all mutating API requests to the audit_log table.
 * READ (GET) requests to sensitive endpoints are logged.
 */
export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Only log mutations and sensitive reads
  const logMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  const sensitivePaths = ['/api/riders', '/api/trips', '/api/drivers', '/api/otp', '/api/auth'];

  const shouldLog = logMethods.includes(req.method) ||
    (req.method === 'GET' && sensitivePaths.some(p => req.path.startsWith(p)));

  if (!shouldLog || !req.user) {
    return next();
  }

  // Capture response to get the status code
  const originalSend = res.send.bind(res);
  res.send = function (body) {
    // Only log successful mutations
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const action = methodToAction(req.method, req.path);
      const entityInfo = extractEntityInfo(req);

      query(
        `INSERT INTO audit_log (org_id, user_id, user_role, entity_type, entity_id, action, details, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::inet, $9)`,
        [
          req.user?.orgId,
          req.user?.userId,
          req.user?.role,
          entityInfo.type,
          entityInfo.id,
          action,
          JSON.stringify({ path: req.path, method: req.method }),
          req.ip ?? req.socket.remoteAddress,
          req.headers['user-agent']?.slice(0, 200),
        ]
      ).catch((err) => {
        logger.error('Failed to write audit log', { error: (err as Error).message });
      });
    }

    return originalSend(body);
  };

  next();
}

function methodToAction(method: string, path: string): string {
  if (path.includes('/otp')) return method === 'POST' ? 'otp_sent' : 'otp_verified';
  if (path.includes('/auth/login')) return 'login';
  if (path.includes('/auth/logout')) return 'logout';
  if (path.includes('/import')) return 'csv_imported';
  const map: Record<string, string> = {
    GET: 'viewed', POST: 'created', PUT: 'updated', PATCH: 'updated', DELETE: 'deleted',
  };
  return map[method] ?? 'accessed';
}

function extractEntityInfo(req: Request): { type: string; id: number | null } {
  const segments = req.path.split('/').filter(Boolean);
  // /api/riders/42 → { type: 'rider', id: 42 }
  const typeMap: Record<string, string> = {
    riders: 'rider', trips: 'trip', drivers: 'driver',
    otp: 'otp', import: 'import', auth: 'auth',
  };
  const type = typeMap[segments[1]] ?? segments[1] ?? 'unknown';
  const id = segments[2] ? parseInt(segments[2], 10) : null;
  return { type, id: (id !== null && isNaN(id)) ? null : id };
}
