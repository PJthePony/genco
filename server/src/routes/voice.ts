import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { gmailConnections, voiceProfiles } from "../db/schema.js";
import { authMiddleware, type AuthUser } from "../middleware/auth.js";
import {
  fetchSentEmailsForVoice,
  refreshAccessToken,
  type GoogleTokens,
} from "../lib/gmail.js";
import {
  analyzeVoiceProfiles,
  generateFollowUpDraft,
  type VoiceContext,
} from "../lib/claude.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// PATCH /voice/:id — edit a bucket (label, description, sample phrases, etc.)
voiceRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid id" }, 400);

  const body = (await c.req.json().catch(() => ({}))) as Partial<{
    label: string;
    description: string;
    formalityScore: number | string;
    greetingHabits: string;
    signOffHabits: string;
    sentenceStyle: string;
    samplePhrases: string[];
  }>;

  const patch: Record<string, unknown> = {};
  if (typeof body.label === "string") patch.label = body.label;
  if (typeof body.description === "string") patch.description = body.description;
  if (body.formalityScore !== undefined)
    patch.formalityScore = String(body.formalityScore);
  if (typeof body.greetingHabits === "string")
    patch.greetingHabits = body.greetingHabits;
  if (typeof body.signOffHabits === "string")
    patch.signOffHabits = body.signOffHabits;
  if (typeof body.sentenceStyle === "string")
    patch.sentenceStyle = body.sentenceStyle;
  if (Array.isArray(body.samplePhrases))
    patch.samplePhrases = body.samplePhrases;

  if (Object.keys(patch).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  const updated = await db
    .update(voiceProfiles)
    .set(patch)
    .where(
      and(eq(voiceProfiles.id, id), eq(voiceProfiles.userId, user.sub)),
    )
    .returning();

  if (updated.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true, profile: updated[0] });
});

// DELETE /voice/:id — remove a bucket
voiceRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid id" }, 400);

  const deleted = await db
    .delete(voiceProfiles)
    .where(
      and(eq(voiceProfiles.id, id), eq(voiceProfiles.userId, user.sub)),
    )
    .returning({ id: voiceProfiles.id });

  if (deleted.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// POST /voice/preview — generate side-by-side drafts (with vs without voice)
// Body: { bucketId: uuid, recipientName: string, recipientEmail: string,
//         scenario: string }
// "scenario" is a free-form description of what the email should be about.
voiceRoutes.post("/preview", async (c) => {
  const user = c.get("user");

  const body = (await c.req.json().catch(() => ({}))) as {
    bucketId?: string;
    recipientName?: string;
    recipientEmail?: string;
    scenario?: string;
  };

  if (!body.bucketId || !UUID_RE.test(body.bucketId)) {
    return c.json({ error: "bucketId is required" }, 400);
  }
  if (!body.recipientName || !body.scenario) {
    return c.json({ error: "recipientName and scenario are required" }, 400);
  }

  const bucket = await db.query.voiceProfiles.findFirst({
    where: and(
      eq(voiceProfiles.id, body.bucketId),
      eq(voiceProfiles.userId, user.sub),
    ),
  });
  if (!bucket) return c.json({ error: "Bucket not found" }, 404);

  const voice: VoiceContext = {
    label: bucket.label,
    description: bucket.description,
    formalityScore: Number(bucket.formalityScore ?? 50),
    greetingHabits: bucket.greetingHabits ?? "",
    signOffHabits: bucket.signOffHabits ?? "",
    sentenceStyle: bucket.sentenceStyle ?? "",
    samplePhrases: Array.isArray(bucket.samplePhrases)
      ? (bucket.samplePhrases as string[])
      : [],
  };

  // Run both drafts in parallel
  const baseOpts = {
    contactName: body.recipientName,
    contactEmail: body.recipientEmail ?? "preview@example.com",
    senderSummary: null,
    reason: "preview",
    contextSnapshot: body.scenario,
    personalFacts: [],
    lastSubject: null,
    direction: body.scenario,
  };

  const [withVoice, withoutVoice] = await Promise.all([
    generateFollowUpDraft({ ...baseOpts, voice }),
    generateFollowUpDraft({ ...baseOpts, voice: null }),
  ]);

  return c.json({
    ok: true,
    withVoice,
    withoutVoice,
    voiceLabel: bucket.label,
  });
});
