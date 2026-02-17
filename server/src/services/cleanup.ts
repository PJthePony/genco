import { and, eq, lt, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { emailQueue } from "../db/schema.js";

/**
 * Strip heavy content (body, drafts) from processed emails older than `daysOld` days.
 * Keeps the metadata row (sender, subject, action taken, timestamps) for AI context.
 */
export async function pruneProcessedEmails(
  daysOld = 7,
): Promise<{ pruned: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);

  const result = await db
    .update(emailQueue)
    .set({
      bodyText: null,
      bodyHtml: null,
      aiReplyDraft: null,
    })
    .where(
      and(
        inArray(emailQueue.status, ["processed", "skipped"]),
        lt(emailQueue.processedAt, cutoff),
        // Only prune rows that still have body content
        // (avoid re-updating already-pruned rows)
      ),
    )
    .returning({ id: emailQueue.id });

  if (result.length > 0) {
    console.log(`Pruned body content from ${result.length} old emails`);
  }

  return { pruned: result.length };
}
