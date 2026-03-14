require('dotenv').config({ path: '../.env' });
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

['./data', './uploads', './uploads/materials', './uploads/dev'].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use('/api', (req, res, next) => {
  const pw = req.headers['x-admin-password'] || req.query.password;
  if (pw !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
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

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
}

app.listen(PORT, () => console.log(`Teaching Platform v2.0 running on port ${PORT}`));
