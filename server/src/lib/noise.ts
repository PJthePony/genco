/**
 * Shared noise-email detection — filters out newsletters, transactional senders,
 * and mass-email systems so they don't pollute the network contacts or follow-ups.
 */

/** Common noreply / system substrings in the full email address. */
const NOREPLY_SUBSTRINGS = [
  "noreply",
  "no-reply",
  "no_reply",
  "do-not-reply",
  "donotreply",
  "notifications",
  "mailer-daemon",
  "unsubscribe",
  "postmaster",
];

/** Local parts that are almost never a real person. */
const NOISE_LOCAL_PARTS = new Set([
  // Generic inboxes
  "info",
  "hello",
  "team",
  "support",
  "news",
  "newsletter",
  "newsletters",
  "updates",
  "marketing",
  "digest",
  "reply",
  "bounce",
  "contact",
  "feedback",
  "service",
  "help",
  "admin",
  "webmaster",
  // Transactional / auth
  "security",
  "verify",
  "confirm",
  "auth",
  "account",
  "accounts",
  "password",
  "billing",
  "receipts",
  "receipt",
  "invoice",
  "invoices",
  "orders",
  "order",
  "shipping",
  "delivery",
  "automated",
  "alerts",
  "alert",
  "notify",
  "notification",
  // Media / editorial
  "daily",
  "breaking",
  "morning",
  "editorial",
  "editor",
  "editors",
  "newsroom",
  "headlines",
  "subscriber",
  "members",
]);

/** Known automated / transactional sending domains (exact match). */
const NOISE_DOMAINS = new Set([
  "github.com",
  "sendgrid.net",
  "mailgun.org",
  "amazonses.com",
  "sparkpostmail.com",
  "mandrillapp.com",
  "mailchimp.com",
  "constantcontact.com",
  "postmarkapp.com",
  "intercom.io",
  "intercom-mail.com",
  "zendesk.com",
  "freshdesk.com",
  "hubspot.com",
  "hubspotmail.net",
  "mailjet.com",
  "sendinblue.com",
  "brevo.com",
  "klaviyo.com",
  "shopify.com",
  "squarespace.info",
  "squarespace.com",
  "wix.com",
  "stripe.com",
  "paypal.com",
  "venmo.com",
  "cashapp.com",
  "square.com",
  "intuit.com",
  "docusign.net",
  "docusign.com",
  "calendly.com",
  "eventbrite.com",
  "meetup.com",
  "slack.com",
  "slackbot.com",
  "atlassian.com",
  "jira.com",
  "trello.com",
  "notion.so",
  "linear.app",
  "figma.com",
  "canva.com",
  "dropbox.com",
  "box.com",
  "google.com",
  "googlemail.com",
  "youtube.com",
  "facebookmail.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "pinterest.com",
  "reddit.com",
  "tiktok.com",
  "apple.com",
  "microsoft.com",
  "amazonses.com",
  "amazon.com",
  "uber.com",
  "lyft.com",
  "doordash.com",
  "grubhub.com",
  "airbnb.com",
  "booking.com",
  "expedia.com",
  // App-specific / local
  "tanzillo.ai",
  "statesman.com",
]);

/** Domain prefixes that signal a mass-email subdomain (e.g. mail.company.com). */
const NOISE_DOMAIN_PREFIXES = [
  "mail.",
  "email.",
  "em.",
  "e.",
  "bounce.",
  "send.",
  "post.",
  "notify.",
  "alerts.",
  "transactional.",
  "mailer.",
  "msg.",
  "outbound.",
  "marketing.",
  "bulk.",
  "campaign.",
  "news.",
];

/**
 * Returns true if the email address looks like a newsletter, transactional,
 * or mass-email sender — not a real person you'd want to follow up with.
 */
export function isNoiseEmail(email: string, userEmail?: string): boolean {
  if (!email.includes("@")) return true;
  if (userEmail && email.toLowerCase() === userEmail.toLowerCase()) return true;

  const lower = email.toLowerCase();
  const local = lower.split("@")[0] ?? "";
  const domain = lower.split("@")[1] ?? "";

  // 1. Noreply / system substrings anywhere in the address
  for (const sub of NOREPLY_SUBSTRINGS) {
    if (lower.includes(sub)) return true;
  }

  // 2. Known noise local parts (exact match)
  if (NOISE_LOCAL_PARTS.has(local)) return true;

  // 3. Known automated sending domains (exact match)
  if (NOISE_DOMAINS.has(domain)) return true;

  // 4. Mass-email subdomain prefixes (e.g. mail.company.com)
  for (const prefix of NOISE_DOMAIN_PREFIXES) {
    if (domain.startsWith(prefix)) return true;
  }

  return false;
}
