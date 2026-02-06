const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8081;
const DB_PATH = process.env.DB_PATH || '/data/monitor.db';

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  // Sessions table
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    agent_id TEXT,
    model TEXT,
    status TEXT DEFAULT 'active'
  )`);

  // Commands/tools executed
  db.run(`CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    tool_name TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    duration_ms INTEGER,
    success BOOLEAN,
    error TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )`);

  // LLM requests
  db.run(`CREATE TABLE IF NOT EXISTS llm_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    model TEXT,
    provider TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    cost_usd REAL,
    thinking_time_ms INTEGER,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )`);

  // Process/agent lifecycle
  db.run(`CREATE TABLE IF NOT EXISTS processes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    pid TEXT,
    command TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    status TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )`);

  // Events log (catch-all)
  db.run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    event_type TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    data TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )`);
});

// WebSocket server for real-time updates
const wss = new WebSocket.Server({ port: 8082 });

function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// API Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Receive session start
app.post('/api/session/start', (req, res) => {
  const { id, agent_id, model } = req.body;
  
  db.run(
    'INSERT INTO sessions (id, agent_id, model, status) VALUES (?, ?, ?, ?)',
    [id, agent_id, model, 'active'],
    function(err) {
      if (err) {
        console.error('Session start error:', err);
        return res.status(500).json({ error: err.message });
      }
      
      broadcast({ type: 'session_start', data: { id, agent_id, model } });
      res.json({ success: true, session_id: id });
    }
  );
});

