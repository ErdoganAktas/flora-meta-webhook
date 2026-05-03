require('dotenv').config();
const express = require('express');
const webhookRouter = require('./webhook');

const app = express();
const PORT = process.env.PORT || 3000;

// Raw body needed for X-Hub-Signature-256 verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/webhook', webhookRouter);

app.listen(PORT, () => {
  console.log(`Flora webhook server running on port ${PORT}`);

  const token = process.env.PAGE_ACCESS_TOKEN;
  console.log('TOKEN CHECK:', token
    ? 'Token var, ilk 10 karakter: ' + token.substring(0, 10)
    : 'TOKEN YOK!');

  const mcpKey = process.env.FLORA_MCP_KEY;
  console.log('MCP KEY CHECK:', mcpKey
    ? 'Key var, ilk 10 karakter: ' + mcpKey.substring(0, 10)
    : 'FLORA_MCP_KEY YOK!');
});
