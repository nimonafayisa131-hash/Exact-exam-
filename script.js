// ===== CONSTANTS =====
const DEFAULT_ADMIN_USER = 'year';
const DEFAULT_ADMIN_PASS = '2026';
const SK_RESULTS   = 'eq2_results';
const SK_ATTEMPTED = 'eq2_attempted';
const SK_COURSES   = 'eq2_courses';
const SK_SETTINGS  = 'eq2_settings';
const SK_AUTHORIZED = 'eq2_authorized';
const SK_TEACHERS = 'eq2_teachers';


const FIREBASE_URL = 'https://exam-c9ed6-default-rtdb.firebaseio.com';

// ===== CLOUD FUNCTIONS (server-side grading) =====

const CLOUD_FUNCTIONS_BASE_URL = 'https://us-central1-exam-c9ed6.cloudfunctions.net';

async function fbGet(key) {
  try {
    const res = await fetch(`${FIREBASE_URL}/${key}.json`);
    if (!res.ok) throw new Error('Firebase GET ' + key + ' failed: ' + res.status);
    return await res.json();
  } catch (e) {
    console.warn('Firebase read failed for "' + key + '":', e);
    return null;
  }
}

function fbSet(key, value) {
  return fetch(`${FIREBASE_URL}/${key}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  }).then(res => {
    if (!res.ok) throw new Error('Firebase PUT ' + key + ' failed: ' + res.status);
    return true;
  }).catch(e => {
    console.warn('Firebase write failed for "' + key + '":', e);
    return false;
  });
}

async function syncAllFromFirebase() {
  const [c, s, a, r, at, t] = await Promise.all([
    fbGet('courses'), fbGet('settings'), fbGet('authorized'), fbGet('results'), fbGet('attempted'), fbGet('teachers')
  ]);
  if (c) localStorage.setItem(SK_COURSES, JSON.stringify(c)); else fbSet('courses', courses);
  if (s) localStorage.setItem(SK_SETTINGS, JSON.stringify(s)); else fbSet('settings', settings);
  if (a) localStorage.setItem(SK_AUTHORIZED, JSON.stringify(a)); else fbSet('authorized', loadAuthorized());
  if (r) localStorage.setItem(SK_RESULTS, JSON.stringify(r)); else fbSet('results', JSON.parse(localStorage.getItem(SK_RESULTS) || '[]'));
  if (at) localStorage.setItem(SK_ATTEMPTED, JSON.stringify(at)); else fbSet('attempted', JSON.parse(localStorage.getItem(SK_ATTEMPTED) || '[]'));
  if (t) localStorage.setItem(SK_TEACHERS, JSON.stringify(t)); else fbSet('teachers', loadTeachers());
  loadData();
  refreshVisibleAdminOrStudentView();
}

function refreshVisibleAdminOrStudentView() {
  try {
    if (document.getElementById('screen-login').classList.contains('active')) {
      renderAdminContactCard();
    }
    if (document.getElementById('screen-course-select').classList.contains('active')) {
      renderCourseSelectGrid();
    }
    if (document.getElementById('screen-admin').classList.contains('active')) {
      if (document.getElementById('tab-results').classList.contains('active')) loadResultsTab();
      if (document.getElementById('tab-courses').classList.contains('active')) refreshCoursesView();
      if (document.getElementById('tab-students').classList.contains('active')) renderAuthorizedTab();
      if (document.getElementById('tab-teachers').classList.contains('active')) renderTeachersTab();
      if (document.getElementById('tab-settings').classList.contains('active')) loadSettingsUI();
    }
  } catch (e) {}
}

// ===== DEFAULT COURSES =====
const DEFAULT_COURSES = [];

const DEFAULT_SETTINGS = {
  timeMins: 20,
  passPercent: 50,
  qCount: 0,
  shuffleQ: true,
  shuffleA: true
};

// ===== STATE =====
let courses = [];
let settings = {};
let loggedInStudent = null;
let currentQ = 0;
let examQuestions = [];
let answers = [];
let answerMap = [];
let timerInterval = null;
let timeLeft = 0;
let TOTAL_TIME = 0;
let currentStudent = {};
let selectedCourseId = null;
let activeCourseId = null;
let editingQIdx = null;
let deletingQIdx = null;
let pendingCorrect = null;
let editingCourseId = null;
let deletingCourseId = null;
let currentQuestionType = 'mcq';
let pendingTFCorrect = null;
let lastExamSnapshot = null;
let currentRole = 'admin';
let currentTeacher = null;
let lastFilteredResults = [];

// ===== DATA =====
function loadData() {
  const sc = localStorage.getItem(SK_COURSES);
  courses = sc ? JSON.parse(sc) : JSON.parse(JSON.stringify(DEFAULT_COURSES));
  const ss = localStorage.getItem(SK_SETTINGS);
  settings = ss ? { ...DEFAULT_SETTINGS, ...JSON.parse(ss) } : { ...DEFAULT_SETTINGS };
}
loadData();
renderAdminContactCard();
updateHeaderLinks('screen-login');
syncAllFromFirebase();

// ===== AUTHORIZED STUDENTS =====
function loadAuthorized() {
  const sa = localStorage.getItem(SK_AUTHORIZED);
  return sa ? JSON.parse(sa) : [];
}

function saveAuthorized(list) {
  localStorage.setItem(SK_AUTHORIZED, JSON.stringify(list));
  fbSet('authorized', list);
}

function findAuthorizedStudent(username, password) {
  const list = loadAuthorized();
  const u = username.trim().toLowerCase();
  return list.find(s => (s.username || '').toLowerCase() === u && s.password === password) || null;
}

function renderAuthorizedTab() {
  const list = loadAuthorized();
  document.getElementById('stat-authorized').textContent = list.length;
  const tbody = document.getElementById('authorized-tbody');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="icon">👥</div><p>No students have been added yet. Until at least one student is added, no one will be able to log in.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = list.map((s, i) => `
    <tr>
      <td><strong>${i + 1}</strong></td>
      <td><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:0.78rem">${s.id}</code></td>
      <td>${s.name || '<span style="color:#94a3b8">—</span>'}</td>
      <td>${s.dept || '<span style="color:#94a3b8">—</span>'}</td>
      <td>${s.username || '<span style="color:#94a3b8">—</span>'}</td>
      <td><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:0.78rem">${s.password || ''}</code></td>
      <td style="text-align:right"><button class="clear-btn" onclick="removeAuthorizedStudent('${s.id}')">🗑️ Delete</button></td>
    </tr>`).join('');
}

function addAuthorizedStudent() {
  const idInput = document.getElementById('auth-id');
  const nameInput = document.getElementById('auth-name');
  const deptInput = document.getElementById('auth-dept');
  const userInput = document.getElementById('auth-username');
  const passInput = document.getElementById('auth-password');
  const err = document.getElementById('auth-error');
  const id = idInput.value.trim().toUpperCase();
  const name = nameInput.value.trim();
  const dept = deptInput.value;
  const username = userInput.value.trim();
  const password = passInput.value.trim();
  if (!id || !name || !dept || !username || !password) {
    err.textContent = 'Please fill in Student ID, Full Name, Department, Username, and Password.';
    err.classList.add('show');
    return;
  }
  const list = loadAuthorized();
  if (list.some(s => s.id === id)) {
    err.textContent = 'This ID is already in the list.';
    err.classList.add('show');
    return;
  }
  if (list.some(s => (s.username || '').toLowerCase() === username.toLowerCase())) {
    err.textContent = 'This username is already taken. Please choose another.';
    err.classList.add('show');
    return;
  }
  err.classList.remove('show');
  list.push({ id, name, dept, username, password });
  saveAuthorized(list);
  idInput.value = '';
  nameInput.value = '';
  deptInput.value = '';
  userInput.value = '';
  passInput.value = '';
  renderAuthorizedTab();
}

function addAuthorizedBulk() {
  const bulkInput = document.getElementById('auth-bulk');
  const lines = bulkInput.value.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return;
  const list = loadAuthorized();
  const existingIds = new Set(list.map(s => s.id));
  const existingUsers = new Set(list.map(s => (s.username || '').toLowerCase()));
  lines.forEach(line => {
    const parts = line.split(',').map(p => p.trim());
    const id = (parts[0] || '').toUpperCase();
    const name = parts[1] || '';
    const dept = parts[2] || '';
    const username = parts[3] || '';
    const password = parts[4] || '';
    if (id && username && password && !existingIds.has(id) && !existingUsers.has(username.toLowerCase())) {
      list.push({ id, name, dept, username, password });
      existingIds.add(id);
      existingUsers.add(username.toLowerCase());
    }
  });
  saveAuthorized(list);
  bulkInput.value = '';
  renderAuthorizedTab();
}

function removeAuthorizedStudent(id) {
  let list = loadAuthorized();
  list = list.filter(s => s.id !== id);
  saveAuthorized(list);
  renderAuthorizedTab();
}

function confirmClearAuthorized() {
  document.getElementById('clear-auth-modal').classList.add('show');
}

function clearAllAuthorized() {
  localStorage.removeItem(SK_AUTHORIZED);
  fbSet('authorized', null);
  closeModal('clear-auth-modal');
  renderAuthorizedTab();
}

// ===== TEACHERS =====
function loadTeachers() {
  const st = localStorage.getItem(SK_TEACHERS);
  return st ? JSON.parse(st) : [];
}

function saveTeachers(list) {
  localStorage.setItem(SK_TEACHERS, JSON.stringify(list));
  fbSet('teachers', list);
}

function findTeacher(username, password) {
  const list = loadTeachers();
  const u = username.trim().toLowerCase();
  return list.find(t => (t.username || '').toLowerCase() === u && t.password === password) || null;
}

function renderTeacherCourseChecks() {
  const box = document.getElementById('teach-course-checks');
  if (!box) return;
  if (!courses.length) {
    box.innerHTML = `<div class="setting-hint">No courses exist yet — add a course first.</div>`;
    return;
  }
  box.innerHTML = courses.map(c => `
    <label style="display:flex;align-items:center;gap:0.4rem;margin:0;font-weight:400">
      <input type="checkbox" class="teach-course-check" value="${c.id}"> ${c.icon || '📚'} ${c.name}
    </label>`).join('');
}

function renderTeachersTab() {
  renderTeacherCourseChecks();
  const list = loadTeachers();
  document.getElementById('stat-teachers').textContent = list.length;
  const tbody = document.getElementById('teachers-tbody');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="icon">👨‍🏫</div><p>No teachers have been added yet.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = list.map((t, i) => {
    const names = (t.courseIds || []).map(id => getCourse(id)).filter(Boolean).map(c => c.name);
    const coursesLabel = names.length
      ? names.map(n => `<span class="badge badge-course">${n}</span>`).join(' ')
      : '<span style="color:#94a3b8">— none assigned —</span>';
    return `
    <tr>
      <td><strong>${i + 1}</strong></td>
      <td>${t.name || '<span style="color:#94a3b8">—</span>'}</td>
      <td>${t.username || '<span style="color:#94a3b8">—</span>'}</td>
      <td><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:0.78rem">${t.password || ''}</code></td>
      <td>${coursesLabel}</td>
      <td style="text-align:right"><button class="clear-btn" onclick="removeTeacher('${t.id}')">🗑️ Delete</button></td>
    </tr>`;
  }).join('');
}

function addTeacher() {
  const nameInput = document.getElementById('teach-name');
  const userInput = document.getElementById('teach-username');
  const passInput = document.getElementById('teach-password');
  const err = document.getElementById('teach-error');
  const name = nameInput.value.trim();
  const username = userInput.value.trim();
  const password = passInput.value.trim();
  const courseIds = Array.from(document.querySelectorAll('.teach-course-check:checked')).map(cb => cb.value);
  if (!name || !username || !password) {
    err.textContent = 'Please fill in Full Name, Username, and Password.';
    err.classList.add('show');
    return;
  }
  const list = loadTeachers();
  if (list.some(t => (t.username || '').toLowerCase() === username.toLowerCase())) {
    err.textContent = 'This username is already taken. Please choose another.';
    err.classList.add('show');
    return;
  }
  if (!courseIds.length) {
    err.textContent = 'Please select at least one course this teacher may view results for.';
    err.classList.add('show');
    return;
  }
  err.classList.remove('show');
  list.push({ id: 'teacher_' + Date.now(), name, username, password, courseIds });
  saveTeachers(list);
  nameInput.value = '';
  userInput.value = '';
  passInput.value = '';
  renderTeachersTab();
}

function removeTeacher(id) {
  let list = loadTeachers();
  list = list.filter(t => t.id !== id);
  saveTeachers(list);
  renderTeachersTab();
}

function confirmClearTeachers() {
  document.getElementById('clear-teachers-modal').classList.add('show');
}

function clearAllTeachers() {
  localStorage.removeItem(SK_TEACHERS);
  fbSet('teachers', null);
  closeModal('clear-teachers-modal');
  renderTeachersTab();
}

function applyRoleUI() {
  const isTeacher = currentRole === 'teacher';
  document.querySelectorAll('.admin-only-tab').forEach(el => {
    el.style.display = isTeacher ? 'none' : '';
  });
  document.getElementById('admin-dashboard-title').textContent = isTeacher ? '👨‍🏫 Teacher Dashboard' : '🎓 Admin Dashboard';
  document.getElementById('admin-dashboard-subtitle').textContent = isTeacher
    ? `Online Exam System — Results for ${currentTeacher ? currentTeacher.name : 'your'} courses`
    : 'Online Exam System — Full Control';
}

// ===== SCREENS =====
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.body.classList.toggle('exam-no-copy', id === 'screen-exam');
  updateHeaderLinks(id);
}

function updateHeaderLinks(id) {
  const aboutLink = document.getElementById('navbar-about-link');
  if (aboutLink) {
    const studentFlowScreens = ['screen-course-select', 'screen-exam', 'screen-result', 'screen-review', 'screen-blocked'];
    aboutLink.style.display = (loggedInStudent && studentFlowScreens.includes(id)) ? 'inline-flex' : 'none';
  }

  const contactLink = document.getElementById('navbar-contact-link');
  if (contactLink) {
    const profile = (settings && settings.adminProfile) || {};
    const hasProfile = !!(profile.name || profile.role || profile.email || profile.phone ||
      profile.facebook || profile.telegram || profile.whatsapp || profile.location || profile.hours || profile.photo);
    const hiddenOn = ['screen-exam', 'screen-admin', 'screen-contact-us'];
    contactLink.style.display = (hasProfile && !hiddenOn.includes(id)) ? 'inline-flex' : 'none';
  }
}

function backFromContactUs() {
  showScreen(loggedInStudent ? 'screen-course-select' : 'screen-login');
}

function goStudentLogin() {
  loadData();
  showScreen('screen-login');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

// ===== UTILS =====
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getCourse(id) {
  return courses.find(c => c.id === id);
}

function getCourseSettings(course) {
  return {
    timeMins: (course.settings && course.settings.timeMins) || 20,
    passPercent: (course.settings && course.settings.passPercent) || 50,
    qCount: (course.settings && course.settings.qCount) || 0,
    shuffleQ: course.settings ? course.settings.shuffleQ !== false : true,
    shuffleA: course.settings ? course.settings.shuffleA !== false : true,
    retake: course.settings ? course.settings.retake === true : false
  };
}

function formatScheduleDateTime(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function getCourseScheduleStatus(course) {
  const now = new Date();
  const start = course.scheduleStart ? new Date(course.scheduleStart) : null;
  const end = course.scheduleEnd ? new Date(course.scheduleEnd) : null;
  if (start && now < start) {
    return { state: 'upcoming', message: `⏳ This exam hasn't opened yet. It opens on ${formatScheduleDateTime(course.scheduleStart)}.` };
  }
  if (end && now > end) {
    return { state: 'closed', message: `🔒 This exam window has closed. It closed on ${formatScheduleDateTime(course.scheduleEnd)}.` };
  }
  return { state: 'open', message: '' };
}

