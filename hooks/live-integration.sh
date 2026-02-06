#!/bin/bash
# OpenClaw Live Monitor Integration with Full Transparency
# Source this in your OpenClaw environment for automatic logging

export MONITOR_URL="${MONITOR_URL:-http://localhost:8081}"
export MONITOR_SESSION="${MONITOR_SESSION:-exec-$(date +%s)}"

# Start session on first load
if [ -z "$MONITOR_SESSION_STARTED" ]; then
    curl -s -X POST "${MONITOR_URL}/api/session/start" \
        -H "Content-Type: application/json" \
        -d "{\"id\":\"${MONITOR_SESSION}\",\"agent_id\":\"executor\",\"model\":\"kimi-k2-thinking\"}" > /dev/null
    export MONITOR_SESSION_STARTED=1
    
    # Set initial status to idle
    curl -s -X POST "${MONITOR_URL}/api/agent/status" \
        -H "Content-Type: application/json" \
        -d "{\"state\":\"idle\",\"session_id\":\"${MONITOR_SESSION}\"}" > /dev/null
    
    echo "📊 Monitor session: ${MONITOR_SESSION}"
    echo "🔮 Transparency mode: ENABLED"
    echo "Dashboard: http://localhost:8080"
fi

# Auto-report status
monitor_status() {
    local state="$1"  # idle, thinking, busy, error
    local action="${2:-}"
    
    curl -s -X POST "${MONITOR_URL}/api/agent/status" \
        -H "Content-Type: application/json" \
        -d "{\"state\":\"${state}\",\"current_action\":\"${action}\",\"session_id\":\"${MONITOR_SESSION}\"}" > /dev/null
}

# Auto-log thinking/reasoning
monitor_thinking() {
    local thought="$1"
    local step="${2:-1}"
    
    curl -s -X POST "${MONITOR_URL}/api/thinking" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\":\"${MONITOR_SESSION}\",\"thought\":\"${thought}\",\"step\":${step}}" > /dev/null
    
    # Also update status to thinking
    monitor_status "thinking"
}

# Auto-log function (call before each tool use)
monitor_log_tool_start() {
    local tool="$1"
    monitor_status "busy" "${tool}"
}

monitor_log_tool_end() {
    local tool="$1"
    local duration="${2:-1000}"
    local success="${3:-true}"
    
    # Log the command
    curl -s -X POST "${MONITOR_URL}/api/command" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\":\"${MONITOR_SESSION}\",\"tool_name\":\"${tool}\",\"duration_ms\":${duration},\"success\":${success}}" > /dev/null
    
    # Return to idle
    monitor_status "idle"
}

# Auto-log LLM call
monitor_log_llm() {
    local input_tokens="${1:-1000}"
    local output_tokens="${2:-500}"
    local thinking_ms="${3:-0}"
    
    # Log thinking first
    monitor_status "thinking"
    
    # Then log the LLM call
    curl -s -X POST "${MONITOR_URL}/api/llm" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\":\"${MONITOR_SESSION}\",\"model\":\"kimi-k2-thinking\",\"provider\":\"moonshot\",\"input_tokens\":${input_tokens},\"output_tokens\":${output_tokens},\"thinking_time_ms\":${thinking_ms}}" > /dev/null
    
    # Return to idle
    monitor_status "idle"
}

# Convenience aliases for common patterns
monitor_start_work() {
    local task="$1"
    monitor_status "busy" "$task"
}

monitor_start_thinking() {
    monitor_status "thinking"
}

monitor_finish() {
    monitor_status "idle"
}

# Show current status
monitor_show_status() {
    echo "📊 Monitor: ${MONITOR_URL}"
    echo "🔑 Session: ${MONITOR_SESSION}"
    curl -s "${MONITOR_URL}/api/agent/status" | python3 -m json.tool 2>/dev/null || echo "Status unavailable"
}