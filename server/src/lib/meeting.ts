/**
 * Heuristic: does this draft body suggest a meeting?
 * Used to decide whether to offer to CC Luca (the calendar manager).
 *
 * Looks for (action verb that implies scheduling) AND (a time signal OR
 * an explicit scheduling word). Conservative so we don't CC Luca on
 * every "let me know" reply.
 */
export function draftSuggestsMeeting(body: string): boolean {
  if (!body || body.length < 10) return false;
  const text = body.toLowerCase();

  const actionRx =
    /\b(meet(?:ing)?|call|coffee|lunch|dinner|drinks|chat|catch up|catch-up|hop on|jump on|zoom|sync|1:1|one-on-one|get together|grab (?:a )?(?:coffee|bite|drink)|face[- ]to[- ]face)\b/;

  const scheduleRx =
    /\b(schedule|calendar|availability|when works|when are you (?:free|available)|free (?:this|next) (?:week|month|monday|tuesday|wednesday|thursday|friday)|find (?:a )?time|block (?:off|out) time|put (?:something|time) on (?:the|my|your) calendar)\b/;

  const timeRx =
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this week|tomorrow|\d{1,2}\s?(?:am|pm|:\d{2})|\d{1,2}\s?o'clock|morning|afternoon|evening)\b/;

  const hasAction = actionRx.test(text);
  const hasSchedule = scheduleRx.test(text);
  const hasTime = timeRx.test(text);

  // Strong: explicit scheduling word alone
  if (hasSchedule) return true;
  // Action + time signal together
  if (hasAction && hasTime) return true;
  return false;
}
