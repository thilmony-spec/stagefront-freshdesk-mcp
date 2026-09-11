import express from 'express';

const app = express();
app.use(express.json({ limit: '10mb' }));

const domain = process.env.FRESHDESK_DOMAIN || 'stagefrontconsignment.freshdesk.com';
const apiKey = process.env.FRESHDESK_API_KEY;

async function freshdesk(path, options = {}) {
  if (!apiKey) throw new Error('FRESHDESK_API_KEY is not configured');
  const response = await fetch(`https://${domain}/api/v2${path}`, {
    ...options,
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:X`).toString('base64')}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`Freshdesk ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

app.get('/', (_req, res) => res.json({ name: 'stagefront-freshdesk-mcp', status: 'ok' }));
app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/mcp', async (req, res) => {
  const rpc = req.body;
  const result = (value) => res.json({ jsonrpc: '2.0', id: rpc.id ?? null, result: value });
  const error = (message) => res.json({ jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32603, message } });
  try {
    if (rpc.method === 'initialize') return result({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'stagefront-freshdesk-mcp', version: '1.0.0' } });
    if (rpc.method === 'notifications/initialized') return res.status(202).end();
    if (rpc.method === 'tools/list') return result({ tools: [
      { name: 'get_ticket', description: 'Get a Freshdesk ticket by ID', inputSchema: { type: 'object', properties: { ticket_id: { type: 'integer' } }, required: ['ticket_id'] } },
      { name: 'search_tickets', description: 'Search Freshdesk tickets using Freshdesk search query syntax', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
      { name: 'update_ticket', description: 'Update fields on a Freshdesk ticket', inputSchema: { type: 'object', properties: { ticket_id: { type: 'integer' }, fields: { type: 'object' } }, required: ['ticket_id','fields'] } },
      { name: 'add_note', description: 'Add a private or public note to a Freshdesk ticket', inputSchema: { type: 'object', properties: { ticket_id: { type: 'integer' }, body: { type: 'string' }, private: { type: 'boolean', default: true } }, required: ['ticket_id','body'] } }
    ] });
    if (rpc.method === 'tools/call') {
      const { name, arguments: a = {} } = rpc.params || {};
      let data;
      if (name === 'get_ticket') data = await freshdesk(`/tickets/${a.ticket_id}?include=conversations`);
      else if (name === 'search_tickets') data = await freshdesk(`/search/tickets?query=${encodeURIComponent('"' + a.query + '"')}`);
      else if (name === 'update_ticket') data = await freshdesk(`/tickets/${a.ticket_id}`, { method: 'PUT', body: JSON.stringify(a.fields) });
      else if (name === 'add_note') data = await freshdesk(`/tickets/${a.ticket_id}/notes`, { method: 'POST', body: JSON.stringify({ body: a.body, private: a.private !== false }) });
      else throw new Error(`Unknown tool: ${name}`);
      return result({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
    }
    return res.status(404).json({ jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: 'Method not found' } });
  } catch (e) { return error(e.message); }
});

const port = Number(process.env.PORT || 10000);
app.listen(port, '0.0.0.0', () => console.log(`Freshdesk MCP listening on ${port}`));
