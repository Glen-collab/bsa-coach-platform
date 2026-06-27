#!/bin/bash
# Cron wrapper for the program safety-net backup. Sources the app env for
# DATABASE_URL and runs the script with the app venv python (which has psycopg2).
set -a
source /opt/bestrongagain/.env
set +a
exec /opt/bestrongagain/venv/bin/python /home/ec2-user/backup_programs.py
