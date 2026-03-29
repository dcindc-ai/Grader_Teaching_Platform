const path = require('path');
// Load .env with absolute path — works regardless of which directory node is run from
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const fs = require('fs');

const { db } = require('./db');
const { migrate } = require('./migrate');
migrate(db);

const app = express();
const PORT = process.env.PORT || 3001;

// Auth disabled

['./data', './uploads', './uploads/materials', './uploads/dev'].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use('/api', (req, res, next) => {
  next();
});

app.use('/api/courses', require('./routes/courses'));
app.use('/api/students', require('./routes/students'));
app.use('/api/assignments', require('./routes/assignments'));
app.use('/api/grade', require('./routes/grade'));
app.use('/api/discuss', require('./routes/discuss'));
app.use('/api/corpus', require('./routes/corpus'));
app.use('/api/materials', require('./routes/materials'));
app.use('/api/alwayson', require('./routes/alwayson'));
app.use('/api/dev', require('./routes/dev'));
app.use('/api/label', require('./routes/label'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/classreport', require('./routes/classreport'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/discussgrade', require('./routes/discussgrade'));
app.use('/api/annotate', require('./routes/annotate'));

// Canvas image proxy — fetches Canvas files server-side to bypass browser CORS
app.post('/api/canvas-proxy/file', async (req, res) => {
  const { fileUrl, canvasToken } = req.body;
  if (!fileUrl || !canvasToken) return res.status(400).json({ error: 'fileUrl and canvasToken required' });
  try {
    const response = await fetch(fileUrl, {
      headers: { 'Authorization': 'Bearer ' + canvasToken }
    });
    if (!response.ok) return res.status(response.status).json({ error: 'Canvas fetch failed: ' + response.status });
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const base64 = Buffer.from(buffer).toString('base64');
    res.json({ base64, contentType });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
app.use('/api/canvas', require('./routes/canvas'));
app.use('/api/canvassync', require('./routes/canvassync'));
app.use('/api/insights', require('./routes/insights'));
app.use('/api/canvasimport', require('./routes/canvasimport'));
app.use('/api/flags', require('./routes/flags'));
app.use('/api/batchgrade', require('./routes/batchgrade'));

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
}

app.listen(PORT, () => console.log(`Teaching Platform v2.0 running on port ${PORT}`));
