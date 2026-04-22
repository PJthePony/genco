import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  gmailConnections,
  briefingSources,
  userPreferences,
} from "../db/schema.js";
import { authMiddleware, type AuthUser } from "../middleware/auth.js";

export const settingsRoutes = new Hono<{ Variables: { user: AuthUser } }>();

settingsRoutes.use("*", authMiddleware);

// ── Preferences ─────────────────────────────────────────────────────────────

// GET /settings/preferences
settingsRoutes.get("/preferences", async (c) => {
  const user = c.get("user");

  const prefs = await db.query.userPreferences.findFirst({
    where: eq(userPreferences.userId, user.sub),
  });

  return c.json({
    scanFrequency: prefs?.scanFrequency ?? "10min",
    lucaEmail: prefs?.lucaEmail ?? null,
  });
});

// PUT /settings/preferences
settingsRoutes.put("/preferences", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    scanFrequency?: string;
    lucaEmail?: string | null;
  }>();

  const existing = await db.query.userPreferences.findFirst({
    where: eq(userPreferences.userId, user.sub),
  });

  // Normalize lucaEmail: empty string → null
  const normalizedLucaEmail =
    body.lucaEmail === undefined
      ? undefined
      : body.lucaEmail?.trim()
        ? body.lucaEmail.trim()
        : null;

  if (existing) {
    await db
      .update(userPreferences)
      .set({
        ...(body.scanFrequency !== undefined && {
          scanFrequency: body.scanFrequency,
        }),
        ...(normalizedLucaEmail !== undefined && {
          lucaEmail: normalizedLucaEmail,
        }),
        updatedAt: new Date(),
      })
      .where(eq(userPreferences.id, existing.id));
  } else {
    await db.insert(userPreferences).values({
      userId: user.sub,
      scanFrequency: body.scanFrequency ?? "10min",
      lucaEmail: normalizedLucaEmail ?? null,
    });
  }

  return c.json({ ok: true });
});

// ── Briefing Sources ────────────────────────────────────────────────────────

// GET /settings/briefing-sources
settingsRoutes.get("/briefing-sources", async (c) => {
  const user = c.get("user");

  const sources = await db.query.briefingSources.findMany({
    where: eq(briefingSources.userId, user.sub),
    orderBy: (bs, { asc }) => [asc(bs.displayName)],
  });

  return c.json({ sources });
});

// POST /settings/briefing-sources
settingsRoutes.post("/briefing-sources", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    emailAddress: string;
    displayName: string;
    tag?: string;
  }>();

  if (!body.emailAddress || !body.displayName) {
    return c.json({ error: "Missing emailAddress or displayName" }, 400);
  }

  const [source] = await db
    .insert(briefingSources)
    .values({
      userId: user.sub,
      emailAddress: body.emailAddress,
      displayName: body.displayName,
      tag: body.tag ?? null,
    })
    .onConflictDoNothing()
    .returning();

  return c.json({ ok: true, source: source ?? null });
});

// DELETE /settings/briefing-sources/:id
settingsRoutes.delete("/briefing-sources/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  await db
    .delete(briefingSources)
    .where(
      and(eq(briefingSources.id, id), eq(briefingSources.userId, user.sub)),
    );

  return c.json({ ok: true });
});

// ── Gmail Connection ────────────────────────────────────────────────────────

// GET /settings/gmail — connection status
settingsRoutes.get("/gmail", async (c) => {
  const user = c.get("user");
  const connection = await db.query.gmailConnections.findFirst({
    where: eq(gmailConnections.userId, user.sub),
  });

  return c.json({
    connected: !!connection,
    email: connection?.gmailAddress ?? null,
  });
});

// DELETE /settings/gmail — disconnect Gmail
settingsRoutes.delete("/gmail", async (c) => {
  const user = c.get("user");

  await db
    .delete(gmailConnections)
    .where(eq(gmailConnections.userId, user.sub));

  return c.json({ ok: true });
});
