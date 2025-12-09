const express = require('express');
const http = require('http');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure uploads dir exists
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.random().toString(36).slice(2,8);
    cb(null, unique + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// Simple in-memory stores (replace with DB in production)
let attendance = {}; // { studentId: { name, records: [{date: '2025-12-01', present: true}] } }
let materials = []; // { id, title, filename, uploadedAt }
let chats = []; // persisted chat messages
let timetableTemplates = []; // optional saved timetables

// ---------- Attendance endpoints ----------
app.get('/api/attendance', (req, res) => {
  res.json(attendance);
});

app.post('/api/attendance/student', (req, res) => {
  const { studentId, name } = req.body;
  if (!studentId || !name) return res.status(400).json({error: 'studentId and name required'});
  if (!attendance[studentId]) attendance[studentId] = { name, records: [] };
  res.json({ok: true, student: attendance[studentId]});
});

app.post('/api/attendance/record', (req, res) => {
  const { studentId, date, present } = req.body;
  if (!attendance[studentId]) return res.status(404).json({error: 'student not found'});
  attendance[studentId].records.push({ date, present: !!present });
  res.json({ok: true});
});

// ---------- Study materials ----------
app.get('/api/materials', (req, res) => {
  res.json(materials);
});

app.post('/api/materials/upload', upload.single('file'), (req, res) => {
  const title = req.body.title || req.file.originalname;
  const entry = {
    id: Date.now().toString(),
    title,
    filename: req.file.filename,
    originalName: req.file.originalname,
    uploadedAt: new Date().toISOString()
  };
  materials.unshift(entry);
  res.json({ok: true, entry});
});

// ---------- Timetable generator ----------
/**
 * POST /api/timetable/generate
 * body: { subjects: [{name, hoursPerWeek}], startHour: 8, endHour: 22, days: ["Mon","Tue",...]}
 * returns simple grid mapping
 */
app.post('/api/timetable/generate', (req, res) => {
  const { subjects = [], startHour = 8, endHour = 20, days = ["Mon","Tue","Wed","Thu","Fri"] } = req.body;
  // Build slots (hourly)
  const slotsPerDay = endHour - startHour;
  const totalSlots = slotsPerDay * days.length;
  // Expand subjects into hour blocks
  let blocks = [];
  subjects.forEach(s => {
    const h = Math.max(0, Math.round(s.hoursPerWeek));
    for (let i=0;i<h;i++) blocks.push({ name: s.name });
  });
  // Fill remaining with "Free"
  while (blocks.length < totalSlots) blocks.push({ name: "Free" });
  // Simple distribution: assign sequentially into day/hour
  let grid = {};
  let idx = 0;
  for (let d of days) {
    grid[d] = [];
    for (let h = 0; h < slotsPerDay; h++) {
      grid[d].push({
        hour: startHour + h,
        subject: blocks[idx] ? blocks[idx].name : "Free"
      });
      idx++;
    }
  }
  res.json({ grid, startHour, endHour, days });
});

// ---------- Simple persisted chat log endpoint ----------
app.get('/api/chat/history', (req, res) => {
  res.json(chats);
});

// ---------- Socket.IO for mini chat ----------
io.on('connection', (socket) => {
  console.log('Socket connected', socket.id);
  socket.on('chat:message', (msg) => {
    const payload = {
      id: Date.now().toString(),
      text: msg.text,
      from: msg.from || 'Anon',
      ts: new Date().toISOString()
    };
    chats.push(payload);
    // broadcast to everyone
    io.emit('chat:message', payload);
  });
  socket.on('disconnect', () => {
    console.log('Socket disconnected', socket.id);
  });
});

// fallback / route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server started on http://localhost:${PORT}`));
