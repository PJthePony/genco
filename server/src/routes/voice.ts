import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { gmailConnections, voiceProfiles } from "../db/schema.js";
import { authMiddleware, type AuthUser } from "../middleware/auth.js";
import {
  fetchSentEmailsForVoice,
  refreshAccessToken,
  type GoogleTokens,
} from "../lib/gmail.js";
import { analyzeVoiceProfiles } from "../lib/claude.js";

export const voiceRoutes = new Hono<{ Variables: { user: AuthUser } }>();

voiceRoutes.use("*", authMiddleware);

// GET /voice — list current profiles for the signed-in user
voiceRoutes.get("/", async (c) => {
  const user = c.get("user");

  const profiles = await db.query.voiceProfiles.findMany({
    where: eq(voiceProfiles.userId, user.sub),
    orderBy: [desc(voiceProfiles.analyzedAt)],
  });

  // Group by analyzedAt to expose the most recent batch as the active set
  const latestAt = profiles[0]?.analyzedAt ?? null;
  const active = latestAt
    ? profiles.filter((p) => p.analyzedAt.getTime() === latestAt.getTime())
    : [];

  return c.json({
    analyzedAt: latestAt,
    profiles: active,
  });
});

// POST /voice/analyze — pull sent emails, cluster, replace existing profiles
voiceRoutes.post("/analyze", async (c) => {
  const user = c.get("user");

  const connection = await db.query.gmailConnections.findFirst({
    where: eq(gmailConnections.userId, user.sub),
  });
  if (!connection) return c.json({ error: "Gmail not connected" }, 422);

  let tokens = connection.googleTokens as GoogleTokens;
  if (
    tokens.expiry_date &&
    tokens.expiry_date < Date.now() + 5 * 60 * 1000
  ) {
    tokens = await refreshAccessToken(tokens);
    await db
      .update(gmailConnections)
      .set({ googleTokens: tokens, updatedAt: new Date() })
      .where(eq(gmailConnections.id, connection.id));
  }

  const samples = await fetchSentEmailsForVoice(tokens, 500);
  if (samples.length < 20) {
    return c.json(
      {
        error: "Not enough sent emails to analyze (need at least 20)",
        sampled: samples.length,
      },
      422,
    );
  }

  const buckets = await analyzeVoiceProfiles(
    samples.map((s) => ({
      to: s.to,
      toName: s.toName,
      subject: s.subject,
      body: s.body,
    })),
  );

  // Replace existing profiles with the new batch (single transaction-ish: delete then insert)
  await db.delete(voiceProfiles).where(eq(voiceProfiles.userId, user.sub));

  const now = new Date();
  if (buckets.length > 0) {
    await db.insert(voiceProfiles).values(
      buckets.map((b) => ({
        userId: user.sub,
        label: b.label,
        description: b.description,
        formalityScore: String(b.formalityScore),
        greetingHabits: b.greetingHabits,
        signOffHabits: b.signOffHabits,
        sentenceStyle: b.sentenceStyle,
        samplePhrases: b.samplePhrases,
        sampleRecipients: b.sampleRecipients,
        matchSignals: b.matchSignals,
        analyzedAt: now,
      })),
    );
  }

  return c.json({
    ok: true,
    sampled: samples.length,
    buckets: buckets.length,
    analyzedAt: now,
  });
});
