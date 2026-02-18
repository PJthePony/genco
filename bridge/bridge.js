#!/usr/bin/env node

/**
 * Genco iMessage Bridge
 *
 * Runs locally on a Mac. Reads iMessages via the Messages SQLite database,
 * pushes them to the Genco server for classification, polls for outbound
 * messages, and sends them via AppleScript.
 *
 * ENV:
 *   GENCO_API_URL   — e.g. https://genco-server.up.railway.app
 *   BRIDGE_API_KEY   — shared secret matching the server's BRIDGE_API_KEY
 *   POLL_INTERVAL_MS — how often to run (default: 60000 = 1 minute)
 *   MESSAGE_LOOKBACK_MINUTES — how far back to read messages (default: 120)
 */

import "dotenv/config";
import { execSync } from "child_process";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────

const API_URL = process.env.GENCO_API_URL || "http://localhost:3001";
const API_KEY = process.env.BRIDGE_API_KEY;
const USER_ID = process.env.GENCO_USER_ID;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || "60000", 10);
const LOOKBACK_MINUTES = parseInt(
  process.env.MESSAGE_LOOKBACK_MINUTES || "120",
  10,
);

if (!API_KEY) {
  console.error("BRIDGE_API_KEY is required");
  process.exit(1);
}
if (!USER_ID) {
  console.error("GENCO_USER_ID is required (your Supabase user ID)");
  process.exit(1);
}

// ── State ───────────────────────────────────────────────────────────────────

const STATE_FILE = join(__dirname, ".bridge-state.json");

function loadState() {
  if (existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  }
  return { lastReadDate: null };
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── iMessage Reading (via Messages.app SQLite DB) ───────────────────────────

const MESSAGES_DB = join(homedir(), "Library/Messages/chat.db");

function readRecentMessages(lookbackMinutes) {
  if (!existsSync(MESSAGES_DB)) {
    console.warn("Messages database not found at", MESSAGES_DB);
    console.warn(
      "Grant Full Disk Access to Terminal in System Settings > Privacy & Security",
    );
    return [];
  }

  let db;
  try {
    db = new Database(MESSAGES_DB, { readonly: true });
  } catch (err) {
    console.error("Cannot open Messages DB:", err.message);
    console.warn(
      "Grant Full Disk Access to Terminal in System Settings > Privacy & Security",
    );
    return [];
  }

  try {
    // Apple epoch: 2001-01-01 00:00:00 UTC
    // date column is in nanoseconds since Apple epoch
    const appleEpochOffset = 978307200; // seconds between Unix epoch and Apple epoch
    const cutoffUnix =
      Math.floor(Date.now() / 1000) - lookbackMinutes * 60;
    const cutoffAppleNano = (cutoffUnix - appleEpochOffset) * 1_000_000_000;

    const rows = db
      .prepare(
        `
      SELECT
        m.rowid,
        m.guid,
        m.text,
        m.is_from_me,
        m.date AS date_apple_nano,
        m.date_read,
        h.id AS handle_id,
        h.service
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.rowid
      WHERE m.date > ?
        AND m.text IS NOT NULL
        AND m.text != ''
        AND m.associated_message_type = 0
      ORDER BY m.date DESC
      LIMIT 200
    `,
      )
      .all(cutoffAppleNano);

    return rows.map((row) => {
      const unixTimestamp =
        Math.floor(row.date_apple_nano / 1_000_000_000) + appleEpochOffset;
      return {
        guid: row.guid,
        text: row.text,
        isFromMe: row.is_from_me === 1,
        senderPhone: row.handle_id || "unknown",
        receivedAt: new Date(unixTimestamp * 1000).toISOString(),
        service: row.service || "iMessage",
      };
    });
  } finally {
    db.close();
  }
}

// ── Contact name lookup via AppleScript ─────────────────────────────────────

const nameCache = new Map();

function lookupContactName(phone) {
  if (nameCache.has(phone)) return nameCache.get(phone);

  try {
    const script = `
      tell application "Contacts"
        set matchingPeople to (every person whose value of every phone of it contains "${phone.replace(/"/g, '\\"')}")
        if (count of matchingPeople) > 0 then
          set p to item 1 of matchingPeople
          return (first name of p & " " & last name of p)
        else
          return ""
        end if
      end tell
    `;
    const result = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      timeout: 5000,
      encoding: "utf-8",
    }).trim();
    nameCache.set(phone, result || null);
    return result || null;
  } catch {
    nameCache.set(phone, null);
    return null;
  }
}

