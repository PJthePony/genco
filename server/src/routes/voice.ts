import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { gmailConnections, voiceProfiles, voiceSamples, voiceBucketAssignments } from "../db/schema.js";
import { authMiddleware, type AuthUser } from "../middleware/auth.js";
import {
  fetchSentEmailsForVoice,
  refreshAccessToken,
  type GoogleTokens,
} from "../lib/gmail.js";
import {
  analyzeVoiceProfiles,
  distillVoiceBucket,
  generateFollowUpDraft,
  type VoiceContext,
} from "../lib/claude.js";
import { inArray } from "drizzle-orm";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const voiceRoutes = new Hono<{ Variables: { user: AuthUser } }>();

voiceRoutes.use("*", authMiddleware);

// GET /voice — list current profiles + sample corpus stats
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

  // Count of persisted samples (corpus size)
  const sampleRows = await db.query.voiceSamples.findMany({
    where: eq(voiceSamples.userId, user.sub),
    columns: { id: true },
  });

  // Manual overrides
  const assignments = await db.query.voiceBucketAssignments.findMany({
    where: eq(voiceBucketAssignments.userId, user.sub),
    columns: { contactEmail: true, voiceProfileId: true },
  });

  return c.json({
    analyzedAt: latestAt,
    profiles: active,
    sampleCount: sampleRows.length,
    assignments,
  });
});

// DELETE /voice/samples — wipe the persisted corpus (start fresh)
voiceRoutes.delete("/samples", async (c) => {
  const user = c.get("user");
  await db.delete(voiceSamples).where(eq(voiceSamples.userId, user.sub));
  return c.json({ ok: true });
});