function saveCourses() {
  courses.forEach(c => {
    const answerKey = (c.questions || []).map(q => q.ans);
    fetch(`${CLOUD_FUNCTIONS_BASE_URL}/saveAnswerKey`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId: c.id, answerKey })
    }).catch(e => console.warn('saveAnswerKey failed for', c.id, e));
  });

  const publicCourses = courses.map(c => ({
    ...c,
    questions: (c.questions || []).map(({ ans, ...rest }) => rest)
  }));
  localStorage.setItem(SK_COURSES, JSON.stringify(publicCourses));
  fbSet('courses', publicCourses);
}

async function loadAnswerKeysForAdminEditor() {
  try {
    const res = await fetch(`${CLOUD_FUNCTIONS_BASE_URL}/getAnswerKeys`);
    if (!res.ok) throw new Error('getAnswerKeys failed: ' + res.status);
    const answerKeys = await res.json();
    courses.forEach(c => {
      const key = answerKeys[c.id];
      if (key && Array.isArray(c.questions)) {
        c.questions.forEach((q, i) => { q.ans = key[i]; });
      }
    });
  } catch (e) {
    console.warn('Could not load answer keys for editor:', e);
  }
}

// ===== COURSE SELECT (student) =====
function renderCourseSelectGrid() {
  const listEl = document.getElementById('course-select-list');
  const studentDept = loggedInStudent ? loggedInStudent.dept : null;
  const visibleCourses = courses.filter(c => !c.hidden && c.dept === studentDept);
  if (!visibleCourses.length) {
    listEl.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>No courses are available for your department yet.</p></div>`;
    return;
  }
  listEl.innerHTML = visibleCourses.map(c => {
    const s = getCourseSettings(c);
    const sched = getCourseScheduleStatus(c);
    const schedLine = (c.scheduleStart || c.scheduleEnd)
      ? `<div class="cs-meta">${sched.state === 'open' ? '🟢 Open now' : sched.state === 'upcoming' ? '⏳ Opens ' + formatScheduleDateTime(c.scheduleStart) : '🔒 Closed'}</div>`
      : '';
    return `
    <div class="course-select-card" onclick="selectCourseCard('${c.id}')">
      <div class="cs-icon">${c.icon || '📚'}</div>
      <div class="cs-info">
        <div class="cs-name">${c.name}</div>
        <div class="cs-meta">⏱️ ${s.timeMins} min · ❓ ${c.questions.length} questions · 🎯 Pass ${s.passPercent}%</div>
        ${schedLine}
      </div>
      <div style="font-size:1.2rem;color:#004346">›</div>
    </div>`;
  }).join('');
}

function selectCourseCard(id) {
  selectedCourseId = id;
  const course = getCourse(id);
  const s = getCourseSettings(course);
  document.getElementById('ccode-icon').textContent = course.icon || '📚';
  document.getElementById('ccode-name').textContent = course.name;
  document.getElementById('ccode-instructions').innerHTML = `
    <li>⏱️ <strong>Time Allowed:</strong>&nbsp;${s.timeMins} minutes</li>
    <li>❓ <strong>Questions:</strong>&nbsp;${(s.qCount > 0 && s.qCount <= course.questions.length) ? s.qCount : course.questions.length}</li>
    <li>🎯 <strong>Pass Mark:</strong>&nbsp;${s.passPercent}%</li>
    <li>🔁 <strong>Attempts:</strong>&nbsp;${s.retake ? 'Unlimited — you may retake this exam' : '1 (you cannot retake this exam once submitted)'}</li>
    ${(course.scheduleStart || course.scheduleEnd) ? `<li>🗓️ <strong>Exam Window:</strong>&nbsp;${course.scheduleStart ? formatScheduleDateTime(course.scheduleStart) : 'Anytime'} → ${course.scheduleEnd ? formatScheduleDateTime(course.scheduleEnd) : 'No end'}</li>` : ''}
  `;
  document.getElementById('course-code-input').value = '';
  document.getElementById('course-code-error').classList.remove('show');
  document.getElementById('course-list-view').style.display = 'none';
  document.getElementById('course-code-view').style.display = 'block';
}

function backToCourseList() {
  selectedCourseId = null;
  document.getElementById('course-code-view').style.display = 'none';
  document.getElementById('course-list-view').style.display = 'block';
}

// ===== STUDENT LOGIN =====

function handleUnifiedLogin() {
  loadData();
  const username = document.getElementById('student-username').value.trim();
  const password = document.getElementById('student-password').value;
  const err = document.getElementById('login-student-error');
  if (!username || !password) {
    err.textContent = 'Please enter both username and password.';
    err.classList.remove('notice-green');
    err.classList.add('show');
    return;
  }

  if (username === getAdminUsername() && password === getAdminPassword()) {
    err.classList.remove('show', 'notice-green');
    currentRole = 'admin';
    currentTeacher = null;
    document.getElementById('student-username').value = '';
    document.getElementById('student-password').value = '';
    showScreen('screen-admin');
    applyRoleUI();
    switchTab('tab-results', document.querySelector('.tab-btn'));
    loadAnswerKeysForAdminEditor();
    return;
  }

  const teacher = findTeacher(username, password);
  if (teacher) {
    err.classList.remove('show', 'notice-green');
    currentRole = 'teacher';
    currentTeacher = teacher;
    document.getElementById('student-username').value = '';
    document.getElementById('student-password').value = '';
    showScreen('screen-admin');
    applyRoleUI();
    switchTab('tab-results', document.querySelector('.tab-btn'));
    loadAnswerKeysForAdminEditor();
    return;
  }

  const student = findAuthorizedStudent(username, password);
  if (student) {
    err.classList.remove('show', 'notice-green');
    loggedInStudent = student;
    document.getElementById('student-username').value = '';
    document.getElementById('student-password').value = '';
    goCourseSelectScreen();
    return;
  }

  err.textContent = 'Incorrect username or password. Please contact Admin if you don\'t have an account.';
  err.classList.add('show', 'notice-green');
}

function goCourseSelectScreen() {
  document.getElementById('cs-student-name').textContent = loggedInStudent.name || loggedInStudent.username;
  document.getElementById('cs-student-meta').textContent =
    `${loggedInStudent.id}${loggedInStudent.dept ? ' — ' + loggedInStudent.dept : ''} · Choose a course to begin`;
  selectedCourseId = null;
  document.getElementById('course-code-view').style.display = 'none';
  document.getElementById('course-list-view').style.display = 'block';
  renderCourseSelectGrid();
  showScreen('screen-course-select');
}

// ===== ABOUT ME (student's own full page, via the "👤 About Me" link) =====
let myHistoryResults = [];

function showAboutMeScreen() {
  if (!loggedInStudent) return;
  const results = JSON.parse(localStorage.getItem(SK_RESULTS) || '[]');
  myHistoryResults = results
    .filter(r => r.id === loggedInStudent.id)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  renderMyHistoryCourseList();
  renderMyProfileCard();
  renderAdminContactCard();
  document.getElementById('my-history-detail-view').style.display = 'none';
  document.getElementById('my-history-course-list-view').style.display = 'block';
  showScreen('screen-about-me');
}

function renderMyProfileCard() {
  if (!loggedInStudent) return;
  const name = loggedInStudent.name || loggedInStudent.username || 'Student';
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '--';
  document.getElementById('my-profile-avatar').textContent = initials;
  document.getElementById('my-profile-name').textContent = name;
  document.getElementById('my-profile-id').textContent = `🆔 ${loggedInStudent.id}`;
  document.getElementById('my-profile-dept').textContent = loggedInStudent.dept ? `🎓 ${loggedInStudent.dept}` : '';
  document.getElementById('my-profile-username').textContent = loggedInStudent.username ? `👤 ${loggedInStudent.username}` : '';
  const passed = myHistoryResults.filter(r => r.passed).length;
  document.getElementById('my-profile-stats').textContent =
    myHistoryResults.length ? `📊 ${myHistoryResults.length} exam${myHistoryResults.length === 1 ? '' : 's'} taken · ${passed} passed` : '📊 No exams taken yet';
}

function renderMyHistoryCourseList() {
  const listEl = document.getElementById('my-history-course-list');
  if (!myHistoryResults.length) {
    listEl.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>You haven't taken any exams yet.</p></div>`;
    return;
  }
  const byCourse = {};
  myHistoryResults.forEach(r => {
    const key = r.courseId || r.courseName;
    if (!byCourse[key]) byCourse[key] = { courseName: r.courseName, courseId: key, attempts: [] };
    byCourse[key].attempts.push(r);
  });
  listEl.innerHTML = Object.values(byCourse).map(c => {
    const best = c.attempts.reduce((a, b) => (b.pct > a.pct ? b : a), c.attempts[0]);
    return `
    <div class="course-select-card" onclick="showMyHistoryCourseDetail('${c.courseId}')">
      <div class="cs-icon">📚</div>
      <div class="cs-info">
        <div class="cs-name">${c.courseName}</div>
        <div class="cs-meta">${c.attempts.length} attempt${c.attempts.length === 1 ? '' : 's'} · Best <strong style="color:${best.passed ? '#16a34a' : '#dc2626'}">${best.pct}%</strong></div>
      </div>
      <div style="font-size:1.2rem;color:#004346">›</div>
    </div>`;
  }).join('');
}

