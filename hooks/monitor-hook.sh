#!/bin/bash
# OpenClaw Monitor Hook
# Send monitoring data to the collector
# Usage: source monitor-hook.sh

MONITOR_URL="${MONITOR_URL:-http://localhost:8081}"
SESSION_ID="${SESSION_ID:-$(date +%s)}"

# Send session start
monitor_session_start() {
    local agent_id="${1:-unknown}"
    local model="${2:-unknown}"
    
    curl -s -X POST "${MONITOR_URL}/api/session/start" \
        -H "Content-Type: application/json" \
        -d "{\"id\":\"${SESSION_ID}\",\"agent_id\":\"${agent_id}\",\"model\":\"${model}\"}" > /dev/null
}

# Log command execution
monitor_command() {
    local tool_name="$1"
    local duration_ms="${2:-0}"
    local success="${3:-true}"
    local error="${4:-}"
    
    curl -s -X POST "${MONITOR_URL}/api/command" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\":\"${SESSION_ID}\",\"tool_name\":\"${tool_name}\",\"duration_ms\":${duration_ms},\"success\":${success},\"error\":\"${error}\"}" > /dev/null
}

# Log LLM request
monitor_llm() {
    local model="$1"
    local provider="${2:-unknown}"
    local input_tokens="${3:-0}"
    local output_tokens="${4:-0}"
    local thinking_time_ms="${5:-0}"
    
    curl -s -X POST "${MONITOR_URL}/api/llm" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\":\"${SESSION_ID}\",\"model\":\"${model}\",\"provider\":\"${provider}\",\"input_tokens\":${input_tokens},\"output_tokens\":${output_tokens},\"thinking_time_ms\":${thinking_time_ms}}" > /dev/null
}

# Log process start
monitor_process_start() {
    local pid="$1"
    local command="$2"
    
    curl -s -X POST "${MONITOR_URL}/api/process" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\":\"${SESSION_ID}\",\"pid\":\"${pid}\",\"command\":\"${command}\",\"status\":\"start\"}" > /dev/null
}

# Log process end
monitor_process_end() {
    local pid="$1"
    
    curl -s -X POST "${MONITOR_URL}/api/process" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\":\"${SESSION_ID}\",\"pid\":\"${pid}\",\"status\":\"end\"}" > /dev/null
}

echo "Monitor hooks loaded. SESSION_ID=${SESSION_ID}"
echo "Dashboard: http://localhost:8080"
echo "API: ${MONITOR_URL}"