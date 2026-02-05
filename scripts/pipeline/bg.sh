#!/bin/bash
#
# Background execution helper for the Blaulicht pipeline.
#
# Usage:
#   ./scripts/pipeline/bg.sh start    # Start pipeline in background
#   ./scripts/pipeline/bg.sh stop     # Stop running pipeline
#   ./scripts/pipeline/bg.sh status   # Check if running
#   ./scripts/pipeline/bg.sh logs     # Tail the log file
#   ./scripts/pipeline/bg.sh attach   # Attach to running process (view output)
#

set -e

# Resolve project root (where this script lives: scripts/pipeline/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Paths
LOG_DIR="$PROJECT_ROOT/logs"
PID_FILE="$LOG_DIR/pipeline.pid"
LOG_FILE="$LOG_DIR/pipeline.log"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

start() {
    if [ -f "$PID_FILE" ]; then
        pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            echo "Pipeline already running (PID: $pid)"
            echo "Use './scripts/pipeline/bg.sh stop' to stop it first."
            exit 1
        else
            # Stale PID file
            rm -f "$PID_FILE"
        fi
    fi

    echo "Starting Blaulicht Pipeline in background..."
    echo "Log file: $LOG_FILE"

    # Start in background with nohup
    cd "$PROJECT_ROOT"
    nohup python3 -m scripts.pipeline.runner start >> "$LOG_FILE" 2>&1 &
    pid=$!
    echo $pid > "$PID_FILE"

    echo "Pipeline started (PID: $pid)"
    echo ""
    echo "Commands:"
    echo "  ./scripts/pipeline/bg.sh status   # Check if running"
    echo "  ./scripts/pipeline/bg.sh logs     # View log output"
    echo "  ./scripts/pipeline/bg.sh stop     # Stop the pipeline"
}

stop() {
    if [ ! -f "$PID_FILE" ]; then
        echo "No PID file found. Pipeline may not be running."
        exit 0
    fi

    pid=$(cat "$PID_FILE")

    if ! ps -p "$pid" > /dev/null 2>&1; then
        echo "Pipeline not running (stale PID file)"
        rm -f "$PID_FILE"
        exit 0
    fi

    echo "Stopping pipeline (PID: $pid)..."
    echo "Sending SIGTERM for graceful shutdown..."

    # Send SIGTERM for graceful shutdown
    kill -TERM "$pid" 2>/dev/null || true

    # Wait for process to exit (up to 60 seconds)
    echo "Waiting for current chunk to complete..."
    for i in {1..60}; do
        if ! ps -p "$pid" > /dev/null 2>&1; then
            echo "Pipeline stopped."
            rm -f "$PID_FILE"
            exit 0
        fi
        sleep 1
    done

    # Force kill if still running
    echo "Forcing shutdown..."
    kill -9 "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    echo "Pipeline stopped (forced)."
}

status() {
    if [ ! -f "$PID_FILE" ]; then
        echo "Pipeline: NOT RUNNING (no PID file)"
        return
    fi

    pid=$(cat "$PID_FILE")

    if ps -p "$pid" > /dev/null 2>&1; then
        echo "Pipeline: RUNNING (PID: $pid)"

        # Show some process info
        ps -p "$pid" -o pid,etime,rss,command | tail -n 1

        echo ""
        echo "Use './scripts/pipeline/bg.sh logs' to view output"
    else
        echo "Pipeline: NOT RUNNING (stale PID file)"
        rm -f "$PID_FILE"
    fi

    # Also show manifest status
    echo ""
    cd "$PROJECT_ROOT"
    python3 -m scripts.pipeline.runner status 2>/dev/null || true
}

logs() {
    if [ ! -f "$LOG_FILE" ]; then
        echo "No log file found at: $LOG_FILE"
        exit 1
    fi

    echo "Tailing $LOG_FILE (Ctrl+C to stop)..."
    echo "========================================="
    tail -f "$LOG_FILE"
}

attach() {
    logs
}

# Main command dispatch
case "${1:-}" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    status)
        status
        ;;
    logs|tail|attach)
        logs
        ;;
    *)
        echo "Blaulicht Pipeline Background Runner"
        echo ""
        echo "Usage: $0 {start|stop|status|logs}"
        echo ""
        echo "Commands:"
        echo "  start   - Start the pipeline in background"
        echo "  stop    - Stop the running pipeline (graceful)"
        echo "  status  - Check if pipeline is running"
        echo "  logs    - Tail the log file"
        echo ""
        exit 1
        ;;
esac