// ── iMessage Sending via AppleScript ────────────────────────────────────────

function sendIMessage(phone, text) {
  const escapedText = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const escapedPhone = phone.replace(/"/g, '\\"');

  const script = `
    tell application "Messages"
      set targetService to 1st service whose service type = iMessage
      set targetBuddy to buddy "${escapedPhone}" of targetService
      send "${escapedText}" to targetBuddy
    end tell
  `;

  try {
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      timeout: 10000,
    });
    return true;
  } catch (err) {
    console.error(`Failed to send iMessage to ${phone}:`, err.message);
    return false;
  }
}

// ── API Helpers ─────────────────────────────────────────────────────────────

async function apiPost(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function apiGet(path) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// ── Main Loop ───────────────────────────────────────────────────────────────

async function ingestMessages() {
  console.log("[ingest] Reading recent iMessages...");
  const messages = readRecentMessages(LOOKBACK_MINUTES);

  if (messages.length === 0) {
    console.log("[ingest] No messages found.");
    return;
  }

  // Filter to incoming messages only (not from me)
  const incoming = messages.filter((m) => !m.isFromMe);
  console.log(
    `[ingest] Found ${messages.length} messages, ${incoming.length} incoming.`,
  );

  if (incoming.length === 0) return;

  // Look up names
  const withNames = incoming.map((m) => ({
    senderPhone: m.senderPhone,
    senderName: lookupContactName(m.senderPhone),
    messageText: m.text,
    receivedAt: m.receivedAt,
    isFromMe: false,
  }));

  try {
    const result = await apiPost("/messages/ingest", { userId: USER_ID, messages: withNames });
    console.log(
      `[ingest] Sent ${withNames.length} messages. Server: ${result.inserted || 0} new, ${result.duplicates || 0} dupes.`,
    );

    // Trigger classification
    if (result.inserted > 0) {
      console.log("[classify] Triggering classification...");
      const classifyResult = await apiPost("/messages/classify", { userId: USER_ID });
      console.log(
        `[classify] Classified ${classifyResult.classified || 0} messages.`,
      );
    }
  } catch (err) {
    console.error("[ingest] Error:", err.message);
  }
}

async function processOutbound() {
  try {
    const data = await apiGet(`/messages/outbound?userId=${USER_ID}`);
    const pending = data.items || [];

    if (pending.length === 0) return;

    console.log(`[outbound] ${pending.length} messages to send.`);

    for (const msg of pending) {
      console.log(
        `[outbound] Sending to ${msg.recipientName || msg.recipientPhone}: "${msg.messageText.slice(0, 50)}..."`,
      );
      const sent = sendIMessage(msg.recipientPhone, msg.messageText);

      if (sent) {
        await apiPost(`/messages/outbound/${msg.id}/sent`, {});
        console.log(`[outbound] Marked ${msg.id} as sent.`);
      } else {
        await apiPost(`/messages/outbound/${msg.id}/failed`, {});
        console.error(`[outbound] Marked ${msg.id} as failed.`);
      }
    }
  } catch (err) {
    console.error("[outbound] Error:", err.message);
  }
}

async function tick() {
  const start = Date.now();
  await ingestMessages();
  await processOutbound();
  const elapsed = Date.now() - start;
  console.log(
    `[tick] Done in ${elapsed}ms. Next run in ${POLL_INTERVAL / 1000}s.\n`,
  );
}

// ── Startup ─────────────────────────────────────────────────────────────────

console.log("=== Genco iMessage Bridge ===");
console.log(`Server: ${API_URL}`);
console.log(`Poll interval: ${POLL_INTERVAL / 1000}s`);
console.log(`Lookback: ${LOOKBACK_MINUTES} minutes`);
console.log("");

// Run immediately, then on interval
tick();
setInterval(tick, POLL_INTERVAL);
