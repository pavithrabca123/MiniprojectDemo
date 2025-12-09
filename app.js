// Single-file frontend logic: fetch-based API + socket.io chat
const api = {
  getAttendance: () => fetch('/api/attendance').then(r=>r.json()),
  addStudent: (s) => fetch('/api/attendance/student',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)}).then(r=>r.json()),
  addRecord: (rec)=> fetch('/api/attendance/record',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rec)}).then(r=>r.json()),
  getMaterials: ()=> fetch('/api/materials').then(r=>r.json()),
  uploadMaterial: (formData)=> fetch('/api/materials/upload',{method:'POST',body:formData}).then(r=>r.json()),
  generateTimetable: (data)=> fetch('/api/timetable/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json()),
  getChatHistory: ()=> fetch('/api/chat/history').then(r=>r.json())
};

document.addEventListener('DOMContentLoaded', () => {
  // Panel navigation
  document.querySelectorAll('.sidebar button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sidebar button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const panel = btn.dataset.panel;
      document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
      document.getElementById('panel-' + panel).classList.remove('hidden');
    });
  });

  // Attendance logic
  const studentsList = document.getElementById('students-list');
  const addStudentForm = document.getElementById('add-student-form');
  addStudentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('studentId').value.trim();
    const name = document.getElementById('studentName').value.trim();
    if (!id || !name) return alert('Provide ID and name');
    await api.addStudent({ studentId: id, name });
    document.getElementById('studentId').value = '';
    document.getElementById('studentName').value = '';
    renderAttendance();
  });

  async function renderAttendance(){
    const data = await api.getAttendance();
    studentsList.innerHTML = '';
    Object.entries(data).forEach(([id, s])=>{
      const card = document.createElement('div');
      card.className = 'panel';
      card.style.marginBottom = '10px';
      card.innerHTML = `
        <strong>${s.name}</strong> <small class="muted">(${id})</small>
        <div style="margin-top:8px">
          <button data-id="${id}" class="mark-present">Mark Present (today)</button>
          <button data-id="${id}" class="view-records">View Records</button>
          <div class="records"></div>
        </div>
      `;
      studentsList.appendChild(card);

      card.querySelector('.mark-present').addEventListener('click', async () => {
        const today = new Date().toISOString().slice(0,10);
        await api.addRecord({ studentId: id, date: today, present: true });
        alert('Marked present for ' + s.name);
        renderAttendance();
      });

      card.querySelector('.view-records').addEventListener('click', () => {
        const recDiv = card.querySelector('.records');
        recDiv.innerHTML = '<ul>' + s.records.map(r=>`<li>${r.date}: ${r.present? 'Present':'Absent'}</li>`).join('') + '</ul>';
      });
    });
  }

  renderAttendance();

  // Materials logic
  const materialsList = document.getElementById('materials-list');
  const uploadForm = document.getElementById('upload-form');
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('material-file');
    if (!fileInput.files.length) return alert('Select a file');
    const fd = new FormData();
    fd.append('file', fileInput.files[0]);
    fd.append('title', document.getElementById('material-title').value || fileInput.files[0].name);
    const res = await api.uploadMaterial(fd);
    if (res.ok) {
      document.getElementById('material-title').value = '';
      fileInput.value = '';
      loadMaterials();
    } else {
      alert('Upload failed');
    }
  });

  async function loadMaterials(){
    const list = await api.getMaterials();
    materialsList.innerHTML = list.map(m => `<li><a href="/uploads/${m.filename}" target="_blank">${escapeHtml(m.title)}</a><span style="color:#999"> • ${new Date(m.uploadedAt).toLocaleString()}</span></li>`).join('');
  }
  loadMaterials();

  // Timetable generator
  document.getElementById('add-subj').addEventListener('click', () => addSubjectRow());
  function addSubjectRow(){
    const container = document.getElementById('subjects-container');
    const row = document.createElement('div');
    row.className = 'subject-row';
    row.innerHTML = `<input placeholder="Subject name" class="subj-name" /><input type="number" placeholder="Hours/week" class="subj-hours" min="0" /><button type="button" class="remove-subj">✕</button>`;
    container.appendChild(row);
    row.querySelector('.remove-subj').addEventListener('click', ()=>row.remove());
  }
  // start with 1
  document.querySelectorAll('.subject-row .remove-subj').forEach(b => b.addEventListener('click', e => e.target.closest('.subject-row').remove()));

  document.getElementById('timetable-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rows = Array.from(document.querySelectorAll('.subject-row'));
    const subjects = rows.map(r => ({ name: r.querySelector('.subj-name').value.trim() || 'Unnamed', hoursPerWeek: Number(r.querySelector('.subj-hours').value) || 0 }));
    const res = await api.generateTimetable({ subjects, startHour: 8, endHour: 20 });
    renderTimetable(res);
  });

  function renderTimetable(data){
    const out = document.getElementById('timetable-output');
    const days = data.days;
    const start = data.startHour;
    let html = '<table class="timetable" border="1" cellpadding="6" style="border-collapse:collapse;width:100%"><thead><tr><th>Hour</th>';
    days.forEach(d => html += `<th>${d}</th>`);
    html += '</tr></thead><tbody>';
    const rows = data.grid[days[0]].length;
    for (let h = 0; h < rows; h++){
      html += `<tr><td>${start + h}:00</td>`;
      days.forEach(d => {
        const sub = data.grid[d][h].subject;
        html += `<td>${escapeHtml(sub)}</td>`;
      });
      html += '</tr>';
    }
    html += '</tbody></table>';
    out.innerHTML = html;
  }

  // Chat (Socket.IO)
  const socket = io();
  const chatLog = document.getElementById('chat-log');
  const chatForm = document.getElementById('chat-form');
  api.getChatHistory().then(h => { h.forEach(renderChatMessage); chatLog.scrollTop = chatLog.scrollHeight; });

  socket.on('chat:message', (msg) => {
    renderChatMessage(msg);
  });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('chat-name').value.trim() || 'Student';
    const text = document.getElementById('chat-input').value.trim();
    if (!text) return;
    socket.emit('chat:message', { from: name, text });
    document.getElementById('chat-input').value = '';
  });

  function renderChatMessage(m){
    const div = document.createElement('div');
    div.className = 'chat-entry';
    div.innerHTML = `<strong>${escapeHtml(m.from || 'Anon')}</strong> <small style="color:#666">${new Date(m.ts || Date.now()).toLocaleTimeString()}</small><div>${escapeHtml(m.text)}</div>`;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  // utils
  function escapeHtml(s){ return (s||'').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
});
