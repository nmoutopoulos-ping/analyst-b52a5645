#!/usr/bin/env python3
"""
keygen.py — Generate a new Ping Analyst API key.

Usage:
    python3 keygen.py someone@example.com "Jane Doe"
    python3 keygen.py someone@example.com          # name defaults to email prefix

Then paste the printed line into users.py and redeploy.
"""

import secrets
import string
import sys


def gen_key() -> str:
    chars = string.ascii_uppercase + string.digits
    seg = lambda n: "".join(secrets.choice(chars) for _ in range(n))
    return f"PING-{seg(4)}-{seg(4)}"


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 keygen.py <email> [name]")
        sys.exit(1)

    email = sys.argv[1].strip()
    name  = sys.argv[2].strip() if len(sys.argv) > 2 else email.split("@")[0]
    key   = gen_key()

    print(f"\n  Generated key for {name} <{email}>:\n")
    print(f"    Key: {key}\n")
    print(f"  Paste this line into Pipeline/users.py inside USERS = {{ ... }}:\n")
    print(f'    "{key}": {{"email": "{email}", "name": "{name}"}},')
    print()
