import { CONFIG } from './config.js';
import { DOMAINS, SESSIONS, PORTFOLIO_ARTIFACTS, CAPSTONE_COMPONENTS, DOSSIER_SECTIONS, FUNDING_OPPORTUNITIES } from './curriculum.js';
import { SAMPLE_FELLOW, SAMPLE_ARTIFACTS, SAMPLE_CAPSTONE_NARRATIVE, SAMPLE_CONCEPT_NOTE, STAFF_RESOURCES } from './samplePortfolio.js';
import {
  supabaseReady, getSession, onAuthChange, signInWithGoogle, signInWithEmailOtp, signOut,
  isFacilitatorEmail, fetchMyProgress, syncProgressEvent, syncTaskNote,
  fetchAllProgressForFacilitators, fetchMyArtifacts, syncArtifact,
  fetchMessages, postMessage, updateMessage, deleteMessage, addVote, removeVote,
  fetchResources, addLinkResource, uploadFileResource, deleteResource,
  fetchSessionMaterials, upsertLinkMaterial, uploadFileMaterial, deleteSessionMaterial,
} from './supabase.js';

// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════
const STORAGE_PREFIX = 'psix2026';
const SECTION_TABS = ['prepare', 'session', 'reflect', 'portfolio', 'resources', 'discussion'];

let fellowName = '';
let currentUserId = null;
let currentUserEmail = null;
let activeView = 'dashboard';
let activeSessionId = '';
let gateStep = 'pass';     // 'pass' | 'name' | 'sync' — one gate for everyone now
let facilitatorLoaded = false;
let isFacilitatorUser = false;      // signed-in email is on the facilitator list — grants the admin toggle
let previewAsFellow = false;        // facilitator viewing the fellow shell with edit affordances hidden
let sessionMaterialsCache = {};     // { [sessionId]: { [slotKey]: materialRow } }
let sessionMaterialsLoaded = false;
let _materialTarget = null;         // { sessionId, slotKey } for the open upload modal
let _materialSelFile = null;

// ═══════════════════════════════════════════════════════
// UTIL
// ═══════════════════════════════════════════════════════
function escapeHTML(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text.trim());
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getReadingData(reading) {
  if (typeof reading === 'object') {
    return {
      title: reading.title || reading.text || 'Resource',
      url: reading.url || '',
      type: reading.type || 'Reading',
    };
  }
  const match = String(reading).match(/(https?:\/\/[^\s)]+)/);
  return {
    title: String(reading).replace(match ? match[0] : '', '').trim(),
    url: match ? match[0] : '',
    type: 'Reading',
  };
}

