import { db } from "../db/index.js";
import { gmailConnections, userPreferences } from "../db/schema.js";
import { scanInbox } from "./scanner.js";
import { classifyPendingEmails } from "./classifier.js";
import { pruneProcessedEmails } from "./cleanup.js";
import { detectFollowUps } from "./followup.js";

const FREQUENCY_MS: Record<string, number> = {
  "10min": 10 * 60 * 1000,
  "30min": 30 * 60 * 1000,
  hourly: 60 * 60 * 1000,
};
const DEFAULT_INTERVAL_MS = FREQUENCY_MS["10min"];
const FOLLOW_UP_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let timeoutId: ReturnType<typeof setTimeout> | null = null;
let lastFollowUpCheck = 0;
let running = false;

/**
 * Read the scan frequency from user preferences.
 * Falls back to 10 minutes if no preference is set.
 */
async function getScanIntervalMs(): Promise<number> {
  try {
    const pref = await db.query.userPreferences.findFirst();
    return FREQUENCY_MS[pref?.scanFrequency ?? ""] ?? DEFAULT_INTERVAL_MS;
  } catch {
    return DEFAULT_INTERVAL_MS;
  }
}

/**
 * Scan all connected Gmail accounts.
 * Called on a schedule to keep the queue fresh.
 */
async function scanAllAccounts(): Promise<void> {
  console.log("[Scheduler] Starting scan for all accounts...");

  try {
    // Get all connected Gmail accounts
    const connections = await db.query.gmailConnections.findMany();

    if (connections.length === 0) {
      console.log("[Scheduler] No connected accounts, skipping.");
      return;
    }

    for (const conn of connections) {
      try {
        const scanResult = await scanInbox(conn.userId);
        console.log(
          `[Scheduler] Scanned ${conn.gmailAddress}: ${scanResult.fetched} fetched, ${scanResult.inserted} new, ${scanResult.autoArchived} auto-archived`,
        );

        if (scanResult.inserted > 0) {
          const classifyResult = await classifyPendingEmails(conn.userId);
          console.log(
            `[Scheduler] Classified for ${conn.gmailAddress}: ${classifyResult.processed} processed, ${classifyResult.urgent} urgent`,
          );
        }
      } catch (err) {
        console.error(
          `[Scheduler] Failed to scan ${conn.gmailAddress}:`,
          err,
        );
      }
    }

    // Housekeeping: prune old processed emails
    await pruneProcessedEmails().catch((err) =>
      console.warn("[Scheduler] Prune failed:", err),
    );

    // Daily follow-up detection (run once every 24h)
    const now = Date.now();
    if (now - lastFollowUpCheck > FOLLOW_UP_CHECK_INTERVAL_MS) {
      lastFollowUpCheck = now;
      for (const conn of connections) {
        try {
          const result = await detectFollowUps(conn.userId);
          if (result.inserted > 0) {
            console.log(
              `[Scheduler] Follow-up detection for ${conn.gmailAddress}: ${result.inserted} new (${result.wentCold} awaiting-reply, ${result.dateComingUp} date-coming-up)`,
            );
          }
        } catch (err) {
          console.error(
            `[Scheduler] Follow-up detection failed for ${conn.gmailAddress}:`,
            err,
          );
        }
      }
    }

    console.log("[Scheduler] Scan complete.");
  } catch (err) {
    console.error("[Scheduler] Scan all accounts failed:", err);
  }
}

/**
 * Schedule the next scan, reading the user's preferred interval.
 */
async function scheduleNext(): Promise<void> {
  if (!running) return;

  const intervalMs = await getScanIntervalMs();

  timeoutId = setTimeout(async () => {
    await scanAllAccounts().catch((err) =>
      console.error("[Scheduler] Scheduled scan failed:", err),
    );
    scheduleNext();
  }, intervalMs);

  console.log(
    `[Scheduler] Next scan in ${intervalMs / 60000} minutes`,
  );
}

/**
 * Start the scan scheduler.
 */
export function startScheduler(): void {
  if (running) return;
  running = true;

  console.log("[Scheduler] Started");

  // Run immediately on startup (with a small delay to let server boot)
  setTimeout(async () => {
    await scanAllAccounts().catch((err) =>
      console.error("[Scheduler] Initial scan failed:", err),
    );
    scheduleNext();
  }, 10_000);
}

/**
 * Stop the scheduler (for graceful shutdown).
 */
export function stopScheduler(): void {
  running = false;
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
  console.log("[Scheduler] Stopped.");
}