// Record command execution
app.post('/api/command', (req, res) => {
  const { session_id, tool_name, duration_ms, success, error } = req.body;
  
  db.run(
    'INSERT INTO commands (session_id, tool_name, duration_ms, success, error) VALUES (?, ?, ?, ?, ?)',
    [session_id, tool_name, duration_ms, success ? 1 : 0, error || null],
    function(err) {
      if (err) {
        console.error('Command log error:', err);
        return res.status(500).json({ error: err.message });
      }
      
      broadcast({ 
        type: 'command', 
        data: { session_id, tool_name, duration_ms, success, timestamp: new Date().toISOString() } 
      });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// Record LLM request
app.post('/api/llm', (req, res) => {
  const { session_id, model, provider, input_tokens, output_tokens, thinking_time_ms } = req.body;
  
  const total_tokens = (input_tokens || 0) + (output_tokens || 0);
  
  // Cost calculation (per 1K tokens in USD)
  const costs = {
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-3.5-turbo': { input: 0.0015, output: 0.002 },
    'claude-3-opus': { input: 0.015, output: 0.075 },
    'claude-3-sonnet': { input: 0.003, output: 0.015 },
    'claude-3-haiku': { input: 0.00025, output: 0.00125 },
    // Moonshot / Kimi models (approx $0.50 per 1M tokens = $0.0005 per 1K)
    'kimi-k2': { input: 0.0005, output: 0.0005 },
    'kimi-k2.5': { input: 0.0005, output: 0.0005 },
    'kimi-k2-0905-preview': { input: 0.0005, output: 0.0005 },
    'kimi-k2-thinking': { input: 0.0005, output: 0.0005 },
    'moonshot/kimi-k2.5': { input: 0.0005, output: 0.0005 },
    'moonshot/kimi-k2': { input: 0.0005, output: 0.0005 },
    'kimi-coding/kimi-k2-thinking': { input: 0.0005, output: 0.0005 }
  };
  
  const modelCosts = costs[model] || costs['gpt-3.5-turbo'];
  const cost_usd = ((input_tokens || 0) / 1000 * modelCosts.input) + 
                   ((output_tokens || 0) / 1000 * modelCosts.output);
  
  db.run(
    'INSERT INTO llm_requests (session_id, model, provider, input_tokens, output_tokens, total_tokens, cost_usd, thinking_time_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [session_id, model, provider, input_tokens, output_tokens, total_tokens, cost_usd, thinking_time_ms],
    function(err) {
      if (err) {
        console.error('LLM log error:', err);
        return res.status(500).json({ error: err.message });
      }
      
      broadcast({ 
        type: 'llm', 
        data: { session_id, model, provider, input_tokens, output_tokens, total_tokens, cost_usd, timestamp: new Date().toISOString() } 
      });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// Record process/agent
app.post('/api/process', (req, res) => {
  const { session_id, pid, command, status } = req.body;
  
  if (status === 'start') {
    db.run(
      'INSERT INTO processes (session_id, pid, command, status) VALUES (?, ?, ?, ?)',
      [session_id, pid, command, 'running'],
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        broadcast({ type: 'process_start', data: { session_id, pid, command } });
        res.json({ success: true, id: this.lastID });
      }
    );
  } else if (status === 'end') {
    db.run(
      'UPDATE processes SET ended_at = CURRENT_TIMESTAMP, status = ? WHERE pid = ?',
      ['completed', pid],
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        broadcast({ type: 'process_end', data: { session_id, pid } });
        res.json({ success: true });
      }
    );
  }
});

// Dashboard data endpoints

app.get('/api/dashboard/summary', (req, res) => {
  db.get(`
    SELECT 
      COUNT(DISTINCT s.id) as total_sessions,
      COUNT(DISTINCT CASE WHEN s.status = 'active' THEN s.id END) as active_sessions,
      COUNT(c.id) as total_commands,
      SUM(l.input_tokens) as total_input_tokens,
      SUM(l.output_tokens) as total_output_tokens,
      SUM(l.cost_usd) as total_cost
    FROM sessions s
    LEFT JOIN commands c ON s.id = c.session_id
    LEFT JOIN llm_requests l ON s.id = l.session_id
    WHERE s.started_at > datetime('now', '-24 hours')
  `, (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(row);
  });
});

app.get('/api/dashboard/recent', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  
  // Timestamps are already in local time from database
  db.all(`
    SELECT * FROM (
      SELECT 'command' as type, tool_name as name, timestamp, session_id, duration_ms, success
      FROM commands
      UNION ALL
      SELECT 'llm' as type, model as name, timestamp, session_id, total_tokens as duration_ms, NULL as success
      FROM llm_requests
    )
    ORDER BY timestamp DESC
    LIMIT ?
  `, [limit], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.get('/api/dashboard/costs', (req, res) => {
  db.all(`
    SELECT 
      date(timestamp) as date,
      model,
      COUNT(*) as request_count,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens,
      SUM(cost_usd) as cost
    FROM llm_requests
    WHERE timestamp > datetime('now', '-7 days')
    GROUP BY date(timestamp), model
    ORDER BY date DESC
  `, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Agent Status Tracking
let agentStatus = {
  state: 'idle', // idle, thinking, busy, error
  current_action: null,
  action_start_time: null,
  session_id: null,
  last_activity: new Date().toISOString()
};

// Update agent status
app.post('/api/agent/status', (req, res) => {
  const { state, current_action, session_id } = req.body;
  
  agentStatus = {
    state: state || agentStatus.state,
    current_action: current_action || agentStatus.current_action,
    action_start_time: state === 'busy' ? new Date().toISOString() : agentStatus.action_start_time,
    session_id: session_id || agentStatus.session_id,
    last_activity: new Date().toISOString()
  };
  
  broadcast({ 
    type: 'status', 
    data: agentStatus 
  });
  
  res.json({ success: true, status: agentStatus });
});

// Get current agent status
app.get('/api/agent/status', (req, res) => {
  // Calculate elapsed time if busy
  let elapsed_ms = null;
  if (agentStatus.state === 'busy' && agentStatus.action_start_time) {
    elapsed_ms = Date.now() - new Date(agentStatus.action_start_time).getTime();
  }
  
  res.json({
    ...agentStatus,
    elapsed_ms
  });
});

// Log thinking/reasoning steps
app.post('/api/thinking', (req, res) => {
  const { session_id, thought, step } = req.body;
  
  db.run(
    'INSERT INTO events (session_id, event_type, data) VALUES (?, ?, ?)',
    [session_id, 'thinking', JSON.stringify({ thought, step })],
    function(err) {
      if (err) {
        console.error('Thinking log error:', err);
        return res.status(500).json({ error: err.message });
      }
      
      broadcast({ 
        type: 'thinking', 
        data: { session_id, thought, step, timestamp: new Date().toISOString() } 
      });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// Get thinking logs
app.get('/api/thinking', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  
  db.all(`
    SELECT session_id, event_type, timestamp, data
    FROM events
    WHERE event_type = 'thinking'
    ORDER BY timestamp DESC
    LIMIT ?
  `, [limit], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    const parsed = rows.map(row => ({
      ...row,
      data: JSON.parse(row.data || '{}')
    }));
    
    res.json(parsed);
  });
});

// Read OpenClaw agent logs
app.get('/api/logs', (req, res) => {
  const lines = parseInt(req.query.lines) || 50;
  
  // Find the most recent session log file
  const sessionsDir = '/openclaw/agents/executor/sessions';
  
  try {
    if (!fs.existsSync(sessionsDir)) {
      return res.json({ logs: [], error: 'Sessions directory not found' });
    }
    
    const files = fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.jsonl') && !f.endsWith('.lock'))
      .map(f => ({
        name: f,
        path: path.join(sessionsDir, f),
        mtime: fs.statSync(path.join(sessionsDir, f)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime);
    
    if (files.length === 0) {
      return res.json({ logs: [] });
    }
    
    // Read last N lines from most recent file
    const logFile = files[0].path;
    const content = fs.readFileSync(logFile, 'utf8');
    const logLines = content.trim().split('\n').filter(line => line);
    const recentLines = logLines.slice(-lines);
    
    // Parse and format logs
    const parsedLogs = recentLines.map(line => {
      try {
        const entry = JSON.parse(line);
        return formatLogEntry(entry);
      } catch (e) {
        return { type: 'raw', message: line, timestamp: new Date().toISOString() };
      }
    }).filter(Boolean);
    
    res.json({ logs: parsedLogs, file: files[0].name });
  } catch (err) {
    console.error('Log read error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Format log entry to human-readable
function formatLogEntry(entry) {
  const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    timeZone: 'America/New_York'
  });
  
  switch (entry.type) {
    case 'message':
      if (entry.message?.role === 'user') {
        const text = entry.message.content?.[0]?.text || '[media]';
        return { time, type: 'user', message: text.slice(0, 100) + (text.length > 100 ? '...' : ''), timestamp: entry.timestamp };
      } else if (entry.message?.role === 'assistant') {
        return { time, type: 'assistant', message: '[Response]', timestamp: entry.timestamp };
      }
      break;
    case 'tool_call':
      return { time, type: 'tool', message: `Tool: ${entry.tool?.name || 'unknown'}`, timestamp: entry.timestamp };
    case 'tool_result':
      return { time, type: 'result', message: `Result: ${entry.result?.status || 'completed'}`, timestamp: entry.timestamp };
    case 'model_change':
      return { time, type: 'system', message: `Model: ${entry.modelId}`, timestamp: entry.timestamp };
    case 'thinking_level_change':
      return { time, type: 'system', message: `Thinking: ${entry.thinkingLevel}`, timestamp: entry.timestamp };
    case 'custom':
      if (entry.customType === 'model-snapshot') {
        return null; // Skip these
      }
      break;
    case 'session':
      return { time, type: 'system', message: 'Session started', timestamp: entry.timestamp };
  }
  
  return null;
}

// Moonshot balance check
app.get('/api/moonshot/balance', async (req, res) => {
  try {
    const fetch = (await import('node-fetch')).default;
    const apiKey = process.env.MOONSHOT_API_KEY || 'sk-Ifih5zxNPQEjEuOhyBjWTHAhNZfuRJuBWVcyawmUhBBtvgxN';
    
    const response = await fetch('https://api.moonshot.ai/v1/users/me/balance', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    
    if (data.status) {
      res.json({
        available_balance: data.data.available_balance,
        cash_balance: data.data.cash_balance,
        voucher_balance: data.data.voucher_balance,
        last_updated: new Date().toISOString()
      });
    } else {
      res.status(500).json({ error: data.message || 'Failed to fetch balance' });
    }
  } catch (err) {
    console.error('Moonshot balance error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`OpenClaw Monitor Collector running on port ${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`WebSocket: ws://localhost:8082`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  db.close();
  process.exit(0);
});
// Moonshot balance history tracking
const BALANCE_HISTORY_FILE = '/data/moonshot_balance_history.json';

function loadBalanceHistory() {
  try {
    if (fs.existsSync(BALANCE_HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(BALANCE_HISTORY_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveBalanceHistory(history) {
  try {
    fs.writeFileSync(BALANCE_HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (e) {}
}

// Get Moonshot spend analysis
app.get('/api/moonshot/spend', async (req, res) => {
  try {
    const fetch = (await import('node-fetch')).default;
    const apiKey = process.env.MOONSHOT_API_KEY || 'sk-Ifih5zxNPQEjEuOhyBjWTHAhNZfuRJuBWVcyawmUhBBtvgxN';
    
    const response = await fetch('https://api.moonshot.ai/v1/users/me/balance', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    
    const data = await response.json();
    if (!data.status) {
      return res.status(500).json({ error: 'Failed to fetch balance' });
    }
    
    const currentBalance = data.data.available_balance;
    let history = loadBalanceHistory();
    
    // Add current reading
    history.push({
      timestamp: new Date().toISOString(),
      balance: currentBalance
    });
    
    // Keep last 1000 entries (about 10 days at 15-min intervals)
    history = history.slice(-1000);
    saveBalanceHistory(history);
    
    // Calculate metrics
    const now = new Date();
    const oneHourAgo = new Date(now - 60 * 60 * 1000);
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    
    const recentHistory = history.filter(h => new Date(h.timestamp) > oneDayAgo);
    
    let spendAnalysis = {
      current_balance: currentBalance,
      history_count: history.length,
      periods: {}
    };
    
    if (history.length > 1) {
      const initial = history[0].balance;
      const totalSpent = initial - currentBalance;
      const firstReading = new Date(history[0].timestamp);
      const hoursTracked = (now - firstReading) / (1000 * 60 * 60);
      
      spendAnalysis.total_tracked = {
        spent: totalSpent,
        since: history[0].timestamp,
        hours: Math.round(hoursTracked * 10) / 10,
        hourly_rate: hoursTracked > 0 ? Math.round((totalSpent / hoursTracked) * 100) / 100 : 0
      };
    }
    
    // Calculate last hour spend
    const hourAgoReading = history.filter(h => new Date(h.timestamp) <= oneHourAgo).pop();
    if (hourAgoReading) {
      spendAnalysis.periods.last_hour = {
        spent: hourAgoReading.balance - currentBalance,
        start_balance: hourAgoReading.balance,
        reading_time: hourAgoReading.timestamp
      };
    }
    
    // Calculate last 24 hours spend
    const dayAgoReading = history.filter(h => new Date(h.timestamp) <= oneDayAgo).pop();
    if (dayAgoReading) {
      spendAnalysis.periods.last_24h = {
        spent: dayAgoReading.balance - currentBalance,
        start_balance: dayAgoReading.balance,
        reading_time: dayAgoReading.timestamp
      };
    }
    
    res.json(spendAnalysis);
    
  } catch (err) {
    console.error('Moonshot spend analysis error:', err);
    res.status(500).json({ error: err.message });
  }
});

// System Metrics (FREE - runs locally)
app.get('/api/system/metrics', async (req, res) => {
  try {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    // Get CPU usage
    let cpu = 'N/A';
    try {
      const { stdout } = await execPromise("top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1");
      cpu = parseFloat(stdout.trim()).toFixed(1);
    } catch (e) {}
    
    // Get RAM usage
    let ram = 'N/A';
    try {
      const { stdout } = await execPromise("free -h | awk '/^Mem:/ {print $3 \"/\" $2}'");
      ram = stdout.trim();
    } catch (e) {}
    
    // Get disk usage
    let disk = 'N/A';
    try {
      const { stdout } = await execPromise("df -h / | awk 'NR==2 {print $3 \"/\" $2 \" (\" $5 \")\"}'");
      disk = stdout.trim();
    } catch (e) {}
    
    // Get process counts
    let docker = 0, node = 0, python = 0;
    try {
      const { stdout: d } = await execPromise('docker ps -q 2>/dev/null | wc -l');
      docker = parseInt(d.trim()) || 0;
    } catch (e) {}
    try {
      const { stdout: n } = await execPromise('pgrep -c node 2>/dev/null || echo 0');
      node = parseInt(n.trim()) || 0;
    } catch (e) {}
    try {
      const { stdout: p } = await execPromise('pgrep -c python 2>/dev/null || echo 0');
      python = parseInt(p.trim()) || 0;
    } catch (e) {}
    
    // Get network stats
    let connections = 0, ports = 0;
    try {
      const { stdout: c } = await execPromise('netstat -an 2>/dev/null | grep ESTABLISHED | wc -l');
      connections = parseInt(c.trim()) || 0;
    } catch (e) {}
    try {
      const { stdout: p } = await execPromise('netstat -tlnp 2>/dev/null | grep LISTEN | wc -l');
      ports = parseInt(p.trim()) || 0;
    } catch (e) {}
    
    res.json({
      cpu,
      ram,
      disk,
      docker,
      node,
      python,
      connections,
      ports,
      timestamp: new Date().toISOString()
    });
    
  } catch (err) {
    console.error('System metrics error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Weather API - Open-Meteo (FREE, no key required)
app.get('/api/weather/open-meteo', async (req, res) => {
  try {
    const fetch = (await import('node-fetch')).default;
    
    // Toronto coordinates (can make this configurable)
    const lat = 43.6532;
    const lon = -79.3832;
    
    // Current weather
    const currentUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&timezone=America/Toronto`;
    
    const currentResponse = await fetch(currentUrl);
    const currentData = await currentResponse.json();
    
    // 5-day forecast
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=America/Toronto&forecast_days=5`;
    
    const forecastResponse = await fetch(forecastUrl);
    const forecastData = await forecastResponse.json();
    
    // Weather code descriptions
    const weatherCodes = {
      0: 'Clear sky',
      1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
      45: 'Fog', 48: 'Depositing rime fog',
      51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
      61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
      71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
      77: 'Snow grains',
      80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
      95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Heavy thunderstorm'
    };
    
    const code = currentData.current.weather_code;
    
    const result = {
      location: 'Toronto, ON',
      current: {
        temperature: currentData.current.temperature_2m,
        humidity: currentData.current.relative_humidity_2m,
        precipitation: currentData.current.precipitation,
        windSpeed: currentData.current.wind_speed_10m,
        code: code,
        description: weatherCodes[code] || 'Unknown'
      },
      forecast: forecastData.daily.time.map((date, i) => ({
        date: date,
        max: forecastData.daily.temperature_2m_max[i],
        min: forecastData.daily.temperature_2m_min[i],
        code: forecastData.daily.weather_code[i]
      })),
      source: 'Open-Meteo',
      cached_at: new Date().toISOString()
    };
    
    res.json(result);
    
  } catch (err) {
    console.error('Weather fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Weather API - OpenWeatherMap (with API key, more reliable)
// Uses standard 2.5 API (free tier compatible)
app.get('/api/weather/openweather', async (req, res) => {
  try {
    const fetch = (await import('node-fetch')).default;
    const apiKey = process.env.OPENWEATHER_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENWEATHER_API_KEY not configured' });
    }
    
    // Toronto
    const city = 'Toronto';
    
    // Current weather (free tier compatible)
    const currentUrl = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric`;
    
    const currentResponse = await fetch(currentUrl);
    const currentData = await currentResponse.json();
    
    if (currentData.cod !== 200) {
      return res.status(500).json({ error: currentData.message || 'OpenWeather API error' });
    }
    
    // 5-day forecast (free tier compatible)
    const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${apiKey}&units=metric`;
    
    const forecastResponse = await fetch(forecastUrl);
    const forecastData = await forecastResponse.json();
    
    // Build daily forecast
    const dailyForecast = [];
    const seenDates = new Set();
    
    if (forecastData.list) {
      for (const item of forecastData.list) {
        const date = item.dt_txt.split(' ')[0];
        
        // One entry per day (noon reading)
        if (!seenDates.has(date)) {
          seenDates.add(date);
          dailyForecast.push({
            date: date,
            max: item.main.temp_max,
            min: item.main.temp_min,
            description: item.weather[0].description,
            icon: item.weather[0].icon
          });
          
          if (dailyForecast.length >= 5) break;
        }
      }
    }
    
    const result = {
      location: `${currentData.name}, ${currentData.sys.country}`,
      current: {
        temperature: currentData.main.temp,
        humidity: currentData.main.humidity,
        feels_like: currentData.main.feels_like,
        windSpeed: currentData.wind.speed,
        description: currentData.weather[0].description,
        icon: currentData.weather[0].icon,
        pressure: currentData.main.pressure,
        visibility: currentData.visibility
      },
      forecast: dailyForecast,
      source: 'OpenWeatherMap',
      cached_at: new Date().toISOString()
    };
    
    res.json(result);
    
  } catch (err) {
    console.error('OpenWeather fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});
