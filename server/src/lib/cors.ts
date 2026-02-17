import { env } from "../config.js";

const ALLOWED_ORIGINS = [
  "https://genco.tanzillo.ai",
  "http://localhost:5173",
];

if (env.FRONTEND_URL && !ALLOWED_ORIGINS.includes(env.FRONTEND_URL)) {
  ALLOWED_ORIGINS.push(env.FRONTEND_URL);
}

export function getAllowedOrigin(
  requestOrigin: string | undefined,
): string | null {
  if (!requestOrigin) return null;
  return ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : null;
}

export function setCorsHeaders(
  headers: { header: (name: string, value: string) => void },
  origin: string,
) {
  headers.header("Access-Control-Allow-Origin", origin);
  headers.header("Access-Control-Allow-Credentials", "true");
  headers.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
