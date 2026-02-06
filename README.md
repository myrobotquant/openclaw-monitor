# OpenClaw Monitor

Real-time monitoring dashboard for OpenClaw with LLM token tracking and cost calculations.

![Dashboard Preview](docs/preview.png)

## Features

- 🔮 **Real-time Dashboard** - Web interface at http://localhost:8080
- 📊 **Command Tracking** - See all tool executions
- 🧠 **LLM Monitoring** - Track tokens, models, costs
- 💰 **Cost Calculations** - Real-time spend tracking
- 🔄 **Live Updates** - WebSocket-powered activity feed
- 📈 **Historical Data** - SQLite persistence
- 🐳 **Docker-based** - Portable, isolated, easy updates

## Quick Start

```bash
cd /home/rr/.openclaw/workspace-executor/monitor

# Start all services
docker-compose up -d

# View dashboard
open http://localhost:8080

# Or on Linux
xdg-open http://localhost:8080
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  OpenClaw Agent                                         │
│  ├─→ monitor-hook.sh (sends data)                      │
│  └─→ API calls to collector:8081                       │
└──────────────────┬──────────────────────────────────────┘
                   │ HTTP/WebSocket
                   ▼
┌─────────────────────────────────────────────────────────┐
│  Docker Network                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  Collector  │  │    Web      │  │  Prometheus │     │
│  │   :8081     │  │   :8080     │  │   :9090     │     │
│  │   :8082     │  │   (nginx)   │  │             │     │
│  └──────┬──────┘  └─────────────┘  └─────────────┘     │
│         │                                               │
│         └─→ SQLite (/data/monitor.db)                   │
└─────────────────────────────────────────────────────────┘
```

## Components

| Service | Port | Description |
|---------|------|-------------|
| Web Dashboard | 8080 | React-based real-time UI |
| Collector API | 8081 | HTTP API for receiving data |
| WebSocket | 8082 | Real-time updates to dashboard |
| Prometheus | 9090 | Metrics collection (optional) |
| Grafana | 3000 | Advanced dashboards (optional) |

## Integration with OpenClaw

### Option 1: Hook Script (Recommended)

Source the hook in your OpenClaw session:

```bash
source /home/rr/.openclaw/workspace-executor/monitor/hooks/monitor-hook.sh
monitor_session_start "executor" "kimi-k2"
```

Then use helper functions:
```bash
monitor_command "web_search" 1500 true
monitor_llm "kimi-k2" "moonshot" 1024 512 2300
```

### Option 2: Direct HTTP Calls

```bash
# Session start
curl -X POST http://localhost:8081/api/session/start \
  -H "Content-Type: application/json" \
  -d '{"id":"session-123","agent_id":"executor","model":"kimi-k2"}'

# Log command
curl -X POST http://localhost:8081/api/command \
  -H "Content-Type: application/json" \
  -d '{"session_id":"session-123","tool_name":"web_search","duration_ms":1500,"success":true}'

# Log LLM call
curl -X POST http://localhost:8081/api/llm \
  -H "Content-Type: application/json" \
  -d '{"session_id":"session-123","model":"kimi-k2","provider":"moonshot","input_tokens":1024,"output_tokens":512}'
```

## Data Collected

### Sessions
- Start/end times
- Agent ID and model
- Status (active/completed)

### Commands
- Tool name
- Execution duration
- Success/failure
- Error messages

### LLM Requests
- Model and provider
- Input/output tokens
- Total tokens
- Cost (USD)
- Thinking time

### Processes
- PID
- Command
- Start/end times
- Status

## Cost Calculation

Approximate costs per 1K tokens:

| Model | Input | Output |
|-------|-------|--------|
| GPT-4 | $0.03 | $0.06 |
| GPT-4 Turbo | $0.01 | $0.03 |
| GPT-3.5 Turbo | $0.0015 | $0.002 |
| Claude 3 Opus | $0.015 | $0.075 |
| Claude 3 Sonnet | $0.003 | $0.015 |
| Kimi K2 | $0.002 | $0.002 |

## Management

```bash
# View logs
docker-compose logs -f collector

# Stop
docker-compose down

# Restart
docker-compose restart

# Update
docker-compose pull
docker-compose up -d

# Backup data
cp data/monitor.db backup/monitor-$(date +%Y%m%d).db

# Reset data
docker-compose down -v
rm -rf data/*
docker-compose up -d
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/session/start` | POST | Start new session |
| `/api/command` | POST | Log command |
| `/api/llm` | POST | Log LLM request |
| `/api/process` | POST | Log process start/end |
| `/api/dashboard/summary` | GET | 24h summary stats |
| `/api/dashboard/recent` | GET | Recent activity |
| `/api/dashboard/costs` | GET | Cost breakdown |

## WebSocket Events

```javascript
{
  "type": "command|llm|process_start|process_end",
  "data": { ... }
}
```

## Troubleshooting

**Dashboard not loading:**
```bash
docker-compose ps
docker-compose logs web
```

**No data showing:**
- Check collector is running: `curl http://localhost:8081/health`
- Verify WebSocket connection in browser dev tools

**Costs seem wrong:**
- Costs are approximate based on current pricing
- Update rates in `collector/server.js` if needed

## Security

- Dashboard is local-only (localhost:8080)
- No authentication by default
- Add nginx basic auth if exposing externally
- Database at `data/monitor.db` (Docker volume)

## Roadmap

- [ ] Session replay
- [ ] Cost alerts/budgets
- [ ] Export to CSV/PDF
- [ ] Multi-agent support
- [ ] Alert webhooks
- [ ] Dark/light themes