function showMyHistoryCourseDetail(courseId) {
  const attempts = myHistoryResults.filter(r => (r.courseId || r.courseName) === courseId);
  if (!attempts.length) return;
  document.getElementById('my-history-detail-title').textContent = `📚 ${attempts[0].courseName}`;
  document.getElementById('my-history-detail-tbody').innerHTML = attempts.map(r => `
    <tr>
      <td><strong style="color:${r.passed ? '#16a34a' : '#dc2626'}">${r.pct}%</strong> (${r.correct}/${r.total})</td>
      <td><span class="badge ${r.passed ? 'badge-pass' : 'badge-fail'}">${r.passed ? '✅ Pass' : '❌ Fail'}</span></td>
      <td>${r.time || '—'}</td>
      <td style="font-size:0.78rem;color:#64748B">${r.date}</td>
    </tr>`).join('');
  document.getElementById('my-history-course-list-view').style.display = 'none';
  document.getElementById('my-history-detail-view').style.display = 'block';
}

function backToMyHistoryCourseList() {
  document.getElementById('my-history-detail-view').style.display = 'none';
  document.getElementById('my-history-course-list-view').style.display = 'block';
}

function handleCourseSelectContinue() {
  const err = document.getElementById('course-code-error');
  if (!selectedCourseId) {
    err.textContent = 'Please choose a course first.';
    err.classList.add('show');
    return;
  }
  const course = getCourse(selectedCourseId);
  if (!course || !course.questions.length) {
    err.textContent = 'This course has no questions yet.';
    err.classList.add('show');
    return;
  }
  const enteredCode = document.getElementById('course-code-input').value.trim();
  if (!enteredCode) {
    err.textContent = 'Please enter the course code.';
    err.classList.add('show');
    return;
  }
  if (course.code && enteredCode.toUpperCase() !== course.code.trim().toUpperCase()) {
    err.textContent = 'Incorrect course code. Please check with your instructor and try again.';
    err.classList.add('show');
    return;
  }
  const sched = getCourseScheduleStatus(course);
  if (sched.state !== 'open') {
    err.textContent = sched.message;
    err.classList.add('show');
    return;
  }
  err.classList.remove('show');
  const id = loggedInStudent.id;
  if (!getCourseSettings(course).retake) {
    const attempted = JSON.parse(localStorage.getItem(SK_ATTEMPTED) || '[]');
    const key = id.toUpperCase() + '::' + selectedCourseId;
    if (attempted.includes(key)) {
      document.getElementById('blocked-id').textContent = id;
      document.getElementById('blocked-course').textContent = course.name;
      showScreen('screen-blocked');
      return;
    }
  }
  currentStudent = {
    name: loggedInStudent.name,
    id: id.toUpperCase(),
    dept: loggedInStudent.dept,
    courseId: selectedCourseId,
    courseName: course.name
  };
  startExam(course);
}

// ===== EXAM =====
function startExam(course) {
  currentQ = 0;
  const submitBtn = document.getElementById('exam-submit-btn');
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '✔ Submit'; }
  const s = getCourseSettings(course);
  let pool = [...course.questions];
  if (s.shuffleQ) pool = shuffle(pool);
  const cnt = (s.qCount > 0 && s.qCount <= pool.length) ? s.qCount : pool.length;
  examQuestions = pool.slice(0, cnt);
  answerMap = examQuestions.map(q => {
    const idxs = q.opts.map((_, i) => i);
    return s.shuffleA ? shuffle(idxs) : idxs;
  });
  answers = new Array(examQuestions.length).fill(null);
  TOTAL_TIME = s.timeMins * 60;
  timeLeft = TOTAL_TIME;
  showScreen('screen-exam');
  document.getElementById('exam-student-label').textContent = `👤 ${currentStudent.name} — ${currentStudent.courseName}`;
  renderExamProfileMenu();
  renderQuestion();
  startTimer();
}

function renderQuestion() {
  const q = examQuestions[currentQ];
  const map = answerMap[currentQ];
  const total = examQuestions.length;
  document.getElementById('q-counter').textContent = `Question ${currentQ + 1} of ${total}`;
  document.getElementById('exam-q-label').textContent = `Q ${currentQ + 1} / ${total}`;
  document.getElementById('q-text').textContent = q.q;
  document.getElementById('exam-progress').style.width = `${((currentQ + 1) / total) * 100}%`;
  document.getElementById('q-dot-status').textContent = `🔢 ${answers.filter(a => a !== null).length} / ${total} answered`;
  renderQuestionNav();
  const letters = ['A', 'B', 'C', 'D'];
  const isTF = q.type === 'tf';
  if (isTF) {
    document.getElementById('q-options').innerHTML = ['True', 'False'].map((label, dispIdx) => `
      <div class="option-item ${answers[currentQ] === dispIdx ? 'selected' : ''}" onclick="selectAnswer(${dispIdx})">
        <div class="option-letter">${dispIdx === 0 ? '✅' : '❌'}</div>
        <span>${label}</span>
      </div>`).join('');
  } else {
    document.getElementById('q-options').innerHTML = map.map((origIdx, dispIdx) => `
      <div class="option-item ${answers[currentQ] === dispIdx ? 'selected' : ''}" onclick="selectAnswer(${dispIdx})">
        <div class="option-letter">${letters[dispIdx]}</div>
        <span>${q.opts[origIdx]}</span>
      </div>`).join('');
  }
  document.getElementById('btn-prev').disabled = currentQ === 0;
  document.getElementById('btn-prev').style.opacity = currentQ === 0 ? '0.4' : '1';
  const nb = document.getElementById('btn-next');
  if (currentQ === total - 1) {
    nb.textContent = '✔ Submit';
    nb.className = 'btn-nav btn-submit-exam';
    nb.onclick = () => document.getElementById('submit-modal').classList.add('show');
  } else {
    nb.textContent = 'Next →';
    nb.className = 'btn-nav btn-next-q';
    nb.onclick = nextQuestion;
  }
}

function confirmExitExam() {
  document.getElementById('exit-exam-modal').classList.add('show');
}

function exitExamConfirmed() {
  clearInterval(timerInterval);
  closeModal('exit-exam-modal');
  studentLogout();
}

function selectAnswer(d) {
  answers[currentQ] = d;
  renderQuestion();
}

function prevQuestion() {
  if (currentQ > 0) {
    currentQ--;
    renderQuestion();
  }
}

function nextQuestion() {
  if (currentQ < examQuestions.length - 1) {
    currentQ++;
    renderQuestion();
  }
}

// ===== QUESTION NAVIGATOR =====
function renderQuestionNav() {
  const grid = document.getElementById('q-nav-grid');
  if (!grid) return;
  grid.innerHTML = examQuestions.map((_, i) => {
    let cls = 'q-nav-item';
    if (i === currentQ) cls += ' current';
    else if (answers[i] !== null) cls += ' answered';
    return `<button class="${cls}" onclick="goToQuestion(${i})">${i + 1}</button>`;
  }).join('');
}

function toggleQuestionNav() {
  renderQuestionNav();
  document.getElementById('q-nav-modal').classList.add('show');
}

function goToQuestion(i) {
  currentQ = i;
  renderQuestion();
  closeModal('q-nav-modal');
}