// POST /voice/analyze — fetch a batch of sent emails (default 50), append
// to the persisted corpus, then re-cluster across the full corpus.
// Body: { batchSize?: number }  (max 100 — Gmail fetch starts timing out above)
voiceRoutes.post("/analyze", async (c) => {
  const user = c.get("user");

  const body = (await c.req.json().catch(() => ({}))) as { batchSize?: number };
  const batchSize = Math.min(Math.max(body.batchSize ?? 50, 10), 100);

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

  // Skip messages we've already pulled in prior batches
  const existing = await db.query.voiceSamples.findMany({
    where: eq(voiceSamples.userId, user.sub),
    columns: { gmailMessageId: true, toEmail: true, toName: true, subject: true, body: true },
  });
  const seenIds = new Set(existing.map((s) => s.gmailMessageId));

  const fresh = await fetchSentEmailsForVoice(tokens, batchSize, seenIds);

  // Persist the new batch
  if (fresh.length > 0) {
    await db.insert(voiceSamples).values(
      fresh.map((s) => ({
        userId: user.sub,
        gmailMessageId: s.gmailMessageId,
        toEmail: s.to,
        toName: s.toName,
        subject: s.subject,
        body: s.body,
        sentAt: s.date,
      })),
    );
  }

  // Build the full corpus (existing + fresh)
  const corpus = [
    ...existing.map((s) => ({
      to: s.toEmail,
      toName: s.toName ?? "",
      subject: s.subject ?? "",
      body: s.body,
    })),
    ...fresh.map((s) => ({
      to: s.to,
      toName: s.toName,
      subject: s.subject,
      body: s.body,
    })),
  ];

  if (corpus.length < 20) {
    return c.json(
      {
        ok: true,
        added: fresh.length,
        totalSamples: corpus.length,
        buckets: 0,
        message: `Need at least 20 samples for clustering (have ${corpus.length}). Add more.`,
      },
    );
  }

  const buckets = await analyzeVoiceProfiles(corpus);

  // Replace profiles with the newly clustered set
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
    added: fresh.length,
    totalSamples: corpus.length,
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

// POST /voice/profiles/:id/split — pull selected recipients out of a bucket
// into a brand-new bucket distilled from just their samples.
// Body: { recipientEmails: string[], newLabel?: string }
voiceRoutes.post("/profiles/:id/split", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid id" }, 400);

  const body = (await c.req.json().catch(() => ({}))) as {
    recipientEmails?: string[];
    newLabel?: string;
  };
  const emails = Array.isArray(body.recipientEmails)
    ? body.recipientEmails
        .map((e) => (typeof e === "string" ? e.toLowerCase().trim() : ""))
        .filter(Boolean)
    : [];
  if (emails.length === 0) {
    return c.json({ error: "recipientEmails is required" }, 400);
  }

  const source = await db.query.voiceProfiles.findFirst({
    where: and(
      eq(voiceProfiles.id, id),
      eq(voiceProfiles.userId, user.sub),
    ),
  });
  if (!source) return c.json({ error: "Source bucket not found" }, 404);

  // Pull samples for these recipients from the persisted corpus
  const samples = await db.query.voiceSamples.findMany({
    where: and(
      eq(voiceSamples.userId, user.sub),
      inArray(voiceSamples.toEmail, emails),
    ),
  });

  if (samples.length < 2) {
    return c.json(
      { error: "Not enough emails to these recipients in your corpus. Analyze more first." },
      422,
    );
  }

  const bucket = await distillVoiceBucket(
    samples.map((s) => ({
      to: s.toEmail,
      toName: s.toName ?? "",
      subject: s.subject ?? "",
      body: s.body,
    })),
    { hintLabel: body.newLabel?.trim() || undefined },
  );

  const inserted = await db
    .insert(voiceProfiles)
    .values({
      userId: user.sub,
      label: bucket.label,
      description: bucket.description,
      formalityScore: String(bucket.formalityScore),
      greetingHabits: bucket.greetingHabits,
      signOffHabits: bucket.signOffHabits,
      sentenceStyle: bucket.sentenceStyle,
      samplePhrases: bucket.samplePhrases,
      sampleRecipients: bucket.sampleRecipients,
      matchSignals: bucket.matchSignals,
      analyzedAt: source.analyzedAt, // keep alongside the current clustering batch
    })
    .returning();

  const newProfileId = inserted[0].id;

  // Upsert assignments: these recipients always use the new bucket
  for (const email of emails) {
    await db
      .insert(voiceBucketAssignments)
      .values({
        userId: user.sub,
        contactEmail: email,
        voiceProfileId: newProfileId,
      })
      .onConflictDoUpdate({
        target: [voiceBucketAssignments.userId, voiceBucketAssignments.contactEmail],
        set: { voiceProfileId: newProfileId },
      });
  }

  return c.json({ ok: true, profile: inserted[0] });
});

// POST /voice/profiles/:id/move — move selected recipients INTO this bucket
// Body: { recipientEmails: string[] }
voiceRoutes.post("/profiles/:id/move", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid id" }, 400);

  const body = (await c.req.json().catch(() => ({}))) as {
    recipientEmails?: string[];
  };
  const emails = Array.isArray(body.recipientEmails)
    ? body.recipientEmails
        .map((e) => (typeof e === "string" ? e.toLowerCase().trim() : ""))
        .filter(Boolean)
    : [];
  if (emails.length === 0) {
    return c.json({ error: "recipientEmails is required" }, 400);
  }

  const target = await db.query.voiceProfiles.findFirst({
    where: and(
      eq(voiceProfiles.id, id),
      eq(voiceProfiles.userId, user.sub),
    ),
  });
  if (!target) return c.json({ error: "Target bucket not found" }, 404);

  for (const email of emails) {
    await db
      .insert(voiceBucketAssignments)
      .values({
        userId: user.sub,
        contactEmail: email,
        voiceProfileId: id,
      })
      .onConflictDoUpdate({
        target: [voiceBucketAssignments.userId, voiceBucketAssignments.contactEmail],
        set: { voiceProfileId: id },
      });
  }

  return c.json({ ok: true, moved: emails.length });
});

// DELETE /voice/assignments/:email — clear the manual override for a contact
voiceRoutes.delete("/assignments/:email", async (c) => {
  const user = c.get("user");
  const email = c.req.param("email").toLowerCase();
  await db
    .delete(voiceBucketAssignments)
    .where(
      and(
        eq(voiceBucketAssignments.userId, user.sub),
        eq(voiceBucketAssignments.contactEmail, email),
      ),
    );
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