function icsEscape(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function formatICSDate(date) {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function downloadSessionICS(sessionId) {
  const session = SESSIONS.find(s => s.id === sessionId);
  if (!session) return;
  const monthOrder = ['jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar', 'apr', 'may', 'jun'];
  const offset = monthOrder.indexOf(sessionId);
  const now = new Date();
  const fellowshipStartYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1; // fellowship year starts July
  const calMonth = (6 + offset) % 12;
  const calYear = fellowshipStartYear + Math.floor((6 + offset) / 12);
  const start = new Date(calYear, calMonth, 15, 10, 0, 0);
  const end = new Date(start.getTime() + 90 * 60 * 1000);

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PSiX Fellowship//Fellow Journey Companion//EN',
    'BEGIN:VEVENT',
    `UID:psix-${session.id}-${calYear}@psix-fellows-curriculum`,
    `DTSTAMP:${formatICSDate(new Date())}`,
    `DTSTART:${formatICSDate(start)}`,
    `DTEND:${formatICSDate(end)}`,
    `SUMMARY:${icsEscape('PSiX Fellowship — ' + session.month + ': ' + session.title)}`,
    `DESCRIPTION:${icsEscape('Placeholder reminder — edit this event to match your program\'s actual ' + session.month + ' session date and time.\\n\\n' + session.inquiry)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `psix-${session.id}-${session.month.toLowerCase()}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════
// PROGRESS STORAGE (localStorage cache + optional Supabase sync)
// ═══════════════════════════════════════════════════════
function taskKey(sessionId, type, index) {
  return `${STORAGE_PREFIX}:${sessionId}:${type}:${index}`;
}

function isComplete(sessionId, type, index) {
  return localStorage.getItem(taskKey(sessionId, type, index)) === '1';
}

function setLocalOnly(sessionId, type, index, complete) {
  const key = taskKey(sessionId, type, index);
  if (complete) localStorage.setItem(key, '1');
  else localStorage.removeItem(key);
}

function setComplete(sessionId, type, index, complete, meta = {}) {
  setLocalOnly(sessionId, type, index, complete);
  if (currentUserId) {
    syncProgressEvent({
      userId: currentUserId,
      fellowName,
      fellowEmail: currentUserEmail,
      sessionId,
      taskType: type,
      taskIndex: index,
      taskText: meta.text || '',
      action: complete ? 'checked' : 'unchecked',
    });
  }
}

async function pullRemoteProgress() {
  if (!currentUserId) return;
  const rows = await fetchMyProgress(currentUserId);
  rows.forEach(row => {
    setLocalOnly(row.session_id, row.task_type, row.task_index, row.action === 'checked');
    // Don't clobber a local draft that hasn't synced yet.
    if (row.note && !localStorage.getItem(taskNoteKey(row.session_id, row.task_type))) {
      localStorage.setItem(taskNoteKey(row.session_id, row.task_type), row.note);
    }
  });
}

// ═══════════════════════════════════════════════════════
// TASK NOTES — informal, ungraded scratch space under the "Before/After
// the Session" tasks, so a fellow's own thinking (e.g. July's "write a
// paragraph" prep task) is actually captured somewhere, not just a
// checkbox. Same localStorage-first + optional Supabase sync pattern as
// progress checkboxes; reuses the same psix_progress_events row via its
// `note` column rather than a separate table.
// ═══════════════════════════════════════════════════════
function taskNoteKey(sessionId, type) {
  return `${STORAGE_PREFIX}:tasknote:${sessionId}:${type}`;
}

function getTaskNote(sessionId, type) {
  return localStorage.getItem(taskNoteKey(sessionId, type)) || '';
}

function saveTaskNote(sessionId, type, text, taskText) {
  localStorage.setItem(taskNoteKey(sessionId, type), text);
  if (currentUserId) {
    syncTaskNote({
      userId: currentUserId,
      fellowName,
      fellowEmail: currentUserEmail,
      sessionId,
      taskType: type,
      taskText: taskText || '',
      // Reflects current true completion state so this save can't
      // accidentally flip the checkbox — syncProgressEvent() (the checkbox
      // handler) never touches `note`, and this never touches anything
      // else's meaning for `action`.
      action: isComplete(sessionId, type, 0) ? 'checked' : 'unchecked',
      note: text,
    });
  }
}

const _taskNoteSaveTimers = {};
function handleTaskNoteInput(sessionId, type) {
  const timerKey = sessionId + ':' + type;
  const textarea = document.getElementById(`tasknote-${type}-${sessionId}`);
  const statusEl = document.getElementById(`tasknote-status-${type}-${sessionId}`);
  if (statusEl) statusEl.textContent = 'Saving…';
  clearTimeout(_taskNoteSaveTimers[timerKey]);
  _taskNoteSaveTimers[timerKey] = setTimeout(() => {
    const session = SESSIONS.find(s => s.id === sessionId);
    const taskText = session ? (type === 'before' ? session.before : session.after) : '';
    saveTaskNote(sessionId, type, textarea ? textarea.value : '', taskText);
    if (statusEl) statusEl.textContent = 'Saved';
  }, 500);
}

// Session panels are built once at init(), before a signed-in fellow's
// remotely-synced notes have been pulled in — without this, a note saved on
// another device would silently never appear in a freshly loaded textarea.
function refreshTaskNoteFields() {
  SESSIONS.forEach(s => {
    const beforeEl = document.getElementById(`tasknote-before-${s.id}`);
    if (beforeEl) beforeEl.value = getTaskNote(s.id, 'before');
    const afterEl = document.getElementById(`tasknote-after-${s.id}`);
    if (afterEl) afterEl.value = getTaskNote(s.id, 'after');
  });
}

// ═══════════════════════════════════════════════════════
// ARTIFACT DRAFTS (localStorage cache + optional Supabase sync)
// ═══════════════════════════════════════════════════════
function artifactKey(sessionId) {
  return `${STORAGE_PREFIX}:artifact:${sessionId}`;
}

function getArtifactDraft(sessionId) {
  const raw = localStorage.getItem(artifactKey(sessionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function saveArtifactDraft(sessionId, data) {
  localStorage.setItem(artifactKey(sessionId), JSON.stringify(data));
  if (currentUserId) {
    const artifact = PORTFOLIO_ARTIFACTS.find(a => a.sessionId === sessionId);
    syncArtifact({
      userId: currentUserId,
      fellowName,
      fellowEmail: currentUserEmail,
      sessionId,
      artifactLabel: artifact ? artifact.label : sessionId,
      response: JSON.stringify(data),
    });
  }
}

async function pullRemoteArtifacts() {
  if (!currentUserId) return;
  const rows = await fetchMyArtifacts(currentUserId);
  rows.forEach(row => {
    if (!localStorage.getItem(artifactKey(row.session_id)) && row.response) {
      localStorage.setItem(artifactKey(row.session_id), row.response);
    }
  });
}

// ═══════════════════════════════════════════════════════
// PORTFOLIO / RESOURCES / READINESS (ported from legacy)
// ═══════════════════════════════════════════════════════
function getPortfolioArtifact(session) {
  const artifact = PORTFOLIO_ARTIFACTS.find(item => item.sessionId === session.id);
  return artifact || {
    sessionId: session.id,
    label: `${session.month} portfolio artifact`,
    component: 'Portfolio evidence',
    purpose: 'Captures the work produced during this month.',
    prompt: session.after,
  };
}

function getArtifactStatus(artifact) {
  const session = SESSIONS.find(item => item.id === artifact.sessionId);
  if (!session) return { label: 'Pending', key: 'not-started' };
  const sessionStatus = getSessionStatus(session);
  const progress = getSessionProgress(session);
  if (sessionStatus.key === 'complete') return { label: 'Complete', key: 'complete' };
  if (sessionStatus.key === 'reflect') return { label: 'Ready to Submit', key: 'ready' };
  if (progress.complete > 0) return { label: 'In Progress', key: 'in-progress' };
  return { label: 'Not Started', key: 'not-started' };
}

function getArtifactStatusClass(status) {
  return `artifact-${status.key}`;
}

function getPortfolioStats() {
  const complete = PORTFOLIO_ARTIFACTS.filter(a => getArtifactStatus(a).key === 'complete').length;
  const ready = PORTFOLIO_ARTIFACTS.filter(a => getArtifactStatus(a).key === 'ready').length;
  return {
    complete, ready,
    total: PORTFOLIO_ARTIFACTS.length,
    percent: Math.round((complete / PORTFOLIO_ARTIFACTS.length) * 100),
  };
}

function renderArtifactCard(artifact, options = {}) {
  const session = SESSIONS.find(item => item.id === artifact.sessionId);
  const status = getArtifactStatus(artifact);
  const isActive = options.activeSessionId && artifact.sessionId === options.activeSessionId;
  return `
    <article class="artifact-card ${isActive ? 'active' : ''}">
      <div class="artifact-topline">
        <div><div class="artifact-month">${escapeHTML(session ? session.month : '')}</div></div>
        <span class="artifact-status ${getArtifactStatusClass(status)}" data-artifact-status="${escapeHTML(artifact.sessionId)}">${escapeHTML(status.label)}</span>
      </div>
      <div class="artifact-title">${escapeHTML(artifact.label)}</div>
      <div class="artifact-purpose">${escapeHTML(artifact.purpose)}</div>
      <div class="artifact-meta">
        <span class="artifact-chip">${escapeHTML(artifact.component)}</span>
        <span class="artifact-chip">${session ? escapeHTML(DOMAINS[session.domain].label) : 'Portfolio'}</span>
      </div>
      <div class="artifact-actions">
        ${session ? `<button class="artifact-action primary" onclick="goToTask('${session.id}', 'portfolio')">Open Artifact</button>` : ''}
        <span class="artifact-action pending">Submission Link Pending</span>
      </div>
    </article>
  `;
}

function renderPortfolioOverview() {
  const stats = getPortfolioStats();
  return `
    <div class="portfolio-overview">
      <div class="portfolio-overview-title">Your capstone portfolio is built one month at a time.</div>
      <div class="portfolio-overview-text">Each artifact captures a piece of your fellowship work: conceptual grounding, partnership practice, funding strategy, research design, institutional navigation, teaching, and synthesis.</div>
      <div class="portfolio-meter">
        <div class="portfolio-track"><div class="portfolio-fill" style="width:${stats.percent}%"></div></div>
        <div class="portfolio-count">${stats.complete}/${stats.total} complete</div>
      </div>
    </div>
  `;
}

function renderPortfolioGrid(options = {}) {
  return `<div class="artifact-grid">${PORTFOLIO_ARTIFACTS.map(a => renderArtifactCard(a, options)).join('')}</div>`;
}

function capstoneComponentSourceLabel(component) {
  return component.sessionIds
    .map(sid => SESSIONS.find(s => s.id === sid)?.month)
    .filter(Boolean)
    .join(', ');
}

function renderCapstoneMap() {
  return `
    <div class="capstone-map">
      ${CAPSTONE_COMPONENTS.map((c, i) => `
        <div class="capstone-row">
          <div class="capstone-num">${i + 1}</div>
          <div>
            <div class="capstone-title">${escapeHTML(c.title)}</div>
            <div class="capstone-source">${escapeHTML(capstoneComponentSourceLabel(c))}</div>
          </div>
        </div>
      `).join('')}
    </div>
    <button class="dashboard-link-button" style="margin-top:14px;" onclick="showConceptMap()">See the full map →</button>
  `;
}

const _artifactSaveTimers = {};

function collectArtifactFormData(sessionId, format) {
  if (format === 'aims') {
    const aims = [0, 1, 2].map(i => ({
      title: `Aim ${i + 1}`,
      text: document.getElementById(`artifact-aim-${i}-${sessionId}`)?.value || '',
    }));
    const note = document.getElementById(`artifact-aim-note-${sessionId}`)?.value || '';
    return { format: 'aims', aims, note };
  }
  if (format === 'timeline') {
    return {
      format: 'timeline',
      allies: document.getElementById(`artifact-allies-${sessionId}`)?.value || '',
      constraints: document.getElementById(`artifact-constraints-${sessionId}`)?.value || '',
      moves: document.getElementById(`artifact-moves-${sessionId}`)?.value || '',
    };
  }
  if (format === 'slides') {
    const slides = [0, 1, 2, 3].map(i => ({
      title: document.getElementById(`artifact-slide-title-${i}-${sessionId}`)?.value || '',
      bullets: document.getElementById(`artifact-slide-bullets-${i}-${sessionId}`)?.value || '',
    }));
    return { format: 'slides', slides };
  }
  return { format: 'text', text: document.getElementById(`artifact-text-${sessionId}`)?.value || '' };
}

function renderArtifactPreview(format, data) {
  if (format === 'aims') {
    const hasContent = data.aims.some(a => a.text.trim()) || (data.note || '').trim();
    if (!hasContent) return '';
    return renderSampleAims({ aims: data.aims, content: data.note });
  }
  if (format === 'timeline') {
    const items = [
      { when: 'Allies', label: 'Name the allies', detail: data.allies },
      { when: 'Constraints', label: 'Manage the constraint', detail: data.constraints, risk: true },
      { when: 'Near-Term', label: 'Near-term moves', detail: data.moves },
    ].filter(t => (t.detail || '').trim());
    if (!items.length) return '';
    return renderSampleTimeline({ timeline: items });
  }
  if (format === 'slides') {
    const slides = data.slides
      .map(s => ({ title: s.title, bullets: (s.bullets || '').split('\n').map(b => b.trim()).filter(Boolean) }))
      .filter(s => s.title.trim() || s.bullets.length);
    if (!slides.length) return '';
    return renderSampleSlides({ slides });
  }
  return '';
}

function handleArtifactInput(sessionId) {
  const artifact = PORTFOLIO_ARTIFACTS.find(a => a.sessionId === sessionId);
  const format = artifact?.format || 'text';
  const data = collectArtifactFormData(sessionId, format);
  const previewEl = document.getElementById('artifact-preview-' + sessionId);
  if (previewEl) previewEl.innerHTML = renderArtifactPreview(format, data);
  const statusEl = document.getElementById('artifact-status-' + sessionId);
  if (statusEl) statusEl.textContent = 'Saving…';
  clearTimeout(_artifactSaveTimers[sessionId]);
  _artifactSaveTimers[sessionId] = setTimeout(() => {
    saveArtifactDraft(sessionId, data);
    if (statusEl) statusEl.textContent = 'Saved';
  }, 500);
}

function renderTextEditor(sessionId, artifact, draft) {
  const text = draft ? draft.text : '';
  return `
    <textarea class="artifact-editor-textarea" id="artifact-text-${sessionId}"
      placeholder="Draft your ${escapeHTML(artifact.label.toLowerCase())} here…"
      oninput="handleArtifactInput('${sessionId}')">${escapeHTML(text)}</textarea>
  `;
}

function renderAimsEditor(sessionId, draft) {
  const aims = draft && draft.aims ? draft.aims : [
    { title: 'Aim 1', text: '' }, { title: 'Aim 2', text: '' }, { title: 'Aim 3', text: '' },
  ];
  const note = draft ? (draft.note || '') : '';
  return `
    <div class="artifact-editor-grid">
      ${aims.map((a, i) => `
        <div class="artifact-editor-box">
          <label class="lib-label">${escapeHTML(a.title)}</label>
          <textarea class="artifact-editor-textarea small" id="artifact-aim-${i}-${sessionId}"
            placeholder="What is Aim ${i + 1}?" oninput="handleArtifactInput('${sessionId}')">${escapeHTML(a.text)}</textarea>
        </div>
      `).join('')}
    </div>
    <label class="lib-label" style="margin-top:12px;display:block;">Claim You Most Want Feedback On</label>
    <textarea class="artifact-editor-textarea small" id="artifact-aim-note-${sessionId}"
      placeholder="What are you least sure will survive scrutiny?" oninput="handleArtifactInput('${sessionId}')">${escapeHTML(note)}</textarea>
  `;
}

function renderTimelineEditor(sessionId, draft) {
  const d = draft || {};
  const fields = [
    { key: 'allies', label: 'Allies', placeholder: 'Who is already on your side inside your institution?' },
    { key: 'constraints', label: 'Constraints', placeholder: 'What could slow this down or block it?' },
    { key: 'moves', label: 'Near-Term Moves', placeholder: 'What will you actually do in the next 4-6 weeks?' },
  ];
  return fields.map(f => `
    <label class="lib-label" style="margin-top:10px;display:block;">${escapeHTML(f.label)}</label>
    <textarea class="artifact-editor-textarea small" id="artifact-${f.key}-${sessionId}"
      placeholder="${escapeHTML(f.placeholder)}" oninput="handleArtifactInput('${sessionId}')">${escapeHTML(d[f.key] || '')}</textarea>
  `).join('');
}

function renderSlidesEditor(sessionId, draft) {
  const slides = draft && draft.slides ? draft.slides : [0, 1, 2, 3].map(() => ({ title: '', bullets: '' }));
  return `
    <div class="artifact-editor-grid">
      ${slides.map((s, i) => `
        <div class="artifact-editor-box">
          <label class="lib-label">Slide ${i + 1} Title</label>
          <input class="lib-input" id="artifact-slide-title-${i}-${sessionId}" type="text"
            value="${escapeHTML(s.title)}" placeholder="Slide ${i + 1} title" oninput="handleArtifactInput('${sessionId}')">
          <label class="lib-label" style="margin-top:8px;display:block;">Bullets (one per line)</label>
          <textarea class="artifact-editor-textarea small" id="artifact-slide-bullets-${i}-${sessionId}"
            placeholder="One idea per line" oninput="handleArtifactInput('${sessionId}')">${escapeHTML(s.bullets)}</textarea>
        </div>
      `).join('')}
    </div>
  `;
}

function renderArtifactEditor(session, artifact, draft) {
  const format = artifact.format || 'text';
  if (format === 'aims') return renderAimsEditor(session.id, draft);
  if (format === 'timeline') return renderTimelineEditor(session.id, draft);
  if (format === 'slides') return renderSlidesEditor(session.id, draft);
  return renderTextEditor(session.id, artifact, draft);
}

function renderSessionPortfolio(session) {
  const artifact = getPortfolioArtifact(session);
  const status = getArtifactStatus(artifact);
  const format = artifact.format || 'text';
  const rawDraft = getArtifactDraft(session.id);
  const draft = rawDraft && rawDraft.format === format ? rawDraft : null;
  const initialPreview = draft ? renderArtifactPreview(format, draft) : '';
  return `
    <div class="portfolio-overview">
      <div class="portfolio-overview-title">${escapeHTML(artifact.label)}</div>
      <div class="portfolio-overview-text">${escapeHTML(artifact.purpose)}</div>
      <div class="artifact-meta" style="margin-top:14px;">
        <span class="artifact-chip">${escapeHTML(artifact.component)}</span>
        <span class="artifact-status ${getArtifactStatusClass(status)}" data-artifact-status="${escapeHTML(artifact.sessionId)}">${escapeHTML(status.label)}</span>
      </div>
    </div>
    <section class="resource-section">
      <div class="resource-section-header">
        <div class="resource-section-title">Draft Your Artifact</div>
        <div class="resource-section-note" id="artifact-status-${session.id}">Autosaves as you type</div>
      </div>
      <div class="portfolio-overview-text" style="margin-bottom:14px;">${escapeHTML(artifact.prompt)}</div>
      ${renderArtifactEditor(session, artifact, draft)}
      <div class="artifact-preview" id="artifact-preview-${session.id}">${initialPreview}</div>
    </section>
    <section class="resource-section">
      <div class="resource-section-header">
        <div class="resource-section-title">Capstone Contribution</div>
        <div class="resource-section-note">How this month carries forward</div>
      </div>
      ${renderCapstoneMap()}
    </section>
  `;
}

function materialFor(sessionId, slotKey) {
  return (sessionMaterialsCache[sessionId] || {})[slotKey];
}

function withMaterial(session, base) {
  const mat = materialFor(session.id, base.slotKey);
  if (mat) return { ...base, status: 'Available', url: mat.url };
  return { ...base, status: 'Pending', url: '' };
}

function getResourceGroups(session) {
  const readings = session.readings.map((r, i) => {
    const data = getReadingData(r);
    const slotKey = `reading-${i}`;
    if (data.url) return { title: data.title, type: data.type, status: 'Available', url: data.url, audience: 'Fellows', slotKey, editable: false };
    return withMaterial(session, { title: data.title, type: data.type, audience: 'Fellows', slotKey, editable: true });
  });
  return [
    { title: 'Core Readings', note: 'Complete before the session', items: readings },
    {
      title: 'Session Materials', note: 'For live work together',
      items: [
        withMaterial(session, { title: `${session.month} session slide deck`, type: 'Slides', audience: 'Fellows', slotKey: 'material-slides', editable: true }),
        withMaterial(session, { title: `${session.month} working worksheet`, type: 'Worksheet', audience: 'Fellows', slotKey: 'material-worksheet', editable: true }),
        withMaterial(session, { title: 'Session agenda and activity flow', type: 'Agenda', audience: 'Fellows', slotKey: 'material-agenda', editable: true }),
      ],
    },
    {
      title: 'Submit or Share', note: 'Where the month becomes evidence',
      items: [
        withMaterial(session, { title: getPortfolioArtifact(session).label, type: 'Artifact', audience: 'Fellows', slotKey: 'submit-artifact', editable: true }),
        withMaterial(session, { title: `${session.month} reflection post`, type: 'Forum', audience: 'Cohort', slotKey: 'submit-reflection', editable: true }),
        withMaterial(session, { title: 'Mentor submission folder', type: 'Submission', audience: 'Mentor', slotKey: 'submit-mentor-folder', editable: true }),
      ],
    },
    {
      title: 'Mentor and Support', note: 'Use when you need feedback or orientation',
      items: [
        withMaterial(session, { title: 'Mentor check-in notes', type: 'Mentor', audience: 'Private', slotKey: 'mentor-notes', editable: true }),
        withMaterial(session, { title: 'Office hours and support channel', type: 'Support', audience: 'Fellows', slotKey: 'mentor-officehours', editable: true }),
      ],
    },
    {
      title: 'Optional Deeper Dives', note: 'For fellows who want more',
      items: [
        withMaterial(session, { title: `Additional ${DOMAINS[session.domain].label.toLowerCase()} resources`, type: 'Optional', audience: 'Optional', slotKey: 'optional-resources', editable: true }),
      ],
    },
  ];
}

function renderResourceAction(item, sessionId) {
  const openLink = item.url
    ? `<a class="resource-action" href="${escapeHTML(item.url)}" target="_blank" rel="noopener">Open</a>`
    : '<span class="resource-action pending">Pending</span>';
  const showEdit = isFacilitatorUser && !previewAsFellow && item.editable !== false;
  if (!showEdit) return openLink;
  const editLabel = item.url ? 'Replace' : '+ Add';
  const editBtn = `<button class="resource-action-edit" onclick="openMaterialModal('${sessionId}','${item.slotKey}','${escapeHTML(item.title)}')">${editLabel}</button>`;
  return `<div class="resource-action-group">${openLink}${editBtn}</div>`;
}

function renderResourceGroups(session) {
  return getResourceGroups(session).map(group => `
    <section class="resource-section">
      <div class="resource-section-header">
        <div class="resource-section-title">${escapeHTML(group.title)}</div>
        <div class="resource-section-note">${escapeHTML(group.note)}</div>
      </div>
      <div class="resource-list">
        ${group.items.map(item => `
          <div class="resource-item">
            <div class="resource-item-main">
              <div class="resource-item-title">${escapeHTML(item.title)}</div>
              <div class="resource-item-meta">
                <span class="resource-chip">${escapeHTML(item.type)}</span>
                <span class="resource-chip">${escapeHTML(item.status)}</span>
                <span class="resource-chip">${escapeHTML(item.audience)}</span>
              </div>
            </div>
            ${renderResourceAction(item, session.id)}
          </div>
        `).join('')}
      </div>
    </section>
  `).join('');
}

function refreshResourceGroups(sessionId) {
  const session = SESSIONS.find(s => s.id === sessionId);
  const el = document.getElementById('resource-groups-' + sessionId);
  if (!session || !el) return;
  el.innerHTML = renderResourceGroups(session);
}

async function loadSessionMaterials(force) {
  if (sessionMaterialsLoaded && !force) return;
  sessionMaterialsLoaded = true;
  const rows = await fetchSessionMaterials();
  sessionMaterialsCache = {};
  rows.forEach(row => {
    if (!sessionMaterialsCache[row.session_id]) sessionMaterialsCache[row.session_id] = {};
    sessionMaterialsCache[row.session_id][row.slot_key] = row;
  });
}

// ═══════════════════════════════════════════════════════
// SESSION MATERIAL UPLOAD MODAL (facilitator only)
// ═══════════════════════════════════════════════════════
function openMaterialModal(sessionId, slotKey, defaultTitle) {
  const session = SESSIONS.find(s => s.id === sessionId);
  const existing = materialFor(sessionId, slotKey);
  _materialTarget = { sessionId, slotKey };
  _materialSelFile = null;

  const titleEl = document.getElementById('material-modal-title');
  const subEl = document.getElementById('material-modal-sub');
  if (titleEl) titleEl.textContent = existing ? 'Replace Material' : 'Add Material';
  if (subEl) subEl.textContent = `${session ? session.month : ''} — ${defaultTitle}`;

  const urlInput = document.getElementById('material-url');
  const linkTitleInput = document.getElementById('material-link-title');
  const fileTitleInput = document.getElementById('material-file-title');
  if (urlInput) urlInput.value = existing && existing.type === 'link' ? existing.url : '';
  if (linkTitleInput) linkTitleInput.value = existing ? existing.title : defaultTitle;
  if (fileTitleInput) fileTitleInput.value = existing ? existing.title : defaultTitle;
  const linkErr = document.getElementById('material-link-error');
  const fileErr = document.getElementById('material-file-error');
  if (linkErr) linkErr.textContent = '';
  if (fileErr) fileErr.textContent = '';

  clearMaterialFile();
  setMaterialType('link');

  const footer = document.getElementById('material-modal-footer');
  if (footer) footer.style.display = existing ? 'block' : 'none';

  const overlay = document.getElementById('material-modal-overlay');
  if (overlay) overlay.style.display = 'flex';
}

function closeMaterialModal() {
  const overlay = document.getElementById('material-modal-overlay');
  if (overlay) overlay.style.display = 'none';
  _materialTarget = null;
}

function setMaterialType(type) {
  const isFile = type === 'file';
  document.getElementById('material-type-link')?.classList.toggle('active', !isFile);
  document.getElementById('material-type-file')?.classList.toggle('active', isFile);
  const linkForm = document.getElementById('material-link-form');
  const fileForm = document.getElementById('material-file-form');
  if (linkForm) linkForm.style.display = isFile ? 'none' : 'block';
  if (fileForm) fileForm.style.display = isFile ? 'block' : 'none';
}

function handleMaterialDrop(event) {
  event.preventDefault();
  event.currentTarget.classList.remove('dragging');
  const file = event.dataTransfer.files[0];
  if (file) setMaterialFile(file);
}

function handleMaterialFileSelect(file) {
  if (file) setMaterialFile(file);
}

function setMaterialFile(file) {
  if (file.size > 20 * 1024 * 1024) {
    alert('That file is over 20 MB. Please upload a smaller file, or share a link instead.');
    return;
  }
  _materialSelFile = file;
  const selectedEl = document.getElementById('material-file-selected');
  const nameEl = document.getElementById('material-file-name-display');
  const dropZone = document.getElementById('material-drop-zone');
  if (selectedEl) selectedEl.style.display = 'flex';
  if (nameEl) nameEl.textContent = `${file.name} (${formatFileSize(file.size)})`;
  if (dropZone) dropZone.style.display = 'none';
  const titleEl = document.getElementById('material-file-title');
  if (titleEl && !titleEl.value) titleEl.value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
}

function clearMaterialFile() {
  _materialSelFile = null;
  const selectedEl = document.getElementById('material-file-selected');
  const dropZone = document.getElementById('material-drop-zone');
  if (selectedEl) selectedEl.style.display = 'none';
  if (dropZone) dropZone.style.display = 'block';
  const inp = document.getElementById('material-file-input');
  if (inp) inp.value = '';
}

async function submitMaterialLink() {
  if (!_materialTarget) return;
  const url = (document.getElementById('material-url')?.value || '').trim();
  const title = (document.getElementById('material-link-title')?.value || '').trim();
  const errEl = document.getElementById('material-link-error');
  if (!url) { if (errEl) errEl.textContent = 'Please enter a URL.'; return; }
  if (!title) { if (errEl) errEl.textContent = 'Please enter a title.'; return; }
  if (errEl) errEl.textContent = '';

  const btn = document.getElementById('material-link-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const target = _materialTarget;
  try {
    await upsertLinkMaterial({
      sessionId: target.sessionId, slotKey: target.slotKey, title, url,
      email: currentUserEmail, name: fellowName || currentUserEmail || 'Facilitator',
    });
    await loadSessionMaterials(true);
    refreshResourceGroups(target.sessionId);
    closeMaterialModal();
  } catch (err) {
    if (errEl) errEl.textContent = 'Could not save: ' + (err.message || 'please try again.');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
}

async function submitMaterialFile() {
  if (!_materialTarget) return;
  const errEl = document.getElementById('material-file-error');
  if (!_materialSelFile) { if (errEl) errEl.textContent = 'Please select a file first.'; return; }
  const title = (document.getElementById('material-file-title')?.value || '').trim();
  if (!title) { if (errEl) errEl.textContent = 'Please enter a title.'; return; }
  if (errEl) errEl.textContent = '';

  const btn = document.getElementById('material-file-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }
  const target = _materialTarget;
  try {
    await uploadFileMaterial({
      sessionId: target.sessionId, slotKey: target.slotKey, title, file: _materialSelFile,
      email: currentUserEmail, name: fellowName || currentUserEmail || 'Facilitator',
    });
    await loadSessionMaterials(true);
    refreshResourceGroups(target.sessionId);
    closeMaterialModal();
  } catch (err) {
    if (errEl) errEl.textContent = 'Upload failed: ' + (err.message || 'please try again.');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Upload'; }
}

async function removeMaterial() {
  if (!_materialTarget) return;
  if (!confirm('Revert this item to Pending?')) return;
  const target = _materialTarget;
  const existing = materialFor(target.sessionId, target.slotKey);
  try {
    await deleteSessionMaterial({
      sessionId: target.sessionId, slotKey: target.slotKey,
      url: existing?.url, type: existing?.type,
    });
    await loadSessionMaterials(true);
    refreshResourceGroups(target.sessionId);
    closeMaterialModal();
  } catch (err) {
    alert('Could not remove — please try again.');
  }
}

// ═══════════════════════════════════════════════════════
// FACILITATOR PREVIEW TOOLBAR (shown when browsing the fellow shell as a facilitator)
// ═══════════════════════════════════════════════════════
function updateFacilitatorToolbar() {
  const bar = document.getElementById('facToolbar');
  if (!bar) return;
  bar.style.display = isFacilitatorUser ? 'flex' : 'none';
  document.body.classList.toggle('fac-toolbar-active', isFacilitatorUser);
  const btn = document.getElementById('facToolbarPreviewBtn');
  if (btn) {
    btn.textContent = previewAsFellow
      ? '👁 Viewing as: Fellow — click to resume editing'
      : '🔧 Viewing as: Facilitator — editing live';
    btn.classList.toggle('previewing', previewAsFellow);
  }
}

function toggleFacilitatorPreview() {
  previewAsFellow = !previewAsFellow;
  updateFacilitatorToolbar();
  SESSIONS.forEach(s => refreshResourceGroups(s.id));
}

function browseFellowContent() {
  previewAsFellow = false;
  setRoute('dashboard');
}

function backToFacilitatorDashboard() {
  setRoute('facilitator');
}

function getSessionTasks(session) {
  return [
    { type: 'before', index: 0, tab: 'prepare', label: 'Finish the preparation task', text: session.before },
    ...session.readings.map((r, i) => ({ type: 'reading', index: i, tab: 'prepare', label: 'Complete assigned reading', text: getReadingData(r).title })),
    ...session.goals.map((g, i) => ({ type: 'goal', index: i, tab: 'session', label: 'Review learning goal', text: g })),
    { type: 'after', index: 0, tab: 'reflect', label: 'Complete the reflection task', text: session.after },
  ];
}

function getSessionProgress(session) {
  const tasks = getSessionTasks(session);
  const complete = tasks.filter(t => isComplete(session.id, t.type, t.index)).length;
  return { complete, total: tasks.length, percent: Math.round((complete / tasks.length) * 100) };
}

function getReadinessItems(session) {
  const readingsDone = session.readings.every((r, i) => isComplete(session.id, 'reading', i));
  const goalsDone = session.goals.every((g, i) => isComplete(session.id, 'goal', i));
  const beforeDone = isComplete(session.id, 'before', 0);
  const afterDone = isComplete(session.id, 'after', 0);
  const artifact = getPortfolioArtifact(session);
  const artifactStatus = getArtifactStatus(artifact);
  return [
    { kind: 'Do', title: 'Complete the preparation task', detail: session.before, done: beforeDone, ready: false, actionTab: 'prepare' },
    { kind: 'Read', title: `Finish ${session.readings.length} assigned reading${session.readings.length === 1 ? '' : 's'}`, detail: session.readings.map(r => getReadingData(r).title).join('; '), done: readingsDone, ready: beforeDone && !readingsDone, actionTab: 'prepare' },
    { kind: 'Bring', title: artifact.label, detail: artifact.prompt, done: artifactStatus.key === 'complete', ready: beforeDone && readingsDone && artifactStatus.key !== 'complete', actionTab: 'portfolio' },
    { kind: 'Join', title: 'Come ready for the live session', detail: `${session.goals.length} learning goals and ${session.activities.length} planned activities anchor this month.`, done: goalsDone, ready: beforeDone && readingsDone && !goalsDone, actionTab: 'session' },
    { kind: 'Submit', title: 'Complete the reflection task', detail: session.after, done: afterDone, ready: goalsDone && !afterDone, actionTab: 'reflect' },
  ];
}

function getReadinessProgress(session) {
  const items = getReadinessItems(session);
  const complete = items.filter(i => i.done).length;
  return { complete, total: items.length, percent: Math.round((complete / items.length) * 100) };
}

function renderReadinessChecklist(session) {
  const progress = getReadinessProgress(session);
  return `
    <div class="readiness-panel">
      <div class="readiness-panel-title">Session readiness</div>
      <div class="readiness-panel-text">Use this as the quick check before ${escapeHTML(session.month)}. It separates what to do, what to read, what to bring, and what to submit after the session.</div>
      <div class="readiness-progress">
        <div class="readiness-track"><div class="readiness-fill" style="width:${progress.percent}%"></div></div>
        <div class="readiness-count">${progress.complete}/${progress.total} ready</div>
      </div>
      <div class="readiness-checklist">
        ${getReadinessItems(session).map((item, index) => `
          <div class="readiness-check ${item.done ? 'done' : item.ready ? 'ready' : ''}" data-readiness-session="${session.id}" data-readiness-index="${index}">
            <div class="readiness-kind">${escapeHTML(item.kind)}</div>
            <div class="readiness-mark">${item.done ? '✓' : item.ready ? '•' : ''}</div>
            <div>
              <div class="readiness-check-title">${escapeHTML(item.title)}</div>
              <div class="readiness-check-detail">${escapeHTML(item.detail)}</div>
              <span class="readiness-check-status">${item.done ? 'Done' : item.ready ? 'Ready' : 'Waiting'}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function getOverallProgress() {
  let complete = 0, total = 0;
  SESSIONS.forEach(session => {
    const p = getSessionProgress(session);
    complete += p.complete;
    total += p.total;
  });
  return { complete, total, percent: total ? Math.round((complete / total) * 100) : 0 };
}

function getNextAction(session) {
  return getSessionTasks(session).find(t => !isComplete(session.id, t.type, t.index));
}

function getFocusSession() {
  return SESSIONS.find(s => getSessionStatus(s).key !== 'complete') || SESSIONS[SESSIONS.length - 1];
}

function getSessionStatus(session) {
  const prepTasks = getSessionTasks(session).filter(t => t.tab === 'prepare' || t.tab === 'resources');
  const prepDone = prepTasks.every(t => isComplete(session.id, t.type, t.index));
  const afterDone = isComplete(session.id, 'after', 0);
  const progress = getSessionProgress(session);
  const goalsDone = session.goals.every((g, i) => isComplete(session.id, 'goal', i));
  if (afterDone || progress.complete === progress.total) {
    return { label: 'Complete', key: 'complete', summary: 'This month is wrapped. You can return to it anytime as part of your portfolio thread.' };
  }
  if (goalsDone) {
    return { label: 'Reflection Due', key: 'reflect', summary: 'The session work has moved into synthesis. Finish the reflection so the month can close cleanly.' };
  }
  if (prepDone) {
    return { label: 'Ready for Session', key: 'ready', summary: 'The preparation work is complete. You are ready to participate in the live session.' };
  }
  if (progress.complete > 0) {
    return { label: 'Preparing', key: 'preparing', summary: 'You have started the month. Keep moving through preparation and readings before the session.' };
  }
  return { label: 'Not Started', key: 'not-started', summary: 'This month is waiting for you. Begin with the preparation task and assigned readings.' };
}

function getStatusClass(status) {
  return `status-${status.key}`;
}

// ═══════════════════════════════════════════════════════
// ROUTING
// ═══════════════════════════════════════════════════════
function parseRoute() {
  const hash = (window.location.hash || '#dashboard').replace(/^#/, '');
  if (!hash || hash === 'dashboard') return { view: 'dashboard' };
  if (hash === 'facilitator') return { view: 'facilitator' };
  const secondary = SECONDARY_VIEWS.find(v => v.hash === hash);
  if (secondary) return { view: secondary.key };
  const parts = hash.split('-');
  const sessionId = parts[0];
  const section = parts.slice(1).join('-') || 'overview';
  const session = SESSIONS.find(item => item.id === sessionId);
  if (!session) return { view: 'dashboard' };
  return { view: 'session', sessionId, section: SECTION_TABS.includes(section) ? section : 'overview' };
}

function setRoute(hash) {
  const cleanHash = hash.replace(/^#/, '');
  if (window.location.hash === '#' + cleanHash) {
    routeFromHash({ behavior: 'smooth' });
  } else {
    window.location.hash = cleanHash;
  }
}

function goToTask(sessionId, tab) {
  setRoute(`${sessionId}-${tab}`);
}

function showSession(id) {
  setRoute(id);
}

function showDashboard() {
  setRoute('dashboard');
}

function showSecondaryView(key) {
  const view = SECONDARY_VIEWS.find(v => v.key === key);
  if (view) setRoute(view.hash);
}

function showLibrary() { showSecondaryView('library'); }
function showConceptMap() { showSecondaryView('conceptmap'); }
function showSamplePortfolio() { showSecondaryView('sampleportfolio'); }
function showCvDossier() { showSecondaryView('cvdossier'); }
function showFunding() { showSecondaryView('funding'); }

function scrollToRoute(route, behavior = 'smooth') {
  let target = null;
  if (route.view === 'dashboard') target = document.getElementById('dashboardPanel');
  else if (route.view === 'facilitator') target = null;
  else if (SECONDARY_VIEWS.some(v => v.key === route.view)) {
    target = document.getElementById(SECONDARY_VIEWS.find(v => v.key === route.view).panelId);
  }
  else if (route.section === 'overview') target = document.getElementById('panel-' + route.sessionId);
  else target = document.getElementById(`${route.sessionId}-${route.section}`);
  if (target) {
    target.scrollIntoView({ behavior, block: 'start' });
    return;
  }
  const main = document.querySelector('.main');
  if (main) main.scrollTo({ top: 0, behavior });
  window.scrollTo({ top: 0, behavior });
}

function routeFromHash(options = {}) {
  const route = parseRoute();
  const behavior = options.behavior || 'smooth';
  if (route.view === 'facilitator') {
    if (!isFacilitatorUser) {
      history.replaceState(null, '', '#dashboard');
      applyFellowShell();
      applyDashboardView();
      updateProgressUI();
      return;
    }
    applyFacilitatorView();
    return;
  }
  applyFellowShell();
  if (route.view === 'dashboard') {
    applyDashboardView();
  } else if (SECONDARY_VIEWS.some(v => v.key === route.view)) {
    applySecondaryView(route.view);
  } else {
    applySessionView(route.sessionId, route.section);
  }
  updateProgressUI();
  requestAnimationFrame(() => scrollToRoute(route, behavior));
  setTimeout(() => scrollToRoute(route, behavior), 120);
}

// ═══════════════════════════════════════════════════════
// FELLOW SHELL RENDER
// ═══════════════════════════════════════════════════════
function applyFellowShell() {
  const fellowShell = document.getElementById('fellowShell');
  const facilitatorShell = document.getElementById('facilitatorShell');
  if (fellowShell) fellowShell.classList.add('active');
  if (facilitatorShell) facilitatorShell.classList.remove('active');
  updateFacilitatorToolbar();
}

// Each secondary (non-session, non-dashboard) view registers itself here:
// key = route.view value, hash = URL hash, panelId/btnId = DOM ids,
// topbar = topbar label, build = the function that (re)renders the panel.
// All library-family views share btnId 'libraryNavBtn' so the sidebar keeps
// "Resource Library" highlighted while browsing any of its sub-pages.
const SECONDARY_VIEWS = [
  { key: 'library', hash: 'library', panelId: 'libraryHubPanel', btnId: 'libraryNavBtn', topbar: 'Resource Library', build: () => buildLibraryHubPanel() },
  { key: 'libraryresources', hash: 'library-resources', panelId: 'libraryResourcesPanel', btnId: 'libraryNavBtn', topbar: 'Community Resources', build: () => buildLibraryResourcesPanel() },
  { key: 'funding', hash: 'library-funding', panelId: 'fundingPanel', btnId: 'libraryNavBtn', topbar: 'Funding Opportunities', build: () => buildFundingPanel() },
  { key: 'cvdossier', hash: 'library-cv', panelId: 'cvDossierPanel', btnId: 'libraryNavBtn', topbar: 'CV & Dossier Tools', build: () => buildCvDossierPanel() },
  { key: 'artifactguide', hash: 'library-artifact-guide', panelId: 'artifactGuidePanel', btnId: 'libraryNavBtn', topbar: 'Artifact Guide', build: () => buildArtifactGuidePanel() },
  { key: 'conceptmap', hash: 'library-concept-map', panelId: 'conceptMapPanel', btnId: 'libraryNavBtn', topbar: 'How Your Portfolio Comes Together', build: () => buildConceptMapPanel() },
  { key: 'sampleportfolio', hash: 'library-sample-portfolio', panelId: 'samplePortfolioPanel', btnId: 'libraryNavBtn', topbar: 'Sample Portfolio (Illustrative)', build: () => buildSamplePortfolioPanel() },
  { key: 'myportfolio', hash: 'library-my-portfolio', panelId: 'myPortfolioPanel', btnId: 'libraryNavBtn', topbar: 'My Portfolio', build: () => buildMyPortfolioPanel() },
  { key: 'sampleconceptnote', hash: 'library-sample-concept-note', panelId: 'sampleConceptNotePanel', btnId: 'libraryNavBtn', topbar: 'Sample Concept Note (Illustrative)', build: () => buildSampleConceptNotePanel() },
];

function resetAllPanels() {
  document.getElementById('dashboardPanel')?.classList.remove('active');
  document.getElementById('dashboardNavBtn')?.classList.remove('active');
  SECONDARY_VIEWS.forEach(({ panelId, btnId }) => {
    document.getElementById(panelId)?.classList.remove('active');
    document.getElementById(btnId)?.classList.remove('active');
  });
  document.querySelectorAll('.session-panel').forEach(panel => panel.classList.remove('active'));
  document.querySelectorAll('.month-btn').forEach(btn => btn.classList.remove('active'));
}

function applyDashboardView() {
  activeView = 'dashboard';
  activeSessionId = '';
  resetAllPanels();
  document.getElementById('dashboardPanel')?.classList.add('active');
  document.getElementById('dashboardNavBtn')?.classList.add('active');
  const topbar = document.getElementById('topbarSession');
  if (topbar) topbar.textContent = 'Dashboard';
}

function applySecondaryView(key) {
  const view = SECONDARY_VIEWS.find(v => v.key === key);
  if (!view) return;
  activeView = key;
  activeSessionId = '';
  resetAllPanels();
  document.getElementById(view.panelId)?.classList.add('active');
  document.getElementById(view.btnId)?.classList.add('active');
  const topbar = document.getElementById('topbarSession');
  if (topbar) topbar.textContent = view.topbar;
  view.build();
}

function updateSectionNav(sessionId, section) {
  const panel = document.getElementById('panel-' + sessionId);
  if (!panel) return;
  const activeSection = SECTION_TABS.includes(section) ? section : 'prepare';
  panel.querySelectorAll('.tab-btn').forEach(link => link.classList.toggle('active', link.dataset.tab === activeSection));
  panel.querySelectorAll('.tab-pane').forEach(pane => pane.classList.toggle('active', pane.dataset.section === activeSection));
  if (activeSection === 'discussion') loadSessionDiscussion(sessionId);
  if (activeSection === 'resources') loadSessionResources(sessionId);
}

function applySessionView(sessionId, section = 'overview') {
  activeView = 'session';
  activeSessionId = sessionId;
  resetAllPanels();
  const target = document.getElementById('panel-' + sessionId);
  if (target) target.classList.add('active');
  document.querySelectorAll('.month-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.id === sessionId));
  const session = SESSIONS.find(item => item.id === sessionId);
  const topbar = document.getElementById('topbarSession');
  if (session && topbar) topbar.textContent = session.month + ' — ' + session.title;
  updateSectionNav(sessionId, section);
}

function buildDashboard() {
  const dashboard = document.getElementById('dashboardPanel');
  if (!dashboard) return;
  const focus = getFocusSession();
  const focusProgress = getSessionProgress(focus);
  const focusStatus = getSessionStatus(focus);
  const nextAction = getNextAction(focus);
  const focusReadings = focus.readings.slice(0, 3).map(getReadingData);
  const portfolioStats = getPortfolioStats();

  dashboard.innerHTML = `
    <div class="dashboard-hero">
      <div>
        <div class="dashboard-eyebrow">Fellowship Home</div>
        <div class="dashboard-title">Welcome back${fellowName ? ', ' + escapeHTML(fellowName.split(' ')[0]) : ''}.</div>
        <div class="dashboard-subtitle">Your current focus is <strong>${escapeHTML(focus.month)}</strong>. Prepare for the session, keep track of your readings and reflections, and let the year build toward your capstone portfolio.</div>
      </div>
      <div class="dashboard-meter-card">
        <div class="dashboard-meter-count" id="dashboardMeterCount">0%</div>
        <div class="dashboard-meter-label">Year Complete</div>
        <div class="dashboard-track"><div class="dashboard-fill" id="dashboardFill"></div></div>
      </div>
    </div>
    <div class="dashboard-grid">
      <div>
        <div class="dashboard-card">
          <div class="dashboard-card-header">
            <div class="dashboard-card-title">Current Focus</div>
            <div class="dashboard-card-note">${focusProgress.complete} of ${focusProgress.total} complete</div>
          </div>
          <div class="focus-meta">
            <span class="focus-pill">${escapeHTML(focus.month)}</span>
            <span class="focus-pill">${escapeHTML(DOMAINS[focus.domain].label)}</span>
            <span class="status-pill ${getStatusClass(focusStatus)}">${escapeHTML(focusStatus.label)}</span>
          </div>
          <div class="focus-title">${escapeHTML(focus.title)}</div>
          <div class="status-summary">${escapeHTML(focusStatus.summary)}</div>
          <div class="focus-inquiry">${escapeHTML(focus.inquiry)}</div>
          <div class="dashboard-actions">
            <button class="dashboard-action" onclick="goToTask('${focus.id}', '${nextAction ? nextAction.tab : 'reflect'}')">${nextAction ? 'Continue' : 'Review Month'}</button>
            <button class="dashboard-action secondary" onclick="showSession('${focus.id}')">Open Full Session</button>
          </div>
        </div>
        <div class="dashboard-card">
          <div class="dashboard-card-header">
            <div class="dashboard-card-title">Month Status</div>
            <div class="dashboard-card-note">Year at a glance</div>
          </div>
          <div class="month-status-grid" role="img" aria-label="Completion percentage for each month of the fellowship year">
            ${SESSIONS.map(session => {
              const status = getSessionStatus(session);
              const progress = getSessionProgress(session);
              const domain = DOMAINS[session.domain];
              return `
                <div class="month-status-row" role="button" tabindex="0"
                  aria-label="${escapeHTML(session.month)}: ${escapeHTML(session.title)}, ${progress.complete} of ${progress.total} complete, ${status.label}"
                  title="${progress.complete}/${progress.total} complete (${progress.percent}%)"
                  onclick="showSession('${session.id}')" onkeydown="if(event.key==='Enter')showSession('${session.id}')">
                  <div class="month-status-name">
                    <span class="month-status-dot" style="background:${domain.color}"></span>${escapeHTML(session.month)}
                  </div>
                  <div class="month-status-title">${escapeHTML(session.title)}${session.inPerson ? ' <span class="month-status-inperson-tag">· In-Person</span>' : ''}</div>
                  <div class="month-status-track"><div class="month-status-fill" style="width:${progress.percent}%"></div></div>
                  <span class="status-pill ${getStatusClass(status)}">${escapeHTML(status.label)}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
        <div class="dashboard-card">
          <div class="dashboard-card-header">
            <div class="dashboard-card-title">Portfolio Thread</div>
            <div class="dashboard-card-note">${portfolioStats.complete}/${portfolioStats.total} complete</div>
          </div>
          ${renderPortfolioOverview()}
          ${renderPortfolioGrid({ activeSessionId: focus.id })}
        </div>
      </div>
      <div>
        <div class="dashboard-card">
          <div class="dashboard-card-header"><div class="dashboard-card-title">Quick Access</div></div>
          <div class="quick-link-list">
            <div class="quick-link-item"><div class="quick-link-dot"></div><button class="dashboard-link-button" onclick="goToTask('${focus.id}', 'prepare')">Preparation and readings</button></div>
            <div class="quick-link-item"><div class="quick-link-dot"></div><button class="dashboard-link-button" onclick="goToTask('${focus.id}', 'reflect')">Reflection prompts</button></div>
            ${focusReadings.map(reading => `
              <div class="quick-link-item"><div class="quick-link-dot"></div><div>${escapeHTML(reading.title)}</div></div>
            `).join('')}
          </div>
        </div>
        <div class="dashboard-card">
          <div class="dashboard-card-header">
            <div class="dashboard-card-title">Capstone Assembly</div>
            <div class="dashboard-card-note">Where artifacts lead</div>
          </div>
          ${renderCapstoneMap()}
        </div>
      </div>
    </div>
  `;
}

function updateDashboard() {
  if (!document.getElementById('dashboardPanel')) return;
  buildDashboard();
  const overall = getOverallProgress();
  const fill = document.getElementById('dashboardFill');
  const count = document.getElementById('dashboardMeterCount');
  if (fill) fill.style.width = overall.percent + '%';
  if (count) count.textContent = overall.percent + '%';
}

function updateProgressUI() {
  const overall = getOverallProgress();
  const sidebarFill = document.getElementById('sidebarProgressFill');
  const sidebarText = document.getElementById('sidebarProgressText');
  if (sidebarFill) sidebarFill.style.width = overall.percent + '%';
  if (sidebarText) sidebarText.textContent = overall.percent + '%';
  updateDashboard();

  SESSIONS.forEach(session => {
    const progress = getSessionProgress(session);
    const status = getSessionStatus(session);
    const navBtn = document.querySelector(`.month-btn[data-id="${session.id}"]`);
    if (navBtn) {
      navBtn.classList.toggle('complete', status.key === 'complete');
      navBtn.classList.remove('month-status-not-started', 'month-status-preparing', 'month-status-ready', 'month-status-reflect', 'month-status-complete');
      navBtn.classList.add(`month-status-${status.key}`);
      const navProgress = navBtn.querySelector('.month-progress');
      if (navProgress) navProgress.textContent = `${progress.complete}/${progress.total}`;
      const navStatus = navBtn.querySelector('.month-status');
      if (navStatus) navStatus.textContent = status.label;
    }

    const panel = document.getElementById('panel-' + session.id);
    if (!panel) return;
    const fill = panel.querySelector('.session-progress-fill');
    const text = panel.querySelector('.session-progress-text');
    const statusPill = panel.querySelector('.session-status-pill');
    const statusText = panel.querySelector('.session-status-text');
    if (fill) fill.style.width = progress.percent + '%';
    if (text) text.textContent = `${progress.complete} of ${progress.total} complete`;
    if (statusPill) {
      statusPill.className = `session-status-pill status-pill ${getStatusClass(status)}`;
      statusPill.textContent = status.label;
    }
    if (statusText) statusText.textContent = status.summary;

    const readinessProgress = getReadinessProgress(session);
    panel.querySelectorAll('.readiness-fill').forEach(el => { el.style.width = readinessProgress.percent + '%'; });
    panel.querySelectorAll('.readiness-count').forEach(el => { el.textContent = `${readinessProgress.complete}/${readinessProgress.total} ready`; });
    getReadinessItems(session).forEach((item, index) => {
      panel.querySelectorAll(`[data-readiness-session="${session.id}"][data-readiness-index="${index}"]`).forEach(el => {
        el.classList.toggle('done', item.done);
        el.classList.toggle('ready', !item.done && item.ready);
        const mark = el.querySelector('.readiness-mark');
        const statusLabel = el.querySelector('.readiness-check-status');
        if (mark) mark.textContent = item.done ? '✓' : item.ready ? '•' : '';
        if (statusLabel) statusLabel.textContent = item.done ? 'Done' : item.ready ? 'Ready' : 'Waiting';
      });
    });

    document.querySelectorAll(`[data-artifact-status="${session.id}"]`).forEach(el => {
      const artifact = getPortfolioArtifact(session);
      const artifactStatus = getArtifactStatus(artifact);
      el.className = `artifact-status ${getArtifactStatusClass(artifactStatus)}`;
      el.dataset.artifactStatus = session.id;
      el.textContent = artifactStatus.label;
    });

    panel.querySelectorAll('[data-progress-type]').forEach(el => {
      const type = el.dataset.progressType;
      const index = Number(el.dataset.progressIndex || 0);
      const complete = isComplete(session.id, type, index);
      if (el.matches('input[type="checkbox"]')) el.checked = complete;
      el.classList.toggle('done', complete);
      el.classList.toggle('read', complete);
    });

    const nextAction = getNextAction(session);
    const nextText = panel.querySelector('.next-action-text');
    const nextBtn = panel.querySelector('.next-action-btn');
    if (nextText && nextBtn) {
      if (nextAction) {
        nextText.textContent = `${nextAction.label}: ${nextAction.text}`;
        nextBtn.textContent = nextAction.tab === 'prepare' ? 'Prepare' : nextAction.tab === 'session' ? 'Session' : 'Reflect';
        nextBtn.onclick = () => goToTask(session.id, nextAction.tab);
      } else {
        nextText.textContent = 'This month is complete. You are ready to carry the work forward.';
        nextBtn.textContent = 'Review';
        nextBtn.onclick = () => goToTask(session.id, 'reflect');
      }
    }
  });
}

function buildNav() {
  const nav = document.getElementById('monthNav');
  if (!nav) return;
  nav.innerHTML = '';
  SESSIONS.forEach((s, i) => {
    const d = DOMAINS[s.domain];
    const btn = document.createElement('button');
    btn.className = 'month-btn' + (i === 0 ? ' active' : '');
    btn.dataset.id = s.id;
    btn.innerHTML = `
      <div class="month-dot" style="background:${d.color}"></div>
      <div class="month-btn-info">
        <div class="month-name">${s.month}</div>
        <div class="month-session-title">${escapeHTML(s.title)}</div>
        <div class="month-status">Not Started</div>
      </div>
      <span class="month-progress">0/0</span>
      ${s.inPerson ? '<span class="month-inperson">●</span>' : ''}
    `;
    btn.onclick = () => showSession(s.id);
    nav.appendChild(btn);
  });
}

function buildSessions() {
  const wrap = document.getElementById('sessionPanels');
  if (!wrap) return;
  wrap.innerHTML = '';
  SESSIONS.forEach(s => {
    const d = DOMAINS[s.domain];
    const isGrantReviewMonth = s.id === 'dec' || s.id === 'apr';
    const panel = document.createElement('div');
    panel.className = 'session-panel';
    panel.id = 'panel-' + s.id;

    const activitiesHTML = s.activities.map((a, i) => `
      <div class="activity-card">
        <div class="act-num">${i + 1}</div>
        <div class="act-body">
          <div class="act-meta">${a.time ? `<span class="badge-time">${escapeHTML(a.time)}</span>` : ''}</div>
          <div class="act-text">${escapeHTML(a.text)}</div>
        </div>
      </div>
    `).join('');

    const readingsHTML = s.readings.map((r, i) => {
      const data = getReadingData(r);
      return `<div class="reading-row resource-row" onclick="toggleReading(this)"
        data-progress-type="reading" data-progress-index="${i}"
        data-sid="${s.id}" data-stitle="${escapeHTML(s.title)}" data-task="${escapeHTML(data.title)}">
        <span class="reading-bullet read-check">✓</span>
        <span class="reading-text">${escapeHTML(data.title)}</span>
        <span class="resource-type">${escapeHTML(data.type)}</span>
        ${data.url
          ? `<a class="resource-link" href="${escapeHTML(data.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Open</a>`
          : '<span class="resource-link disabled">Pending</span>'}
      </div>`;
    }).join('');

    const goalsHTML = s.goals.map((g, i) => `
      <div class="goal-item" onclick="toggleGoal(this)"
        data-progress-type="goal" data-progress-index="${i}"
        data-sid="${s.id}" data-stitle="${escapeHTML(s.title)}" data-task="${escapeHTML(g)}">
        <div class="goal-circle">✓</div>
        <div class="goal-text">${escapeHTML(g)}</div>
      </div>`).join('');

    const promptsHTML = (s.reflectPrompts || []).map((p, i) => `
      <div class="reflect-prompt-item"><div class="prompt-num">${i + 1}</div><div>${escapeHTML(p)}</div></div>
    `).join('');

    const connectsHTML = s.connectsTo ? `
      <div class="connects-forward">
        <div class="connects-arrow">→</div>
        <div class="connects-body">
          <div class="connects-label">Connects Forward</div>
          <div class="connects-text">${escapeHTML(s.connectsTo)}</div>
        </div>
      </div>
    ` : '';

    panel.innerHTML = `
      <div class="session-header">
        <div class="session-eyebrow">
          <span class="session-month-label">${s.month}</span>
          <span class="domain-pill" style="background:${d.color}">${d.label}</span>
          ${s.inPerson ? '<span class="inperson-badge">In-Person Convening</span>' : ''}
          <button class="calendar-add-btn" onclick="downloadSessionICS('${s.id}')" title="Downloads a placeholder reminder — adjust the date to your program's actual session date">+ Add to Calendar</button>
        </div>
        <h1 class="session-title">${escapeHTML(s.title)}</h1>
        <div class="session-status-line">
          <span class="session-status-pill status-pill status-not-started">Not Started</span>
          <span class="session-status-text">This month is waiting for you. Begin with the preparation task and assigned readings.</span>
        </div>
        <div class="session-progress-row" aria-label="${s.month} progress">
          <div class="session-progress-text">0 of 0 complete</div>
          <div class="session-progress-track"><div class="session-progress-fill"></div></div>
        </div>
      </div>
      <div class="next-action-card">
        <div>
          <div class="next-action-label">Next Step</div>
          <div class="next-action-text">Loading your next step...</div>
        </div>
        <button class="next-action-btn" type="button">Go</button>
      </div>
      <div class="inquiry-block">
        <div class="inquiry-label">Guiding Inquiry</div>
        <div class="inquiry-question">${escapeHTML(s.inquiry)}</div>
      </div>
      <p class="session-description">${escapeHTML(s.description)}</p>
      <div class="tabs-bar">
        <a class="tab-btn active" data-tab="prepare" href="#${s.id}-prepare">Prepare</a>
        <a class="tab-btn" data-tab="session" href="#${s.id}-session">Session</a>
        <a class="tab-btn" data-tab="reflect" href="#${s.id}-reflect">Reflect</a>
        <a class="tab-btn" data-tab="portfolio" href="#${s.id}-portfolio">Portfolio</a>
        <a class="tab-btn" data-tab="resources" href="#${s.id}-resources">Resources</a>
        <a class="tab-btn" data-tab="discussion" href="#${s.id}-discussion">Discussion</a>
      </div>
      <section class="tab-pane active" id="${s.id}-prepare" data-section="prepare">
        ${renderReadinessChecklist(s)}
        <div class="phase-card">
          <div class="phase-card-header">
            <div class="phase-icon" style="background:${d.color}22; color:${d.color}; font-size:16px;">◆</div>
            <div class="phase-card-title">Before the Session</div>
          </div>
          <div class="phase-task-text">${escapeHTML(s.before)}</div>
          <div class="task-check-wrap">
            <input type="checkbox" id="check-before-${s.id}"
              data-progress-type="before" data-progress-index="0"
              data-task="${escapeHTML(s.before)}"
              onchange="toggleTaskCheckbox(this, '${s.id}', 'Before Session')">
            <label for="check-before-${s.id}">Mark complete when done</label>
          </div>
          <div class="task-note-wrap">
            <label class="lib-label" for="tasknote-before-${s.id}">Your Notes <span class="lib-optional">optional, saved automatically — not graded</span></label>
            <textarea class="artifact-editor-textarea small" id="tasknote-before-${s.id}"
              placeholder="Jot down your paragraph or working thoughts here…"
              oninput="handleTaskNoteInput('${s.id}','before')">${escapeHTML(getTaskNote(s.id, 'before'))}</textarea>
            <span class="cv-copy-status" id="tasknote-status-before-${s.id}"></span>
          </div>
        </div>
        <div class="section-hd" style="margin-top:24px">Assigned Readings</div>
        <div class="readings-card">${readingsHTML}</div>
      </section>
      <section class="tab-pane" id="${s.id}-session" data-section="session">
        <div class="section-hd">Learning Goals</div>
        <div class="goals-list">${goalsHTML}</div>
        <div class="section-hd">Activities</div>
        <div class="activities-list">${activitiesHTML}</div>
      </section>
      <section class="tab-pane" id="${s.id}-reflect" data-section="reflect">
        <div class="reflect-after-card">
          <div class="reflect-after-label">After the Session</div>
          <div class="reflect-after-text">${escapeHTML(s.after)}</div>
          <div class="task-check-wrap reflect-complete">
            <input type="checkbox" id="check-after-${s.id}"
              data-progress-type="after" data-progress-index="0"
              data-task="${escapeHTML(s.after)}"
              onchange="toggleTaskCheckbox(this, '${s.id}', 'After Session')">
            <label for="check-after-${s.id}">Mark reflection complete</label>
          </div>
          <div class="task-note-wrap">
            <label class="lib-label" for="tasknote-after-${s.id}">Your Notes <span class="lib-optional">optional, saved automatically — not graded</span></label>
            <textarea class="artifact-editor-textarea small" id="tasknote-after-${s.id}"
              placeholder="Jot down your reflection here…"
              oninput="handleTaskNoteInput('${s.id}','after')">${escapeHTML(getTaskNote(s.id, 'after'))}</textarea>
            <span class="cv-copy-status" id="tasknote-status-after-${s.id}"></span>
          </div>
        </div>
        <div class="section-hd">Reflection Prompts</div>
        <div class="reflect-prompts">${promptsHTML}</div>
        ${connectsHTML}
      </section>
      <section class="tab-pane" id="${s.id}-portfolio" data-section="portfolio">
        <div class="section-hd">Portfolio Artifact</div>
        ${renderSessionPortfolio(s)}
      </section>
      <section class="tab-pane" id="${s.id}-resources" data-section="resources">
        <div class="section-hd">Resource Hub</div>
        <div id="resource-groups-${s.id}">${renderResourceGroups(s)}</div>

        <div class="section-hd" style="margin-top:24px">Shared by Fellows</div>
        <div class="resource-section">
          <div class="resource-section-header">
            <div class="resource-section-title">Community Resources</div>
            <div class="resource-section-note">Links and files fellows have shared for ${escapeHTML(s.month)}</div>
          </div>
          <div class="lib-session-actions" id="session-resources-actions-${s.id}">
            <button class="lib-add-btn" onclick="showLibAddForm('${s.id}')">+ Add Resource</button>
          </div>
          ${resourceFormHTML(s.id, { showSessionSelect: false })}
          <div id="session-resources-list-${s.id}" class="lib-session-list">
            <div class="disc-status">Loading resources…</div>
          </div>
        </div>
      </section>
      <section class="tab-pane" id="${s.id}-discussion" data-section="discussion">
        <div class="section-hd">Discussion</div>
        <p class="portfolio-overview-text" style="margin-bottom:18px;">Share reactions, questions, and insights from this session. Posts are visible to all signed-in fellows.</p>
        ${isGrantReviewMonth ? `
        <div class="peer-review-guide">
          <div class="peer-review-guide-title">Peer Review Exchange</div>
          <div class="peer-review-guide-text">This is a grant-development month — use this thread to request or give structured feedback on a draft. A useful review answers: <strong>Is the gap clear?</strong> <strong>Is the approach feasible?</strong> <strong>Is the scope realistic?</strong> Post your draft (or a link to it in the Resource Library) and tag what kind of feedback you want.</div>
        </div>
        ` : ''}
        <div class="disc-wrap">
          <div class="disc-list" id="disc-list-${s.id}">
            <div class="disc-status">Loading discussion…</div>
          </div>
          <div class="disc-composer" id="disc-composer-${s.id}" style="display:none;">
            <textarea
              class="disc-input"
              id="disc-input-${s.id}"
              placeholder="${isGrantReviewMonth ? "Share a draft link or paste your aims — ask reviewers a specific question (Enter to post, Shift+Enter for new line)" : "Share a thought, question, or reaction… (Enter to post, Shift+Enter for new line)"}"
              oninput="this.style.height='38px';this.style.height=Math.min(110,this.scrollHeight)+'px'"
              onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();postDiscussionMessage('${s.id}')}"
            ></textarea>
            <button class="disc-post-btn" id="disc-post-btn-${s.id}" onclick="postDiscussionMessage('${s.id}')">Post</button>
          </div>
        </div>
      </section>
    `;
    wrap.appendChild(panel);
  });
}

function switchTab(sessionId, tab) {
  setRoute(`${sessionId}-${tab}`);
}

function toggleGoal(el) {
  const index = Number(el.dataset.progressIndex || 0);
  const nextValue = !isComplete(el.dataset.sid, 'goal', index);
  setComplete(el.dataset.sid, 'goal', index, nextValue, { text: el.dataset.task });
  updateProgressUI();
}

function toggleReading(el) {
  const index = Number(el.dataset.progressIndex || 0);
  const nextValue = !isComplete(el.dataset.sid, 'reading', index);
  setComplete(el.dataset.sid, 'reading', index, nextValue, { text: el.dataset.task });
  updateProgressUI();
}

function toggleTaskCheckbox(el, sessionId) {
  const type = el.dataset.progressType;
  const index = Number(el.dataset.progressIndex || 0);
  setComplete(sessionId, type, index, el.checked, { text: el.dataset.task });
  updateProgressUI();
}

// ═══════════════════════════════════════════════════════
// ACCESS GATE
// ═══════════════════════════════════════════════════════
const LOGO_LIGHT = './src/assets/psix-logo-light.png';
const LOGO_DARK = './src/assets/psix-logo-dark.png';

const GATE_COPY = {
  eyebrow: 'PSiX · Purpose Commons',
  title: "Fellow's Journey Companion",
  subtitle: 'Translational Fellowship in Purpose Science',
};

// Everyone comes in through this one gate now — there is no separate
// facilitator passcode. Administrator access (the toggle to the Facilitator
// Dashboard, once inside) is granted by being listed in the psix_facilitators
// table under the Google/email address used to sign in here, checked after
// entry — not by which passcode screen someone found.
function renderGate() {
  const overlay = document.getElementById('gate-overlay');
  if (!overlay) return;
  const copy = GATE_COPY;
  const syncAvailable = supabaseReady();

  let stepHTML = '';
  if (gateStep === 'pass') {
    stepHTML = `
      <div class="gate-card">
        <div>
          <div class="gate-label">Access Code</div>
          <div class="gate-input-wrap">
            <input id="gate-pass-input" class="gate-input" type="password"
                   placeholder="Enter your cohort passcode"
                   autocomplete="off" onkeydown="if(event.key==='Enter')gateCheckPass()">
            <button class="gate-pass-toggle" type="button" onclick="togglePassVisibility()">Show</button>
          </div>
        </div>
        <div id="gate-pass-error" class="gate-error"></div>
        <button class="gate-btn" onclick="gateCheckPass()">Continue →</button>
      </div>
    `;
  } else if (gateStep === 'name') {
    stepHTML = `
      <div class="gate-card">
        <div>
          <div class="gate-label">Your Name</div>
          <input id="gate-name-input" class="gate-input" type="text"
                 placeholder="First and last name" value="${escapeHTML(fellowName)}"
                 onkeydown="if(event.key==='Enter')gateCheckName()">
        </div>
        <div id="gate-name-error" class="gate-error"></div>
        <button class="gate-btn" onclick="gateCheckName()">Continue →</button>
      </div>
    `;
  } else if (gateStep === 'sync') {
    stepHTML = `
      <div class="gate-card">
        <div class="gate-label" style="text-align:center; margin-bottom:0;">Sync your progress across devices</div>
        ${syncAvailable
          ? `<button class="gate-btn-google" onclick="handleGoogleSignIn()">
               <svg width="16" height="16" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.85.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.96 10.71A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"/></svg>
               Sign in with Google
             </button>
             <div class="gate-divider-or">or</div>
             <div class="gate-email-otp">
               <input id="gate-email-input" class="gate-input" type="email" placeholder="you@youruniversity.edu" autocomplete="email" onkeydown="if(event.key==='Enter'){event.preventDefault();handleEmailOtpSignIn()}">
               <button class="gate-btn-email" onclick="handleEmailOtpSignIn()">Email me a sign-in link</button>
             </div>
             <div id="gate-email-status" class="gate-error"></div>
             <div class="gate-divider-or">or</div>`
          : ''}
        <button class="gate-skip" onclick="skipSync()">Continue without syncing</button>
        <div id="gate-sync-error" class="gate-error"></div>
      </div>
    `;
  }

  overlay.innerHTML = `
    <div class="gate-brand">
      <div class="gate-eyebrow">${copy.eyebrow}</div>
      <img class="gate-logo" src="${LOGO_LIGHT}" alt="Purpose Science & Innovation Exchange" />
      <div class="gate-title">${copy.title}</div>
      <div class="gate-subtitle">${copy.subtitle}</div>
      <div class="gate-divider"></div>
    </div>
    ${stepHTML}
  `;
}

function togglePassVisibility() {
  const input = document.getElementById('gate-pass-input');
  const toggle = document.querySelector('.gate-pass-toggle');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  if (toggle) toggle.textContent = showing ? 'Show' : 'Hide';
  input.focus();
}

async function gateCheckPass() {
  const input = document.getElementById('gate-pass-input');
  const val = input.value.trim();
  const hash = await sha256Hex(val);
  if (val && hash === CONFIG.fellowAccessHash) {
    gateStep = 'name';
    renderGate();
    setTimeout(() => document.getElementById('gate-name-input')?.focus(), 50);
  } else {
    document.getElementById('gate-pass-error').textContent = 'Incorrect passcode. Please try again.';
    input.value = '';
  }
}

function gateCheckName() {
  const val = document.getElementById('gate-name-input').value.trim();
  if (val.length < 2) {
    document.getElementById('gate-name-error').textContent = 'Please enter your full name.';
    return;
  }
  fellowName = val;
  // Save now (not just at enterApp) so a magic-link click-through that opens
  // in a fresh tab — a different in-memory JS state — can still recover the
  // name that was typed here moments ago, as long as it's the same browser.
  localStorage.setItem(`${STORAGE_PREFIX}:fellowName`, val);
  gateStep = 'sync';
  renderGate();
}

function skipSync() {
  enterApp();
}

async function handleGoogleSignIn() {
  try {
    sessionStorage.setItem('psix_pending_name', fellowName);
    await signInWithGoogle();
  } catch (err) {
    const el = document.getElementById('gate-sync-error');
    if (el) el.textContent = 'Sign-in failed: ' + err.message;
  }
}

async function handleEmailOtpSignIn() {
  const input = document.getElementById('gate-email-input');
  const statusEl = document.getElementById('gate-email-status');
  const email = (input?.value || '').trim();
  if (!email || !email.includes('@')) {
    if (statusEl) { statusEl.style.color = ''; statusEl.textContent = 'Please enter a valid email address.'; }
    return;
  }
  const btn = document.querySelector('.gate-btn-email');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    await signInWithEmailOtp(email);
    if (statusEl) {
      statusEl.style.color = 'rgba(150,220,180,0.9)';
      statusEl.textContent = `Check ${email} for a sign-in link — it'll bring you right back here.`;
    }
    if (input) input.value = '';
  } catch (err) {
    if (statusEl) { statusEl.style.color = ''; statusEl.textContent = 'Could not send link: ' + err.message; }
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Email me a sign-in link'; }
}

async function handleSignOut() {
  await signOut();
  currentUserId = null;
  currentUserEmail = null;
  isFacilitatorUser = false;
  previewAsFellow = false;
  localStorage.removeItem(`${STORAGE_PREFIX}:localGateOK`);
  updateAccountPanel();
  updateAdminToggle();
  updateFacilitatorToolbar();
}

function resetLocalAccess() {
  if (!confirm("Reset access on this device? You'll need the passcode again next time.")) return;
  localStorage.removeItem(`${STORAGE_PREFIX}:lastRole`);
  localStorage.removeItem(`${STORAGE_PREFIX}:localGateOK`);
  localStorage.removeItem(`${STORAGE_PREFIX}:fellowName`);
  window.location.reload();
}

function fadeOutGate() {
  const overlay = document.getElementById('gate-overlay');
  if (!overlay) return;
  overlay.classList.add('fade-out');
  // `inert` immediately drops the overlay (and whatever inside it still has
  // focus) out of the tab order, so a keyboard user's next Tab lands on the
  // skip link / app content rather than a fading, soon-to-be-hidden button.
  overlay.inert = true;
  document.activeElement?.blur();
  setTimeout(() => { overlay.classList.add('hidden'); }, 500);
}

function enterApp() {
  // Remember this device passed the gate, so a returning visitor skips
  // straight past the passcode next time — see resumeSession().
  if (fellowName) localStorage.setItem(`${STORAGE_PREFIX}:fellowName`, fellowName);
  localStorage.setItem(`${STORAGE_PREFIX}:localGateOK`, '1');
  fadeOutGate();
  updateAccountPanel();
  if (!window.location.hash || window.location.hash === '#') {
    history.replaceState(null, '', '#dashboard');
  }
  routeFromHash({ behavior: 'auto' });
  loadSessionMaterials().then(() => SESSIONS.forEach(s => refreshResourceGroups(s.id)));
  // Give focus a concrete landing point once the gate is gone, instead of
  // leaving it on document.body — Chromium's next Tab-from-nothing
  // otherwise resumes near wherever the routed-to scrollIntoView() just
  // scrolled to, silently skipping the sidebar nav and skip link.
  setTimeout(() => { document.getElementById('contentWrap')?.focus(); }, 520);
}

// Everyone enters as a fellow. Whether the "Facilitator Dashboard" toggle
// appears (and works) is decided here, after sign-in, by checking the signed-
// in email against psix_facilitators — not by which gate someone found.
async function refreshAdminStatus() {
  isFacilitatorUser = currentUserEmail ? await isFacilitatorEmail(currentUserEmail) : false;
  updateAdminToggle();
}

function updateAdminToggle() {
  const btn = document.getElementById('adminToggleBtn');
  if (btn) btn.style.display = isFacilitatorUser ? 'flex' : 'none';
}

function toggleAdminView() {
  if (!isFacilitatorUser) return;
  setRoute('facilitator');
}

function updateAccountPanel() {
  const panel = document.getElementById('sidebarAccount');
  if (!panel) return;
  const greeting = document.getElementById('fellow-greeting');
  if (greeting) greeting.textContent = fellowName ? 'Welcome, ' + fellowName.split(' ')[0] : '';
  if (currentUserId) {
    panel.innerHTML = `
      <div class="sidebar-account-status"><div class="sidebar-account-dot synced"></div>Synced as ${escapeHTML(currentUserEmail || '')}</div>
      <button class="sidebar-account-btn" onclick="handleSignOut()">Sign out</button>
    `;
  } else {
    panel.innerHTML = `
      <div class="sidebar-account-status"><div class="sidebar-account-dot"></div>Progress saved on this device only</div>
      ${supabaseReady() ? `<button class="sidebar-account-btn" onclick="handleGoogleSignIn()">Sign in to sync</button>` : ''}
      ${localStorage.getItem(`${STORAGE_PREFIX}:localGateOK`) === '1' ? `<button class="sidebar-account-btn sidebar-account-btn-ghost" onclick="resetLocalAccess()">Not you? Reset access</button>` : ''}
    `;
  }
}

// ═══════════════════════════════════════════════════════
// FACILITATOR DASHBOARD
// ═══════════════════════════════════════════════════════
function currentSessionIndex() {
  const month = new Date().getMonth(); // 0=Jan
  return (month - 6 + 12) % 12; // fellowship year starts July
}

function buildFacilitatorShell() {
  const shell = document.getElementById('facilitatorShell');
  if (!shell) return;
  shell.innerHTML = `
    <div class="fac-topbar">
      <img class="fac-topbar-logo-img" src="${LOGO_LIGHT}" alt="Purpose Science & Innovation Exchange" />
      <div class="fac-topbar-sep"></div>
      <div class="fac-topbar-title">Facilitator Dashboard</div>
      <span class="fac-badge">🔒 FACILITATOR ONLY</span>
      <span class="fac-refresh-status" id="facRefreshStatus"></span>
      <button class="fac-btn" onclick="browseFellowContent()">🖉 Browse &amp; Manage Content</button>
      <button class="fac-btn fac-btn-refresh" onclick="refreshFacilitatorData()">↻ Refresh</button>
    </div>
    <div class="fac-page">
      <div class="fac-no-data-banner" id="facNoDataBanner" style="display:none">
        <span class="icon">⚠</span>
        <div class="msg"><strong>Not connected.</strong> No fellow activity found yet, or Supabase isn't configured. Fellows must sign in with Google at least once for their progress to sync here.</div>
      </div>
      <div class="fac-stats-row">
        <div class="fac-stat-card" style="border-color:var(--fac-tra)">
          <div class="fac-stat-num" id="facStatFellows">–</div>
          <div class="fac-stat-label">Fellows Active</div>
          <div class="fac-stat-sub" id="facStatFellowsSub">Loading…</div>
        </div>
        <div class="fac-stat-card" style="border-color:var(--fac-gold)">
          <div class="fac-stat-num" id="facStatCheckins">–</div>
          <div class="fac-stat-label">Total Check-ins</div>
          <div class="fac-stat-sub">Goals + readings + tasks logged</div>
        </div>
        <div class="fac-stat-card" style="border-color:var(--con)">
          <div class="fac-stat-num" id="facStatSession">–</div>
          <div class="fac-stat-label">Current Session</div>
          <div class="fac-stat-sub" id="facStatSessionSub">Based on calendar month</div>
        </div>
        <div class="fac-stat-card" style="border-color:var(--gra)">
          <div class="fac-stat-num" id="facStatLast">–</div>
          <div class="fac-stat-label">Last Activity</div>
          <div class="fac-stat-sub" id="facStatLastSub">Most recent check-in</div>
        </div>
      </div>
      <div class="fac-section-hdr"><h2>Fellowship Year Arc</h2><div class="fac-section-hdr-line"></div></div>
      <div class="fac-arc-wrap"><div class="fac-arc-row" id="facArcRow"></div></div>
      <div class="fac-section-hdr"><h2>Materials Coverage</h2><div class="fac-section-hdr-line"></div></div>
      <div class="fac-coverage-wrap" id="facCoverageWrap"></div>
      <div class="fac-section-hdr"><h2>Fellow Progress by Session</h2><div class="fac-section-hdr-line"></div></div>
      <div class="fac-grid-wrap"><table><thead id="facProgressHead"></thead><tbody id="facProgressBody"></tbody></table></div>
      <div class="fac-section-hdr"><h2>Recent Activity</h2><div class="fac-section-hdr-line"></div></div>
      <div class="fac-feed-wrap" id="facFeed"></div>
    </div>
  `;
  buildFacilitatorArc();
  buildFacilitatorTableSkeleton();
  buildMaterialsCoverage();
}

function getMaterialsCoverage(session) {
  const items = getResourceGroups(session).flatMap(g => g.items).filter(i => i.editable !== false);
  const filled = items.filter(i => i.status === 'Available').length;
  return { filled, total: items.length };
}

function manageSessionMaterials(sessionId) {
  previewAsFellow = false;
  setRoute(sessionId + '-resources');
}

function buildMaterialsCoverage() {
  const wrap = document.getElementById('facCoverageWrap');
  if (!wrap) return;
  wrap.innerHTML = SESSIONS.map(s => {
    const { filled, total } = getMaterialsCoverage(s);
    const pct = total > 0 ? Math.round((filled / total) * 100) : 100;
    const barColor = pct === 100 ? 'var(--fac-tra)' : pct > 0 ? 'var(--fac-amber)' : 'var(--fac-slate)';
    return `
      <div class="fac-coverage-row">
        <div class="fac-coverage-month" style="color:${DOMAINS[s.domain].color}">${escapeHTML(s.month.slice(0, 3))}</div>
        <div class="fac-coverage-title">${escapeHTML(s.title)}</div>
        <div class="fac-coverage-bar-track"><div class="fac-coverage-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
        <div class="fac-coverage-count">${filled}/${total}</div>
        <button class="fac-coverage-btn" onclick="manageSessionMaterials('${s.id}')">Manage →</button>
      </div>
    `;
  }).join('');
}

function buildFacilitatorArc() {
  const cur = currentSessionIndex();
  const row = document.getElementById('facArcRow');
  if (!row) return;
  row.innerHTML = SESSIONS.map((s, i) => {
    const done = i < cur;
    const active = i === cur;
    const color = DOMAINS[s.domain].color;
    const dotStyle = done || active ? `background:${color};` : `background:rgba(255,255,255,.1);`;
    const borderStyle = active ? `border-color:var(--fac-gold);` : '';
    return `
      <div class="fac-arc-cell${done ? ' done' : ''}${active ? ' current' : ''}">
        <div class="fac-arc-dot" style="${dotStyle}${borderStyle}">${i + 1}</div>
        <div class="fac-arc-month">${s.month.slice(0, 3)}</div>
        <div class="fac-arc-label">${escapeHTML(s.title)}</div>
      </div>
    `;
  }).join('');
}

function buildFacilitatorTableSkeleton() {
  const head = document.getElementById('facProgressHead');
  if (!head) return;
  const headerSessions = SESSIONS.map(s => `<th style="color:${DOMAINS[s.domain].color}">${s.month.slice(0, 3)}</th>`).join('');
  head.innerHTML = `<tr><th>Fellow</th>${headerSessions}<th>Overall</th></tr>`;
}

function populateFacilitatorTable(rows) {
  const body = document.getElementById('facProgressBody');
  if (!body) return;
  const colspan = SESSIONS.length + 2;
  const checked = rows.filter(r => (r.action || '').toLowerCase() === 'checked');
  const fellows = {};
  checked.forEach(r => {
    const name = r.fellow_name || '';
    const sid = r.session_id || '';
    if (!name || !sid) return;
    if (!fellows[name]) fellows[name] = {};
    fellows[name][sid] = (fellows[name][sid] || 0) + 1;
  });
  const fellowNames = Object.keys(fellows).sort();
  if (fellowNames.length === 0) {
    body.innerHTML = `<tr><td colspan="${colspan}" style="padding:28px;text-align:center;color:var(--fac-text-dim)">No check-ins recorded yet.</td></tr>`;
    return;
  }
  body.innerHTML = fellowNames.map(name => {
    let total = 0, possible = 0;
    const cells = SESSIONS.map(s => {
      const count = fellows[name][s.id] || 0;
      const sessionTotal = getSessionTasks(s).length;
      total += count;
      possible += sessionTotal;
      let cls = 'fac-pip-none';
      if (count >= sessionTotal) cls = 'fac-pip-done';
      else if (count >= 1) cls = 'fac-pip-partial';
      return `<td><div class="fac-cell-bar"><div class="fac-pip ${cls}" title="${count} check-ins"></div><span class="fac-pct-label">${count > 0 ? count : ''}</span></div></td>`;
    }).join('');
    const pct = possible > 0 ? Math.round((total / possible) * 100) : 0;
    const pctColor = pct >= 75 ? 'var(--fac-tra)' : pct >= 40 ? 'var(--fac-amber)' : 'var(--fac-text-dim)';
    return `<tr><td>${escapeHTML(name)}</td>${cells}<td style="color:${pctColor};font-weight:700">${pct}%</td></tr>`;
  }).join('');
}

function facSessionColor(sid) {
  const s = SESSIONS.find(x => x.id === sid);
  return s ? DOMAINS[s.domain].color : '#7A9BB5';
}

function buildFacilitatorFeed(rows) {
  const feed = document.getElementById('facFeed');
  if (!feed) return;
  const sorted = [...rows]
    .filter(r => (r.action || '').toLowerCase() === 'checked')
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 50);
  if (sorted.length === 0) {
    feed.innerHTML = `<div class="fac-feed-empty">No activity yet — check back after fellows begin logging in.</div>`;
    return;
  }
  feed.innerHTML = sorted.map(r => {
    const name = r.fellow_name || '—';
    const sid = r.session_id || '';
    const type = r.task_type || '';
    const text = r.task_text || '';
    const ts = r.created_at ? new Date(r.created_at) : null;
    const timeStr = ts ? ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const dot = facSessionColor(sid);
    const s = SESSIONS.find(x => x.id === sid);
    const sLabel = s ? s.month : sid;
    const typeClass = type.toLowerCase().includes('goal') ? 'fac-feed-type-goal' : 'fac-feed-type-reading';
    const shortText = text.length > 80 ? text.slice(0, 80) + '…' : text;
    return `<div class="fac-feed-item">
      <div class="fac-feed-dot" style="background:${dot}"></div>
      <div>
        <span class="fac-feed-name">${escapeHTML(name)}</span>
        <span class="fac-feed-action"> logged a <span class="${typeClass}">${escapeHTML(type)}</span></span>
        <span class="fac-feed-session" style="background:${dot}">${escapeHTML(sLabel)}</span>
        <div style="font-size:11.5px;color:var(--fac-text-dim);margin-top:3px">${escapeHTML(shortText)}</div>
      </div>
      <div class="fac-feed-time">${timeStr}</div>
    </div>`;
  }).join('');
}

function updateFacilitatorStats(rows) {
  const cur = currentSessionIndex();
  const s = SESSIONS[cur];
  document.getElementById('facStatSession').textContent = s ? s.month : '—';
  document.getElementById('facStatSessionSub').textContent = s ? s.title : '';

  const checked = rows.filter(r => (r.action || '').toLowerCase() === 'checked');
  const fellows = new Set(checked.map(r => r.fellow_name).filter(Boolean));
  document.getElementById('facStatFellows').textContent = fellows.size;
  document.getElementById('facStatFellowsSub').textContent = [...fellows].slice(0, 3).join(', ') + (fellows.size > 3 ? '…' : '');
  document.getElementById('facStatCheckins').textContent = checked.length;

  const sorted = [...checked].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  if (sorted[0]) {
    const last = sorted[0];
    const ts = last.created_at ? new Date(last.created_at) : null;
    document.getElementById('facStatLast').textContent = last.fellow_name || '—';
    document.getElementById('facStatLastSub').textContent = ts
      ? ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  } else {
    document.getElementById('facStatLast').textContent = '—';
    document.getElementById('facStatLastSub').textContent = 'No check-ins yet';
  }
}

async function loadFacilitatorData() {
  const status = document.getElementById('facRefreshStatus');
  if (status) status.textContent = 'Refreshing…';
  const rows = await fetchAllProgressForFacilitators();
  await loadSessionMaterials(true);
  buildMaterialsCoverage();
  const banner = document.getElementById('facNoDataBanner');
  if (banner) banner.style.display = rows.length === 0 ? 'flex' : 'none';
  populateFacilitatorTable(rows);
  buildFacilitatorFeed(rows);
  updateFacilitatorStats(rows);
  if (status) status.textContent = rows.length ? `Updated ${new Date().toLocaleTimeString()}` : 'No data yet';
}

function refreshFacilitatorData() {
  loadFacilitatorData();
}

function applyFacilitatorView() {
  const fellowShell = document.getElementById('fellowShell');
  const facilitatorShell = document.getElementById('facilitatorShell');
  if (fellowShell) fellowShell.classList.remove('active');
  if (facilitatorShell) facilitatorShell.classList.add('active');
  if (!facilitatorLoaded) {
    facilitatorLoaded = true;
    buildFacilitatorShell();
    loadFacilitatorData();
  } else {
    // Materials Coverage reflects whatever's in sessionMaterialsCache, which the
    // upload modal already keeps fresh — so a cheap re-render (no network call)
    // is enough to reflect edits made since the last full dashboard load.
    buildMaterialsCoverage();
  }
}

// ═══════════════════════════════════════════════════════
// DISCUSSION BOARD (per session)
// ═══════════════════════════════════════════════════════
function discListEl(sessionId) {
  return document.getElementById('disc-list-' + sessionId);
}

function discSetStatus(sessionId, text, isError) {
  const el = discListEl(sessionId);
  if (el) el.innerHTML = `<div class="disc-status${isError ? ' disc-error-msg' : ''}">${escapeHTML(text)}</div>`;
}

function signInPromptHTML(message) {
  return `
    <div class="disc-signin-prompt">
      <div class="disc-signin-text">${escapeHTML(message)}</div>
      <button class="gate-btn-google disc-signin-btn" onclick="handleGoogleSignIn()">
        <svg width="15" height="15" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.85.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.96 10.71A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"/></svg>
        Sign in with Google
      </button>
    </div>
  `;
}

async function loadSessionDiscussion(sessionId) {
  const composer = document.getElementById('disc-composer-' + sessionId);
  if (!currentUserId) {
    discSetStatus(sessionId, '');
    const el = discListEl(sessionId);
    if (el) el.innerHTML = signInPromptHTML('Sign in with Google to read and join the discussion for this session.');
    if (composer) composer.style.display = 'none';
    return;
  }
  if (composer) composer.style.display = 'flex';
  discSetStatus(sessionId, 'Loading discussion…');
  try {
    const messages = await fetchMessages(sessionId);
    discRenderAll(sessionId, messages);
  } catch (err) {
    discSetStatus(sessionId, 'Could not load discussion. Please refresh to try again.', true);
  }
}

function discRenderAll(sessionId, messages) {
  const el = discListEl(sessionId);
  if (!el) return;
  if (!messages.length) {
    el.innerHTML = '<div class="disc-status">No posts yet — be the first to share a thought.</div>';
    return;
  }
  el.innerHTML = messages.map(discMsgHTML).join('');
  el.scrollTop = el.scrollHeight;
}

function discMsgHTML(m) {
  const isOwn = m.user_id === currentUserId;
  const votes = m.psix_message_votes || [];
  const voteCount = votes.length;
  const hasVoted = votes.some(v => v.user_id === currentUserId);
  const dt = new Date(m.created_at);
  const time = dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  const voteInner = voteCount > 0 ? `▲ <span class="disc-vote-count">${voteCount}</span>` : '▲';
  const controls = isOwn ? `
    <div class="disc-msg-controls">
      <button class="disc-ctrl-btn" onclick="editDiscMsg('${m.id}')">Edit</button>
      <button class="disc-ctrl-btn disc-ctrl-del" onclick="deleteDiscMsg('${m.id}')">Delete</button>
    </div>` : '';
  return `
    <div class="disc-msg${isOwn ? ' disc-msg-own' : ''}" id="disc-msg-${m.id}">
      <div class="disc-msg-header">
        <span class="disc-msg-name">${escapeHTML(m.user_name)}</span>
        <span class="disc-msg-time">${time}</span>
      </div>
      <div class="disc-msg-body" id="disc-body-${m.id}">${escapeHTML(m.body)}</div>
      <div class="disc-msg-footer">
        <button class="disc-vote-btn${hasVoted ? ' voted' : ''}" id="vote-btn-${m.id}" onclick="toggleVote('${m.id}')" aria-pressed="${hasVoted}" aria-label="${hasVoted ? 'Remove upvote' : 'Upvote this post'}${voteCount > 0 ? `, ${voteCount} upvote${voteCount === 1 ? '' : 's'} so far` : ''}">${voteInner}</button>
        ${controls}
      </div>
    </div>
  `;
}

async function postDiscussionMessage(sessionId) {
  if (!currentUserId) return;
  const input = document.getElementById('disc-input-' + sessionId);
  const btn = document.getElementById('disc-post-btn-' + sessionId);
  if (!input) return;
  const body = input.value.trim();
  if (!body) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Posting…'; }
  try {
    await postMessage({ sessionId, userId: currentUserId, userName: fellowName || currentUserEmail || 'Fellow', body });
    input.value = '';
    input.style.height = '38px';
    await loadSessionDiscussion(sessionId);
  } catch (err) {
    alert('Could not post. Please try again.');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Post'; }
}

async function toggleVote(messageId) {
  if (!currentUserId) return;
  const btn = document.getElementById('vote-btn-' + messageId);
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  const hasVoted = btn.classList.contains('voted');
  const countEl = btn.querySelector('.disc-vote-count');
  const count = countEl ? (parseInt(countEl.textContent, 10) || 0) : 0;
  try {
    if (hasVoted) {
      await removeVote({ messageId, userId: currentUserId });
      btn.classList.remove('voted');
      const n = Math.max(0, count - 1);
      btn.innerHTML = n > 0 ? `▲ <span class="disc-vote-count">${n}</span>` : '▲';
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', `Upvote this post${n > 0 ? `, ${n} upvote${n === 1 ? '' : 's'} so far` : ''}`);
    } else {
      await addVote({ messageId, userId: currentUserId });
      btn.classList.add('voted');
      btn.innerHTML = `▲ <span class="disc-vote-count">${count + 1}</span>`;
      btn.setAttribute('aria-pressed', 'true');
      btn.setAttribute('aria-label', `Remove upvote, ${count + 1} upvote${count === 0 ? '' : 's'} so far`);
    }
  } catch (err) {
    // leave state unchanged on failure
  }
  btn.disabled = false;
}

function editDiscMsg(id) {
  const bodyEl = document.getElementById('disc-body-' + id);
  if (!bodyEl || bodyEl.dataset.editing) return;
  const orig = bodyEl.textContent.trim();
  bodyEl.dataset.orig = orig;
  bodyEl.dataset.editing = '1';
  bodyEl.innerHTML = `
    <textarea class="disc-edit-input" id="disc-edit-ta-${id}">${escapeHTML(orig)}</textarea>
    <div class="disc-edit-actions">
      <button class="disc-edit-save" onclick="saveDiscMsg('${id}')">Save</button>
      <button class="disc-edit-cancel" onclick="cancelDiscEdit('${id}')">Cancel</button>
    </div>
  `;
  const ta = document.getElementById('disc-edit-ta-' + id);
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

function cancelDiscEdit(id) {
  const bodyEl = document.getElementById('disc-body-' + id);
  if (!bodyEl) return;
  const orig = bodyEl.dataset.orig || '';
  delete bodyEl.dataset.editing;
  delete bodyEl.dataset.orig;
  bodyEl.innerHTML = escapeHTML(orig);
}

async function saveDiscMsg(id) {
  const bodyEl = document.getElementById('disc-body-' + id);
  const ta = document.getElementById('disc-edit-ta-' + id);
  if (!bodyEl || !ta) return;
  const newText = ta.value.trim();
  if (!newText) return;
  const saveBtn = bodyEl.querySelector('.disc-edit-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  try {
    await updateMessage({ id, userId: currentUserId, body: newText });
    delete bodyEl.dataset.editing;
    delete bodyEl.dataset.orig;
    bodyEl.innerHTML = escapeHTML(newText);
  } catch (err) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    alert('Could not save — please try again.');
  }
}

async function deleteDiscMsg(id) {
  if (!confirm('Delete this message?')) return;
  try {
    await deleteMessage({ id, userId: currentUserId });
    const msgEl = document.getElementById('disc-msg-' + id);
    if (msgEl) msgEl.remove();
  } catch (err) {
    alert('Could not delete — please try again.');
  }
}

// ═══════════════════════════════════════════════════════
// RESOURCE LIBRARY
// ═══════════════════════════════════════════════════════
const _libSelFile = {};
let _libSearchTimer = null;
let _libFilter = 'all';
let _libSessionFilter = '';
let _libResources = [];

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function getResourceIcon(r) {
  if (r.type === 'link') {
    const u = (r.url || '').toLowerCase();
    if (u.includes('youtube.com') || u.includes('youtu.be') || u.includes('vimeo.com')) return '▶️';
    if (u.includes('github.com')) return '🐙';
    if (u.includes('docs.google.com') || u.includes('drive.google.com')) return '📁';
    if (u.includes('pubmed') || u.includes('ncbi.nlm') || u.includes('doi.org')) return '🔬';
    return '🔗';
  }
  const n = (r.file_name || '').toLowerCase();
  if (n.endsWith('.pdf')) return '📑';
  if (/\.(ppt|pptx|key)$/.test(n)) return '📊';
  if (/\.(doc|docx)$/.test(n)) return '📝';
  if (/\.(xls|xlsx|csv)$/.test(n)) return '📈';
  if (/\.(png|jpg|jpeg|gif|webp|svg)$/.test(n)) return '🖼️';
  if (/\.(mp4|mov|avi|mkv)$/.test(n)) return '🎬';
  return '📄';
}

function getResourceTypeLabel(r) {
  if (r.type === 'link') {
    const u = (r.url || '').toLowerCase();
    if (u.includes('youtube.com') || u.includes('youtu.be') || u.includes('vimeo.com')) return 'Video';
    if (u.includes('github.com')) return 'GitHub';
    if (u.includes('pubmed') || u.includes('ncbi.nlm')) return 'PubMed';
    if (u.includes('doi.org')) return 'Paper';
    if (u.includes('docs.google.com')) return 'Google Doc';
    return 'Link';
  }
  const n = (r.file_name || '').toLowerCase();
  if (n.endsWith('.pdf')) return 'PDF';
  if (/\.(ppt|pptx|key)$/.test(n)) return 'Slides';
  if (/\.(doc|docx)$/.test(n)) return 'Document';
  if (/\.(xls|xlsx|csv)$/.test(n)) return 'Spreadsheet';
  if (/\.(png|jpg|jpeg|gif|webp)$/.test(n)) return 'Image';
  if (/\.(mp4|mov)$/.test(n)) return 'Video';
  return 'File';
}

function renderResourceCard(r, options = {}) {
  const session = r.session_id ? SESSIONS.find(s => s.id === r.session_id) : null;
  const domain = session ? DOMAINS[session.domain] : null;
  const date = new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const isOwn = r.user_id === currentUserId;
  const icon = getResourceIcon(r);
  const typeLabel = getResourceTypeLabel(r);
  const sizeLabel = r.file_size ? formatFileSize(r.file_size) : '';

  const moduleChip = (session && domain && options.showSessionChip !== false)
    ? `<span class="lib-card-module" style="background:${domain.lt};color:${domain.color}">${escapeHTML(session.month)}</span>`
    : '';
  const sizeChip = sizeLabel ? `<span class="lib-card-size">${sizeLabel}</span>` : '';
  const openBtn = r.url
    ? `<a class="lib-card-action" href="${escapeHTML(r.url)}" target="_blank" rel="noopener">${r.type === 'file' ? 'Download' : 'Open →'}</a>`
    : '';
  const delBtn = isOwn
    ? `<button class="lib-card-delete" onclick="handleDeleteResource('${r.id}')">Delete</button>`
    : '';

  return `
    <div class="lib-card">
      <div class="lib-card-icon">${icon}</div>
      <div class="lib-card-body">
        <div class="lib-card-title">${escapeHTML(r.title)}</div>
        ${r.description ? `<div class="lib-card-desc">${escapeHTML(r.description)}</div>` : ''}
        <div class="lib-card-meta">
          <span class="lib-card-type">${escapeHTML(typeLabel)}</span>
          <span class="lib-card-author">${escapeHTML(r.user_name)}</span>
          <span class="lib-card-date">${date}</span>
          ${moduleChip}${sizeChip}
        </div>
      </div>
      <div class="lib-card-actions">${openBtn}${delBtn}</div>
    </div>
  `;
}

async function loadSessionResources(sessionId) {
  const container = document.getElementById('session-resources-list-' + sessionId);
  const addBtnWrap = document.getElementById('session-resources-actions-' + sessionId);
  if (!container) return;
  if (!currentUserId) {
    container.innerHTML = signInPromptHTML('Sign in with Google to view and share resources for this session.');
    if (addBtnWrap) addBtnWrap.style.display = 'none';
    return;
  }
  if (addBtnWrap) addBtnWrap.style.display = 'flex';
  container.innerHTML = '<div class="disc-status">Loading resources…</div>';
  try {
    const resources = await fetchResources({ sessionId });
    container.innerHTML = resources.length
      ? resources.map(r => renderResourceCard(r, { showSessionChip: false })).join('')
      : '<div class="disc-status">No resources shared for this session yet — add the first one.</div>';
  } catch (err) {
    container.innerHTML = '<div class="disc-status disc-error-msg">Could not load resources. Please refresh to try again.</div>';
  }
}

function resourceFormHTML(scope, options = {}) {
  const sessionOpts = options.showSessionSelect ? SESSIONS.map(s =>
    `<option value="${escapeHTML(s.id)}">${escapeHTML(s.month)} — ${escapeHTML(s.title)}</option>`
  ).join('') : '';

  return `
    <div id="lib-add-form-${scope}" class="lib-add-form" style="display:none;">
      <div class="lib-add-header">
        <div class="lib-type-toggle">
          <button class="lib-type-btn active" id="lib-type-link-${scope}" onclick="setLibType('${scope}','link')">🔗 Share a Link</button>
          <button class="lib-type-btn" id="lib-type-file-${scope}" onclick="setLibType('${scope}','file')">📄 Upload a File</button>
        </div>
        <button class="lib-add-close" onclick="hideLibAddForm('${scope}')">✕</button>
      </div>

      <div id="lib-link-form-${scope}">
        <div class="lib-field">
          <label class="lib-label">URL</label>
          <input id="lib-url-${scope}" class="lib-input" type="url" placeholder="https://…">
        </div>
        <div class="lib-field">
          <label class="lib-label">Title</label>
          <input id="lib-link-title-${scope}" class="lib-input" type="text" placeholder="Give it a clear, descriptive title">
        </div>
        <div class="lib-field">
          <label class="lib-label">Description <span class="lib-optional">optional</span></label>
          <textarea id="lib-link-desc-${scope}" class="lib-input lib-textarea" placeholder="What is this and why is it useful?"></textarea>
        </div>
        ${options.showSessionSelect ? `
        <div class="lib-field">
          <label class="lib-label">Related Session <span class="lib-optional">optional</span></label>
          <select id="lib-link-session-${scope}" class="lib-input lib-select">
            <option value="">— Not session-specific</option>
            ${sessionOpts}
          </select>
        </div>` : ''}
        <div id="lib-link-error-${scope}" class="lib-form-error"></div>
        <button class="lib-submit-btn" onclick="submitLibLink('${scope}')">Add Link</button>
      </div>

      <div id="lib-file-form-${scope}" style="display:none;">
        <div class="lib-drop-zone" id="lib-drop-zone-${scope}"
             ondragover="event.preventDefault();this.classList.add('dragging')"
             ondragleave="this.classList.remove('dragging')"
             ondrop="handleLibDrop(event,'${scope}')"
             onclick="document.getElementById('lib-file-input-${scope}').click()">
          <div class="lib-drop-icon">📂</div>
          <div class="lib-drop-text">Drag a file here, or click to browse</div>
          <div class="lib-drop-hint">PDF, slides, images, documents — max 20 MB</div>
          <input id="lib-file-input-${scope}" type="file" style="display:none;"
                 onchange="handleLibFileSelect('${scope}', this.files[0])">
        </div>
        <div id="lib-file-selected-${scope}" style="display:none;" class="lib-file-selected">
          <span id="lib-file-name-display-${scope}" style="flex:1;"></span>
          <button onclick="clearLibFile('${scope}')" style="background:none;border:none;cursor:pointer;color:var(--text-lt);font-size:14px;padding:2px 6px;line-height:1;">✕</button>
        </div>
        <div class="lib-field">
          <label class="lib-label">Title</label>
          <input id="lib-file-title-${scope}" class="lib-input" type="text" placeholder="Give it a clear, descriptive title">
        </div>
        <div class="lib-field">
          <label class="lib-label">Description <span class="lib-optional">optional</span></label>
          <textarea id="lib-file-desc-${scope}" class="lib-input lib-textarea" placeholder="What is this and why is it useful?"></textarea>
        </div>
        ${options.showSessionSelect ? `
        <div class="lib-field">
          <label class="lib-label">Related Session <span class="lib-optional">optional</span></label>
          <select id="lib-file-session-${scope}" class="lib-input lib-select">
            <option value="">— Not session-specific</option>
            ${sessionOpts}
          </select>
        </div>` : ''}
        <div id="lib-file-error-${scope}" class="lib-form-error"></div>
        <button class="lib-submit-btn" id="lib-upload-btn-${scope}" onclick="submitLibFile('${scope}')">Upload File</button>
      </div>
    </div>
  `;
}

function showLibAddForm(scope) {
  const f = document.getElementById('lib-add-form-' + scope);
  if (!f) return;
  f.style.display = 'block';
  setLibType(scope, 'link');
  f.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideLibAddForm(scope) {
  const f = document.getElementById('lib-add-form-' + scope);
  if (f) f.style.display = 'none';
}

function setLibType(scope, type) {
  const isFile = type === 'file';
  document.getElementById(`lib-type-link-${scope}`)?.classList.toggle('active', !isFile);
  document.getElementById(`lib-type-file-${scope}`)?.classList.toggle('active', isFile);
  const linkForm = document.getElementById(`lib-link-form-${scope}`);
  const fileForm = document.getElementById(`lib-file-form-${scope}`);
  if (linkForm) linkForm.style.display = isFile ? 'none' : 'block';
  if (fileForm) fileForm.style.display = isFile ? 'block' : 'none';
}

async function submitLibLink(scope) {
  const url = (document.getElementById(`lib-url-${scope}`)?.value || '').trim();
  const title = (document.getElementById(`lib-link-title-${scope}`)?.value || '').trim();
  const desc = (document.getElementById(`lib-link-desc-${scope}`)?.value || '').trim();
  const selectEl = document.getElementById(`lib-link-session-${scope}`);
  const sessionId = selectEl ? selectEl.value : scope;
  const errEl = document.getElementById(`lib-link-error-${scope}`);

  if (!url) { if (errEl) errEl.textContent = 'Please enter a URL.'; return; }
  if (!title) { if (errEl) errEl.textContent = 'Please enter a title.'; return; }
  if (errEl) errEl.textContent = '';

  const btn = document.querySelector(`#lib-link-form-${scope} .lib-submit-btn`);
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }

  try {
    await addLinkResource({
      userId: currentUserId, userName: fellowName || currentUserEmail || 'Fellow',
      title, description: desc, url, sessionId: sessionId || null,
    });
    document.getElementById(`lib-url-${scope}`).value = '';
    document.getElementById(`lib-link-title-${scope}`).value = '';
    document.getElementById(`lib-link-desc-${scope}`).value = '';
    if (selectEl) selectEl.value = '';
    hideLibAddForm(scope);
    await refreshResourceScope(scope);
  } catch (err) {
    if (errEl) errEl.textContent = 'Could not add resource. Please try again.';
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Add Link'; }
}

function handleLibDrop(event, scope) {
  event.preventDefault();
  event.currentTarget.classList.remove('dragging');
  const file = event.dataTransfer.files[0];
  if (file) setLibFile(scope, file);
}

function handleLibFileSelect(scope, file) {
  if (file) setLibFile(scope, file);
}

function setLibFile(scope, file) {
  if (file.size > 20 * 1024 * 1024) {
    alert('That file is over 20 MB. Please upload a smaller file, or share a link instead.');
    return;
  }
  _libSelFile[scope] = file;
  const selectedEl = document.getElementById(`lib-file-selected-${scope}`);
  const nameEl = document.getElementById(`lib-file-name-display-${scope}`);
  const dropZone = document.getElementById(`lib-drop-zone-${scope}`);
  if (selectedEl) selectedEl.style.display = 'flex';
  if (nameEl) nameEl.textContent = `${file.name} (${formatFileSize(file.size)})`;
  if (dropZone) dropZone.style.display = 'none';
  const titleEl = document.getElementById(`lib-file-title-${scope}`);
  if (titleEl && !titleEl.value) titleEl.value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
}

function clearLibFile(scope) {
  delete _libSelFile[scope];
  const selectedEl = document.getElementById(`lib-file-selected-${scope}`);
  const dropZone = document.getElementById(`lib-drop-zone-${scope}`);
  if (selectedEl) selectedEl.style.display = 'none';
  if (dropZone) dropZone.style.display = 'block';
  const inp = document.getElementById(`lib-file-input-${scope}`);
  if (inp) inp.value = '';
}

async function submitLibFile(scope) {
  const errEl = document.getElementById(`lib-file-error-${scope}`);
  const file = _libSelFile[scope];
  if (!file) { if (errEl) errEl.textContent = 'Please select a file first.'; return; }

  const title = (document.getElementById(`lib-file-title-${scope}`)?.value || '').trim();
  const desc = (document.getElementById(`lib-file-desc-${scope}`)?.value || '').trim();
  const selectEl = document.getElementById(`lib-file-session-${scope}`);
  const sessionId = selectEl ? selectEl.value : scope;

  if (!title) { if (errEl) errEl.textContent = 'Please enter a title.'; return; }
  if (errEl) errEl.textContent = '';

  const btn = document.getElementById(`lib-upload-btn-${scope}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }

  try {
    await uploadFileResource({
      userId: currentUserId, userName: fellowName || currentUserEmail || 'Fellow',
      title, description: desc, file, sessionId: sessionId || null,
    });
    clearLibFile(scope);
    document.getElementById(`lib-file-title-${scope}`).value = '';
    document.getElementById(`lib-file-desc-${scope}`).value = '';
    if (selectEl) selectEl.value = '';
    hideLibAddForm(scope);
    await refreshResourceScope(scope);
  } catch (err) {
    if (errEl) errEl.textContent = 'Upload failed: ' + (err.message || 'please try again.');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Upload File'; }
}

async function refreshResourceScope(scope) {
  if (scope === 'global') {
    await loadLibraryResources();
  } else {
    await loadSessionResources(scope);
  }
}

async function handleDeleteResource(id) {
  if (!confirm('Remove this resource from the library?')) return;
  const existing = _libResources.find(r => r.id === id);
  try {
    await deleteResource({ id, userId: currentUserId, url: existing?.url, type: existing?.type });
    if (activeView === 'library') {
      await loadLibraryResources(document.getElementById('lib-search-input')?.value || '');
    } else if (activeSessionId) {
      await loadSessionResources(activeSessionId);
    }
  } catch (err) {
    alert('Could not delete — please try again.');
  }
}

// ═══════════════════════════════════════════════════════
// RESOURCE LIBRARY HUB + BREADCRUMBS
// ═══════════════════════════════════════════════════════
function renderBreadcrumb(items) {
  return `
    <div class="lib-breadcrumb">
      ${items.map((item, i) => {
        const isLast = i === items.length - 1;
        return isLast
          ? `<span class="lib-breadcrumb-current">${escapeHTML(item.label)}</span>`
          : `<button class="lib-breadcrumb-link" onclick="${item.onclick}">${escapeHTML(item.label)}</button><span class="lib-breadcrumb-sep">/</span>`;
      }).join('')}
    </div>
  `;
}

function renderFolderTile({ title, description, color, onclick }) {
  return `
    <button class="folder-tile" onclick="${onclick}">
      <div class="folder-tile-icon" style="background:${color}"></div>
      <div class="folder-tile-title">${escapeHTML(title)}</div>
      <div class="folder-tile-desc">${escapeHTML(description)}</div>
      <div class="folder-tile-open">Open →</div>
    </button>
  `;
}

function buildLibraryHubPanel() {
  const panel = document.getElementById('libraryHubPanel');
  if (!panel) return;
  panel.innerHTML = `
    <div class="session-header" style="padding-top:0;">
      <div class="session-eyebrow"><span class="session-month-label">Fellowship-Wide</span></div>
      <h1 class="session-title">Resource Library</h1>
      <p class="session-description" style="border-bottom:none;padding-bottom:0;margin-bottom:24px;">
        Everything fellows and PSiX staff have gathered in one place — organized so you can find what you need without digging.
      </p>
    </div>
    <div class="folder-grid">
      ${renderFolderTile({ title: 'Community Resources', description: 'Readings, links, slides, and files shared by fellows — searchable across every session.', color: 'var(--con)', onclick: "showSecondaryView('libraryresources')" })}
      ${renderFolderTile({ title: 'Funding Opportunities', description: 'A curated list of funders relevant to purpose science and community-engaged research.', color: 'var(--all)', onclick: "showSecondaryView('funding')" })}
      ${renderFolderTile({ title: 'CV & Dossier Tools', description: "Turn this year's work into CV lines and tenure-dossier-ready language.", color: 'var(--gra)', onclick: "showSecondaryView('cvdossier')" })}
      ${renderFolderTile({ title: 'Artifact Guide', description: 'See how your monthly artifacts fit together, and browse a full sample portfolio.', color: 'var(--tea)', onclick: "showSecondaryView('artifactguide')" })}
    </div>
  `;
}

function buildArtifactGuidePanel() {
  const panel = document.getElementById('artifactGuidePanel');
  if (!panel) return;
  panel.innerHTML = `
    ${renderBreadcrumb([{ label: 'Resource Library', onclick: 'showLibrary()' }, { label: 'Artifact Guide' }])}
    <div class="session-header" style="padding-top:0;">
      <div class="session-eyebrow"><span class="session-month-label">Artifact Guide</span></div>
      <h1 class="session-title">Understand Your Portfolio</h1>
      <p class="session-description" style="border-bottom:none;padding-bottom:0;margin-bottom:24px;">
        Two ways to see the whole picture: how each month's artifact fits into the capstone, and what a fully finished portfolio looks like.
      </p>
    </div>
    <div class="folder-grid">
      ${renderFolderTile({ title: 'How It Fits Together', description: 'A click-to-explore map showing how each monthly artifact builds toward your capstone portfolio.', color: 'var(--tea)', onclick: "showSecondaryView('conceptmap')" })}
      ${renderFolderTile({ title: 'Sample Portfolio', description: 'A fictional, fully-worked example of a completed year — illustrative only.', color: 'var(--tra)', onclick: "showSecondaryView('sampleportfolio')" })}
      ${renderFolderTile({ title: 'My Portfolio', description: "Your own artifacts, pulled from what you've drafted this year — export a clean copy for your dossier.", color: 'var(--gold)', onclick: "showSecondaryView('myportfolio')" })}
    </div>
  `;
}

function renderStaffResourceCard(resource) {
  const isReady = resource.status === 'ready';
  const isDownload = isReady && !!resource.url;
  const badgeLabel = isDownload ? 'PSiX Resource' : 'PSiX Sample';
  let action;
  if (isDownload) {
    action = `<a class="lib-card-action" href="${escapeHTML(resource.url)}" target="_blank" rel="noopener" download>Download →</a>`;
  } else if (isReady) {
    action = `<button class="lib-card-action" onclick="showSecondaryView('${resource.routeKey}')">Read →</button>`;
  } else {
    action = `<span class="lib-card-action" style="color:var(--text-lt);cursor:default;">Pending</span>`;
  }
  return `
    <div class="lib-card staff-resource-card">
      <div class="lib-card-icon">${resource.kind === 'Syllabus' ? '📘' : '📝'}</div>
      <div class="lib-card-body">
        <div class="lib-card-title">${escapeHTML(resource.title)}</div>
        <div class="lib-card-desc">${escapeHTML(resource.description)}</div>
        <div class="lib-card-meta">
          <span class="lib-card-type">${escapeHTML(resource.kind)}</span>
          <span class="staff-resource-badge">${badgeLabel}</span>
          ${!isReady ? '<span class="lib-card-size">Coming soon</span>' : ''}
        </div>
      </div>
      <div class="lib-card-actions">
        ${action}
      </div>
    </div>
  `;
}

function buildSampleConceptNotePanel() {
  const panel = document.getElementById('sampleConceptNotePanel');
  if (!panel) return;
  panel.innerHTML = `
    ${renderBreadcrumb([{ label: 'Resource Library', onclick: 'showLibrary()' }, { label: 'Community Resources', onclick: "showSecondaryView('libraryresources')" }, { label: 'Sample Concept Note' }])}
    <div class="sample-banner">
      <span class="sample-banner-badge">Illustrative Only</span>
      <span class="sample-banner-text">This concept note describes a fictional project — same fictional fellow and topic as the Sample Portfolio. It exists to show the format and length of a concept note, not to be copied.</span>
    </div>
    <div class="session-header" style="padding-top:0;">
      <div class="session-eyebrow"><span class="session-month-label">${escapeHTML(SAMPLE_CONCEPT_NOTE.subtitle)}</span></div>
      <h1 class="session-title">${escapeHTML(SAMPLE_CONCEPT_NOTE.title)}</h1>
      <p class="session-description" style="border-bottom:none;padding-bottom:0;margin-bottom:8px;">${escapeHTML(SAMPLE_CONCEPT_NOTE.author)}</p>
    </div>
    <div class="concept-note-sections">
      ${SAMPLE_CONCEPT_NOTE.sections.map(s => `
        <section class="resource-section">
          <div class="resource-section-header">
            <div class="resource-section-title">${escapeHTML(s.heading)}</div>
          </div>
          <div class="portfolio-overview-text">${escapeHTML(s.body)}</div>
        </section>
      `).join('')}
    </div>
  `;
}

function buildLibraryResourcesPanel() {
  const panel = document.getElementById('libraryResourcesPanel');
  if (!panel) return;
  const sessionOpts = SESSIONS.map(s =>
    `<option value="${escapeHTML(s.id)}">${escapeHTML(s.month)} — ${escapeHTML(s.title)}</option>`
  ).join('');

  panel.innerHTML = `
    ${renderBreadcrumb([{ label: 'Resource Library', onclick: 'showLibrary()' }, { label: 'Community Resources' }])}
    <div class="session-header" style="padding-top:0;">
      <div class="session-eyebrow"><span class="session-month-label">Fellowship-Wide</span></div>
      <h1 class="session-title">Community Resources</h1>
      <p class="session-description" style="border-bottom:none;padding-bottom:0;margin-bottom:24px;">
        Share readings, slides, links, and files with the rest of the cohort. Search across every session, or filter down to what's relevant right now.
      </p>
    </div>
    <div class="staff-resources">
      <div class="staff-resources-label">PSiX-Provided Samples</div>
      <div class="staff-resources-grid">
        ${STAFF_RESOURCES.map(renderStaffResourceCard).join('')}
      </div>
    </div>
    <div class="lib-toolbar">
      <input class="lib-search" id="lib-search-input" type="search" placeholder="Search resources…" oninput="debounceLibSearch(this.value)">
      <select class="lib-input lib-select" id="lib-session-filter" style="max-width:240px;" onchange="filterLibSession(this.value)">
        <option value="">All sessions</option>
        ${sessionOpts}
      </select>
      <button class="lib-add-btn" onclick="showLibAddForm('global')">+ Add Resource</button>
    </div>
    ${resourceFormHTML('global', { showSessionSelect: true })}
    <div class="lib-filter-tabs">
      <button class="lib-filter-tab active" data-filter="all" onclick="filterLibType('all')">All</button>
      <button class="lib-filter-tab" data-filter="file" onclick="filterLibType('file')">📄 Files</button>
      <button class="lib-filter-tab" data-filter="link" onclick="filterLibType('link')">🔗 Links & Videos</button>
    </div>
    <div id="lib-list"><div class="disc-status">Loading resources…</div></div>
  `;

  _libFilter = 'all';
  _libSessionFilter = '';
  loadLibraryResources();
}

let _libRequestId = 0;

async function loadLibraryResources(search) {
  const listEl = document.getElementById('lib-list');
  if (!currentUserId) {
    if (listEl) listEl.innerHTML = signInPromptHTML('Sign in with Google to view and share resources.');
    const addBtn = document.querySelector('#libraryResourcesPanel .lib-add-btn');
    if (addBtn) addBtn.style.display = 'none';
    return;
  }
  if (listEl) listEl.innerHTML = '<div class="disc-status">Loading resources…</div>';
  const requestId = ++_libRequestId;
  try {
    const resources = await fetchResources({ search, sessionId: _libSessionFilter || undefined });
    if (requestId !== _libRequestId) return; // a newer search superseded this one
    _libResources = resources;
    renderLibraryList();
  } catch (err) {
    if (requestId !== _libRequestId) return;
    if (listEl) listEl.innerHTML = '<div class="disc-status disc-error-msg">Could not load resources. Please refresh to try again.</div>';
  }
}

function renderLibraryList() {
  const listEl = document.getElementById('lib-list');
  if (!listEl) return;
  const filtered = _libFilter === 'all' ? _libResources : _libResources.filter(r => r.type === _libFilter);
  listEl.innerHTML = filtered.length
    ? filtered.map(r => renderResourceCard(r)).join('')
    : '<div class="disc-status">No resources match yet — try a different search or filter, or add one yourself.</div>';
}

function filterLibType(type) {
  _libFilter = type;
  document.querySelectorAll('#libraryResourcesPanel .lib-filter-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === type));
  renderLibraryList();
}

function filterLibSession(sessionId) {
  _libSessionFilter = sessionId;
  loadLibraryResources(document.getElementById('lib-search-input')?.value || '');
}

function debounceLibSearch(value) {
  clearTimeout(_libSearchTimer);
  _libSearchTimer = setTimeout(() => { loadLibraryResources(value || ''); }, 350);
}

// ═══════════════════════════════════════════════════════
// CONCEPT MAP (theory of change)
// ═══════════════════════════════════════════════════════
const _mapOpenChip = {};

function conceptMapChipId(componentId, sessionId) {
  return `map-chip-${componentId}-${sessionId}`;
}

function renderConceptMapLane(component) {
  const items = component.sessionIds
    .map(sid => ({ session: SESSIONS.find(s => s.id === sid), artifact: PORTFOLIO_ARTIFACTS.find(a => a.sessionId === sid) }))
    .filter(x => x.session && x.artifact);

  return `
    <div class="map-lane">
      <div class="map-lane-header">
        <div class="map-lane-title">${escapeHTML(component.title)}</div>
        <div class="map-lane-desc">${escapeHTML(component.description)}</div>
      </div>
      <div class="map-chip-row">
        ${items.map(({ session, artifact }) => {
          const domain = DOMAINS[session.domain];
          const chipId = conceptMapChipId(component.id, session.id);
          return `
            <button class="map-chip" id="${chipId}-btn" type="button"
              aria-expanded="false" aria-controls="map-detail-${component.id}"
              onclick="toggleMapChip('${component.id}','${session.id}')">
              <span class="map-chip-dot" style="background:${domain.color}"></span>
              ${escapeHTML(session.month)}
            </button>
          `;
        }).join('')}
      </div>
      <div class="map-detail" id="map-detail-${component.id}"></div>
    </div>
  `;
}

function toggleMapChip(componentId, sessionId) {
  const isOpen = _mapOpenChip[componentId] === sessionId;
  _mapOpenChip[componentId] = isOpen ? null : sessionId;
  renderMapLaneDetail(componentId);
}

function renderMapLaneDetail(componentId) {
  const component = CAPSTONE_COMPONENTS.find(c => c.id === componentId);
  const detailEl = document.getElementById('map-detail-' + componentId);
  if (!component || !detailEl) return;
  const openSessionId = _mapOpenChip[componentId];

  component.sessionIds.forEach(sid => {
    const btn = document.getElementById(conceptMapChipId(componentId, sid) + '-btn');
    if (!btn) return;
    const isActive = sid === openSessionId;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-expanded', String(isActive));
  });

  if (!openSessionId) {
    detailEl.innerHTML = '';
    detailEl.classList.remove('open');
    return;
  }

  const session = SESSIONS.find(s => s.id === openSessionId);
  const artifact = PORTFOLIO_ARTIFACTS.find(a => a.sessionId === openSessionId);
  if (!session || !artifact) return;
  const domain = DOMAINS[session.domain];

  detailEl.classList.add('open');
  detailEl.innerHTML = `
    <div class="map-detail-card" role="region" aria-label="${escapeHTML(session.month)} artifact detail">
      <div class="map-detail-month" style="color:${domain.color}">${escapeHTML(session.month)} · ${escapeHTML(domain.label)}</div>
      <div class="map-detail-title">${escapeHTML(artifact.label)}</div>
      <div class="map-detail-purpose">${escapeHTML(artifact.purpose)}</div>
      <div class="map-detail-prompt-label">The Prompt</div>
      <div class="map-detail-prompt">${escapeHTML(artifact.prompt)}</div>
      <button class="map-detail-link" onclick="goToTask('${session.id}','portfolio')">Open ${escapeHTML(session.month)}'s portfolio tab →</button>
    </div>
  `;
}

function buildConceptMapPanel() {
  const panel = document.getElementById('conceptMapPanel');
  if (!panel) return;
  Object.keys(_mapOpenChip).forEach(k => delete _mapOpenChip[k]);
  panel.innerHTML = `
    ${renderBreadcrumb([{ label: 'Resource Library', onclick: 'showLibrary()' }, { label: 'Artifact Guide', onclick: "showSecondaryView('artifactguide')" }, { label: 'How It Fits Together' }])}
    <div class="session-header" style="padding-top:0;">
      <div class="session-eyebrow"><span class="session-month-label">Theory of Change</span></div>
      <h1 class="session-title">How Your Portfolio Comes Together</h1>
      <p class="session-description" style="border-bottom:none;padding-bottom:0;margin-bottom:8px;">
        Every month produces one artifact. None of it is busywork — each artifact is a building block for one or more of the six pieces that make up your capstone portfolio. Click any month below to see why it's there and what it's building toward.
      </p>
    </div>
    <div class="map-flow-label">12 Monthly Artifacts</div>
    <div class="map-lanes">
      ${CAPSTONE_COMPONENTS.map(renderConceptMapLane).join('')}
    </div>
    <div class="map-flow-label">↓ Presented at the June Culminating Symposium</div>
    <div class="map-final-card">
      <div class="map-final-title">Your Capstone Portfolio</div>
      <div class="map-final-text">Six components, twelve months of work, one coherent account of the scholar, partner, and teacher you're becoming — presented to Lab of Labs researchers, Purpose Commons partners, and invited guests.</div>
      <button class="dashboard-link-button" style="margin-top:10px;" onclick="showSamplePortfolio()">See what a finished portfolio looks like →</button>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════
// SAMPLE PORTFOLIO (illustrative, fictional)
// ═══════════════════════════════════════════════════════
function renderSampleAims(sample) {
  return `
    <div class="aims-box-row">
      ${sample.aims.map(a => `
        <div class="aims-box">
          <div class="aims-box-title">${escapeHTML(a.title)}</div>
          <div class="aims-box-text">${escapeHTML(a.text)}</div>
        </div>
      `).join('')}
    </div>
    ${sample.content ? `<div class="sample-card-note"><em>Reviewer note:</em> ${escapeHTML(sample.content)}</div>` : ''}
  `;
}

function renderSampleTimeline(sample) {
  return `
    <div class="sample-timeline">
      ${sample.timeline.map(t => `
        <div class="timeline-step${t.risk ? ' risk' : ''}">
          <div class="timeline-dot"></div>
          <div class="timeline-when">${escapeHTML(t.when)}</div>
          <div class="timeline-label">${escapeHTML(t.label)}</div>
          <div class="timeline-detail">${escapeHTML(t.detail)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderSampleSlides(sample) {
  return `
    <div class="slide-strip">
      ${sample.slides.map((s, i) => `
        <div class="slide-card">
          <div class="slide-num">${i + 1}</div>
          <div class="slide-title">${escapeHTML(s.title)}</div>
          <ul class="slide-bullets">${s.bullets.map(b => `<li>${escapeHTML(b)}</li>`).join('')}</ul>
        </div>
      `).join('')}
    </div>
  `;
}

function buildSamplePortfolioPanel() {
  const panel = document.getElementById('samplePortfolioPanel');
  if (!panel) return;

  const artifactCards = SAMPLE_ARTIFACTS.map(sample => {
    const session = SESSIONS.find(s => s.id === sample.sessionId);
    const artifact = PORTFOLIO_ARTIFACTS.find(a => a.sessionId === sample.sessionId);
    if (!session || !artifact) return '';
    const domain = DOMAINS[session.domain];
    const isVisual = sample.format === 'aims' || sample.format === 'timeline' || sample.format === 'slides';
    let body = `<div class="sample-card-content">${escapeHTML(sample.content)}</div>`;
    if (sample.format === 'aims') body = renderSampleAims(sample);
    else if (sample.format === 'timeline') body = renderSampleTimeline(sample);
    else if (sample.format === 'slides') body = renderSampleSlides(sample);
    return `
      <div class="sample-card${isVisual ? ' sample-card-full' : ''}">
        <div class="sample-card-header">
          <span class="sample-card-month" style="color:${domain.color}">${escapeHTML(session.month)}</span>
          <span class="artifact-chip">${escapeHTML(artifact.component)}</span>
        </div>
        <div class="sample-card-title">${escapeHTML(artifact.label)}</div>
        <div class="sample-card-prompt"><em>Prompt:</em> ${escapeHTML(artifact.prompt)}</div>
        ${body}
      </div>
    `;
  }).join('');

  panel.innerHTML = `
    ${renderBreadcrumb([{ label: 'Resource Library', onclick: 'showLibrary()' }, { label: 'Artifact Guide', onclick: "showSecondaryView('artifactguide')" }, { label: 'Sample Portfolio' }])}
    <div class="sample-banner">
      <span class="sample-banner-badge">Illustrative Only</span>
      <span class="sample-banner-text">This entire portfolio — the fellow, institution, research topic, and community partner — is fictional. It exists to show the structure and depth of finished work, not to be copied. Your portfolio should look nothing like this one.</span>
    </div>
    <div class="session-header" style="padding-top:0;">
      <div class="session-eyebrow"><span class="session-month-label">Sample Portfolio</span></div>
      <h1 class="session-title">A Finished Year, Start to Finish</h1>
      <p class="session-description" style="border-bottom:none;padding-bottom:0;margin-bottom:8px;">
        Meet <strong>${escapeHTML(SAMPLE_FELLOW.name)}</strong> of ${escapeHTML(SAMPLE_FELLOW.institution)}, whose fictional research traces
        <em>${escapeHTML(SAMPLE_FELLOW.focus)}</em>, in partnership with ${escapeHTML(SAMPLE_FELLOW.partner)}.
      </p>
    </div>
    <div class="sample-grid">${artifactCards}</div>
    <div class="sample-card sample-card-capstone">
      <div class="sample-card-header">
        <span class="sample-card-month" style="color:var(--gold)">June</span>
        <span class="artifact-chip">Synthesis</span>
      </div>
      <div class="sample-card-title">Capstone Portfolio Narrative</div>
      <div class="sample-card-content">${escapeHTML(SAMPLE_CAPSTONE_NARRATIVE)}</div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════
// MY PORTFOLIO (real fellow artifacts, exportable to PDF)
// ═══════════════════════════════════════════════════════
function exportMyPortfolio() {
  document.body.classList.add('printing-portfolio');
  window.print();
}

function buildMyPortfolioPanel() {
  const panel = document.getElementById('myPortfolioPanel');
  if (!panel) return;

  const cards = PORTFOLIO_ARTIFACTS.map(artifact => {
    const session = SESSIONS.find(s => s.id === artifact.sessionId);
    if (!session) return '';
    const domain = DOMAINS[session.domain];
    const format = artifact.format || 'text';
    const draft = getArtifactDraft(session.id);
    const hasContent = hasArtifactContent(session.id);
    const isVisual = hasContent && (format === 'aims' || format === 'timeline' || format === 'slides');
    let body;
    if (!hasContent) {
      body = `<div class="sample-card-content my-portfolio-empty">Not started yet. <button class="dashboard-link-button no-print" onclick="goToTask('${session.id}','portfolio')">Draft this artifact →</button></div>`;
    } else if (format === 'text') {
      body = `<div class="sample-card-content">${escapeHTML(draft.text)}</div>`;
    } else {
      body = renderArtifactPreview(format, draft);
    }
    return `
      <div class="sample-card${isVisual ? ' sample-card-full' : ''}">
        <div class="sample-card-header">
          <span class="sample-card-month" style="color:${domain.color}">${escapeHTML(session.month)}</span>
          <span class="artifact-chip">${escapeHTML(artifact.component)}</span>
        </div>
        <div class="sample-card-title">${escapeHTML(artifact.label)}</div>
        <div class="sample-card-prompt"><em>Prompt:</em> ${escapeHTML(artifact.prompt)}</div>
        ${body}
      </div>
    `;
  }).join('');

  const stats = getPortfolioStats();

  panel.innerHTML = `
    ${renderBreadcrumb([{ label: 'Resource Library', onclick: 'showLibrary()' }, { label: 'Artifact Guide', onclick: "showSecondaryView('artifactguide')" }, { label: 'My Portfolio' }])}
    <div class="session-header" style="padding-top:0;">
      <div class="session-eyebrow"><span class="session-month-label">My Portfolio</span></div>
      <h1 class="session-title">${escapeHTML(fellowName ? fellowName + "'s" : 'Your')} Fellowship Portfolio</h1>
      <p class="session-description" style="border-bottom:none;padding-bottom:8px;">
        Your own artifacts, pulled directly from what you've drafted across the year — ${stats.complete}/${stats.total} months complete. Nothing here is fictional; if a month looks empty, you haven't drafted it yet.
      </p>
      <button class="btn-outline no-print" onclick="exportMyPortfolio()">⎙ Export / Save as PDF</button>
    </div>
    <div class="sample-grid">${cards}</div>
  `;
}

// ═══════════════════════════════════════════════════════
// CV & DOSSIER TOOLS
// ═══════════════════════════════════════════════════════
function getCvDetails() {
  const defaults = { cohortYear: '', researchTitle: '', partnerOrg: '', courseTitle: '' };
  const raw = localStorage.getItem(`${STORAGE_PREFIX}:cvdetails`);
  if (!raw) return defaults;
  try {
    return { ...defaults, ...JSON.parse(raw) };
  } catch (err) {
    return defaults;
  }
}

function saveCvDetails(details) {
  localStorage.setItem(`${STORAGE_PREFIX}:cvdetails`, JSON.stringify(details));
}

function hasArtifactContent(sessionId) {
  const draft = getArtifactDraft(sessionId);
  if (!draft) return false;
  if (draft.format === 'aims') return draft.aims.some(a => (a.text || '').trim()) || (draft.note || '').trim();
  if (draft.format === 'timeline') return Boolean((draft.allies || '').trim() || (draft.constraints || '').trim() || (draft.moves || '').trim());
  if (draft.format === 'slides') return draft.slides.some(s => (s.title || '').trim());
  return Boolean((draft.text || '').trim());
}

function buildCvLines(details) {
  const year = details.cohortYear.trim() || '[cohort year]';
  const researchTitle = details.researchTitle.trim() || '[your research project title]';
  const partnerOrg = details.partnerOrg.trim() || '[community partner organization]';
  const courseTitle = details.courseTitle.trim() || '[course/module title]';

  const lines = [
    { id: 'fellowship', section: 'Honors & Fellowships', text: `Purpose Science & Innovation Exchange (PSiX) Fellow, Purpose Commons, ${year}` },
  ];
  if (hasArtifactContent('dec') || hasArtifactContent('apr')) {
    lines.push({ id: 'grant', section: 'Grants Submitted', text: `"${researchTitle}," developed through the Purpose Science & Innovation Exchange (PSiX) Fellowship, ${year}` });
  }
  if (hasArtifactContent('nov')) {
    lines.push({ id: 'partnership', section: 'Community-Engaged Research', text: `Established community-engaged research partnership with ${partnerOrg}, Purpose Science & Innovation Exchange (PSiX) Fellowship, ${year}` });
  }
  if (hasArtifactContent('may')) {
    lines.push({ id: 'course', section: 'Teaching / Course Development', text: `Designed and developed "${courseTitle}," a purpose science course module, as part of the PSiX Fellowship teaching requirement, ${year}` });
  }
  lines.push({ id: 'professional-dev', section: 'Professional Development', text: `Completed year-long fellowship in translational research, community-engaged methods, grant writing, and course design (Purpose Science & Innovation Exchange), Purpose Commons, ${year}` });
  return lines;
}

function renderCvLines() {
  const listEl = document.getElementById('cv-lines-list');
  if (!listEl) return;
  const lines = buildCvLines(getCvDetails());
  listEl.innerHTML = lines.map(l => `
    <div class="cv-line">
      <div class="cv-line-body">
        <div class="cv-line-section">${escapeHTML(l.section)}</div>
        <div class="cv-line-text">${escapeHTML(l.text)}</div>
      </div>
      <button class="cv-line-copy" onclick="copyCvLine(this, '${l.id}')">Copy</button>
    </div>
  `).join('');
}

function handleCvDetailsInput() {
  saveCvDetails({
    cohortYear: document.getElementById('cv-year')?.value || '',
    researchTitle: document.getElementById('cv-research')?.value || '',
    partnerOrg: document.getElementById('cv-partner')?.value || '',
    courseTitle: document.getElementById('cv-course')?.value || '',
  });
  renderCvLines();
}

async function copyCvLine(btn, id) {
  const line = buildCvLines(getCvDetails()).find(l => l.id === id);
  if (!line) return;
  try {
    await navigator.clipboard.writeText(line.text);
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1200);
  } catch (err) {
    // clipboard unavailable — nothing to do
  }
}

async function copyAllCvLines() {
  const lines = buildCvLines(getCvDetails());
  const statusEl = document.getElementById('cv-copy-status');
  try {
    await navigator.clipboard.writeText(lines.map(l => l.text).join('\n'));
    if (statusEl) {
      statusEl.textContent = 'Copied all lines to clipboard.';
      setTimeout(() => { statusEl.textContent = ''; }, 2200);
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Could not copy automatically — select and copy manually.';
  }
}

function buildCvDossierPanel() {
  const panel = document.getElementById('cvDossierPanel');
  if (!panel) return;
  const details = getCvDetails();
  panel.innerHTML = `
    ${renderBreadcrumb([{ label: 'Resource Library', onclick: 'showLibrary()' }, { label: 'CV & Dossier Tools' }])}
    <div class="session-header" style="padding-top:0;">
      <div class="session-eyebrow"><span class="session-month-label">For Early-Career Faculty</span></div>
      <h1 class="session-title">CV &amp; Dossier Tools</h1>
      <p class="session-description" style="border-bottom:none;padding-bottom:0;margin-bottom:8px;">
        Turn this year's fellowship work into CV lines and dossier-ready language — the translation work that usually happens the week before a deadline.
      </p>
    </div>
    <section class="resource-section">
      <div class="resource-section-header">
        <div class="resource-section-title">CV Line Generator</div>
        <div class="resource-section-note">Fill in a few details once</div>
      </div>
      <div class="cv-form-grid">
        <div><label class="lib-label">Cohort Year</label><input class="lib-input" id="cv-year" type="text" placeholder="2025–2026" value="${escapeHTML(details.cohortYear)}" oninput="handleCvDetailsInput()"></div>
        <div><label class="lib-label">Research Project Title</label><input class="lib-input" id="cv-research" type="text" placeholder="Your project's working title" value="${escapeHTML(details.researchTitle)}" oninput="handleCvDetailsInput()"></div>
        <div><label class="lib-label">Community Partner Org</label><input class="lib-input" id="cv-partner" type="text" placeholder="e.g., a local youth-serving organization" value="${escapeHTML(details.partnerOrg)}" oninput="handleCvDetailsInput()"></div>
        <div><label class="lib-label">Course / Module Title</label><input class="lib-input" id="cv-course" type="text" placeholder="e.g., your course module's title" value="${escapeHTML(details.courseTitle)}" oninput="handleCvDetailsInput()"></div>
      </div>
      <div id="cv-lines-list" class="cv-lines-list"></div>
      <button class="lib-add-btn" style="margin-top:14px;" onclick="copyAllCvLines()">Copy All Lines</button>
      <span id="cv-copy-status" class="cv-copy-status"></span>
    </section>
    <section class="resource-section">
      <div class="resource-section-header">
        <div class="resource-section-title">Tenure Dossier Bridge</div>
        <div class="resource-section-note">Where each artifact belongs in a standard dossier</div>
      </div>
      <div class="dossier-grid">
        ${DOSSIER_SECTIONS.map(d => {
          const component = CAPSTONE_COMPONENTS.find(c => c.id === d.componentId);
          return `
            <div class="dossier-card">
              <div class="dossier-card-from">${escapeHTML(component ? component.title : '')}</div>
              <div class="dossier-card-arrow">↓</div>
              <div class="dossier-card-to">${escapeHTML(d.dossierSection)}</div>
              <div class="dossier-card-guidance">${escapeHTML(d.guidance)}</div>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `;
  renderCvLines();
}

// ═══════════════════════════════════════════════════════
// FUNDING OPPORTUNITIES
// ═══════════════════════════════════════════════════════
function buildFundingPanel() {
  const panel = document.getElementById('fundingPanel');
  if (!panel) return;
  panel.innerHTML = `
    ${renderBreadcrumb([{ label: 'Resource Library', onclick: 'showLibrary()' }, { label: 'Funding Opportunities' }])}
    <div class="session-header" style="padding-top:0;">
      <div class="session-eyebrow"><span class="session-month-label">Grant Writing</span></div>
      <h1 class="session-title">Funding Opportunities</h1>
      <p class="session-description" style="border-bottom:none;padding-bottom:0;margin-bottom:8px;">
        A starting list of funders whose priorities commonly align with purpose science and community-engaged developmental research. Always confirm current deadlines and requirements directly with the funder before you rely on anything here.
      </p>
    </div>
    <div class="funding-grid">
      ${FUNDING_OPPORTUNITIES.map(f => `
        <div class="funding-card">
          <div class="funding-card-name">${escapeHTML(f.name)}</div>
          <div class="funding-card-fit">${escapeHTML(f.fit)}</div>
          <div class="funding-card-cadence"><em>Cadence:</em> ${escapeHTML(f.cadence)}</div>
          ${f.link ? `<a class="lib-card-action" href="${escapeHTML(f.link)}" target="_blank" rel="noopener">Visit →</a>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

// ═══════════════════════════════════════════════════════
// SHELL SCAFFOLDING
// ═══════════════════════════════════════════════════════
function renderShell() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div id="gate-overlay"></div>
    <a href="#contentWrap" class="skip-to-content">Skip to main content</a>
    <div class="fac-toolbar" id="facToolbar" style="display:none;">
      <span class="fac-toolbar-label">🔧 Facilitator Mode</span>
      <button class="fac-toolbar-btn" id="facToolbarPreviewBtn" onclick="toggleFacilitatorPreview()">Viewing as: Facilitator — editing live</button>
      <button class="fac-toolbar-btn fac-toolbar-btn-ghost" onclick="backToFacilitatorDashboard()">← Facilitator Dashboard</button>
    </div>
    <div class="material-modal-overlay" id="material-modal-overlay" style="display:none;" onclick="if(event.target===this)closeMaterialModal()">
      <div class="material-modal">
        <div class="lib-add-header">
          <div class="material-modal-title" id="material-modal-title">Add Material</div>
          <button class="lib-add-close" onclick="closeMaterialModal()">✕</button>
        </div>
        <div class="material-modal-sub" id="material-modal-sub"></div>
        <div class="lib-type-toggle" style="margin-bottom:16px;">
          <button class="lib-type-btn active" id="material-type-link" onclick="setMaterialType('link')">🔗 Share a Link</button>
          <button class="lib-type-btn" id="material-type-file" onclick="setMaterialType('file')">📄 Upload a File</button>
        </div>
        <div id="material-link-form">
          <div class="lib-field">
            <label class="lib-label">URL</label>
            <input id="material-url" class="lib-input" type="url" placeholder="https://…">
          </div>
          <div class="lib-field">
            <label class="lib-label">Title</label>
            <input id="material-link-title" class="lib-input" type="text" placeholder="What fellows will see">
          </div>
          <div id="material-link-error" class="lib-form-error"></div>
          <button class="lib-submit-btn" id="material-link-submit" onclick="submitMaterialLink()">Save</button>
        </div>
        <div id="material-file-form" style="display:none;">
          <div class="lib-drop-zone" id="material-drop-zone"
               ondragover="event.preventDefault();this.classList.add('dragging')"
               ondragleave="this.classList.remove('dragging')"
               ondrop="handleMaterialDrop(event)"
               onclick="document.getElementById('material-file-input').click()">
            <div class="lib-drop-icon">📂</div>
            <div class="lib-drop-text">Drag a file here, or click to browse</div>
            <div class="lib-drop-hint">PDF, slides, images, documents — max 20 MB</div>
            <input id="material-file-input" type="file" style="display:none;" onchange="handleMaterialFileSelect(this.files[0])">
          </div>
          <div id="material-file-selected" style="display:none;" class="lib-file-selected">
            <span id="material-file-name-display" style="flex:1;"></span>
            <button onclick="clearMaterialFile()" style="background:none;border:none;cursor:pointer;color:var(--text-lt);font-size:14px;padding:2px 6px;line-height:1;">✕</button>
          </div>
          <div class="lib-field">
            <label class="lib-label">Title</label>
            <input id="material-file-title" class="lib-input" type="text" placeholder="What fellows will see">
          </div>
          <div id="material-file-error" class="lib-form-error"></div>
          <button class="lib-submit-btn" id="material-file-submit" onclick="submitMaterialFile()">Upload</button>
        </div>
        <div class="material-modal-footer" id="material-modal-footer" style="display:none;">
          <button class="material-remove-btn" onclick="removeMaterial()">Remove this item (revert to Pending)</button>
        </div>
      </div>
    </div>
    <div class="app-shell" id="fellowShell">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="brand-eyebrow">Research Fellowship</div>
          <img class="sidebar-logo" src="${LOGO_LIGHT}" alt="Purpose Science & Innovation Exchange" />
          <div class="brand-name">Translational Fellowship in Purpose Science</div>
          <div class="brand-sub">PSiX · Purpose Commons</div>
        </div>
        <div class="dashboard-nav">
          <button class="dashboard-btn active" id="dashboardNavBtn" onclick="showDashboard()">
            <span class="dashboard-icon"></span><span>Dashboard</span>
          </button>
          <button class="dashboard-btn" id="libraryNavBtn" onclick="showLibrary()">
            <span class="dashboard-icon" style="background:var(--con)"></span><span>Resource Library</span>
          </button>
        </div>
        <button class="admin-toggle-btn" id="adminToggleBtn" style="display:none;" onclick="toggleAdminView()">
          <span class="admin-toggle-icon">🔧</span><span>Facilitator Dashboard</span><span class="admin-toggle-arrow">→</span>
        </button>
        <div class="sidebar-section-label">Fellowship Year</div>
        <nav class="month-nav" id="monthNav"></nav>
        <div class="sidebar-progress" aria-label="Fellowship progress">
          <div class="sidebar-progress-label"><span>Year Progress</span><span id="sidebarProgressText">0%</span></div>
          <div class="sidebar-progress-track"><div class="sidebar-progress-fill" id="sidebarProgressFill"></div></div>
        </div>
        <div class="sidebar-legend">
          <div class="legend-title">Domains</div>
          <div class="legend-item"><div class="legend-swatch" style="background:#1B5E8A"></div><div class="legend-label">Purpose Science Content</div></div>
          <div class="legend-item"><div class="legend-swatch" style="background:#2D6B4E"></div><div class="legend-label">Translational & Community</div></div>
          <div class="legend-item"><div class="legend-swatch" style="background:#6B2738"></div><div class="legend-label">Grant Development</div></div>
          <div class="legend-item"><div class="legend-swatch" style="background:#4A3570"></div><div class="legend-label">Course Design & Teaching</div></div>
          <div class="legend-item"><div class="legend-swatch" style="background:#2B4040"></div><div class="legend-label">All Four Domains</div></div>
        </div>
        <div class="sidebar-account" id="sidebarAccount"></div>
      </aside>
      <header class="topbar">
        <div class="topbar-left">
          <div class="topbar-title">Fellow's Journey Companion</div>
          <div class="topbar-divider"></div>
          <div class="topbar-session" id="topbarSession">Select a session →</div>
        </div>
        <div class="topbar-actions">
          <div id="fellow-greeting" style="font-size:12px;font-weight:500;color:var(--text-lt);letter-spacing:0.04em;margin-right:8px;"></div>
          <button class="btn-outline" onclick="window.print()">⎙ Print Session</button>
        </div>
      </header>
      <main class="main">
        <div class="content-wrap" id="contentWrap" tabindex="-1">
          <section class="dashboard-panel active" id="dashboardPanel" aria-label="Fellowship dashboard"></section>
          <section class="dashboard-panel" id="libraryHubPanel" aria-label="Resource library"></section>
          <section class="dashboard-panel" id="libraryResourcesPanel" aria-label="Community resources"></section>
          <section class="dashboard-panel" id="artifactGuidePanel" aria-label="Artifact guide"></section>
          <section class="dashboard-panel" id="conceptMapPanel" aria-label="How your portfolio comes together"></section>
          <section class="dashboard-panel" id="samplePortfolioPanel" aria-label="Sample portfolio"></section>
          <section class="dashboard-panel" id="myPortfolioPanel" aria-label="My portfolio"></section>
          <section class="dashboard-panel" id="sampleConceptNotePanel" aria-label="Sample concept note"></section>
          <section class="dashboard-panel" id="cvDossierPanel" aria-label="CV and dossier tools"></section>
          <section class="dashboard-panel" id="fundingPanel" aria-label="Funding opportunities"></section>
          <div id="sessionPanels"></div>
        </div>
      </main>
    </div>
    <div class="facilitator-view" id="facilitatorShell"></div>
  `;
}

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
// There's one role at sign-in time now (fellow) — administrator access is a
// post-entry check (refreshAdminStatus), not a separate gate/flow — so this
// no longer needs to track or recover which gate a Google sign-in came from.

function looksLikeOAuthReturn() {
  // Supabase's implicit flow puts tokens in the hash; PKCE puts a code in
  // the query string. Either means this load is the tail end of an OAuth
  // redirect, so it's worth waiting a moment for the session to appear
  // rather than failing fast on the first empty check.
  return /access_token=|refresh_token=/.test(window.location.hash) || /[?&]code=/.test(window.location.search);
}

// Google/Supabase append error=...&error_description=... (query string) or
// #error=...&error_description=... (hash) when an OAuth sign-in fails before
// ever producing a session — e.g. a misconfigured provider or redirect. Read
// this so a failure is a visible message instead of a silent bounce back to
// the passcode screen.
function readOAuthError() {
  const params = new URLSearchParams(window.location.search.replace(/^\?/, ''));
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const err = params.get('error_description') || params.get('error')
    || hashParams.get('error_description') || hashParams.get('error');
  return err ? decodeURIComponent(err.replace(/\+/g, ' ')) : null;
}

let _resumingSession = false;
async function resumeSession(retry) {
  if (_resumingSession) return false;
  let session = await getSession();
  if (retry) {
    for (let i = 0; i < 15 && !session; i++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      session = await getSession();
    }
  }
  if (!session) return false;
  _resumingSession = true;
  try {
    currentUserId = session.user.id;
    currentUserEmail = session.user.email;
    const pendingName = sessionStorage.getItem('psix_pending_name') || '';
    sessionStorage.removeItem('psix_pending_name');
    fellowName = pendingName || localStorage.getItem(`${STORAGE_PREFIX}:fellowName`)
      || session.user.user_metadata?.full_name || fellowName;
    await pullRemoteProgress();
    refreshTaskNoteFields();
    await pullRemoteArtifacts();
    await refreshAdminStatus();
    enterApp();
    return true;
  } finally {
    _resumingSession = false;
  }
}

async function init() {
  renderShell();
  buildNav();
  buildSessions();
  buildDashboard();
  gateStep = 'pass';
  renderGate();

  onAuthChange(session => {
    if (session) {
      currentUserId = session.user.id;
      currentUserEmail = session.user.email;
    } else {
      currentUserId = null;
      currentUserEmail = null;
    }
    updateAccountPanel();
    // A magic-link click-through fires this event once Supabase finishes
    // parsing the URL — often in a brand-new tab with no in-memory state.
    // If the gate's still up when a session appears, that's our signal to
    // resume it here instead of waiting on the main init() flow below.
    const overlay = document.getElementById('gate-overlay');
    const gateStillUp = overlay && !overlay.classList.contains('hidden') && !overlay.classList.contains('fade-out');
    if (session && gateStillUp) resumeSession(false);
  });

  window.addEventListener('hashchange', () => routeFromHash({ behavior: 'smooth' }));
  window.addEventListener('afterprint', () => document.body.classList.remove('printing-portfolio'));

  const oauthError = readOAuthError();
  const wasOAuthReturn = looksLikeOAuthReturn() || Boolean(oauthError);
  const resumed = await resumeSession(wasOAuthReturn);
  if (wasOAuthReturn) {
    // Only strip when there was actually OAuth debris (tokens/code/error) in
    // the URL — otherwise this would blow away a normal deep link's hash
    // (e.g. someone bookmarking #library) on every single page load.
    history.replaceState(null, '', window.location.pathname);
  }
  if (resumed) return;

  // No live Supabase session — fall back to local recognition for fellows
  // who previously chose "Continue without syncing" on this device.
  if (localStorage.getItem(`${STORAGE_PREFIX}:localGateOK`) === '1') {
    const savedName = localStorage.getItem(`${STORAGE_PREFIX}:fellowName`) || '';
    if (savedName) {
      fellowName = savedName;
      enterApp();
      return;
    }
  }

  // Sign-in was attempted (we can tell from the returned URL) but never
  // produced a session — surface exactly why instead of silently bouncing
  // back to a blank passcode screen, which is what made this so hard to
  // diagnose remotely.
  if (wasOAuthReturn) {
    const el = document.getElementById('gate-pass-error');
    if (el) {
      el.textContent = oauthError
        ? `Sign-in failed: ${oauthError}`
        : "Sign-in didn't complete — Supabase never returned a session. Try again, and if this repeats, check Authentication → Providers → Google is enabled in Supabase.";
    }
  }
}

// Expose handlers referenced by inline HTML (module scope isn't global).
Object.assign(window, {
  showDashboard, showSession, goToTask, switchTab, showLibrary,
  showConceptMap, showSamplePortfolio, toggleMapChip, showCvDossier, showFunding, showSecondaryView,
  handleCvDetailsInput, copyCvLine, copyAllCvLines, downloadSessionICS,
  toggleGoal, toggleReading, toggleTaskCheckbox, handleTaskNoteInput,
  togglePassVisibility, gateCheckPass, gateCheckName, skipSync,
  handleGoogleSignIn, handleEmailOtpSignIn, handleSignOut, resetLocalAccess, toggleAdminView, refreshFacilitatorData,
  postDiscussionMessage, toggleVote, editDiscMsg, cancelDiscEdit, saveDiscMsg, deleteDiscMsg,
  showLibAddForm, hideLibAddForm, setLibType, submitLibLink, submitLibFile,
  handleLibDrop, handleLibFileSelect, clearLibFile, handleDeleteResource,
  filterLibType, filterLibSession, debounceLibSearch, handleArtifactInput,
  openMaterialModal, closeMaterialModal, setMaterialType, handleMaterialDrop,
  handleMaterialFileSelect, clearMaterialFile, submitMaterialLink, submitMaterialFile,
  removeMaterial, toggleFacilitatorPreview, browseFellowContent, backToFacilitatorDashboard,
  manageSessionMaterials, exportMyPortfolio,
});

init();
