#!/bin/bash
# Tunnel watchdog — keeps localtunnel alive for WSB Telegram bot.
# Polls every 5s; active warmup waits until tunnel is reachable after spawn.

SUBDOMAIN="cyfr-wsb-584268213"
URL="https://${SUBDOMAIN}.loca.lt/"
LOG="/tmp/wsb-watchdog.log"
PORT=5678
CHECK_INTERVAL=5
WARMUP_SEC=8

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" | tee -a "$LOG"; }

start_tunnel() {
  pkill -f "localtunnel.*${SUBDOMAIN}" 2>/dev/null
  sleep 1
  log "starting localtunnel → ${URL}"
  nohup npx -y localtunnel --port ${PORT} --subdomain ${SUBDOMAIN} >> "$LOG" 2>&1 &
  disown 2>/dev/null
  for i in $(seq 1 ${WARMUP_SEC}); do
    if curl -sf -o /dev/null --max-time 3 "${URL}"; then
      log "tunnel UP after ${i}s"
      return 0
    fi
    sleep 1
  done
  log "tunnel did not come up within ${WARMUP_SEC}s (retry next cycle)"
}

log "watchdog started (pid=$$)"

if ! curl -sf -o /dev/null --max-time 5 "${URL}"; then
  start_tunnel
fi

while true; do
  if ! curl -sf -o /dev/null --max-time 5 "${URL}"; then
    log "tunnel DOWN → respawn"
    start_tunnel
  fi
  sleep ${CHECK_INTERVAL}
done
