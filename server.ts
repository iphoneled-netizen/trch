import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dgram from 'dgram';
import http from 'http';
import https from 'https';
import dns from 'dns';
import { URL } from 'url';

// --- Tracker Checking Logic ---

function checkDns(hostname: string): Promise<boolean> {
  return new Promise(resolve => {
    dns.lookup(hostname, (err) => resolve(!err));
  });
}

function checkHttpTracker(trackerUrl: string, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(trackerUrl);
      const lib = parsed.protocol === 'https:' ? https : http;
      
      const req = lib.get(trackerUrl, { timeout: timeoutMs, rejectUnauthorized: false }, (res) => {
        resolve(true); 
        req.destroy();
      });
      
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    } catch (e) {
      resolve(false);
    }
  });
}

function checkUdpTracker(trackerUrl: string, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(trackerUrl);
      const host = parsed.hostname;
      const port = parseInt(parsed.port || '80', 10);

      const client = dgram.createSocket('udp4');
      let resolved = false;

      const finish = (isAlive: boolean) => {
        if (!resolved) {
          resolved = true;
          try { client.close(); } catch (e) {}
          resolve(isAlive);
        }
      };

      client.on('error', () => finish(false));
      client.on('message', (msg) => {
        if (msg.length >= 8) {
          finish(true);
        }
      });

      const buf = Buffer.alloc(16);
      buf.writeUInt32BE(0x00000417, 0); 
      buf.writeUInt32BE(0x27101980, 4); 
      buf.writeUInt32BE(0, 8); 
      buf.writeUInt32BE(Math.floor(Math.random() * 0xffffffff), 12); 

      client.send(buf, 0, buf.length, port, host, (err) => {
        if (err) finish(false);
      });

      setTimeout(() => finish(false), timeoutMs);
    } catch (e) {
      resolve(false);
    }
  });
}

async function checkTracker(trackerUrl: string): Promise<boolean> {
  try {
    const parsed = new URL(trackerUrl);
    if (parsed.protocol === 'udp:') {
      return await checkUdpTracker(trackerUrl);
    } else if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return await checkHttpTracker(trackerUrl);
    } else {
      return await checkDns(parsed.hostname);
    }
  } catch {
    return false;
  }
}

// --- Server Setup ---

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // API to fetch a list of trackers from an external URL
  app.get('/api/fetch-url', async (req, res) => {
    try {
      const url = req.query.url as string;
      if (!url) {
        return res.status(400).json({ error: 'URL is required' });
      }
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(response.status).json({ error: 'Failed to fetch the URL' });
      }
      const text = await response.text();
      res.json({ text });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API to stream tracker check results
  app.post('/api/check-trackers', async (req, res) => {
    const { trackers } = req.body;
    
    if (!trackers || !Array.isArray(trackers)) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    const concurrency = 15;
    let active = 0;
    let index = 0;

    await new Promise<void>((resolve) => {
      const runNext = () => {
        if (index >= trackers.length && active === 0) {
          resolve();
          return;
        }
        while (active < concurrency && index < trackers.length) {
          const tracker = trackers[index++];
          active++;
          checkTracker(tracker).then(isAlive => {
            res.write(JSON.stringify({ tracker, isAlive }) + '\n');
            active--;
            runNext();
          });
        }
      };
      runNext();
    });

    res.end();
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
