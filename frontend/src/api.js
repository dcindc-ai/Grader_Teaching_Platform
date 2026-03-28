const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

function h(pw) {
  return { 'Content-Type': 'application/json', 'x-admin-password': pw };
}
async function get(url, pw) {
  const r = await fetch(`${BASE}${url}`, { headers: h(pw) });
  if (!r.ok) throw new Error(r.status === 401 ? 'Unauthorized' : await r.text());
  return r.json();
}
async function post(url, body, pw) {
  const r = await fetch(`${BASE}${url}`, { method: 'POST', headers: h(pw), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function put(url, body, pw) {
  const r = await fetch(`${BASE}${url}`, { method: 'PUT', headers: h(pw), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function del(url, pw) {
  const r = await fetch(`${BASE}${url}`, { method: 'DELETE', headers: h(pw) });
  return r.json();
}

// Courses
export const getCourses = (pw) => get('/api/courses', pw);
export const createCourse = (data, pw) => post('/api/courses', data, pw);
export const updateCourse = (id, data, pw) => put(`/api/courses/${id}`, data, pw);
export const deleteCourse = (id, pw) => del(`/api/courses/${id}`, pw);

// Assignments
export const getAssignments = (courseId, pw) => get(`/api/assignments?courseId=${courseId}`, pw);
export const createAssignment = (data, pw) => post('/api/assignments', data, pw);
export const updateAssignment = (id, data, pw) => put(`/api/assignments/${id}`, data, pw);
export const deleteAssignment = (id, pw) => del(`/api/assignments/${id}`, pw);
export const getExamples = (assignmentId, pw) => get(`/api/assignments/${assignmentId}/examples`, pw);
export const addExample = (assignmentId, data, pw) => post(`/api/assignments/${assignmentId}/examples`, data, pw);
export const deleteExample = (assignmentId, exId, pw) => del(`/api/assignments/${assignmentId}/examples/${exId}`, pw);

// Students
export const getStudents = (courseId, pw) => get(`/api/students?courseId=${courseId}`, pw);
export const uploadRoster = (courseId, students, pw) => post('/api/students/roster', { courseId, students }, pw);
export const addStudent = (data, pw) => post('/api/students', data, pw);
export const deleteStudent = (id, pw) => del(`/api/students/${id}`, pw);
export const getProgress = (courseId, pw) => get(`/api/students/progress/${courseId}`, pw);

// Grades
export const getGrades = (courseId, assignmentId, pw) => {
  const q = new URLSearchParams();
  if (courseId) q.set('courseId', courseId);
  if (assignmentId) q.set('assignmentId', assignmentId);
  return get(`/api/grade?${q}`, pw);
};
export const deleteGrade = (id, pw) => del(`/api/grade/${id}`, pw);
export const downloadGrades = (courseId, assignmentId, pw) => {
  const q = new URLSearchParams({ password: pw });
  if (courseId) q.set('courseId', courseId);
  if (assignmentId) q.set('assignmentId', assignmentId);
  window.open(`${BASE}/api/grade/download?${q}`, '_blank');
};

export function gradeBatch(files, assignmentId, courseId, password, onProgress, gradeOptions = {}) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('assignmentId', assignmentId);
    fd.append('courseId', courseId);
    if (gradeOptions.tone) fd.append('tone', gradeOptions.tone);
    if (gradeOptions.style) fd.append('style', gradeOptions.style);
    if (gradeOptions.sentences) fd.append('sentences', gradeOptions.sentences);
    files.forEach((f, i) => { fd.append('files', f); fd.append(`name_${i}`, f.name); });

    fetch(`${BASE}/api/grade/batch`, {
      method: 'POST',
      headers: { 'x-admin-password': password },
      body: fd
    }).then(async resp => {
      if (!resp.ok) { reject(new Error('Batch grade failed')); return; }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const results = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.grade) results.push(evt.grade);
              onProgress(evt);
            } catch (e) {}
          }
        }
      }
      resolve(results);
    }).catch(reject);
  });
}

// Discussion
export const generateReply = (data, pw) => post('/api/discuss/reply', data, pw);
export const generateSummary = (data, pw) => post('/api/discuss/summary', data, pw);
export const getDiscussHistory = (courseId, pw) => get(`/api/discuss/history?courseId=${courseId}`, pw);

// Corpus
export const queryCorpus = (question, pw) => post('/api/corpus/query', { question }, pw);
export const getCorpusStats = (pw) => get('/api/corpus/stats', pw);
