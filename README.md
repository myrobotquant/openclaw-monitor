# OpenClaw Monitor

Real-time monitoring dashboard for OpenClaw AI agents. Track costs, system resources, and weather in one place.

![Dashboard Preview](https://img.shields.io/badge/Status-Active-success)
![Docker](https://img.shields.io/badge/Docker-Ready-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## What This Does

This dashboard helps you:
- 💰 **Track AI spending** in real-time (Moonshot API costs)
- 🔍 **Monitor system health** (CPU, RAM, disk usage)
- 🌤️ **Check weather** (Open-Meteo + OpenWeather)
- 📊 **View agent activity** (live logs and status)

## Quick Start

```bash
cd monitor
docker-compose up -d
```

Then open: http://localhost:8080

## Features

| Feature | Description |
|---------|-------------|
| **Cost Tracking** | Real Moonshot API spend, hourly burn rate, balance projections |
| **System Metrics** | CPU, RAM, disk, Docker containers (updates every 5s) |
| **Weather** | Toronto forecast via Open-Meteo + OpenWeatherMap |
| **Agent Logs** | Live view of agent conversations and tool calls |
| **WebSocket Updates** | Real-time data without refreshing |

## Built With

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js, Express
- **Data:** SQLite, Prometheus
- **Deployment:** Docker

## Why This Exists

I was spending $300+ on AI without knowing where it went. This dashboard shows exactly:
- What's costing money
- What's free (local operations)
- How long your balance will last

## Author

Built by [@myrobotquant](https://twitter.com/myrobotquant) with AI assistance.

## License

MIT - Use it, modify it, share it!