async function submitExam() {
  closeModal('submit-modal');
  clearInterval(timerInterval);

  const submitBtn = document.getElementById('exam-submit-btn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Grading…'; }

  const gradingCourse = getCourse(currentStudent.courseId);
  const qIndexes = examQuestions.map(q => gradingCourse.questions.indexOf(q));
  const payloadAnswers = examQuestions.map((q, i) => {
    const isTF = q.type === 'tf';
    const studentDispIdx = answers[i];
    const selectedOptIndex = studentDispIdx === null
      ? null
      : (isTF ? studentDispIdx : answerMap[i][studentDispIdx]);
    return { qIndex: qIndexes[i], type: q.type, selectedOptIndex };
  });
  const timeTaken = TOTAL_TIME - timeLeft;

  let gradeResult;
  try {
    const res = await fetch(`${CLOUD_FUNCTIONS_BASE_URL}/gradeExam`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courseId: currentStudent.courseId,
        student: {
          name: currentStudent.name,
          id: currentStudent.id,
          dept: currentStudent.dept,
          courseName: currentStudent.courseName
        },
        timeTakenSeconds: timeTaken,
        answers: payloadAnswers
      })
    });
    if (!res.ok) throw new Error('Grading request failed: ' + res.status);
    gradeResult = await res.json();
    if (gradeResult.error) throw new Error(gradeResult.error);
  } catch (e) {
    console.error('submitExam grading error:', e);
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '✔ Submit'; }
    alert('Could not submit the exam — please check your internet connection and try again.');
    startTimer();
    return;
  }

  const { correct, total, pct, passed, perQuestion } = gradeResult;

  const correctByQIndex = {};
  perQuestion.forEach(p => { correctByQIndex[p.qIndex] = p.correctOptIndex; });
  examQuestions.forEach((q, i) => { q.ans = correctByQIndex[qIndexes[i]]; });

  await syncAllFromFirebase();

  showResults(correct, total, pct, passed);
}

function showResults(correct, total, pct, passed) {
  showScreen('screen-result');
  document.getElementById('res-correct').textContent = correct;
  document.getElementById('res-wrong').textContent = total - correct;
  document.getElementById('res-total').textContent = total;
  document.getElementById('result-pct').textContent = pct + '%';
  document.getElementById('result-name-line').textContent = `${currentStudent.name} (${currentStudent.id}) — ${currentStudent.courseName}`;
  document.getElementById('result-heading').textContent = passed ? '🎉 Congratulations!' : '📚 Keep Studying';
  const st = document.getElementById('result-status');
  st.textContent = passed ? '✅ PASSED' : '❌ FAILED';
  st.className = 'result-status ' + (passed ? 'status-pass' : 'status-fail');
  setTimeout(() => {
    document.getElementById('result-circle').style.strokeDashoffset = 376.99 - (pct / 100) * 376.99;
  }, 300);
}

function downloadResult() {
  window.print();
}

// ===== STUDENT LOGOUT =====
function studentLogout() {
  currentStudent = {};
  loggedInStudent = null;
  selectedCourseId = null;
  examQuestions = [];
  answers = [];
  answerMap = [];
  lastExamSnapshot = null;
  document.getElementById('student-username').value = '';
  document.getElementById('student-password').value = '';
  showScreen('screen-login');
}

// ===== EXAM PROFILE MENU =====
function getInitials(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '👤';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function renderExamProfileMenu() {
  const initials = getInitials(currentStudent.name);
  document.getElementById('exam-avatar').textContent = initials;
  document.getElementById('exam-avatar-lg').textContent = initials;
  document.getElementById('exam-profile-menu-name').textContent = currentStudent.name || '';
  document.getElementById('exam-profile-menu-id').textContent = currentStudent.id || '';
  document.getElementById('exam-profile-menu-grade').textContent = `🎓 Department: ${currentStudent.dept || '—'}`;
}

function toggleExamProfileMenu(e) {
  if (e) e.stopPropagation();
  document.getElementById('exam-profile-menu').classList.toggle('show');
  document.getElementById('exam-profile-wrap').classList.toggle('open');
}

document.addEventListener('click', (e) => {
  const wrap = document.getElementById('exam-profile-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('exam-profile-menu').classList.remove('show');
    wrap.classList.remove('open');
  }
});

function openEditProfile() {
  document.getElementById('exam-profile-menu').classList.remove('show');
  document.getElementById('exam-profile-wrap').classList.remove('open');
  document.getElementById('ep-name').value = loggedInStudent ? (loggedInStudent.name || '') : (currentStudent.name || '');
  document.getElementById('ep-username').value = loggedInStudent ? (loggedInStudent.username || '') : '';
  document.getElementById('ep-password').value = loggedInStudent ? (loggedInStudent.password || '') : '';
  document.getElementById('edit-profile-error').classList.remove('show');
  document.getElementById('edit-profile-modal').classList.add('show');
}

function saveEditedProfile() {
  const err = document.getElementById('edit-profile-error');
  const name = document.getElementById('ep-name').value.trim();
  const username = document.getElementById('ep-username').value.trim();
  const password = document.getElementById('ep-password').value;
  if (!name || !username || !password) {
    err.textContent = 'Please fill in name, username, and password.';
    err.classList.add('show');
    return;
  }
  const list = loadAuthorized();
  const origUsername = (loggedInStudent && loggedInStudent.username || '').toLowerCase();
  const idx = list.findIndex(s => (s.username || '').toLowerCase() === origUsername);
  if (idx === -1) {
    err.textContent = 'Could not find your student record. Please contact Admin.';
    err.classList.add('show');
    return;
  }
  const dupIdx = list.findIndex((s, i) => i !== idx && (s.username || '').toLowerCase() === username.toLowerCase());
  if (dupIdx !== -1) {
    err.textContent = 'That username is already taken by another student.';
    err.classList.add('show');
    return;
  }
  list[idx] = { ...list[idx], name, username, password };
  saveAuthorized(list);
  loggedInStudent = list[idx];
  currentStudent.name = name;
  document.getElementById('exam-student-label').textContent = `👤 ${currentStudent.name} — ${currentStudent.courseName}`;
  renderExamProfileMenu();
  closeModal('edit-profile-modal');
}

// ===== REVIEW ANSWERS =====
function showReviewScreen() {
  const letters = ['A', 'B', 'C', 'D'];
  document.getElementById('review-subtitle').textContent =
    `${currentStudent.name} — ${currentStudent.courseName}`;
  const body = document.getElementById('review-body');
  body.innerHTML = examQuestions.map((q, i) => {
    const isTF = q.type === 'tf';
    const map = answerMap[i];
    const studentDispIdx = answers[i];
    const skipped = studentDispIdx === null;
    let isCorrect = false;
    let studentOrigIdx = null;
    if (!skipped) {
      studentOrigIdx = isTF ? studentDispIdx : map[studentDispIdx];
      isCorrect = studentOrigIdx === q.ans;
    }
    const status = skipped ? 'skipped' : (isCorrect ? 'correct' : 'wrong');
    const badge = skipped ? '— Skipped' : (isCorrect ? '✅ Correct' : '❌ Wrong');
    const letters = ['A', 'B', 'C', 'D'];
    let optsHtml;
    if (isTF) {
      optsHtml = ['True', 'False'].map((label, dispIdx) => {
        const isCorrectOpt = dispIdx === q.ans;
        const isStudentPick = dispIdx === studentDispIdx;
        let cls = 'review-opt';
        let tag = '';
        if (isCorrectOpt) { cls += ' is-correct'; tag = '✓ Correct'; }
        else if (isStudentPick && !isCorrect) { cls += ' is-student-wrong'; tag = '✗ Your answer'; }
        const icon = dispIdx === 0 ? '✅' : '❌';
        return `
          <div class="${cls}">
            <div class="review-opt-letter">${icon}</div>
            <span>${label}</span>
            ${tag ? `<span class="review-opt-tag">${tag}</span>` : ''}
          </div>`;
      }).join('');
    } else {
      optsHtml = map.map((origIdx, dispIdx) => {
        const isCorrectOpt = origIdx === q.ans;
        const isStudentPick = dispIdx === studentDispIdx;
        let cls = 'review-opt';
        let tag = '';
        if (isCorrectOpt) { cls += ' is-correct'; tag = '✓ Correct'; }
        else if (isStudentPick && !isCorrect) { cls += ' is-student-wrong'; tag = '✗ Your answer'; }
        return `
          <div class="${cls}">
            <div class="review-opt-letter">${letters[dispIdx]}</div>
            <span>${q.opts[origIdx]}</span>
            ${tag ? `<span class="review-opt-tag">${tag}</span>` : ''}
          </div>`;
      }).join('');
    }
    return `
      <div class="review-card ${status}">
        <div class="review-card-top">
          <div style="flex:1">
            <div class="review-q-num">Question ${i + 1}${isTF ? ' <span style="font-size:0.65rem;background:rgba(59,130,246,0.1);color:var(--blue);border-radius:4px;padding:0.1rem 0.4rem;font-weight:700">T/F</span>' : ''}</div>
            <div class="review-q-text">${q.q}</div>
          </div>
          <div class="review-badge ${status}">${badge}</div>
        </div>
        <div class="review-opts">${optsHtml}</div>
      </div>`;
  }).join('');
  showScreen('screen-review');
}

// ===== TIMER =====
function startTimer() {
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      submitExam();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const m = Math.floor(timeLeft / 60);
  const s = timeLeft % 60;
  document.getElementById('timer-display').textContent = `${m}:${s.toString().padStart(2, '0')}`;
  document.getElementById('timer-circle').style.strokeDashoffset = 163.36 - (timeLeft / TOTAL_TIME) * 163.36;
  const danger = timeLeft < 120;
  document.getElementById('timer-display').style.color = danger ? '#EF4444' : '#4ade80';
  document.getElementById('timer-circle').style.stroke = danger ? '#EF4444' : '#4ade80';
}

// ===== ADMIN =====
function adminLogout() {
  document.getElementById('student-username').value = '';
  document.getElementById('student-password').value = '';
  currentRole = 'admin';
  currentTeacher = null;
  courses.forEach(c => (c.questions || []).forEach(q => { delete q.ans; }));
  showScreen('screen-login');
}

// ===== TABS =====
function switchTab(tabId, btn) {
  if (currentRole === 'teacher' && tabId !== 'tab-results') return;
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  btn.classList.add('active');
  if (tabId === 'tab-results')  loadResultsTab();
  if (tabId === 'tab-courses')  { activeCourseDept = null; backToCourses(); }
  if (tabId === 'tab-students') renderAuthorizedTab();
  if (tabId === 'tab-teachers') renderTeachersTab();
  if (tabId === 'tab-settings') loadSettingsUI();
}

// ===== RESULTS TAB =====
function downloadResultsCSV() {
  if (!lastFilteredResults.length) {
    alert('There are no results to download for the current filter.');
    return;
  }
  const fsel = document.getElementById('filter-course');
  const courseLabel = fsel.value ? fsel.options[fsel.selectedIndex].textContent : 'All_Courses';

  const headers = ['#', 'Name', 'ID', 'Department', 'Course', 'Score (%)', 'Correct', 'Total', 'Status', 'Time Taken', 'Date'];
  const rows = lastFilteredResults.map((r, i) => [
    i + 1, r.name, r.id, r.dept, r.courseName, r.pct, r.correct, r.total, r.passed ? 'Pass' : 'Fail', r.time, r.date
  ]);
  const csvEscape = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csvContent = [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeLabel = courseLabel.replace(/[^a-z0-9]+/gi, '_');
  a.href = url;
  a.download = `Results_${safeLabel}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function loadResultsTab() {
  let results = JSON.parse(localStorage.getItem(SK_RESULTS) || '[]');
  let visibleCourses = courses;
  if (currentRole === 'teacher' && currentTeacher) {
    const allowed = new Set(currentTeacher.courseIds || []);
    results = results.filter(r => allowed.has(r.courseId));
    visibleCourses = courses.filter(c => allowed.has(c.id));
  }
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  document.getElementById('stat-courses').textContent = visibleCourses.length;
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-pass').textContent = passed;
  document.getElementById('stat-fail').textContent = total - passed;

  const fsel = document.getElementById('filter-course');
  const curVal = fsel.value;
  fsel.innerHTML = '<option value="">All Courses</option>' +
    visibleCourses.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  fsel.value = curVal;

  const dsel = document.getElementById('filter-dept');
  let filtered = fsel.value ? results.filter(r => r.courseId === fsel.value) : results;
  if (dsel.value) filtered = filtered.filter(r => r.dept === dsel.value);
  lastFilteredResults = filtered;

  const tbody = document.getElementById('results-tbody');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><div class="icon">📭</div><p>No results yet.</p></div></td></tr>`;
    return;
  }

  const groups = {};
  filtered.forEach(r => {
    const key = r.dept || 'No Department';
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });

  let rowNum = 0;
  tbody.innerHTML = Object.keys(groups).sort().map(dept => {
    const rows = groups[dept];
    const groupHeader = `
      <tr class="dept-group-row">
        <td colspan="10">🏫 ${dept} <span style="font-weight:400;opacity:0.85">(${rows.length} result${rows.length === 1 ? '' : 's'})</span></td>
      </tr>`;
    const groupRows = rows.map(r => {
      rowNum++;
      return `
      <tr>
        <td><strong>${rowNum}</strong></td>
        <td><strong class="student-history-link" onclick="openStudentHistory('${r.id}')" style="cursor:pointer;text-decoration:underline;color:#004346">${r.name}</strong></td>
        <td><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:0.78rem">${r.id}</code></td>
        <td>${r.dept}</td>
        <td><span class="badge badge-course">${r.courseName}</span></td>
        <td><strong style="color:${r.passed ? '#16a34a' : '#dc2626'}">${r.pct}%</strong></td>
        <td>${r.correct} / ${r.total}</td>
        <td><span class="badge ${r.passed ? 'badge-pass' : 'badge-fail'}">${r.passed ? '✅ Pass' : '❌ Fail'}</span></td>
        <td>${r.time}</td>
        <td style="font-size:0.78rem;color:#64748B">${r.date}</td>
      </tr>`;
    }).join('');
    return groupHeader + groupRows;
  }).join('');
}

function openStudentHistory(studentId) {
  let results = JSON.parse(localStorage.getItem(SK_RESULTS) || '[]');
  if (currentRole === 'teacher' && currentTeacher) {
    const allowed = new Set(currentTeacher.courseIds || []);
    results = results.filter(r => allowed.has(r.courseId));
  }
  const history = results
    .filter(r => r.id === studentId)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!history.length) return;

  const { name, dept } = history[0];
  document.getElementById('student-history-title').textContent = `📖 ${name}`;
  const passed = history.filter(r => r.passed).length;
  document.getElementById('student-history-summary').textContent =
    `ID: ${studentId} · ${dept || 'No Department'} · ${history.length} exam${history.length === 1 ? '' : 's'} taken · ${passed} passed`;

  document.getElementById('student-history-tbody').innerHTML = history.map(r => `
    <tr>
      <td><span class="badge badge-course">${r.courseName}</span></td>
      <td><strong style="color:${r.passed ? '#16a34a' : '#dc2626'}">${r.pct}%</strong> (${r.correct}/${r.total})</td>
      <td><span class="badge ${r.passed ? 'badge-pass' : 'badge-fail'}">${r.passed ? '✅ Pass' : '❌ Fail'}</span></td>
      <td style="font-size:0.78rem;color:#64748B">${r.date}</td>
    </tr>`).join('');

  document.getElementById('student-history-modal').classList.add('show');
}

