#!/bin/bash
# Tunnel watchdog — keeps localtunnel alive for WSB Telegram bot.
# Checks tunnel reachability every 20s; if down, kills stale localtunnel
# processes and respawns. All output goes to /tmp/wsb-watchdog.log.

SUBDOMAIN="cyfr-wsb-584268213"
URL="https://${SUBDOMAIN}.loca.lt/"
LOG="/tmp/wsb-watchdog.log"
PORT=5678

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" | tee -a "$LOG"; }

start_tunnel() {
  pkill -f "localtunnel.*${SUBDOMAIN}" 2>/dev/null
  sleep 2
  log "starting localtunnel → ${URL}"
  nohup npx -y localtunnel --port ${PORT} --subdomain ${SUBDOMAIN} >> "$LOG" 2>&1 &
  disown 2>/dev/null
  sleep 10
}

log "watchdog started (pid=$$)"

# Initial up-check / spawn
if ! curl -sf -o /dev/null --max-time 8 "${URL}"; then
  start_tunnel
fi

# Main loop
while true; do
  if ! curl -sf -o /dev/null --max-time 8 "${URL}"; then
    log "tunnel DOWN → respawn"
    start_tunnel
  fi
  sleep 20
done
