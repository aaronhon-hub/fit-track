// ═══════════════════════════════════════════════════════════════════════
//  Adaptive Fitness Coach — API Router
//  Mounted at /api/fit-tracker by server.js
//
//  Usage: app.use('/api/fit-tracker', require('./apps/fit-tracker/router')(config));
//
//  Routes:
//    POST   /api/fit-tracker/claude/complete   — LLM proxy (non-streaming + streaming)
//    POST   /api/fit-tracker/sync/push         — delta push from client IndexedDB
//    GET    /api/fit-tracker/sync/pull         — pull records changed since timestamp
//    GET    /api/fit-tracker/sync/health       — unauthenticated connectivity check
//
//  Auth: every route except /health requires Bearer token (config.token).
//
//  Sync storage layout on NAS:
//    /volume1/Share/webapp/apps/fit-tracker/sync/
//      {userId}/
//        {storeName}/
//          {recordId}.json
//
//  Inside the container this maps to:
//    /app/apps/fit-tracker/sync/{userId}/{storeName}/{recordId}.json
// ═══════════════════════════════════════════════════════════════════════

'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const https   = require('https');

// Stores included in sync. Must match syncClient.ts SYNC_STORES.
const SYNC_STORES = [
  'user_profile',
  'cycle_configs',
  'session_logs',
  'benchmark_records',
  'cycle_evaluations',
];

// Maximum records accepted in a single push (safety limit)
const MAX_RECORDS_PER_PUSH = 500;