function adjustCourseSetting(courseId, field, delta) {
  const c = getCourse(courseId);
  if (!c) return;
  const s = getCourseSettings(c);
  if (field === 'timeMins') {
    s.timeMins = Math.max(1, s.timeMins + delta);
  } else if (field === 'qCount') {
    s.qCount = Math.max(0, Math.min(c.questions.length, s.qCount + delta));
  }
  c.settings = s;
  saveCourses();
  refreshCoursesView();
}

function toggleCourseRetake(courseId) {
  const c = getCourse(courseId);
  if (!c) return;
  const s = getCourseSettings(c);
  s.retake = !s.retake;
  c.settings = s;
  saveCourses();
  refreshCoursesView();
}

function confirmClearAll() {
  document.getElementById('clear-modal').classList.add('show');
}

function clearAllData() {
  localStorage.removeItem(SK_RESULTS);
  localStorage.removeItem(SK_ATTEMPTED);
  fbSet('results', null);
  fbSet('attempted', null);
  closeModal('clear-modal');
  loadResultsTab();
}

// ===== COURSES: DEPARTMENT -> COURSES NAVIGATION =====
let activeCourseDept = null;

function renderCourseCard(c, results) {
  const rCount = results.filter(r => r.courseId === c.id).length;
  const isHidden = c.hidden === true;
  const s = getCourseSettings(c);
  return `<div class="course-mgr-card${isHidden ? ' course-hidden-card' : ''}">
    <div class="c-header">
      <div class="c-icon-big">${c.icon || '📚'}</div>
      <div class="c-actions">
        <button class="btn-toggle-c ${isHidden ? 'btn-toggle-hidden' : 'btn-toggle-visible'}" 
          onclick="toggleCourseVisibility('${c.id}')" 
          title="${isHidden ? 'Show course to students' : 'Hide course from students'}">
          ${isHidden ? '👁️‍🗨️ Show' : '🙈 Hide'}
        </button>
        <button class="btn-edit-c" onclick="openEditCourse('${c.id}')">✏️</button>
        <button class="btn-del-c" onclick="confirmDeleteCourse('${c.id}')">🗑️</button>
      </div>
    </div>
    <h3>${c.name}</h3>
    ${c.code ? `<div style="font-size:0.78rem;color:#004346;font-weight:600;margin-bottom:0.4rem">🔑 Code: <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">${c.code}</code></div>` : ''}
    ${(c.scheduleStart || c.scheduleEnd) ? `<div style="font-size:0.78rem;color:#64748B;margin-bottom:0.4rem">🗓️ ${c.scheduleStart ? formatScheduleDateTime(c.scheduleStart) : 'Anytime'} → ${c.scheduleEnd ? formatScheduleDateTime(c.scheduleEnd) : 'No end'}</div>` : ''}
    ${isHidden ? '<div class="hidden-badge">🚫 Hidden from students</div>' : ''}
    <div class="c-desc">${c.desc || ''}</div>
    <div class="c-stats">
      <div class="c-stat">📝 <strong>${c.questions.length}</strong> questions</div>
      <div class="c-stat">👥 <strong>${rCount}</strong> attempts</div>
    </div>

    <!-- Quick adjust: change time/question-count without opening the full edit modal -->
    <div class="c-quick-settings">
      <div class="c-quick-row">
        <span class="c-quick-label">⏱️ Time</span>
        <div class="c-stepper">
          <button onclick="adjustCourseSetting('${c.id}','timeMins',-5)">−</button>
          <span id="qs-time-${c.id}">${s.timeMins} min</span>
          <button onclick="adjustCourseSetting('${c.id}','timeMins',5)">+</button>
        </div>
      </div>
      <div class="c-quick-row">
        <span class="c-quick-label">❓ Questions</span>
        <div class="c-stepper">
          <button onclick="adjustCourseSetting('${c.id}','qCount',-1)">−</button>
          <span id="qs-qcount-${c.id}">${s.qCount > 0 ? s.qCount : 'All'}</span>
          <button onclick="adjustCourseSetting('${c.id}','qCount',1)">+</button>
        </div>
      </div>
    </div>

    <div class="c-footer">
      <div class="c-quick-row" style="margin-bottom:0.7rem">
        <span class="c-quick-label">🔁 Allow Retake</span>
        <label class="toggle"><input type="checkbox" ${s.retake ? 'checked' : ''} onchange="toggleCourseRetake('${c.id}')"><span class="toggle-slider"></span></label>
      </div>
      <button class="btn-manage-q" onclick="openQuestionManager('${c.id}')">📝 Manage Questions</button>
    </div>
  </div>`;
}

function renderDeptList() {
  const grid = document.getElementById('dept-grid');
  if (!courses.length) {
    grid.innerHTML = `<div class="empty-state"><div class="icon">📚</div><p>No courses yet. Add your first course.</p></div>`;
    return;
  }
  const groups = {};
  courses.forEach(c => {
    const key = c.dept || 'No Department';
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  });
  grid.innerHTML = Object.keys(groups).sort().map(dept => `
    <div class="dept-folder-card" onclick="openDeptCourses('${dept.replace(/'/g, "\\'")}')">
      <div class="dept-folder-icon">🏫</div>
      <div class="dept-folder-name">${dept}</div>
      <div class="dept-folder-count">${groups[dept].length} course${groups[dept].length === 1 ? '' : 's'}</div>
    </div>`).join('');
}

function renderDeptCourses(dept) {
  const results = JSON.parse(localStorage.getItem(SK_RESULTS) || '[]');
  const grid = document.getElementById('dept-courses-grid');
  const list = courses.filter(c => (c.dept || 'No Department') === dept);
  document.getElementById('dept-courses-title').textContent = `🏫 ${dept}`;
  if (!list.length) {
    grid.innerHTML = `<div class="empty-state"><div class="icon">📚</div><p>No courses in this department yet.</p></div>`;
    return;
  }
  grid.innerHTML = list.map(c => renderCourseCard(c, results)).join('');
}

function openDeptCourses(dept) {
  activeCourseDept = dept;
  document.getElementById('dept-list-view').style.display = 'none';
  document.getElementById('dept-courses-view').style.display = 'block';
  renderDeptCourses(dept);
}

function backToDeptList() {
  activeCourseDept = null;
  document.getElementById('dept-courses-view').style.display = 'none';
  document.getElementById('dept-list-view').style.display = 'block';
  renderDeptList();
}

function refreshCoursesView() {
  if (activeCourseDept) {
    renderDeptCourses(activeCourseDept);
  } else {
    renderDeptList();
  }
}

function backToCourses() {
  document.getElementById('view-courses').style.display = 'block';
  document.getElementById('view-questions').style.display = 'none';
  activeCourseId = null;
  refreshCoursesView();
}

// ===== COURSE CRUD =====
function openAddCourse() {
  editingCourseId = null;
  document.getElementById('course-modal-title').textContent = 'Add New Course';
  document.getElementById('course-modal-sub').textContent = 'Fill in the course details';
  document.getElementById('cm-name').value = '';
  document.getElementById('cm-dept').value = activeCourseDept || '';
  document.getElementById('cm-desc').value = '';
  document.getElementById('cm-icon').value = '📚';
  document.getElementById('cm-code').value = '';
  document.getElementById('cm-schedule-start').value = '';
  document.getElementById('cm-schedule-end').value = '';
  document.getElementById('cm-time').value = 20;
  document.getElementById('cm-pass').value = 50;
  document.getElementById('cm-qcount').value = 0;
  document.getElementById('cm-shuffleq').checked = true;
  document.getElementById('cm-shufflea').checked = true;
  document.getElementById('cm-retake').checked = false;
  document.getElementById('course-modal-error').classList.remove('show');
  document.getElementById('course-modal').classList.add('show');
}

function openEditCourse(id) {
  editingCourseId = id;
  const c = getCourse(id);
  const s = getCourseSettings(c);
  document.getElementById('course-modal-title').textContent = 'Edit Course';
  document.getElementById('course-modal-sub').textContent = 'Update course details';
  document.getElementById('cm-name').value = c.name;
  document.getElementById('cm-dept').value = c.dept || '';
  document.getElementById('cm-desc').value = c.desc || '';
  document.getElementById('cm-icon').value = c.icon || '📚';
  document.getElementById('cm-code').value = c.code || '';
  document.getElementById('cm-schedule-start').value = c.scheduleStart || '';
  document.getElementById('cm-schedule-end').value = c.scheduleEnd || '';
  document.getElementById('cm-time').value = s.timeMins;
  document.getElementById('cm-pass').value = s.passPercent;
  document.getElementById('cm-qcount').value = s.qCount;
  document.getElementById('cm-shuffleq').checked = s.shuffleQ;
  document.getElementById('cm-shufflea').checked = s.shuffleA;
  document.getElementById('cm-retake').checked = s.retake;
  document.getElementById('course-modal-error').classList.remove('show');
  document.getElementById('course-modal').classList.add('show');
}

function saveCourse() {
  const name = document.getElementById('cm-name').value.trim();
  const dept = document.getElementById('cm-dept').value;
  const desc = document.getElementById('cm-desc').value.trim();
  const icon = document.getElementById('cm-icon').value.trim() || '📚';
  const code = document.getElementById('cm-code').value.trim();
  const scheduleStart = document.getElementById('cm-schedule-start').value;
  const scheduleEnd = document.getElementById('cm-schedule-end').value;
  const timeMins = parseInt(document.getElementById('cm-time').value, 10) || 20;
  const passPercent = parseInt(document.getElementById('cm-pass').value, 10) || 50;
  const qCount = parseInt(document.getElementById('cm-qcount').value, 10) || 0;
  const shuffleQ = document.getElementById('cm-shuffleq').checked;
  const shuffleA = document.getElementById('cm-shufflea').checked;
  const retake = document.getElementById('cm-retake').checked;
  const err = document.getElementById('course-modal-error');
  if (!name) {
    err.textContent = 'Course name is required!';
    err.classList.add('show');
    return;
  }
  if (!dept) {
    err.textContent = 'Please select a Department for this course!';
    err.classList.add('show');
    return;
  }
  if (!code) {
    err.textContent = 'Please set a Course Code — students need it to start the exam!';
    err.classList.add('show');
    return;
  }
  const dupe = courses.find(c => c.id !== editingCourseId && c.code && c.code.toUpperCase() === code.toUpperCase());
  if (dupe) {
    err.textContent = `That course code is already used by "${dupe.name}". Please choose a different one.`;
    err.classList.add('show');
    return;
  }
  if (scheduleStart && scheduleEnd && new Date(scheduleEnd) <= new Date(scheduleStart)) {
    err.textContent = 'The exam "Closes At" time must be after the "Opens At" time!';
    err.classList.add('show');
    return;
  }
  err.classList.remove('show');
  const settings = { timeMins, passPercent, qCount, shuffleQ, shuffleA, retake };
  if (editingCourseId) {
    const c = getCourse(editingCourseId);
    c.name = name;
    c.dept = dept;
    c.desc = desc;
    c.icon = icon;
    c.code = code;
    c.scheduleStart = scheduleStart;
    c.scheduleEnd = scheduleEnd;
    c.settings = settings;
  } else {
    courses.push({
      id: 'course_' + Date.now(),
      name,
      dept,
      desc,
      icon,
      code,
      scheduleStart,
      scheduleEnd,
      settings,
      questions: []
    });
  }
  saveCourses();
  closeModal('course-modal');
  refreshCoursesView();
}

function confirmDeleteCourse(id) {
  deletingCourseId = id;
  document.getElementById('del-course-modal').classList.add('show');
}

function deleteCourse() {
  courses = courses.filter(c => c.id !== deletingCourseId);
  saveCourses();
  closeModal('del-course-modal');
  refreshCoursesView();
}

function toggleCourseVisibility(id) {
  const c = getCourse(id);
  c.hidden = !c.hidden;
  saveCourses();
  refreshCoursesView();
}

// ===== QUESTION MANAGER =====
function openQuestionManager(courseId) {
  activeCourseId = courseId;
  document.getElementById('view-courses').style.display = 'none';
  document.getElementById('view-questions').style.display = 'block';
  const c = getCourse(courseId);
  document.getElementById('qpanel-course-name').textContent = c.name;
  loadAnswerKeysForAdminEditor().then(renderQuestionList);
  renderQuestionList();
}

function renderQuestionList() {
  const c = getCourse(activeCourseId);
  document.getElementById('qpanel-q-count').textContent = `${c.questions.length} questions`;
  const list = document.getElementById('q-list');
  if (!c.questions.length) {
    list.innerHTML = `<div class="empty-state"><div class="icon">📋</div><p>No questions yet. Add your first question.</p></div>`;
    return;
  }
  const letters = ['A', 'B', 'C', 'D'];
  list.innerHTML = c.questions.map((q, i) => {
    const isTF = q.type === 'tf';
    const letters = ['A', 'B', 'C', 'D'];
    const typeBadge = isTF
      ? `<span style="background:rgba(59,130,246,0.1);color:var(--blue);border:1px solid rgba(59,130,246,0.2);border-radius:6px;font-size:0.68rem;font-weight:700;padding:0.15rem 0.5rem;margin-left:0.5rem">T/F</span>`
      : '';
    const optsHtml = q.opts.map((o, oi) =>
      `<div class="q-card-opt ${oi === q.ans ? 'correct' : ''}">${letters[oi]}. ${o}${oi === q.ans ? ' ✓' : ''}</div>`
    ).join('');
    return `
    <div class="q-card">
      <div class="q-card-header">
        <div style="flex:1">
          <div class="q-card-num">Question ${i + 1} ${typeBadge}</div>
          <div class="q-card-text">${q.q}</div>
          <div class="q-card-opts">${optsHtml}</div>
        </div>
        <div class="q-card-actions">
          <button class="btn-edit-q" onclick="openEditQuestion(${i})">✏️ Edit</button>
          <button class="btn-del-q" onclick="confirmDeleteQ(${i})">🗑️</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function openAddQuestion() {
  editingQIdx = null;
  pendingCorrect = null;
  pendingTFCorrect = null;
  currentQuestionType = 'mcq';
  document.getElementById('q-modal-title').textContent = 'Add Question';
  document.getElementById('q-modal-sub').textContent = 'Enter question and answer options';
  document.getElementById('qm-question').value = '';
  [0, 1, 2, 3].forEach(i => document.getElementById(`qm-opt${i}`).value = '');
  document.querySelectorAll('.correct-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.qtype-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.qtype-btn[data-type="mcq"]').classList.add('active');
  document.getElementById('qm-mcq-section').style.display = 'block';
  document.getElementById('qm-tf-section').style.display = 'none';
  document.getElementById('qm-error').classList.remove('show');
  document.getElementById('q-modal').classList.add('show');
}

