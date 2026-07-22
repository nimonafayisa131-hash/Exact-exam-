// =====================================================================
// ONLINE EXAM SYSTEM — main application logic
//
// This is a single-page app: every "screen" (login, exam, admin
// dashboard, etc.) is a <div class="screen"> in index.html, and
// showScreen() just shows/hides them. All data (courses, questions,
// exam settings, authorized students, and results) is stored in the
// browser's localStorage, so there is no backend server involved.
//
// Rough map of this file:
//   1. CONSTANTS            - fixed values (admin login, storage keys)
//   2. SQL_QUESTIONS        - the default question bank for the demo course
//   3. DEFAULT_COURSES/SETTINGS - what a brand-new install starts with
//   4. STATE                - variables that change while the app runs
//   5. DATA                 - load/save helpers for localStorage
//   6. AUTHORIZED STUDENTS  - admin-managed login whitelist
//   7. SCREENS / UTILS      - navigation & small shared helpers
//   8. STUDENT LOGIN / EXAM / RESULTS / REVIEW - the student-facing flow
//   9. ADMIN dashboard      - login, tabs, results, courses, questions, settings
//  10. PDF QUESTION IMPORT  - extract questions from an uploaded PDF
// =====================================================================

// ===== CONSTANTS =====
const ADMIN_USER = 'nima';
const ADMIN_PASS = 'admin2026';
const SK_RESULTS   = 'eq2_results';
const SK_ATTEMPTED = 'eq2_attempted';
const SK_COURSES   = 'eq2_courses';
const SK_SETTINGS  = 'eq2_settings';
const SK_AUTHORIZED = 'eq2_authorized';
const SK_TEACHERS = 'eq2_teachers';

// ===== FIREBASE (REALTIME DATABASE) =====
// This app stores its data in localStorage first (so it always works
// instantly, even offline), and mirrors every change to a Firebase
// Realtime Database in the background so the same data is available
// from any device/browser. This uses Firebase's plain REST API
// (no SDK, no API key needed) — it just talks to <DB_URL>/<path>.json.
//
// IMPORTANT: for this to actually read/write, your Firebase Realtime
// Database's Rules must allow access, e.g. for quick testing:
//   { "rules": { ".read": true, ".write": true } }
// (Anyone with your DB URL can then read/write it — fine for a class
// project, but lock this down with real auth rules for production use.)
const FIREBASE_URL = 'https://exam-c9ed6-default-rtdb.firebaseio.com';

// Fetches one top-level key's value from Firebase. Returns null on any
// failure (missing key, offline, blocked rules, etc.) so callers can
// just fall back to whatever is already in localStorage.
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

