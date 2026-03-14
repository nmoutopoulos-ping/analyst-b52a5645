"""
users.py — Ping Analyst User Registry
---------------------------------------
API key → user record mapping.
To add a user: run keygen.py with their email, paste the output line here, and redeploy.
To remove a user: delete their entry and redeploy.
"""

USERS = {
    "PING-NKO1-GM4X": {"email": "nikomoutop10@gmail.com",        "name": "Niko"},
    "PING-NKO2-PP9R": {"email": "nmoutopoulos@pingpayments.org", "name": "Niko (work)"},
}