function openEditQuestion(idx) {
  editingQIdx = idx;
  pendingCorrect = null;
  pendingTFCorrect = null;
  const c = getCourse(activeCourseId);
  const q = c.questions[idx];
  document.getElementById('q-modal-title').textContent = 'Edit Question';
  document.getElementById('q-modal-sub').textContent = `Question ${idx + 1}`;
  document.getElementById('qm-question').value = q.q;
  document.getElementById('qm-error').classList.remove('show');
  if (q.type === 'tf') {
    currentQuestionType = 'tf';
    document.querySelectorAll('.qtype-btn').forEach(b => b.classList.toggle('active', b.dataset.type === 'tf'));
    document.getElementById('qm-mcq-section').style.display = 'none';
    document.getElementById('qm-tf-section').style.display = 'block';
    pendingTFCorrect = q.ans;
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.tf) === q.ans));
  } else {
    currentQuestionType = 'mcq';
    document.querySelectorAll('.qtype-btn').forEach(b => b.classList.toggle('active', b.dataset.type === 'mcq'));
    document.getElementById('qm-mcq-section').style.display = 'block';
    document.getElementById('qm-tf-section').style.display = 'none';
    q.opts.forEach((o, i) => document.getElementById(`qm-opt${i}`).value = o);
    document.querySelectorAll('.correct-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.idx) === q.ans));
    pendingCorrect = q.ans;
  }
  document.getElementById('q-modal').classList.add('show');
}

function selectCorrect(idx) {
  pendingCorrect = idx;
  document.querySelectorAll('.correct-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.idx) === idx));
}

function setQuestionType(type) {
  currentQuestionType = type;
  pendingCorrect = null;
  pendingTFCorrect = null;
  document.querySelectorAll('.qtype-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  document.querySelectorAll('.correct-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('qm-mcq-section').style.display = type === 'mcq' ? 'block' : 'none';
  document.getElementById('qm-tf-section').style.display = type === 'tf' ? 'block' : 'none';
}

function selectTF(val) {
  pendingTFCorrect = val;
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.tf) === val));
}