module.exports = function createFitTrackerRouter(config) {
  const router = express.Router();
  const TOKEN  = config.token || 'change-this-secret-token';

  // API key: prefer app-scoped key, fall back to platform key
  const ANTHROPIC_API_KEY =
    (config.apps && config.apps['fit-tracker'] && config.apps['fit-tracker'].anthropic_api_key)
    || config.anthropic_api_key
    || null;

  // Sync directory: two levels up from this file = /app inside container
  // then into apps/fit-tracker/sync/
  const SYNC_DIR = path.join(__dirname, 'sync');

  // Ensure sync root exists on startup
  if (!fs.existsSync(SYNC_DIR)) {
    fs.mkdirSync(SYNC_DIR, { recursive: true });
    console.log('[FitTracker] Sync directory created:', SYNC_DIR);
  }

  // ── Auth middleware ────────────────────────────────────────────────────────

  function requireAuth(req, res, next) {
    const auth = req.headers['authorization'] || '';
    const tok  = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (tok !== TOKEN) return res.status(401).json({ error: 'Unauthorized' });
    next();
  }

  // ── Input validation ───────────────────────────────────────────────────────

  function isValidUserId(userId) {
    // UUIDs only — prevents path traversal
    return typeof userId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
  }

  function isValidStoreName(name) {
    return SYNC_STORES.includes(name);
  }

  function isValidRecordId(id) {
    // UUID or alphanumeric slug — prevents path traversal
    return typeof id === 'string' && /^[a-zA-Z0-9_\-]{1,128}$/.test(id);
  }

  // ── Sync directory helpers ─────────────────────────────────────────────────

  function storeDir(userId, storeName) {
    const dir = path.join(SYNC_DIR, userId, storeName);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function recordPath(userId, storeName, recordId) {
    return path.join(storeDir(userId, storeName), `${recordId}.json`);
  }

  // Returns the ISO timestamp string from a record, used for delta filtering.
  // Matches the field priority in syncClient.ts getAllModifiedSince().
  function getRecordTimestamp(record) {
    return record.updated_at
        || record.completed_at
        || record.generated_at
        || record.triggered_at
        || record.date
        || '1970-01-01T00:00:00.000Z';
  }

  // ── Health check (unauthenticated) ─────────────────────────────────────────

  router.get('/health', (req, res) => {
    res.json({
      ok:      true,
      service: 'fit-tracker',
      claude:  !!ANTHROPIC_API_KEY,
      syncDir: fs.existsSync(SYNC_DIR),
    });
  });

  // ── Claude LLM Proxy ───────────────────────────────────────────────────────
  //
  //  Implements the same proxy contract as apps/athanor/router.js but mounted
  //  at /api/fit-tracker/claude/complete (dedicated, not shared with Athanor).
  //
  //  Request body (JSON): { messages, system?, model?, max_tokens?, stream? }
  //
  //  Unlike Athanor's single-turn prompt/string interface, this proxy accepts
  //  the full `messages` array. This is required because LLM workflows W1–W8
  //  (workflowOrchestrator.ts) pass multi-turn context for some workflows.
  //
  //  Streaming: supported but most fitness workflows use stream: false since
  //  they need complete JSON responses for schema validation (outputValidator.ts).
  //  W4 coaching notes may use streaming for better perceived UX.

  router.post('/claude/complete', requireAuth, (req, res) => {
    if (!ANTHROPIC_API_KEY) {
      return res.status(503).json({
        error: 'Anthropic API key not configured. Add apps.fit-tracker.anthropic_api_key to config.json.',
      });
    }

    let body;
    try { body = JSON.parse(req.body || '{}'); }
    catch (_) { return res.status(400).json({ error: 'Request body must be JSON' }); }

    const {
      messages,
      system,
      model      = 'claude-sonnet-4-6',
      max_tokens = 1024,
      stream     = false,
    } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required and must be non-empty' });
    }

    const anthropicBody = { model, max_tokens, messages, stream };
    if (system) anthropicBody.system = String(system);
    const bodyStr = JSON.stringify(anthropicBody);

    console.log(
      `[FitTracker-Claude] ${model} | messages: ${messages.length} | stream: ${stream} | ~${bodyStr.length} chars`,
    );

    const options = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'Content-Type':      'application/json',
        'Content-Length':    Buffer.byteLength(bodyStr),
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
    };

    if (stream) {
      // SSE streaming path — used by W4 coaching notes for perceived speed
      res.setHeader('Content-Type',      'text/event-stream');
      res.setHeader('Cache-Control',     'no-cache');
      res.setHeader('Connection',        'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');  // prevent Cloudflare/nginx buffering
      res.flushHeaders();

      const apiReq = https.request(options, (apiRes) => {
        if (apiRes.statusCode !== 200) {
          let errData = '';
          apiRes.on('data', c => { errData += c; });
          apiRes.on('end', () => {
            try {
              const parsed = JSON.parse(errData);
              res.write(`data: ${JSON.stringify({ ft_error: parsed.error?.message || errData })}\n\n`);
            } catch (_) {
              res.write(`data: ${JSON.stringify({ ft_error: errData })}\n\n`);
            }
            res.end();
          });
          return;
        }
        apiRes.on('data',  chunk => { try { res.write(chunk); } catch (_) {} });
        apiRes.on('end',   ()    => { try { res.end();        } catch (_) {} });
        apiRes.on('error', err   => {
          console.error('[FitTracker-Claude] Stream error:', err.message);
          try { res.end(); } catch (_) {}
        });
      });

      apiReq.on('error', err => {
        console.error('[FitTracker-Claude] Request error:', err.message);
        if (!res.headersSent) {
          res.status(502).json({ error: 'Anthropic API unreachable: ' + err.message });
        } else {
          try { res.end(); } catch (_) {}
        }
      });

      apiReq.write(bodyStr);
      apiReq.end();

    } else {
      // Non-streaming path — used by all structured JSON workflows (W1–W3, W5–W8)
      const apiReq = https.request(options, (apiRes) => {
        let data = '';
        apiRes.on('data', chunk => { data += chunk; });
        apiRes.on('end', () => {
          try {
            res.status(apiRes.statusCode).type('application/json').send(data);
          } catch (e) {
            if (!res.headersSent) res.status(500).json({ error: e.message });
          }
        });
      });

      apiReq.on('error', err => {
        console.error('[FitTracker-Claude] Request error:', err.message);
        if (!res.headersSent) {
          res.status(502).json({ error: 'Anthropic API unreachable: ' + err.message });
        }
      });

      apiReq.write(bodyStr);
      apiReq.end();
    }
  });

  // ── Sync: Push ─────────────────────────────────────────────────────────────
  //
  //  POST /api/fit-tracker/sync/push
  //  Body: { userId: string, payload: Record<storeName, record[]>, clientTs: string }
  //
  //  Writes each record as {recordId}.json into the appropriate store directory.
  //  Record ID is resolved from the record's keyPath field:
  //    user_profile    → user_id
  //    everything else → id

  router.post('/sync/push', requireAuth, (req, res) => {
    let body;
    try { body = JSON.parse(req.body || '{}'); }
    catch (_) { return res.status(400).json({ error: 'Request body must be JSON' }); }

    const { userId, payload } = body;

    if (!isValidUserId(userId)) {
      return res.status(400).json({ error: 'Invalid userId — must be a UUID' });
    }

    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'payload is required' });
    }

    let totalWritten = 0;
    const errors = [];

    for (const [storeName, records] of Object.entries(payload)) {
      if (!isValidStoreName(storeName)) {
        errors.push(`Unknown store: ${storeName}`);
        continue;
      }

      if (!Array.isArray(records)) {
        errors.push(`payload.${storeName} must be an array`);
        continue;
      }

      if (totalWritten + records.length > MAX_RECORDS_PER_PUSH) {
        errors.push(`Record limit exceeded (max ${MAX_RECORDS_PER_PUSH} per push)`);
        break;
      }

      for (const record of records) {
        // Resolve the record's primary key
        const recordId = storeName === 'user_profile' ? record.user_id : record.id;

        if (!isValidRecordId(String(recordId ?? ''))) {
          errors.push(`Invalid record ID in ${storeName}: ${recordId}`);
          continue;
        }

        try {
          const filePath = recordPath(userId, storeName, String(recordId));
          fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
          totalWritten++;
        } catch (err) {
          errors.push(`Failed to write ${storeName}/${recordId}: ${err.message}`);
        }
      }
    }

    console.log(`[FitTracker-Sync] Push — user: ${userId} | written: ${totalWritten} | errors: ${errors.length}`);

    res.json({
      ok:           errors.length === 0,
      recordsWritten: totalWritten,
      errors:       errors.length > 0 ? errors : undefined,
    });
  });

  // ── Sync: Pull ─────────────────────────────────────────────────────────────
  //
  //  GET /api/fit-tracker/sync/pull?userId={uuid}&since={isoTimestamp}
  //
  //  Returns all records for the user modified after the `since` timestamp.
  //  Timestamp comparison uses the same field priority as getRecordTimestamp().

  router.get('/sync/pull', requireAuth, (req, res) => {
    const { userId, since } = req.query;

    if (!isValidUserId(userId)) {
      return res.status(400).json({ error: 'Invalid userId — must be a UUID' });
    }

    const sinceTs = since || '1970-01-01T00:00:00.000Z';
    const payload = {};
    let totalRecords = 0;

    for (const storeName of SYNC_STORES) {
      const dir = path.join(SYNC_DIR, userId, storeName);
      if (!fs.existsSync(dir)) {
        payload[storeName] = [];
        continue;
      }

      const records = [];
      let files;
      try {
        files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      } catch (_) {
        payload[storeName] = [];
        continue;
      }

      for (const file of files) {
        try {
          const raw    = fs.readFileSync(path.join(dir, file), 'utf8');
          const record = JSON.parse(raw);
          const ts     = getRecordTimestamp(record);
          if (ts > sinceTs) {
            records.push(record);
          }
        } catch (_) {
          // Corrupt file — skip silently; won't affect other records
        }
      }

      payload[storeName] = records;
      totalRecords += records.length;
    }

    console.log(`[FitTracker-Sync] Pull — user: ${userId} | since: ${sinceTs} | records: ${totalRecords}`);

    res.json({ ok: true, payload, recordCount: totalRecords });
  });

  return router;
};
