import { JWT } from "@colyseus/auth";
import type { Request, Response, NextFunction } from "express";

export interface AuthUser {
  id: string;
  username?: string;
  avatar?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = header.slice(7);
  if (token.length > 4096) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  try {
    const payload = (await JWT.verify(token)) as Record<string, unknown>;
    const id = payload?.id;
    if (typeof id !== "string" || !id) {
      res.status(401).json({ error: "Invalid token payload" });
      return;
    }
    req.user = {
      id,
      username: typeof payload.username === "string" ? payload.username : undefined,
      avatar: typeof payload.avatar === "string" ? payload.avatar : undefined,
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}
