import { db } from "../db/index.js";
import { gmailConnections } from "../db/schema.js";
import { scanInbox } from "./scanner.js";
import { classifyPendingEmails } from "./classifier.js";
import { pruneProcessedEmails } from "./cleanup.js";

const SCAN_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Scan all connected Gmail accounts.
 * Called on a schedule to keep the queue fresh.
 */
async function scanAllAccounts(): Promise<void> {
  console.log("[Scheduler] Starting hourly scan for all accounts...");

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

    console.log("[Scheduler] Hourly scan complete.");
  } catch (err) {
    console.error("[Scheduler] Scan all accounts failed:", err);
  }
}

/**
 * Start the hourly scan scheduler.
 */
export function startScheduler(): void {
  if (intervalId) return; // Already running

  console.log(
    `[Scheduler] Started — scanning every ${SCAN_INTERVAL_MS / 60000} minutes`,
  );

  // Run immediately on startup (with a small delay to let server boot)
  setTimeout(() => {
    scanAllAccounts().catch((err) =>
      console.error("[Scheduler] Initial scan failed:", err),
    );
  }, 10_000);

  // Then run on interval
  intervalId = setInterval(() => {
    scanAllAccounts().catch((err) =>
      console.error("[Scheduler] Scheduled scan failed:", err),
    );
  }, SCAN_INTERVAL_MS);
}

/**
 * Stop the scheduler (for graceful shutdown).
 */
export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[Scheduler] Stopped.");
  }
}
