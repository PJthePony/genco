import { eq, and, ne, lte, gte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  networkContacts,
  contactContext,
  followUpQueue,
} from "../db/schema.js";

export interface FollowUpDetectionResult {
  inserted: number;
  wentCold: number;
  dateComingUp: number;
}

/**
 * Detect follow-up opportunities for a user's network contacts.
 * Pure SQL queries — no AI calls. Designed to run daily.
 *
 * Two detection rules:
 * 1. Awaiting reply (stored as "went_cold") — P.J. sent last, no response in 4+ days
 * 2. Date coming up — a personal fact has a relevant date within 7 days
 */
export async function detectFollowUps(
  userId: string,
): Promise<FollowUpDetectionResult> {
  let inserted = 0;
  let wentCold = 0;
  let dateComingUp = 0;

  // Get all network contacts for this user
  const contacts = await db.query.networkContacts.findMany({
    where: eq(networkContacts.userId, userId),
  });

  if (contacts.length === 0) {
    return { inserted: 0, wentCold: 0, dateComingUp: 0 };
  }

  // Get all existing pending/snoozed follow-ups to avoid duplicates
  const contactIds = contacts.map((c) => c.id);
  const existingFollowUps = await db.query.followUpQueue.findMany({
    where: sql`${followUpQueue.networkContactId} IN (${sql.join(
      contactIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}) AND ${followUpQueue.status} IN ('pending', 'snoozed')`,
  });

  // Build a set of "contactId:reason" to check for existing follow-ups
  const existingSet = new Set(
    existingFollowUps.map((f) => `${f.networkContactId}:${f.reason}`),
  );

  const now = new Date();
  const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // ── Rule 1: Awaiting reply ─────────────────────────────────────────────
  // P.J. sent last, they haven't replied in 4+ days
  for (const contact of contacts) {
    if (
      contact.lastContactAt &&
      contact.lastContactAt < fourDaysAgo &&
      contact.threadStatus === "awaiting_their_reply" &&
      !existingSet.has(`${contact.id}:went_cold`)
    ) {
      const daysSince = Math.floor(
        (now.getTime() - contact.lastContactAt.getTime()) /
          (24 * 60 * 60 * 1000),
      );

      try {
        await db.insert(followUpQueue).values({
          networkContactId: contact.id,
          reason: "went_cold",
          suggestedAction: "nudge",
          contextSnapshot: contact.lastSubject
            ? `${contact.displayName} hasn't replied in ${daysSince}d — last thread: "${contact.lastSubject}"`
            : `${contact.displayName} hasn't replied in ${daysSince}d`,
        });
        inserted++;
        wentCold++;
      } catch (err) {
        console.warn(
          `Failed to insert awaiting-reply follow-up for ${contact.email}:`,
          err,
        );
      }
    }
  }

  // ── Rule 3: Date coming up ─────────────────────────────────────────────
  // Personal facts with a dateRelevant within the next 7 days
  const upcomingFacts = await db.query.contactContext.findMany({
    where: and(
      sql`${contactContext.networkContactId} IN (${sql.join(
        contactIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
      eq(contactContext.expired, false),
      gte(contactContext.dateRelevant, now),
      lte(contactContext.dateRelevant, sevenDaysFromNow),
    ),
  });

  for (const fact of upcomingFacts) {
    if (!existingSet.has(`${fact.networkContactId}:date_coming_up`)) {
      const contact = contacts.find((c) => c.id === fact.networkContactId);
      if (!contact) continue;

      const daysUntil = fact.dateRelevant
        ? Math.ceil(
            (fact.dateRelevant.getTime() - now.getTime()) /
              (24 * 60 * 60 * 1000),
          )
        : 0;

      try {
        await db.insert(followUpQueue).values({
          networkContactId: fact.networkContactId,
          reason: "date_coming_up",
          suggestedAction: "compose_new",
          contextSnapshot: `${contact.displayName}: ${fact.fact} (in ${daysUntil} day${daysUntil === 1 ? "" : "s"})`,
        });
        inserted++;
        dateComingUp++;
        // Mark this contact as having a date follow-up so we don't duplicate
        existingSet.add(`${fact.networkContactId}:date_coming_up`);
      } catch (err) {
        console.warn(
          `Failed to insert date_coming_up follow-up for ${contact.email}:`,
          err,
        );
      }
    }
  }

  return { inserted, wentCold, dateComingUp };
}
