// Parse a Canvas rubric CSV export into { criteria, totalMax }.
//
// Canvas exports rubric CSVs in more than one column layout. Locating columns by
// header NAME (not fixed offsets) handles those variants and is robust to extra
// leading columns. The old fixed-offset parser assumed criteria-name at column 0
// and 2-column rating pairs at column 2; the current Canvas export adds leading
// "Rubric Name / Criteria Name / Criteria Description / Criteria Enable Range"
// columns and uses 3-column [Rating Name, Rating Description, Rating Points]
// rating groups — so every rating was shifted and the max came out wrong
// (e.g. 67.5 instead of 75, by reading the Proficient points as the only value).

// RFC-4180-ish tokenizer: handles quoted fields with embedded commas/newlines and
// doubled "" escapes. Fields are returned untrimmed; callers trim where needed.
function tokenizeCSV(text) {
  const rows = [];
  let row = [], field = '', inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (ch === '"') {
      if (inQuote && next === '"') { field += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      row.push(field); field = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuote) {
      if (ch === '\r' && next === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim())) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); if (row.some(f => f.trim())) rows.push(row); }
  return rows;
}

function parseRubricCsv(csv, makeId) {
  const genId = makeId || (() => require('uuid').v4());
  if (!csv || !csv.trim()) throw new Error('csv required');

  const rows = tokenizeCSV(csv);
  if (rows.length < 2) throw new Error('CSV has no data rows');

  const header = (rows[0] || []).map(h => (h || '').trim());
  const norm = header.map(h => h.toLowerCase());

  // Identify rating columns by header. A "Rating Points" column (current export)
  // is a 3-column group whose name/description sit in the two columns before it.
  // Any other "<something> Points" column (older export) is a 2-column pair whose
  // rating name lives in the header itself (e.g. "Accomplished Points").
  const ratingCols = [];
  for (let c = 0; c < header.length; c++) {
    if (norm[c] === 'rating points') {
      ratingCols.push({ ptsIdx: c, descIdx: c - 1, nameIdx: c - 2, nameFromHeader: null });
    } else if (/ points$/.test(norm[c]) && norm[c] !== 'points') {
      ratingCols.push({ ptsIdx: c, descIdx: c - 1, nameIdx: null, nameFromHeader: header[c].replace(/\s*points$/i, '').trim() });
    }
  }
  if (!ratingCols.length) {
    throw new Error('No rating-points columns found — check the CSV header (expected "Rating Points" columns).');
  }

  // Criteria-name column: by header, else fall back to the column just before the
  // first rating group.
  let critIdx = norm.findIndex(h => h === 'criteria name' || h === 'criterion' || h === 'criteria');
  if (critIdx < 0) critIdx = Math.max(0, Math.min(...ratingCols.map(r => r.descIdx)) - 1);
  const descColIdx = norm.findIndex(h => h === 'criteria description');

  const criteria = [];
  for (let i = 1; i < rows.length; i++) {
    const f = rows[i];
    const name = (f[critIdx] || '').trim();
    if (!name) continue;

    const ratings = [];
    for (const rc of ratingCols) {
      const pts = parseFloat(f[rc.ptsIdx]);
      if (isNaN(pts)) continue;
      const rname = (rc.nameIdx != null ? (f[rc.nameIdx] || '').trim() : '') || rc.nameFromHeader || '';
      ratings.push({ name: rname, description: (f[rc.descIdx] || '').trim(), points: pts });
    }
    if (!ratings.length) continue;

    criteria.push({
      id: genId(),
      name,
      description: descColIdx >= 0 ? (f[descColIdx] || '').trim() : '',
      maxPoints: Math.max(...ratings.map(r => r.points)),
      ratings,
    });
  }

  if (!criteria.length) throw new Error('No criteria found — check CSV format');

  const totalMax = criteria.reduce((a, c) => a + c.maxPoints, 0);
  return { criteria, totalMax };
}

module.exports = { parseRubricCsv, tokenizeCSV };