function saveQuestion() {
  const qText = document.getElementById('qm-question').value.trim();
  const err = document.getElementById('qm-error');
  if (!qText) {
    err.textContent = 'Please enter a question!';
    err.classList.add('show');
    return;
  }
  let newQ;
  if (currentQuestionType === 'tf') {
    if (pendingTFCorrect === null) {
      err.textContent = 'Please select True or False as the correct answer!';
      err.classList.add('show');
      return;
    }
    newQ = {
      type: 'tf',
      q: qText,
      opts: ['True', 'False'],
      ans: pendingTFCorrect
    };
  } else {
    const opts = [0, 1, 2, 3].map(i => document.getElementById(`qm-opt${i}`).value.trim());
    if (opts.some(o => !o)) {
      err.textContent = 'Please fill in all 4 answer options!';
      err.classList.add('show');
      return;
    }
    if (pendingCorrect === null) {
      err.textContent = 'Please select the correct answer (A/B/C/D)!';
      err.classList.add('show');
      return;
    }
    newQ = { q: qText, opts, ans: pendingCorrect };
  }
  err.classList.remove('show');
  const c = getCourse(activeCourseId);
  if (editingQIdx !== null) {
    c.questions[editingQIdx] = newQ;
  } else {
    c.questions.push(newQ);
  }
  saveCourses();
  closeModal('q-modal');
  renderQuestionList();
}

function confirmDeleteQ(idx) {
  deletingQIdx = idx;
  document.getElementById('del-q-modal').classList.add('show');
}

function deleteQuestion() {
  const c = getCourse(activeCourseId);
  c.questions.splice(deletingQIdx, 1);
  saveCourses();
  closeModal('del-q-modal');
  renderQuestionList();
}

// ===== SETTINGS =====
function getAdminUsername() {
  return (settings.adminAuth && settings.adminAuth.username) || DEFAULT_ADMIN_USER;
}
function getAdminPassword() {
  return (settings.adminAuth && settings.adminAuth.password) || DEFAULT_ADMIN_PASS;
}

async function changeAdminCredentials() {
  const msg = document.getElementById('admin-login-msg');
  msg.classList.remove('show');

  const current = document.getElementById('admin-current-pass').value;
  const newUsername = document.getElementById('admin-new-username').value.trim();
  const newPassword = document.getElementById('admin-new-pass').value;
  const confirmPassword = document.getElementById('admin-confirm-pass').value;

  if (current !== getAdminPassword()) {
    msg.textContent = 'Current password is incorrect.';
    msg.classList.add('show');
    return;
  }
  if (!newUsername) {
    msg.textContent = 'Username cannot be empty.';
    msg.classList.add('show');
    return;
  }
  if (newPassword && newPassword !== confirmPassword) {
    msg.textContent = 'New password and confirmation do not match.';
    msg.classList.add('show');
    return;
  }

  settings.adminAuth = {
    username: newUsername,
    password: newPassword || getAdminPassword()
  };
  localStorage.setItem(SK_SETTINGS, JSON.stringify(settings));

  try {
    const ok = await fbSet('settings', settings);
    if (!ok) throw new Error('sync failed');
  } catch (e) {
    msg.textContent = '⚠️ Saved on this device, but failed to sync online. Check your internet connection and try again, or the old login may come back after a reload.';
    msg.classList.add('show');
    return;
  }

  document.getElementById('admin-current-pass').value = '';
  document.getElementById('admin-new-pass').value = '';
  document.getElementById('admin-confirm-pass').value = '';
  document.getElementById('admin-new-username').value = newUsername;

  msg.classList.remove('show');
  const successMsg = document.getElementById('settings-msg');
  successMsg.textContent = '✅ Admin login updated successfully!';
  successMsg.classList.add('show');
  setTimeout(() => successMsg.classList.remove('show'), 3000);
}

function loadSettingsUI() {
  document.getElementById('set-time').value = settings.timeMins || 20;
  document.getElementById('set-pass').value = settings.passPercent || 50;
  document.getElementById('set-qcount').value = settings.qCount || 0;
  document.getElementById('set-shuffle-q').checked = settings.shuffleQ !== false;
  document.getElementById('set-shuffle-a').checked = settings.shuffleA !== false;
  document.getElementById('set-api-key').value = localStorage.getItem('eq2_api_key') || '';
  document.getElementById('admin-new-username').value = getAdminUsername();
  document.getElementById('admin-current-pass').value = '';
  document.getElementById('admin-new-pass').value = '';
  document.getElementById('admin-confirm-pass').value = '';
  document.getElementById('admin-login-msg').classList.remove('show');
  const profile = settings.adminProfile || {};
  document.getElementById('admin-profile-name').value = profile.name || '';
  document.getElementById('admin-profile-role').value = profile.role || '';
  document.getElementById('admin-profile-email').value = profile.email || '';
  document.getElementById('admin-profile-phone').value = profile.phone || '';
  document.getElementById('admin-profile-facebook').value = profile.facebook || '';
  document.getElementById('admin-profile-telegram').value = profile.telegram || '';
  document.getElementById('admin-profile-whatsapp').value = profile.whatsapp || '';
  document.getElementById('admin-profile-location').value = profile.location || '';
  document.getElementById('admin-profile-hours').value = profile.hours || '';
  pendingAdminPhoto = null;
  const preview = document.getElementById('admin-photo-preview');
  const placeholder = document.getElementById('admin-photo-placeholder');
  if (profile.photo) {
    preview.src = profile.photo;
    preview.style.display = 'block';
    placeholder.style.display = 'none';
  } else {
    preview.style.display = 'none';
    placeholder.style.display = 'flex';
  }
  document.getElementById('settings-msg').classList.remove('show');
}

let pendingAdminPhoto = null;
function handleAdminPhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingAdminPhoto = reader.result;
    const preview = document.getElementById('admin-photo-preview');
    preview.src = pendingAdminPhoto;
    preview.style.display = 'block';
    document.getElementById('admin-photo-placeholder').style.display = 'none';
  };
  reader.readAsDataURL(file);
}

function renderAdminContactCard() {
  const profile = (settings && settings.adminProfile) || {};
  const hasProfile = !!(profile.name || profile.role || profile.email || profile.phone ||
    profile.facebook || profile.telegram || profile.whatsapp || profile.location || profile.hours || profile.photo);

  const content = document.getElementById('contact-us-content');
  const empty = document.getElementById('contact-us-empty');
  if (!content) return;

  if (!hasProfile) {
    content.style.display = 'none';
    if (empty) empty.style.display = 'block';
    return;
  }
  content.style.display = 'block';
  if (empty) empty.style.display = 'none';

  const photo = document.getElementById('admin-contact-photo-4');
  const photoPlaceholder = document.getElementById('admin-contact-photo-placeholder-4');
  if (profile.photo) {
    photo.src = profile.photo;
    photo.style.display = 'block';
    photoPlaceholder.style.display = 'none';
  } else {
    photo.style.display = 'none';
    photoPlaceholder.style.display = 'flex';
  }
  document.getElementById('admin-contact-name-4').textContent = profile.name || 'Admin';
  const roleLine = document.getElementById('admin-contact-role-4');
  roleLine.textContent = profile.role || '';
  roleLine.style.display = profile.role ? 'block' : 'none';

  const emailLink = document.getElementById('admin-contact-email-4');
  if (profile.email) {
    emailLink.querySelector('.contact-row-text').textContent = profile.email;
    emailLink.href = `mailto:${profile.email}`;
    emailLink.style.display = 'flex';
  } else {
    emailLink.style.display = 'none';
  }

  const phoneLink = document.getElementById('admin-contact-phone-4');
  if (profile.phone) {
    phoneLink.querySelector('.contact-row-text').textContent = profile.phone;
    phoneLink.href = `tel:${profile.phone.replace(/[^0-9+]/g, '')}`;
    phoneLink.style.display = 'flex';
  } else {
    phoneLink.style.display = 'none';
  }

  const reachSection = document.getElementById('contact-section-reach');
  reachSection.style.display = (profile.email || profile.phone) ? 'block' : 'none';

  const fbLink = document.getElementById('admin-contact-facebook-4');
  fbLink.href = profile.facebook || '#';
  fbLink.style.display = profile.facebook ? 'flex' : 'none';

  const tgLink = document.getElementById('admin-contact-telegram-4');
  tgLink.href = profile.telegram || '#';
  tgLink.style.display = profile.telegram ? 'flex' : 'none';

  const waLink = document.getElementById('admin-contact-whatsapp-4');
  waLink.href = profile.whatsapp || '#';
  waLink.style.display = profile.whatsapp ? 'flex' : 'none';

  const socialSection = document.getElementById('contact-section-social');
  socialSection.style.display = (profile.facebook || profile.telegram || profile.whatsapp) ? 'block' : 'none';

  const locationRow = document.getElementById('admin-contact-location-4');
  locationRow.querySelector('.contact-row-text').textContent = profile.location || '';
  locationRow.style.display = profile.location ? 'flex' : 'none';

  const hoursRow = document.getElementById('admin-contact-hours-4');
  hoursRow.querySelector('.contact-row-text').textContent = profile.hours || '';
  hoursRow.style.display = profile.hours ? 'flex' : 'none';

  const locationSection = document.getElementById('contact-section-location');
  locationSection.style.display = (profile.location || profile.hours) ? 'block' : 'none';
}

function saveSettings() {
  settings = {
    timeMins: parseInt(document.getElementById('set-time').value) || 20,
    passPercent: parseInt(document.getElementById('set-pass').value) || 50,
    qCount: parseInt(document.getElementById('set-qcount').value) || 0,
    shuffleQ: document.getElementById('set-shuffle-q').checked,
    shuffleA: document.getElementById('set-shuffle-a').checked,
    adminProfile: {
      name: document.getElementById('admin-profile-name').value.trim(),
      role: document.getElementById('admin-profile-role').value.trim(),
      email: document.getElementById('admin-profile-email').value.trim(),
      phone: document.getElementById('admin-profile-phone').value.trim(),
      facebook: document.getElementById('admin-profile-facebook').value.trim(),
      telegram: document.getElementById('admin-profile-telegram').value.trim(),
      whatsapp: document.getElementById('admin-profile-whatsapp').value.trim(),
      location: document.getElementById('admin-profile-location').value.trim(),
      hours: document.getElementById('admin-profile-hours').value.trim(),
      photo: pendingAdminPhoto || (settings.adminProfile && settings.adminProfile.photo) || ''
    }
  };
  localStorage.setItem(SK_SETTINGS, JSON.stringify(settings));
  fbSet('settings', settings);
  renderAdminContactCard();
  updateHeaderLinks('screen-admin');
  const apiKey = document.getElementById('set-api-key').value.trim();
  if (apiKey) localStorage.setItem('eq2_api_key', apiKey);
  const msg = document.getElementById('settings-msg');
  msg.textContent = '✅ Settings saved successfully!';
  msg.classList.add('show');
  setTimeout(() => msg.classList.remove('show'), 3000);
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('set-api-key');
  input.type = input.type === 'password' ? 'text' : 'password';
}

// ===== KEYBOARD SHORTCUTS =====
document.getElementById('student-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleUnifiedLogin();
});

// ===== PDF UPLOAD & AUTO QUESTION EXTRACTION =====

let pdfExtractedQuestions = [];

