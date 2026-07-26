"""
Ihlamudheen Madrasa — ZKTeco Attendance Agent
=============================================
Runs on the office PC (same local network as the fingerprint device). Polls the
device every minute and sends each new punch to the madrasa website, which
records the staff member's in/out time in Supabase.

The website decides in vs out:
  - first punch of the day  -> check-in
  - a later punch           -> check-out (last punch of the day wins)

SETUP (one-time):
  1. Install Python 3.x from https://python.org  (tick "Add Python to PATH").
  2. Open Command Prompt and run:
       pip install pyzk requests
  3. Set DEVICE_IP to your ZKTeco device's IP address.
  4. Set ZK_API_KEY below to the SAME secret you put in the Vercel env var ZK_API_KEY.
  5. Enrol each staff member on the device and, in the website
     (Staff Attendance -> Manage staff), set their "Device user id" to the same
     enrolment number the device shows for them.
  6. Test it:  python zk_agent.py
  7. To auto-start on Windows boot, create a Scheduled Task:
       - Action:   Start a program
       - Program:  pythonw.exe        (pythonw runs silently, no console window)
       - Arguments: "C:\\path\\to\\zk_agent.py"
       - Trigger:  At log on / At startup
"""

import time
import json
import logging
import os
from datetime import date

import requests
from zk import ZK

# ── Configuration ──────────────────────────────────────────
DEVICE_IP       = "192.168.1.201"   # ← your ZKTeco device IP
DEVICE_PORT     = 4370
DEVICE_PASSWORD = 0                 # change if the device has a comm password

API_URL    = "https://ihlamudheen-madrasa.vercel.app/api/zk-attendance"
ZK_API_KEY = "REPLACE_WITH_YOUR_SECRET_KEY"   # ← must match Vercel env ZK_API_KEY

POLL_INTERVAL = 60                  # seconds between polls
LOG_FILE   = os.path.join(os.path.dirname(__file__), "zk_agent.log")
STATE_FILE = os.path.join(os.path.dirname(__file__), "zk_sent.json")
# ───────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("zk_agent")


def load_sent() -> set:
    """Load the set of already-sent punch keys from disk."""
    if not os.path.exists(STATE_FILE):
        return set()
    try:
        with open(STATE_FILE, "r") as f:
            return set(json.load(f))
    except Exception:
        return set()


def save_sent(sent: set) -> None:
    """Persist sent punch keys. Keep only today's so the file never grows unbounded."""
    today_prefix = date.today().isoformat()
    trimmed = {k for k in sent if k.startswith(today_prefix)}
    with open(STATE_FILE, "w") as f:
        json.dump(list(trimmed), f)


def poll_device(sent: set) -> set:
    """Connect to the ZKTeco device, fetch today's punches, POST new ones."""
    zk = ZK(DEVICE_IP, port=DEVICE_PORT, timeout=10, password=DEVICE_PASSWORD,
            force_udp=False, ommit_ping=False)
    conn = None
    today = date.today()

    try:
        conn = zk.connect()
        conn.disable_device()
        attendances = conn.get_attendance()
        conn.enable_device()
        conn.disconnect()
        conn = None

        new_count = 0
        for att in attendances:
            # Use the punch's own date (protects against midnight drift).
            att_date = att.timestamp.date()
            if att_date != today:
                continue

            punch_time = att.timestamp.strftime("%H:%M")
            punch_date = att_date.isoformat()
            key = f"{punch_date}_{att.user_id}_{punch_time}"
            if key in sent:
                continue

            try:
                resp = requests.post(
                    API_URL,
                    json={
                        "apiKey":       ZK_API_KEY,
                        "deviceUserId": int(att.user_id),
                        "punchTime":    punch_time,
                        "punchDate":    punch_date,
                    },
                    timeout=15,
                )
                data = resp.json()
                if resp.status_code == 200:
                    if data.get("skipped"):
                        # Don't mark skipped punches as sent — a later config fix
                        # (e.g. mapping the device id to a staff member) will let
                        # the next poll retry instead of dropping it forever.
                        log.debug("Skipped user %s @ %s: %s", att.user_id, punch_time, data.get("reason"))
                    else:
                        log.info("Synced  user %-4s  %s  %s  %s",
                                 att.user_id, punch_date, punch_time, data.get("action", "?"))
                        sent.add(key)
                        new_count += 1
                else:
                    log.warning("Server error %s for user %s: %s", resp.status_code, att.user_id, resp.text[:200])
            except requests.RequestException as e:
                log.warning("Network error posting user %s: %s", att.user_id, e)

        if new_count:
            log.info("Sent %d new punch(es) to server", new_count)

    except Exception as e:
        log.error("Device error: %s", e)
    finally:
        if conn:
            try:
                conn.enable_device()
                conn.disconnect()
            except Exception:
                pass

    return sent


def main() -> None:
    log.info("=" * 60)
    log.info("ZKTeco Agent starting — device %s:%s — poll every %ds", DEVICE_IP, DEVICE_PORT, POLL_INTERVAL)
    log.info("=" * 60)

    sent = load_sent()
    while True:
        sent = poll_device(sent)
        save_sent(sent)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
