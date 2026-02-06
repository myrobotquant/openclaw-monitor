#!/bin/bash
# Start OpenClaw Monitor

set -e

cd "$(dirname "$0")"

echo "🚀 Starting OpenClaw Monitor..."

# Create data directory
mkdir -p data

# Start services
docker-compose up -d

echo ""
echo "✅ Monitor is running!"
echo ""
echo "📊 Dashboard:     http://localhost:8080"
echo "🔌 Collector API: http://localhost:8081"
echo "📈 Prometheus:    http://localhost:9090"
echo "📉 Grafana:       http://localhost:3000 (admin/admin)"
echo ""
echo "To view logs: docker-compose logs -f"
echo "To stop:      docker-compose down"
echo ""

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 3

# Health check
if curl -s http://localhost:8081/health > /dev/null; then
    echo "✅ Collector is healthy"
else
    echo "⚠️  Collector may still be starting..."
fi

# Try to open browser
if command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:8080
elif command -v open &> /dev/null; then
    open http://localhost:8080
else
    echo "Open http://localhost:8080 in your browser"
fi