// Writes one top-level key's value to Firebase. Fire-and-forget: the
// caller doesn't wait for this, so the UI never feels slower because
// of the network. Pass `null` to delete that key from the database.
function fbSet(key, value) {
  fetch(`${FIREBASE_URL}/${key}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  }).catch(e => console.warn('Firebase write failed for "' + key + '":', e));
}

// On startup: pulls the latest courses/settings/authorized-students/
// results/attempted records from Firebase (so this device sees changes
// made from any other device), stores them into localStorage, then
// reloads the in-memory state and refreshes whatever's on screen.
// If Firebase has nothing yet (brand-new database), it seeds Firebase
// with whatever this device currently has instead.
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

// Cheap, safe-to-call-anytime refresh of whichever screen/tab happens
// to be open right now, so newly-synced Firebase data shows up without
// needing a manual page reload.
function refreshVisibleAdminOrStudentView() {
  try {
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
  } catch (e) { /* nothing on screen yet to refresh — ignore */ }
}

// ===== SQL QUESTIONS =====
const SQL_QUESTIONS = [
  {q:"What is a major disadvantage of the File-Based system?",opts:["It is very fast","Data redundancy and inconsistency","It is cheap to maintain","It supports many users easily"],ans:1},
  {q:"What does DBMS stand for?",opts:["Data Backup Management System","Digital Base Management System","Database Management System","Data Browsing Module System"],ans:2},
  {q:"Which best describes a Relational Database?",opts:["Data stored in plain text files","Data organized in related tables with rows and columns","Data stored in a single large file","Data stored only on the cloud"],ans:1},
  {q:"What is a Primary Key?",opts:["A key that allows NULL values","A column that uniquely identifies each row and cannot be NULL","A key shared between two tables","A key used only for sorting"],ans:1},
  {q:"What is the role of a Foreign Key?",opts:["It deletes records automatically","It links two tables by referencing a Primary Key","It encrypts table data","It prevents duplicate rows"],ans:1},
  {q:"In which year did SQL become an ANSI standard?",opts:["1970","1980","1986","2000"],ans:2},
  {q:"Which of the following is NOT a benefit of the Database approach?",opts:["Data sharing among multiple users","Data redundancy increases","Backup and recovery support","Improved data security"],ans:1},
  {q:"SQL stands for:",opts:["Simple Query List","Structured Question Language","Structured Query Language","System Query Language"],ans:2},
  {q:"Which SQL category controls user access?",opts:["DDL","DML","DQL","DCL"],ans:3},
  {q:"What does it mean that SQL is non-procedural?",opts:["SQL cannot run on any system","You specify WHAT you want, not HOW to get it","SQL must follow step-by-step instructions","SQL does not support functions"],ans:1},
  {q:"Which of the following is an example of an RDBMS?",opts:["Microsoft Word","MySQL","Adobe Acrobat","Windows Explorer"],ans:1},
  {q:"A schema in a database refers to:",opts:["A single row in a table","The overall logical structure of the database","A backup file","A type of query"],ans:1},
  {q:"Which SQL command creates a new table?",opts:["NEW TABLE","ADD TABLE","CREATE TABLE","INSERT TABLE"],ans:2},
  {q:"Which command removes a table permanently?",opts:["DELETE TABLE","REMOVE TABLE","TRUNCATE TABLE","DROP TABLE"],ans:3},
  {q:"Which command adds a new column to an existing table?",opts:["UPDATE TABLE","ALTER TABLE ... ADD","MODIFY TABLE","INSERT COLUMN"],ans:1},
  {q:"What does the NOT NULL constraint do?",opts:["Allows empty values","Forces a column to always have a value","Makes values unique","Sets a default value"],ans:1},
  {q:"Which constraint ensures no duplicate values in a column?",opts:["NOT NULL","PRIMARY KEY","UNIQUE","CHECK"],ans:2},
  {q:"What does the DEFAULT constraint do?",opts:["Prevents NULL values","Automatically inserts a predefined value if none is provided","Removes duplicate rows","Deletes empty records"],ans:1},
  {q:"Which constraint limits the values allowed in a column?",opts:["NOT NULL","UNIQUE","CHECK","DEFAULT"],ans:2},
  {q:"Which data type stores variable-length text up to 8,000 characters?",opts:["CHAR","TEXT","VARCHAR","INT"],ans:2},
  {q:"What is the correct syntax to create a database?",opts:["NEW DATABASE myDB;","ADD DATABASE myDB;","CREATE DATABASE myDB;","BUILD DATABASE myDB;"],ans:2},
  {q:"Which keyword auto-increments a primary key in SQL Server?",opts:["AUTO_INCREMENT","IDENTITY","AUTOKEY","SEQUENCE"],ans:1},
  {q:"What does DROP DATABASE do?",opts:["Empties all tables","Permanently deletes the entire database","Renames the database","Creates a backup"],ans:1},
  {q:"Which correctly adds a Foreign Key?",opts:["ALTER TABLE Orders ADD FOREIGN KEY (CustID) REFERENCES Customers(ID);","INSERT FOREIGN KEY CustID INTO Orders;","CREATE FOREIGN KEY Orders.CustID;","MODIFY TABLE Orders FK CustID;"],ans:0},
  {q:"Which command inserts a new row into a table?",opts:["ADD INTO","INSERT INTO","PUT INTO","PUSH INTO"],ans:1},
  {q:"What is the correct syntax to update data?",opts:["MODIFY table SET col=val WHERE condition;","UPDATE table SET col=val WHERE condition;","CHANGE table col=val WHERE condition;","ALTER table SET col=val;"],ans:1},
  {q:"What happens if you run UPDATE without a WHERE clause?",opts:["Nothing happens","Only the first row is updated","All rows in the table are updated","An error occurs"],ans:2},
  {q:"Which command removes specific rows from a table?",opts:["DROP","TRUNCATE","REMOVE","DELETE"],ans:3},
  {q:"What does DELETE FROM Students; do?",opts:["Deletes the Students table","Deletes all rows but keeps the table structure","Deletes only the first row","Renames the table"],ans:1},
  {q:"What is the difference between DELETE and DROP?",opts:["No difference","DELETE removes data rows; DROP removes the entire table structure","DROP removes data rows; DELETE removes the table","Both remove the database"],ans:1},
  {q:"Which DML statement modifies existing records?",opts:["INSERT","ALTER","UPDATE","SELECT"],ans:2},
  {q:"To insert only specific columns, which syntax is correct?",opts:["INSERT INTO table VALUES (val1, val2);","INSERT INTO table (col1, col2) VALUES (val1, val2);","ADD INTO table (col1) = val1;","PUT INTO table col1=val1;"],ans:1},
  {q:"Which clause prevents UPDATE or DELETE from affecting all rows?",opts:["ORDER BY","GROUP BY","WHERE","HAVING"],ans:2},
  {q:"Which keyword retrieves data from a table?",opts:["GET","FETCH","SELECT","RETRIEVE"],ans:2},
  {q:"What does SELECT * mean?",opts:["Select all databases","Select all rows only","Select all columns","Select the first row"],ans:2},
  {q:"What does the DISTINCT keyword do?",opts:["Sorts results alphabetically","Removes duplicate values from results","Filters NULL values","Groups rows together"],ans:1},
  {q:"Which clause filters rows based on a condition?",opts:["HAVING","ORDER BY","GROUP BY","WHERE"],ans:3},
  {q:"What does ORDER BY DESC do?",opts:["Sorts from A to Z","Sorts from smallest to largest","Sorts from largest to smallest / Z to A","Removes duplicates"],ans:2},
  {q:"Which operator checks if a value falls within a range?",opts:["IN","LIKE","BETWEEN","IS NULL"],ans:2},
  {q:"What does the LIKE operator with '%' wildcard do?",opts:["Matches exactly one character","Matches zero or more characters","Matches only numbers","Matches NULL values"],ans:1},
  {q:"Which aggregate function returns the total number of rows?",opts:["SUM()","AVG()","COUNT()","MAX()"],ans:2},
  {q:"Which function returns the highest value in a column?",opts:["MIN()","AVG()","COUNT()","MAX()"],ans:3},
  {q:"What does AVG() do?",opts:["Returns the total sum","Returns the average (mean) value","Returns the number of rows","Returns the minimum value"],ans:1},
  {q:"What is the purpose of GROUP BY?",opts:["Sorts results","Groups rows with the same value for use with aggregate functions","Filters individual rows","Joins two tables"],ans:1},
  {q:"What is the difference between WHERE and HAVING?",opts:["No difference","WHERE filters rows before grouping; HAVING filters groups after aggregation","HAVING filters rows before grouping; WHERE filters after","Both filter after aggregation"],ans:1},
  {q:"Which clause filters results after GROUP BY?",opts:["WHERE","ORDER BY","HAVING","DISTINCT"],ans:2},
  {q:"A subquery must be enclosed in:",opts:["Square brackets [ ]","Curly braces { }","Parentheses ( )","Quotation marks"],ans:2},
  {q:"Which operator is used with a subquery returning multiple rows?",opts:["=","IN","LIKE","BETWEEN"],ans:1},
  {q:"Which function combines two strings together?",opts:["MERGE()","JOIN()","CONCAT()","COMBINE()"],ans:2},
  {q:"Which is the correct full SELECT syntax order?",opts:["FROM -> WHERE -> SELECT -> GROUP BY -> HAVING -> ORDER BY","SELECT -> FROM -> WHERE -> GROUP BY -> HAVING -> ORDER BY","WHERE -> SELECT -> FROM -> ORDER BY -> GROUP BY -> HAVING","SELECT -> WHERE -> FROM -> HAVING -> GROUP BY -> ORDER BY"],ans:1}
];

// ===== DEFAULT COURSES =====
const DEFAULT_COURSES = [
  {
    id: 'course_sql',
    name: 'SQL — Basic Structured Query Language',
    dept: 'WDDBA',
    code: 'SQL2026',
    desc: 'WDDBA Level III · 50 Questions · 4 Chapters',
    icon: '🗄️',
    settings: { timeMins: 20, passPercent: 50, qCount: 0, shuffleQ: true, shuffleA: true, retake: false },
    questions: JSON.parse(JSON.stringify(SQL_QUESTIONS))
  }
];

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
let currentRole = 'admin';   // 'admin' or 'teacher' — who is logged into screen-admin right now
let currentTeacher = null;   // the matched teacher record when currentRole === 'teacher'
let lastFilteredResults = []; // whatever loadResultsTab() currently has on screen (respects the course/dept filters), used by downloadResultsCSV()

// ===== DATA =====
// Loads courses & settings from localStorage (or falls back to the built-in defaults)
// so the app remembers admin changes even after the page is refreshed.
function loadData() {
  const sc = localStorage.getItem(SK_COURSES);
  courses = sc ? JSON.parse(sc) : JSON.parse(JSON.stringify(DEFAULT_COURSES));
  const ss = localStorage.getItem(SK_SETTINGS);
  // Merge over DEFAULT_SETTINGS so older saved settings (from before a
  // newer default option existed) still get a sensible value.
  settings = ss ? { ...DEFAULT_SETTINGS, ...JSON.parse(ss) } : { ...DEFAULT_SETTINGS };
}
loadData();
syncAllFromFirebase();

// ===== AUTHORIZED STUDENTS =====
// Reads the list of authorized (whitelisted) students from localStorage.
// Only students on this list are allowed to log in and take an exam.
function loadAuthorized() {
  const sa = localStorage.getItem(SK_AUTHORIZED);
  return sa ? JSON.parse(sa) : [];
}

// Persists the authorized-student list back to localStorage.
function saveAuthorized(list) {
  localStorage.setItem(SK_AUTHORIZED, JSON.stringify(list));
  fbSet('authorized', list);
}

// Checks a login attempt against the authorized list (case-insensitive username).
// Returns the matching student record, or null if the credentials are wrong.
function findAuthorizedStudent(username, password) {
  const list = loadAuthorized();
  const u = username.trim().toLowerCase();
  return list.find(s => (s.username || '').toLowerCase() === u && s.password === password) || null;
}

// Draws the admin's "Authorized Students" table (or an empty-state message
// if no students have been added yet).
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

// Admin action: adds one new authorized student after validating that
// all fields are filled in and the ID/username aren't already taken.
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

// Admin action: adds many students at once from a pasted, comma-separated
// list (one student per line). Skips duplicate IDs/usernames automatically.
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

// Admin action: removes a single student from the authorized list by ID.
function removeAuthorizedStudent(id) {
  let list = loadAuthorized();
  list = list.filter(s => s.id !== id);
  saveAuthorized(list);
  renderAuthorizedTab();
}

// Opens the "are you sure?" confirmation modal before wiping all students.
function confirmClearAuthorized() {
  document.getElementById('clear-auth-modal').classList.add('show');
}

// Admin action: deletes every authorized student. Used after the user
// confirms via the warning modal, since this action can't be undone.
function clearAllAuthorized() {
  localStorage.removeItem(SK_AUTHORIZED);
  fbSet('authorized', null);
  closeModal('clear-auth-modal');
  renderAuthorizedTab();
}

// ===== TEACHERS =====
// Teacher accounts are created by the Admin and each one is given
// permission to view results for a chosen set of courses only. A
// teacher logs in through the same Admin Login form; handleAdminLogin()
// checks the real admin credentials first, then falls back to this list.
function loadTeachers() {
  const st = localStorage.getItem(SK_TEACHERS);
  return st ? JSON.parse(st) : [];
}

function saveTeachers(list) {
  localStorage.setItem(SK_TEACHERS, JSON.stringify(list));
  fbSet('teachers', list);
}

// Checks a login attempt against the teacher list (case-insensitive username).
// Returns the matching teacher record, or null if the credentials are wrong.
function findTeacher(username, password) {
  const list = loadTeachers();
  const u = username.trim().toLowerCase();
  return list.find(t => (t.username || '').toLowerCase() === u && t.password === password) || null;
}

// Builds the checkbox list (one per existing course) shown in the
// "Add a Teacher" form, so the admin can pick which courses' results
// this teacher is allowed to see.
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

// Draws the admin's "Teachers" table (or an empty-state message if none yet).
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

// Admin action: adds one new teacher account after validating the form
// and making sure the username isn't already taken (by a teacher or a student).
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

// Admin action: removes a single teacher account by ID.
function removeTeacher(id) {
  let list = loadTeachers();
  list = list.filter(t => t.id !== id);
  saveTeachers(list);
  renderTeachersTab();
}

// Opens the "are you sure?" confirmation modal before wiping all teachers.
function confirmClearTeachers() {
  document.getElementById('clear-teachers-modal').classList.add('show');
}

// Admin action: deletes every teacher account.
function clearAllTeachers() {
  localStorage.removeItem(SK_TEACHERS);
  fbSet('teachers', null);
  closeModal('clear-teachers-modal');
  renderTeachersTab();
}

// Shows/hides the admin-only tabs & controls depending on whether the
// dashboard is being viewed by the real Admin or by a permission-limited
// Teacher, and updates the dashboard header to match.
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
// Simple screen router: hides every screen, then shows only the one
// requested. The whole app is a single page split into these screens.
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  // Hide the header's "Admin"/"Teacher" links during a live exam (so a
  // student can't accidentally click away mid-exam) and while already in
  // the admin/teacher dashboard (the links would be redundant there).
  const adminLink = document.getElementById('global-admin-link');
  const teacherLink = document.getElementById('global-teacher-link');
  const shouldHide = id === 'screen-exam' || id === 'screen-admin';
  if (adminLink) adminLink.classList.toggle('hidden', shouldHide);
  if (teacherLink) teacherLink.classList.toggle('hidden', shouldHide);
  // Block text selection/copying of question content while a live exam
  // is on screen (see the "exam-no-copy" CSS rules + the copy/selectstart/
  // contextmenu guards registered once near the bottom of this file).
  document.body.classList.toggle('exam-no-copy', id === 'screen-exam');
}

// Navigates to the student login screen, refreshing data first so any
// changes an admin made (new students, courses, etc.) are picked up.
function goStudentLogin() {
  loadData();
  showScreen('screen-login');
}

// Navigates to the admin login screen, labeled for the real Admin.
function goAdminLogin() {
  document.getElementById('login-badge').textContent = '🔐 Admin Access';
  document.getElementById('login-heading').textContent = 'Admin Login';
  document.getElementById('login-subtitle').textContent = 'Enter credentials to access the dashboard';
  showScreen('screen-admin-login');
}

// Navigates to the same login screen, but relabeled for a Teacher —
// they log in with the username/password the Admin created for them,
// and land on a Results-only dashboard limited to their permitted courses.
function goTeacherLogin() {
  document.getElementById('login-badge').textContent = '👨‍🏫 Teacher Access';
  document.getElementById('login-heading').textContent = 'Teacher Login';
  document.getElementById('login-subtitle').textContent = 'Enter the username and password given to you by Admin to view your course results';
  showScreen('screen-admin-login');
}

// Hides a popup/modal dialog by id.
function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

// ===== UTILS =====
// Fisher-Yates shuffle: returns a new array with the same items in random
// order. Used to randomize question and answer order per settings.
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Looks up a course object by its id.
function getCourse(id) {
  return courses.find(c => c.id === id);
}

// Returns a course's own exam settings (time/pass%/question count/
// shuffle options). Falls back to sensible defaults for older course
// records saved before per-course settings existed.
function getCourseSettings(course) {
  return {
    timeMins: (course.settings && course.settings.timeMins) || 20,
    passPercent: (course.settings && course.settings.passPercent) || 50,
    qCount: (course.settings && course.settings.qCount) || 0,
    shuffleQ: course.settings ? course.settings.shuffleQ !== false : true,
    shuffleA: course.settings ? course.settings.shuffleA !== false : true,
    // Per-course retake toggle: false (default) = a student may only take
    // THIS course's exam once, the "already attempted" lock applies. true =
    // the lock is skipped entirely for this course and students can retake
    // it as many times as they like.
    retake: course.settings ? course.settings.retake === true : false
  };
}

// Persists the current in-memory `courses` array to localStorage.
function saveCourses() {
  localStorage.setItem(SK_COURSES, JSON.stringify(courses));
  fbSet('courses', courses);
}

// ===== COURSE SELECT (student) =====
// Renders the list of course cards a logged-in student can choose from.
// Only courses in the student's own department are shown (never leaks
// across departments — see renderCourseSelectGrid's filter below).
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
    return `
    <div class="course-select-card" onclick="selectCourseCard('${c.id}')">
      <div class="cs-icon">${c.icon || '📚'}</div>
      <div class="cs-info">
        <div class="cs-name">${c.name}</div>
        <div class="cs-meta">⏱️ ${s.timeMins} min · ❓ ${c.questions.length} questions · 🎯 Pass ${s.passPercent}%</div>
      </div>
      <div style="font-size:1.2rem;color:#004346">›</div>
    </div>`;
  }).join('');
}

// Student clicked a course card: show its instructions and the course
// code entry box before letting them start the exam.
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
  `;
  document.getElementById('course-code-input').value = '';
  document.getElementById('course-code-error').classList.remove('show');
  document.getElementById('course-list-view').style.display = 'none';
  document.getElementById('course-code-view').style.display = 'block';
}

// Student backed out of the code-entry box to pick a different course.
function backToCourseList() {
  selectedCourseId = null;
  document.getElementById('course-code-view').style.display = 'none';
  document.getElementById('course-list-view').style.display = 'block';
}

// ===== STUDENT LOGIN =====
let loggedInStudent = null;

// Validates the student login form, checks credentials against the
// authorized list, and moves to course selection on success.
function handleStudentLogin() {
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
  const student = findAuthorizedStudent(username, password);
  if (!student) {
    err.textContent = 'Incorrect username or password. Please contact Admin if you don\'t have an account.';
    err.classList.add('show', 'notice-green');
    return;
  }
  err.classList.remove('show', 'notice-green');
  loggedInStudent = student;
  document.getElementById('student-username').value = '';
  document.getElementById('student-password').value = '';
  goCourseSelectScreen();
}

// Shows the course-selection screen for the now-logged-in student.
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

// Validates the course code the student typed in, blocks them if
// they've already attempted this exact course before, and otherwise
// starts the exam.
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
  err.classList.remove('show');
  const id = loggedInStudent.id;
  // Only enforce the "already attempted" lock when THIS course's own
  // "Allow Retake" setting is off. When a course has retakes allowed,
  // the lock is skipped entirely for that course.
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
// Prepares a fresh exam attempt: picks/shuffles questions and answer
// order per admin settings, resets the timer, and shows the exam screen.
function startExam(course) {
  currentQ = 0;
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

// Renders the current question, its options, and the progress bar/nav
// buttons. Handles both multiple-choice and True/False question types.
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

// Opens the "are you sure?" modal before letting the student leave a
// live exam without submitting.
function confirmExitExam() {
  document.getElementById('exit-exam-modal').classList.add('show');
}

// Student confirmed they want to leave mid-exam: stop the timer, throw
// away their in-progress answers (nothing is saved/submitted, and this
// attempt is NOT marked as "attempted" — same as if they'd just closed
// the browser tab), and send them back to the home/login screen.
function exitExamConfirmed() {
  clearInterval(timerInterval);
  closeModal('exit-exam-modal');
  studentLogout();
}

// Records the student's chosen option for the current question and
// re-renders so the selection is visually highlighted.
function selectAnswer(d) {
  answers[currentQ] = d;
  renderQuestion();
}

// Moves back one question, if possible.
function prevQuestion() {
  if (currentQ > 0) {
    currentQ--;
    renderQuestion();
  }
}

// Moves forward one question, if possible.
function nextQuestion() {
  if (currentQ < examQuestions.length - 1) {
    currentQ++;
    renderQuestion();
  }
}

// ===== QUESTION NAVIGATOR =====
// Shows a panel with every question number in one place, colored by
// current / answered / unanswered, so the student can find and jump to
// any question instantly instead of paging through Next/Previous.
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

// Jumps straight to question index i (0-based) and closes the panel.
function goToQuestion(i) {
  currentQ = i;
  renderQuestion();
  closeModal('q-nav-modal');
}

// Grades the exam, saves the result and marks the student/course pair
// as "attempted" (so they can't retake it), then shows the results screen.
function submitExam() {
  closeModal('submit-modal');
  clearInterval(timerInterval);
  let correct = 0;
  examQuestions.forEach((q, i) => {
    if (answers[i] === null) return;
    if (q.type === 'tf') {
      if (answers[i] === q.ans) correct++;
    } else {
      if (answerMap[i][answers[i]] === q.ans) correct++;
    }
  });
  const total = examQuestions.length;
  const pct = Math.round((correct / total) * 100);
  const gradingCourse = getCourse(currentStudent.courseId);
  const passPercent = gradingCourse ? getCourseSettings(gradingCourse).passPercent : 50;
  const passed = pct >= passPercent;
  const timeTaken = TOTAL_TIME - timeLeft;
  const mins = Math.floor(timeTaken / 60);
  const secs = timeTaken % 60;
  const attempted = JSON.parse(localStorage.getItem(SK_ATTEMPTED) || '[]');
  attempted.push(currentStudent.id + '::' + currentStudent.courseId);
  localStorage.setItem(SK_ATTEMPTED, JSON.stringify(attempted));
  fbSet('attempted', attempted);
  const results = JSON.parse(localStorage.getItem(SK_RESULTS) || '[]');
  results.push({
    name: currentStudent.name,
    id: currentStudent.id,
    dept: currentStudent.dept,
    courseId: currentStudent.courseId,
    courseName: currentStudent.courseName,
    correct,
    total,
    pct,
    passed,
    time: `${mins}:${secs.toString().padStart(2, '0')}`,
    date: new Date().toLocaleString('en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  });
  localStorage.setItem(SK_RESULTS, JSON.stringify(results));
  fbSet('results', results);
  showResults(correct, total, pct, passed);
}

// Displays the score screen, including the animated pass/fail circle.
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

// Lets the student "download" their result. We reuse the browser's own
// print dialog (which every browser can save as PDF) rather than pulling
// in an external PDF library — the print-only CSS in styles.css hides
// everything except the result card itself, so what gets saved/printed
// is just a clean result slip.
function downloadResult() {
  window.print();
}

// ===== STUDENT LOGOUT =====
// Clears the current student's session data and returns to the login screen.
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
// Builds a two-letter avatar from a full name: first letter of the
// first name + first letter of the last name (e.g. "Sara Bekele" -> "SB").
function getInitials(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '👤';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// Fills in the avatar initials and menu details for the student
// currently taking the exam.
function renderExamProfileMenu() {
  const initials = getInitials(currentStudent.name);
  document.getElementById('exam-avatar').textContent = initials;
  document.getElementById('exam-avatar-lg').textContent = initials;
  document.getElementById('exam-profile-menu-name').textContent = currentStudent.name || '';
  document.getElementById('exam-profile-menu-id').textContent = currentStudent.id || '';
  document.getElementById('exam-profile-menu-grade').textContent = `🎓 Department: ${currentStudent.dept || '—'}`;
}

// Opens/closes the avatar dropdown (Edit Profile / Department / Logout).
function toggleExamProfileMenu(e) {
  if (e) e.stopPropagation();
  document.getElementById('exam-profile-menu').classList.toggle('show');
  document.getElementById('exam-profile-wrap').classList.toggle('open');
}

// Clicking anywhere outside the avatar menu closes it.
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('exam-profile-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('exam-profile-menu').classList.remove('show');
    wrap.classList.remove('open');
  }
});

// Opens the Edit Profile modal pre-filled with the logged-in student's
// current name/username/password.
function openEditProfile() {
  document.getElementById('exam-profile-menu').classList.remove('show');
  document.getElementById('exam-profile-wrap').classList.remove('open');
  document.getElementById('ep-name').value = loggedInStudent ? (loggedInStudent.name || '') : (currentStudent.name || '');
  document.getElementById('ep-username').value = loggedInStudent ? (loggedInStudent.username || '') : '';
  document.getElementById('ep-password').value = loggedInStudent ? (loggedInStudent.password || '') : '';
  document.getElementById('edit-profile-error').classList.remove('show');
  document.getElementById('edit-profile-modal').classList.add('show');
}

// Saves the edited name/username/password back into the authorized
// students list, and refreshes the exam header/avatar to match.
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
// Builds the answer-review screen, showing each question with the
// student's answer and the correct answer side by side.
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
// Starts the countdown timer for the exam and auto-submits when it hits zero.
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

// Updates the on-screen timer text/color as time runs low.
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
// Validates the admin login form. Checks the real (hardcoded) admin
// credentials first; if those don't match, falls back to checking the
// list of teacher accounts the Admin has created. A matching teacher
// gets a restricted dashboard limited to Results for their permitted
// courses only.
function handleAdminLogin() {
  const user = document.getElementById('admin-username').value.trim();
  const pass = document.getElementById('admin-password').value;
  const err = document.getElementById('login-error');
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    err.classList.remove('show');
    currentRole = 'admin';
    currentTeacher = null;
    loadData();
    showScreen('screen-admin');
    applyRoleUI();
    switchTab('tab-results', document.querySelector('.tab-btn'));
    return;
  }
  const teacher = findTeacher(user, pass);
  if (teacher) {
    err.classList.remove('show');
    currentRole = 'teacher';
    currentTeacher = teacher;
    loadData();
    showScreen('screen-admin');
    applyRoleUI();
    switchTab('tab-results', document.querySelector('.tab-btn'));
    return;
  }
  err.textContent = 'Incorrect username or password!';
  err.classList.add('show');
}

// Clears the admin login form, resets the role back to admin, and
// returns to the home/login screen.
function adminLogout() {
  document.getElementById('admin-username').value = '';
  document.getElementById('admin-password').value = '';
  currentRole = 'admin';
  currentTeacher = null;
  showScreen('screen-login');
}

// ===== TABS =====
// Switches between tabs in the admin dashboard (Results / Courses /
// Authorized Students / Settings) and loads that tab's data.
function switchTab(tabId, btn) {
  // A teacher account only ever gets the Results tab, no matter what —
  // this is a safety net in case an admin-only tab button is reachable.
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
// Builds the admin's exam-results table and summary stats. Results are
// grouped under their own Department heading — a course's results only
// ever show up inside that course's department group, never mixed in
// with another department's results.
// Exports whatever results are currently on screen (i.e. respecting the
// Course/Department filters — so picking one course in the filter and
// clicking Download gives just that course's results, all in one file)
// as a single downloadable CSV, opens fine in Excel/Sheets.
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

  // Leading BOM so Excel opens names with special characters correctly.
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
  // A teacher only ever sees results for the courses the Admin gave
  // them permission for — everything else is filtered out up front.
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

  // Group results by department so each department's results sit
  // together under their own heading row.
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
        <td><strong>${r.name}</strong></td>
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

// Admin action: nudges one course's time limit or per-attempt question
// count up/down directly from its card, without opening the full edit
// modal. Clamped so time can't go below 1 min and question count can't
// go below 0 (0 means "use all questions") or above the course's total.
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

// Flips one course's "Allow Retake" setting on/off directly from its
// card's toggle switch, without opening the full edit modal.
function toggleCourseRetake(courseId) {
  const c = getCourse(courseId);
  if (!c) return;
  const s = getCourseSettings(c);
  s.retake = !s.retake;
  c.settings = s;
  saveCourses();
  refreshCoursesView();
}

// Opens the confirmation modal before wiping all stored exam results.
function confirmClearAll() {
  document.getElementById('clear-modal').classList.add('show');
}

// Admin action: deletes all saved results and attempt records.
function clearAllData() {
  localStorage.removeItem(SK_RESULTS);
  localStorage.removeItem(SK_ATTEMPTED);
  fbSet('results', null);
  fbSet('attempted', null);
  closeModal('clear-modal');
  loadResultsTab();
}

// ===== COURSES: DEPARTMENT -> COURSES NAVIGATION =====
// Which department's course list is currently open (null = showing the
// top-level department list instead of one department's courses).
let activeCourseDept = null;

// Builds the HTML for a single course management card. Shared by the
// department-courses view below.
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

// Level 1: shows one "folder" card per department (with a course count).
// Clicking a department drills into just that department's courses.
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

// Level 2: shows only the courses belonging to one department.
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

// Drills into one department's course list.
function openDeptCourses(dept) {
  activeCourseDept = dept;
  document.getElementById('dept-list-view').style.display = 'none';
  document.getElementById('dept-courses-view').style.display = 'block';
  renderDeptCourses(dept);
}

// Backs out of a department's course list to the top-level department list.
function backToDeptList() {
  activeCourseDept = null;
  document.getElementById('dept-courses-view').style.display = 'none';
  document.getElementById('dept-list-view').style.display = 'block';
  renderDeptList();
}

// Re-renders whichever course view (department list, or one department's
// courses) is currently on screen. Called after any add/edit/delete so
// the admin doesn't lose their place.
function refreshCoursesView() {
  if (activeCourseDept) {
    renderDeptCourses(activeCourseDept);
  } else {
    renderDeptList();
  }
}

// Returns from the question-manager view to wherever the admin was in
// the department/courses navigation before opening it.
function backToCourses() {
  document.getElementById('view-courses').style.display = 'block';
  document.getElementById('view-questions').style.display = 'none';
  activeCourseId = null;
  refreshCoursesView();
}

// ===== COURSE CRUD =====
// Opens the course modal in "add new course" mode.
function openAddCourse() {
  editingCourseId = null;
  document.getElementById('course-modal-title').textContent = 'Add New Course';
  document.getElementById('course-modal-sub').textContent = 'Fill in the course details';
  document.getElementById('cm-name').value = '';
  document.getElementById('cm-dept').value = activeCourseDept || '';
  document.getElementById('cm-desc').value = '';
  document.getElementById('cm-icon').value = '📚';
  document.getElementById('cm-code').value = '';
  document.getElementById('cm-time').value = 20;
  document.getElementById('cm-pass').value = 50;
  document.getElementById('cm-qcount').value = 0;
  document.getElementById('cm-shuffleq').checked = true;
  document.getElementById('cm-shufflea').checked = true;
  document.getElementById('cm-retake').checked = false;
  document.getElementById('course-modal-error').classList.remove('show');
  document.getElementById('course-modal').classList.add('show');
}

// Opens the course modal pre-filled with an existing course's details.
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
  document.getElementById('cm-time').value = s.timeMins;
  document.getElementById('cm-pass').value = s.passPercent;
  document.getElementById('cm-qcount').value = s.qCount;
  document.getElementById('cm-shuffleq').checked = s.shuffleQ;
  document.getElementById('cm-shufflea').checked = s.shuffleA;
  document.getElementById('cm-retake').checked = s.retake;
  document.getElementById('course-modal-error').classList.remove('show');
  document.getElementById('course-modal').classList.add('show');
}

// Validates and saves a new or edited course, including its own unique
// access code and its own exam settings (time limit, pass %, shuffling).
function saveCourse() {
  const name = document.getElementById('cm-name').value.trim();
  const dept = document.getElementById('cm-dept').value;
  const desc = document.getElementById('cm-desc').value.trim();
  const icon = document.getElementById('cm-icon').value.trim() || '📚';
  const code = document.getElementById('cm-code').value.trim();
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
  // Course codes must be unique across all courses so one code can't
  // accidentally unlock a different course.
  const dupe = courses.find(c => c.id !== editingCourseId && c.code && c.code.toUpperCase() === code.toUpperCase());
  if (dupe) {
    err.textContent = `That course code is already used by "${dupe.name}". Please choose a different one.`;
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
    c.settings = settings;
  } else {
    courses.push({
      id: 'course_' + Date.now(),
      name,
      dept,
      desc,
      icon,
      code,
      settings,
      questions: []
    });
  }
  saveCourses();
  closeModal('course-modal');
  refreshCoursesView();
}

// Opens the confirmation modal before permanently deleting a course.
function confirmDeleteCourse(id) {
  deletingCourseId = id;
  document.getElementById('del-course-modal').classList.add('show');
}

// Admin action: removes a course and all of its questions.
function deleteCourse() {
  courses = courses.filter(c => c.id !== deletingCourseId);
  saveCourses();
  closeModal('del-course-modal');
  refreshCoursesView();
}

// Admin action: hides/unhides a course from students without deleting it.
function toggleCourseVisibility(id) {
  const c = getCourse(id);
  c.hidden = !c.hidden;
  saveCourses();
  refreshCoursesView();
}

// ===== QUESTION MANAGER =====
// Switches to the question-editing view for a specific course.
function openQuestionManager(courseId) {
  activeCourseId = courseId;
  document.getElementById('view-courses').style.display = 'none';
  document.getElementById('view-questions').style.display = 'block';
  const c = getCourse(courseId);
  document.getElementById('qpanel-course-name').textContent = c.name;
  renderQuestionList();
}

// Draws the list of questions belonging to the currently open course.
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

// Opens the question modal in "add new question" mode.
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

// Opens the question modal pre-filled with an existing question's data.
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

// Marks which multiple-choice option is the correct answer while editing.
function selectCorrect(idx) {
  pendingCorrect = idx;
  document.querySelectorAll('.correct-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.idx) === idx));
}

// Switches the question editor between multiple-choice (mcq) and True/False (tf).
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

// Marks True or False as the correct answer while editing a T/F question.
function selectTF(val) {
  pendingTFCorrect = val;
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.tf) === val));
}

// Validates and saves a new or edited question into the current course.
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

// Opens the confirmation modal before deleting a question.
function confirmDeleteQ(idx) {
  deletingQIdx = idx;
  document.getElementById('del-q-modal').classList.add('show');
}

// Admin action: removes a question from the current course.
function deleteQuestion() {
  const c = getCourse(activeCourseId);
  c.questions.splice(deletingQIdx, 1);
  saveCourses();
  closeModal('del-q-modal');
  renderQuestionList();
}

// ===== SETTINGS =====
// Populates the Settings tab inputs with the currently saved exam settings.
function loadSettingsUI() {
  document.getElementById('set-time').value = settings.timeMins || 20;
  document.getElementById('set-pass').value = settings.passPercent || 50;
  document.getElementById('set-qcount').value = settings.qCount || 0;
  document.getElementById('set-shuffle-q').checked = settings.shuffleQ !== false;
  document.getElementById('set-shuffle-a').checked = settings.shuffleA !== false;
  document.getElementById('set-api-key').value = localStorage.getItem('eq2_api_key') || '';
  document.getElementById('settings-msg').classList.remove('show');
}

// Validates and persists the exam settings (time limit, pass %, shuffling, etc.).
function saveSettings() {
  settings = {
    timeMins: parseInt(document.getElementById('set-time').value) || 20,
    passPercent: parseInt(document.getElementById('set-pass').value) || 50,
    qCount: parseInt(document.getElementById('set-qcount').value) || 0,
    shuffleQ: document.getElementById('set-shuffle-q').checked,
    shuffleA: document.getElementById('set-shuffle-a').checked,
  };
  localStorage.setItem(SK_SETTINGS, JSON.stringify(settings));
  fbSet('settings', settings);
  const apiKey = document.getElementById('set-api-key').value.trim();
  if (apiKey) localStorage.setItem('eq2_api_key', apiKey);
  const msg = document.getElementById('settings-msg');
  msg.textContent = '✅ Settings saved successfully!';
  msg.classList.add('show');
  setTimeout(() => msg.classList.remove('show'), 3000);
}

// Shows/hides the API key input's text so it isn't left visible by default.
function toggleApiKeyVisibility() {
  const input = document.getElementById('set-api-key');
  input.type = input.type === 'password' ? 'text' : 'password';
}

// ===== KEYBOARD SHORTCUTS =====
document.getElementById('admin-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleAdminLogin();
});
document.getElementById('student-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleStudentLogin();
});

