#!/bin/bash
cd /home/z/my-project
while true; do
  node .next/standalone/server.js 2>&1
  echo "[$(date)] Server exited with code $?, restarting in 2s..." >> /tmp/amy-restart.log
  sleep 2
done
