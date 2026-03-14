#!/usr/bin/env python3
"""
keygen.py — Ping Analyst API Key Manager
------------------------------------------
Manages Pipeline/users.json directly from your terminal.

Commands:

  add <email> [name]          Generate a new key and add to users.json
  remove <PING-XXXX-XXXX>     Revoke a key (delete from users.json)
  list                        Show all active users and their keys

Examples:

  python3 Pipeline/keygen.py add jane@company.com "Jane Doe"
  python3 Pipeline/keygen.py add jane@company.com        # name defaults to email prefix
  python3 Pipeline/keygen.py remove PING-A3K9-BX2M
  python3 Pipeline/keygen.py list

After add/remove, commit and push users.json — Railway will redeploy automatically.
"""

import json
import secrets
import string
import sys
from pathlib import Path

USERS_FILE = Path(__file__).parent / "users.json"


# ── Helpers ──────────────────────────────────────────────────────────────────────

def _load() -> dict:
    if USERS_FILE.exists():
        return json.loads(USERS_FILE.read_text())
    return {}


def _save(users: dict) -> None:
    USERS_FILE.write_text(json.dumps(users, indent=2) + "\n")


def _gen_key() -> str:
    chars = string.ascii_uppercase + string.digits
    seg = lambda n: "".join(secrets.choice(chars) for _ in range(n))
    return f"PING-{seg(4)}-{seg(4)}"


# ── Commands ─────────────────────────────────────────────────────────────────────

def cmd_add(email: str, name: str) -> None:
    users = _load()

    # Check for duplicate email
    for key, user in users.items():
        if user["email"].lower() == email.lower():
            print(f"\n  ⚠️  {email} already has a key: {key}  ({user['name']})")
            print(f"  Remove it first with:  python3 Pipeline/keygen.py remove {key}\n")
            sys.exit(1)

    key = _gen_key()
    users[key] = {"email": email, "name": name}
    _save(users)

    print(f"\n  ✅  Key created and added to users.json\n")
    print(f"  Name:   {name}")
    print(f"  Email:  {email}")
    print(f"  Key:    {key}")
    print(f"\n  Next: git add Pipeline/users.json && git commit -m 'Add user {name}' && git push\n")


def cmd_remove(key: str) -> None:
    key = key.strip().upper()
    users = _load()

    if key not in users:
        print(f"\n  ❌  Key not found: {key}\n")
        print(f"  Run  python3 Pipeline/keygen.py list  to see active keys.\n")
        sys.exit(1)

    user = users.pop(key)
    _save(users)

    print(f"\n  ✅  Key revoked and removed from users.json\n")
    print(f"  Was: {key}  →  {user['name']} <{user['email']}>")
    print(f"\n  Next: git add Pipeline/users.json && git commit -m 'Remove user {user[\"name\"]}' && git push\n")


def cmd_list() -> None:
    users = _load()

    if not users:
        print("\n  No users in users.json.\n")
        return

    print(f"\n  {'KEY':<20}  {'NAME':<20}  EMAIL")
    print(f"  {'─'*20}  {'─'*20}  {'─'*30}")
    for key, user in users.items():
        print(f"  {key:<20}  {user['name']:<20}  {user['email']}")
    print()


# ── Entry point ───────────────────────────────────────────────────────────────────

def main():
    args = sys.argv[1:]

    if not args:
        print(__doc__)
        sys.exit(0)

    cmd = args[0].lower()

    if cmd == "add":
        if len(args) < 2:
            print("\n  Usage: python3 Pipeline/keygen.py add <email> [name]\n")
            sys.exit(1)
        email = args[1].strip()
        name  = args[2].strip() if len(args) > 2 else email.split("@")[0]
        cmd_add(email, name)

    elif cmd == "remove":
        if len(args) < 2:
            print("\n  Usage: python3 Pipeline/keygen.py remove <PING-XXXX-XXXX>\n")
            sys.exit(1)
        cmd_remove(args[1])

    elif cmd == "list":
        cmd_list()

    else:
        print(f"\n  Unknown command: {cmd}")
        print(f"  Commands: add, remove, list\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