// ===== PDF UPLOAD & AUTO QUESTION EXTRACTION =====

let pdfExtractedQuestions = [];

// Opens the "Upload PDF" modal used to auto-extract questions from a PDF.
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

// Closes the PDF-upload modal and resets its state for next time.
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
    // Step 1: Extract text from PDF using PDF.js
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // Preserve line structure by grouping items by Y position
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

    // Step 2: Parse questions with regex (no API needed)
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

// Parses raw text extracted from a PDF into structured question objects
// (question text + up to 4 options), using pattern matching on numbering/lettering.
function parseQuestionsFromText(text) {
  const questions = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Match question line: "1." / "1)" / "Q1." / "Question 1:"
    const qMatch = line.match(/^(?:Q(?:uestion)?\s*)?(\d+)[.\)]\s+(.+)/i);
    if (!qMatch) { i++; continue; }

    let qText = qMatch[2].trim();
    i++;

    // Collect continuation lines of question (before options start)
    while (i < lines.length &&
           !lines[i].match(/^[A-Da-d][.\)]\s/i) &&
           !lines[i].match(/^(?:Q(?:uestion)?\s*)?\d+[.\)]\s/i)) {
      const next = lines[i];
      if (next.match(/^(?:answer|ans|answer key|answers)\s*[:]/i)) break;
      if (next.match(/^(?:answer|ans)\s*[:\-]\s*[A-Da-d]\s*$/i)) break;
      qText += ' ' + next;
      i++;
    }

    // Check for True/False question
    const isTF = /true\s*(or|\/)\s*false/i.test(qText);

    if (isTF) {
      questions.push({ q: cleanQText(qText), type: 'tf', opts: ['True', 'False'], ans: -1 });
      // Skip any answer line
      if (i < lines.length && lines[i].match(/^(?:answer|ans)\s*[:\-]/i)) i++;
      continue;
    }

    // Collect options A B C D (ignore any answer markers)
    const opts = ['', '', '', ''];
    const optLetters = ['A','B','C','D'];
    let foundOpts = 0;

    while (i < lines.length && foundOpts < 4) {
      const optLine = lines[i];
      // Skip answer key lines
      if (optLine.match(/^(?:answer|ans|key)\s*[:\-]/i)) { i++; break; }
      const optMatch = optLine.match(/^([A-Da-d])[.\)]\s+(.+)/);
      if (!optMatch) break;

      const idx = optLetters.indexOf(optMatch[1].toUpperCase());
      if (idx === -1) break;

      // Strip any answer markers (* correct etc.)
      let optText = optMatch[2].replace(/\*$|\(correct\)|\[correct\]/gi, '').trim();
      i++;

      // Collect continuation of option
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

    // Skip answer key line if present
    if (i < lines.length && lines[i].match(/^(?:answer|ans|key)\s*[:\-]/i)) i++;

    if (foundOpts < 2) continue; // skip malformed

    // Fill empty opts
    for (let k = 0; k < 4; k++) if (!opts[k]) opts[k] = `Option ${optLetters[k]}`;

    questions.push({ q: cleanQText(qText), opts, ans: -1 }); // ans=-1 = not yet selected
  }

  return questions;
}