function openPdfUpload() {
  pdfExtractedQuestions = [];
  document.getElementById('pdf-file-input').value = '';
  document.getElementById('pdf-error').textContent = '';
  document.getElementById('pdf-error').classList.remove('show');
  document.getElementById('pdf-success').textContent = '';
  document.getElementById('pdf-success').classList.remove('show');
  document.getElementById('pdf-progress-area').style.display = 'none';
  document.getElementById('pdf-preview-area').style.display = 'none';
  document.getElementById('pdf-extract-btn').style.display = '';
  document.getElementById('pdf-save-btn').style.display = 'none';
  document.getElementById('pdf-modal').classList.add('show');
}

function closePdfModal() {
  document.getElementById('pdf-modal').classList.remove('show');
}

async function extractFromPdf() {
  const fileInput = document.getElementById('pdf-file-input');
  const file = fileInput.files[0];

  if (!file) { showPdfError('Please choose a PDF file first!'); return; }

  hidePdfError(); hidePdfSuccess();
  document.getElementById('pdf-preview-area').style.display = 'none';
  document.getElementById('pdf-extract-btn').disabled = true;
  document.getElementById('pdf-extract-btn').textContent = '⏳ Working...';
  document.getElementById('pdf-save-btn').style.display = 'none';
  setPdfProgress(10, '📖 Reading PDF...');
  document.getElementById('pdf-progress-area').style.display = 'block';

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const lines = {};
      content.items.forEach(item => {
        const y = Math.round(item.transform[5]);
        if (!lines[y]) lines[y] = [];
        lines[y].push(item.str);
      });
      const sortedY = Object.keys(lines).map(Number).sort((a, b) => b - a);
      sortedY.forEach(y => { fullText += lines[y].join(' ') + '\n'; });
      setPdfProgress(10 + Math.round((i / pdf.numPages) * 40), `📖 Reading page ${i}/${pdf.numPages}...`);
    }

    if (fullText.trim().length < 50) {
      showPdfError('Could not extract text from the PDF. It may be a scanned/image PDF.');
      resetPdfBtn(); return;
    }

    setPdfProgress(60, '🔍 Searching for questions...');
    pdfExtractedQuestions = parseQuestionsFromText(fullText);
    setPdfProgress(100, '✅ Done!');

    if (pdfExtractedQuestions.length === 0) {
      showPdfError('Could not find any questions. The PDF should follow this format: "1. Question\\nA. ...\\nB. ...\\nC. ...\\nD. ..."');
      resetPdfBtn(); return;
    }

    showPdfPreview(pdfExtractedQuestions);
    document.getElementById('pdf-save-btn').style.display = '';
    resetPdfBtn();

  } catch (err) {
    showPdfError('Error: ' + err.message);
    resetPdfBtn();
  }
}

function parseQuestionsFromText(text) {
  const questions = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const qMatch = line.match(/^(?:Q(?:uestion)?\s*)?(\d+)[.\)]\s+(.+)/i);
    if (!qMatch) { i++; continue; }

    let qText = qMatch[2].trim();
    i++;

    while (i < lines.length &&
           !lines[i].match(/^[A-Da-d][.\)]\s/i) &&
           !lines[i].match(/^(?:Q(?:uestion)?\s*)?\d+[.\)]\s/i)) {
      const next = lines[i];
      if (next.match(/^(?:answer|ans|answer key|answers)\s*[:]/i)) break;
      if (next.match(/^(?:answer|ans)\s*[:\-]\s*[A-Da-d]\s*$/i)) break;
      qText += ' ' + next;
      i++;
    }

    const isTF = /true\s*(or|\/)\s*false/i.test(qText);

    if (isTF) {
      questions.push({ q: cleanQText(qText), type: 'tf', opts: ['True', 'False'], ans: -1 });
      if (i < lines.length && lines[i].match(/^(?:answer|ans)\s*[:\-]/i)) i++;
      continue;
    }

    const opts = ['', '', '', ''];
    const optLetters = ['A','B','C','D'];
    let foundOpts = 0;

    while (i < lines.length && foundOpts < 4) {
      const optLine = lines[i];
      if (optLine.match(/^(?:answer|ans|key)\s*[:\-]/i)) { i++; break; }
      const optMatch = optLine.match(/^([A-Da-d])[.\)]\s+(.+)/);
      if (!optMatch) break;

      const idx = optLetters.indexOf(optMatch[1].toUpperCase());
      if (idx === -1) break;

      let optText = optMatch[2].replace(/\*$|\(correct\)|\[correct\]/gi, '').trim();
      i++;

      while (i < lines.length &&
             !lines[i].match(/^[A-Da-d][.\)]\s/i) &&
             !lines[i].match(/^(?:Q(?:uestion)?\s*)?\d+[.\)]\s/i) &&
             !lines[i].match(/^(?:answer|ans)\s*[:\-]/i)) {
        optText += ' ' + lines[i];
        i++;
      }
      opts[idx] = optText.trim();
      foundOpts++;
    }

    if (i < lines.length && lines[i].match(/^(?:answer|ans|key)\s*[:\-]/i)) i++;

    if (foundOpts < 2) continue;

    for (let k = 0; k < 4; k++) if (!opts[k]) opts[k] = `Option ${optLetters[k]}`;

    questions.push({ q: cleanQText(qText), opts, ans: -1 });
  }

  return questions;
}

function cleanQText(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\?+$/, '?')
    .trim();
}


function showPdfPreview(questions) {
  document.getElementById('pdf-q-count').textContent = questions.length;
  const list = document.getElementById('pdf-preview-list');

  list.innerHTML = questions.map((q, i) => {
    const isTF = q.opts.length === 2;
    const btns = q.opts.map((opt, idx) => {
      const label = isTF ? opt : `${['A','B','C','D'][idx]}. ${opt}`;
      return `<button onclick="selectPdfAns(${i},${idx})" id="pdf-ans-${i}-${idx}"
        style="display:block;width:100%;text-align:left;margin:2px 0;padding:5px 10px;
               border:1.5px solid #004346;border-radius:6px;background:lightgray;
               color:#004346;font-size:0.78rem;cursor:pointer;transition:all 0.15s">
        ${label}
      </button>`;
    }).join('');

    return `<div id="pdf-qblock-${i}" style="margin-bottom:0.9rem;padding:0.7rem;background:#f0f0f0;border:1px solid #d3d3d3;border-radius:8px">
      <div style="font-size:0.8rem;font-weight:600;color:#004346;margin-bottom:0.4rem">
        ${i+1}. ${q.q.substring(0,120)}${q.q.length>120?'...':''}
      </div>
      <div id="pdf-opts-${i}">${btns}</div>
      <div id="pdf-ans-label-${i}" style="font-size:0.72rem;color:gray;margin-top:4px">⬜ No answer selected yet</div>
    </div>`;
  }).join('');

  document.getElementById('pdf-preview-area').style.display = 'block';
}

function selectPdfAns(qIdx, ansIdx) {
  pdfExtractedQuestions[qIdx].ans = ansIdx;
  const optCount = pdfExtractedQuestions[qIdx].opts.length;
  const isTF = optCount === 2;

  for (let k = 0; k < optCount; k++) {
    const btn = document.getElementById(`pdf-ans-${qIdx}-${k}`);
    if (btn) {
      btn.style.background = 'lightgray';
      btn.style.color = '#004346';
      btn.style.borderColor = '#004346';
      btn.style.fontWeight = 'normal';
    }
  }
  const sel = document.getElementById(`pdf-ans-${qIdx}-${ansIdx}`);
  if (sel) {
    sel.style.background = 'darkgreen';
    sel.style.color = '#fff';
    sel.style.borderColor = 'darkgreen';
    sel.style.fontWeight = '600';
  }

  const label = isTF
    ? pdfExtractedQuestions[qIdx].opts[ansIdx]
    : `${['A','B','C','D'][ansIdx]}`;
  const lbl = document.getElementById(`pdf-ans-label-${qIdx}`);
  if (lbl) { lbl.textContent = `✅ Answer: ${label}`; lbl.style.color = 'darkgreen'; }

  const allDone = pdfExtractedQuestions.every(q => q.ans !== -1);
  const saveBtn = document.getElementById('pdf-save-btn');
  if (allDone) {
    saveBtn.style.display = '';
    saveBtn.textContent = `💾 Save All ${pdfExtractedQuestions.length} Questions`;
  } else {
    const remaining = pdfExtractedQuestions.filter(q => q.ans === -1).length;
    saveBtn.style.display = 'none';
    document.getElementById('pdf-q-count').textContent =
      `${pdfExtractedQuestions.length} (${remaining} unanswered)`;
  }
}

function savePdfQuestions() {
  if (!activeCourseId || pdfExtractedQuestions.length === 0) return;

  const unanswered = pdfExtractedQuestions.filter(q => q.ans === -1).length;
  if (unanswered > 0) {
    showPdfError(`${unanswered} question(s) have no answer selected! Please select an answer for all.`);
    return;
  }

  const course = courses.find(c => c.id === activeCourseId);
  if (!course) return;

  course.questions.push(...pdfExtractedQuestions);
  saveCourses();
  renderQuestionList();

  showPdfSuccess(`🎉 ${pdfExtractedQuestions.length} question(s) added to the course!`);
  document.getElementById('pdf-save-btn').style.display = 'none';
  document.getElementById('pdf-preview-area').style.display = 'none';
  pdfExtractedQuestions = [];
  setTimeout(() => closePdfModal(), 1800);
}

function setPdfProgress(pct, text) {
  document.getElementById('pdf-progress-bar').style.width = pct + '%';
  document.getElementById('pdf-status-text').textContent = text;
}

function showPdfError(msg) {
  const el = document.getElementById('pdf-error');
  el.textContent = msg;
  el.classList.add('show');
}

function hidePdfError() {
  const el = document.getElementById('pdf-error');
  el.textContent = '';
  el.classList.remove('show');
}

function showPdfSuccess(msg) {
  const el = document.getElementById('pdf-success');
  el.textContent = msg;
  el.classList.add('show');
}

function hidePdfSuccess() {
  const el = document.getElementById('pdf-success');
  el.textContent = '';
  el.classList.remove('show');
}

function resetPdfBtn() {
  const btn = document.getElementById('pdf-extract-btn');
  btn.disabled = false;
  btn.textContent = '🔍 Extract Questions';
}

// ===== EXAM ANTI-COPY GUARD =====
document.addEventListener('copy', e => {
  if (document.body.classList.contains('exam-no-copy')) e.preventDefault();
});
document.addEventListener('cut', e => {
  if (document.body.classList.contains('exam-no-copy')) e.preventDefault();
});
document.addEventListener('selectstart', e => {
  if (document.body.classList.contains('exam-no-copy')) e.preventDefault();
});
document.addEventListener('contextmenu', e => {
  if (document.body.classList.contains('exam-no-copy')) e.preventDefault();
});