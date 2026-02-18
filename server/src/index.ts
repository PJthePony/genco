import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { env } from "./config.js";
import { getAllowedOrigin, setCorsHeaders } from "./lib/cors.js";
import { authRoutes } from "./routes/auth.js";
import { queueRoutes } from "./routes/queue.js";
import { emailRoutes } from "./routes/emails.js";
import { feedbackRoutes } from "./routes/feedback.js";
import { settingsRoutes } from "./routes/settings.js";
import { networkRoutes } from "./routes/network.js";
import { startScheduler } from "./services/scheduler.js";

const app = new Hono();

// Global error handler — catch unhandled errors
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json(
    { error: "Internal server error" },
    500,
  );
});

// 404 handler
app.notFound((c) => c.json({ error: "Not found" }, 404));

app.use(logger());

// Global CORS preflight handler
app.use("*", async (c, next) => {
  const origin = getAllowedOrigin(c.req.header("origin"));

  if (c.req.method === "OPTIONS" && origin) {
    setCorsHeaders(c, origin);
    return c.body(null, 204);
  }

  await next();

  if (origin) {
    setCorsHeaders(c, origin);
  }
});

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// API routes
app.route("/auth", authRoutes);
app.route("/queue", queueRoutes);
app.route("/emails", emailRoutes);
app.route("/feedback", feedbackRoutes);
app.route("/settings", settingsRoutes);
app.route("/network", networkRoutes);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Genco is running on http://localhost:${info.port}`);

  // Start the hourly scan scheduler
  startScheduler();
});

export default app;