// Normalizes whitespace and stray punctuation in an extracted question string.
function cleanQText(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\?+$/, '?')
    .trim();
}


// Renders the extracted questions so the admin can pick the correct
// answer for each one before saving them into the course.
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

// Records the admin's chosen correct answer for one extracted question
// and enables the Save button once every question has an answer.
function selectPdfAns(qIdx, ansIdx) {
  pdfExtractedQuestions[qIdx].ans = ansIdx;
  const optCount = pdfExtractedQuestions[qIdx].opts.length;
  const isTF = optCount === 2;

  // Reset all buttons in this question
  for (let k = 0; k < optCount; k++) {
    const btn = document.getElementById(`pdf-ans-${qIdx}-${k}`);
    if (btn) {
      btn.style.background = 'lightgray';
      btn.style.color = '#004346';
      btn.style.borderColor = '#004346';
      btn.style.fontWeight = 'normal';
    }
  }
  // Highlight selected
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

  // Check if all answered
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

// Adds all the extracted (and now answered) questions into the active course.
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

// Updates the progress bar/status text shown while a PDF is being processed.
function setPdfProgress(pct, text) {
  document.getElementById('pdf-progress-bar').style.width = pct + '%';
  document.getElementById('pdf-status-text').textContent = text;
}

// Displays an error message in the PDF-upload modal.
function showPdfError(msg) {
  const el = document.getElementById('pdf-error');
  el.textContent = msg;
  el.classList.add('show');
}

// Hides the PDF-upload error message.
function hidePdfError() {
  const el = document.getElementById('pdf-error');
  el.textContent = '';
  el.classList.remove('show');
}

// Displays a success message in the PDF-upload modal.
function showPdfSuccess(msg) {
  const el = document.getElementById('pdf-success');
  el.textContent = msg;
  el.classList.add('show');
}

// Hides the PDF-upload success message.
function hidePdfSuccess() {
  const el = document.getElementById('pdf-success');
  el.textContent = '';
  el.classList.remove('show');
}

// Resets the "Extract Questions" button back to its default state.
function resetPdfBtn() {
  const btn = document.getElementById('pdf-extract-btn');
  btn.disabled = false;
  btn.textContent = '🔍 Extract Questions';
}

// ===== EXAM ANTI-COPY GUARD =====
// While document.body has the "exam-no-copy" class (set by showScreen()
// whenever screen-exam is active), block selecting or copying question
// text: this stops students copy/pasting a question out to search for
// the answer elsewhere. Registered once, globally, so it works no matter
// which question is currently on screen.
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
