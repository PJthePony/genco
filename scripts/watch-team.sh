#!/usr/bin/env python3
"""
Watch team inbox messages in real time.

Usage:
  ./scripts/watch-team.sh              # watch all inboxes
  ./scripts/watch-team.sh team-lead    # watch only team-lead's inbox
  ./scripts/watch-team.sh ux-designer  # watch only ux-designer's inbox
"""

import json
import os
import sys
import textwrap
import time
from pathlib import Path

TEAM_DIR = Path.home() / ".claude" / "teams" / "genco-ux-redesign" / "inboxes"
POLL_INTERVAL = 2
AGENT_FILTER = sys.argv[1] if len(sys.argv) > 1 else None

# ANSI colors
BLUE = "\033[0;34m"
GREEN = "\033[0;32m"
YELLOW = "\033[0;33m"
ORANGE = "\033[0;91m"
CYAN = "\033[0;36m"
DIM = "\033[2m"
BOLD = "\033[1m"
RESET = "\033[0m"

COLORS = {
    "ux-designer": BLUE,
    "product-designer": GREEN,
    "frontend-engineer": YELLOW,
    "team-lead": ORANGE,
}

seen_counts: dict[str, int] = {}


def decode_message(text: str) -> str:
    """Try to decode protocol JSON into readable text."""
    try:
        parsed = json.loads(text)
        msg_type = parsed.get("type", "")
        if msg_type == "permission_request":
            return f'[permission request] {parsed.get("description", "")} — tool: {parsed.get("tool_name", "")}'
        elif msg_type == "idle":
            return f'[idle] {parsed.get("summary", "")}'
        elif msg_type == "shutdown_request":
            return "[shutdown request]"
        elif msg_type == "shutdown_response":
            approved = parsed.get("approve", False)
            return f'[shutdown {"approved" if approved else "rejected"}]'
        elif msg_type == "plan_approval_request":
            return "[plan ready for review]"
        elif msg_type == "plan_approval_response":
            approved = parsed.get("approve", False)
            return f'[plan {"approved" if approved else "rejected"}]'
        elif "content" in parsed:
            return parsed["content"]
        elif "summary" in parsed:
            return parsed["summary"]
    except (json.JSONDecodeError, TypeError):
        pass
    return text


def print_messages(filepath: Path):
    inbox_owner = filepath.stem
    if AGENT_FILTER and inbox_owner != AGENT_FILTER:
        return

    try:
        with open(filepath) as f:
            msgs = json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return

    already_seen = seen_counts.get(str(filepath), 0)
    if len(msgs) <= already_seen:
        return

    for msg in msgs[already_seen:]:
        sender = msg.get("from", "?")
        ts = msg.get("timestamp", "")[:19].replace("T", " ")
        text = decode_message(msg.get("text", ""))

        if len(text) > 500:
            text = text[:500] + "..."

        wrapped = textwrap.fill(text, width=80, initial_indent="  ", subsequent_indent="  ")

        from_color = COLORS.get(sender, CYAN)
        to_color = COLORS.get(inbox_owner, CYAN)

        print(f"{from_color}{BOLD}FROM:{RESET} {from_color}{sender}{RESET}")
        print(f"{to_color}{BOLD}  TO:{RESET} {to_color}{inbox_owner}{RESET}")
        print(f"{DIM}  AT: {ts}{RESET}")
        print(wrapped)
        print("---")
        sys.stdout.flush()

    seen_counts[str(filepath)] = len(msgs)


def main():
    print(f"{BOLD}Watching team: genco-ux-redesign{RESET}")
    if AGENT_FILTER:
        print(f"{DIM}Filtering to: {AGENT_FILTER}{RESET}")
    print(f"{DIM}Press Ctrl+C to stop{RESET}")
    print("===")
    sys.stdout.flush()

    try:
        while True:
            if TEAM_DIR.exists():
                for filepath in sorted(TEAM_DIR.glob("*.json")):
                    print_messages(filepath)
            time.sleep(POLL_INTERVAL)
    except KeyboardInterrupt:
        print(f"\n{DIM}Stopped.{RESET}")


if __name__ == "__main__":
    main()
