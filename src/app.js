import { CONFIG } from './config.js';
import { DOMAINS, SESSIONS, PORTFOLIO_ARTIFACTS, CAPSTONE_COMPONENTS } from './curriculum.js';
import { SAMPLE_FELLOW, SAMPLE_ARTIFACTS, SAMPLE_CAPSTONE_NARRATIVE } from './samplePortfolio.js';
import {
  supabaseReady, getSession, onAuthChange, signInWithGoogle, signOut,
  isFacilitatorEmail, fetchMyProgress, syncProgressEvent,
  fetchAllProgressForFacilitators,
  fetchMessages, postMessage, updateMessage, deleteMessage, addVote, removeVote,
  fetchResources, addLinkResource, uploadFileResource, deleteResource,
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
let gateRole = 'fellow';   // 'fellow' | 'facilitator'
let gateStep = 'pass';     // 'pass' | 'name' | 'sync'
let facilitatorLoaded = false;
let facilitatorUnlocked = false;

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

function renderSessionPortfolio(session) {
  const artifact = getPortfolioArtifact(session);
  const status = getArtifactStatus(artifact);
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
        <div class="resource-section-title">Artifact Prompt</div>
        <div class="resource-section-note">${escapeHTML(session.month)}</div>
      </div>
      <div class="portfolio-overview-text">${escapeHTML(artifact.prompt)}</div>
      <div class="artifact-actions">
        <span class="artifact-action pending">Submission Link Pending</span>
        <span class="artifact-action pending">View Draft Pending</span>
      </div>
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

function getResourceGroups(session) {
  const readings = session.readings.map(r => {
    const data = getReadingData(r);
    return { title: data.title, type: data.type, status: data.url ? 'Available' : 'Pending', url: data.url, audience: 'Fellows' };
  });
  return [
    { title: 'Core Readings', note: 'Complete before the session', items: readings },
    {
      title: 'Session Materials', note: 'For live work together',
      items: [
        { title: `${session.month} session slide deck`, type: 'Slides', status: 'Pending', url: '', audience: 'Fellows' },
        { title: `${session.month} working worksheet`, type: 'Worksheet', status: 'Pending', url: '', audience: 'Fellows' },
        { title: 'Session agenda and activity flow', type: 'Agenda', status: 'Pending', url: '', audience: 'Fellows' },
      ],
    },
    {
      title: 'Submit or Share', note: 'Where the month becomes evidence',
      items: [
        { title: getPortfolioArtifact(session).label, type: 'Artifact', status: 'Pending', url: '', audience: 'Fellows' },
        { title: `${session.month} reflection post`, type: 'Forum', status: 'Pending', url: '', audience: 'Cohort' },
        { title: 'Mentor submission folder', type: 'Submission', status: 'Pending', url: '', audience: 'Mentor' },
      ],
    },
    {
      title: 'Mentor and Support', note: 'Use when you need feedback or orientation',
      items: [
        { title: 'Mentor check-in notes', type: 'Mentor', status: 'Pending', url: '', audience: 'Private' },
        { title: 'Office hours and support channel', type: 'Support', status: 'Pending', url: '', audience: 'Fellows' },
      ],
    },
    {
      title: 'Optional Deeper Dives', note: 'For fellows who want more',
      items: [
        { title: `Additional ${DOMAINS[session.domain].label.toLowerCase()} resources`, type: 'Optional', status: 'Pending', url: '', audience: 'Optional' },
      ],
    },
  ];
}

function renderResourceAction(item) {
  if (item.url) return `<a class="resource-action" href="${escapeHTML(item.url)}" target="_blank" rel="noopener">Open</a>`;
  return '<span class="resource-action pending">Pending</span>';
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
            ${renderResourceAction(item)}
          </div>
        `).join('')}
      </div>
    </section>
  `).join('');
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
  if (hash === 'library') return { view: 'library' };
  if (hash === 'concept-map') return { view: 'conceptmap' };
  if (hash === 'sample-portfolio') return { view: 'sampleportfolio' };
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

function showLibrary() {
  setRoute('library');
}

function showConceptMap() {
  setRoute('concept-map');
}

function showSamplePortfolio() {
  setRoute('sample-portfolio');
}

function scrollToRoute(route, behavior = 'smooth') {
  let target = null;
  if (route.view === 'dashboard') target = document.getElementById('dashboardPanel');
  else if (route.view === 'facilitator') target = null;
  else if (route.view === 'library') target = document.getElementById('libraryPanel');
  else if (route.view === 'conceptmap') target = document.getElementById('conceptMapPanel');
  else if (route.view === 'sampleportfolio') target = document.getElementById('samplePortfolioPanel');
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
    if (!facilitatorUnlocked) {
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
  } else if (route.view === 'library') {
    applyLibraryView();
  } else if (route.view === 'conceptmap') {
    applyConceptMapView();
  } else if (route.view === 'sampleportfolio') {
    applySamplePortfolioView();
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
}

const SECONDARY_PANELS = [
  { panelId: 'dashboardPanel', btnId: 'dashboardNavBtn' },
  { panelId: 'libraryPanel', btnId: 'libraryNavBtn' },
  { panelId: 'conceptMapPanel', btnId: 'conceptMapNavBtn' },
  { panelId: 'samplePortfolioPanel', btnId: 'samplePortfolioNavBtn' },
];

function resetAllPanels() {
  SECONDARY_PANELS.forEach(({ panelId, btnId }) => {
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

function applyLibraryView() {
  activeView = 'library';
  activeSessionId = '';
  resetAllPanels();
  document.getElementById('libraryPanel')?.classList.add('active');
  document.getElementById('libraryNavBtn')?.classList.add('active');
  const topbar = document.getElementById('topbarSession');
  if (topbar) topbar.textContent = 'Resource Library';
  buildLibraryPanel();
}

function applyConceptMapView() {
  activeView = 'conceptmap';
  activeSessionId = '';
  resetAllPanels();
  document.getElementById('conceptMapPanel')?.classList.add('active');
  document.getElementById('conceptMapNavBtn')?.classList.add('active');
  const topbar = document.getElementById('topbarSession');
  if (topbar) topbar.textContent = 'How Your Portfolio Comes Together';
  buildConceptMapPanel();
}

function applySamplePortfolioView() {
  activeView = 'sampleportfolio';
  activeSessionId = '';
  resetAllPanels();
  document.getElementById('samplePortfolioPanel')?.classList.add('active');
  document.getElementById('samplePortfolioNavBtn')?.classList.add('active');
  const topbar = document.getElementById('topbarSession');
  if (topbar) topbar.textContent = 'Sample Portfolio (Illustrative)';
  buildSamplePortfolioPanel();
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
          <div class="month-status-grid">
            ${SESSIONS.map(session => {
              const status = getSessionStatus(session);
              return `
                <div class="month-status-row">
                  <div class="month-status-name">${escapeHTML(session.month)}</div>
                  <div>
                    <div class="month-status-title">${escapeHTML(session.title)}</div>
                    ${session.inPerson ? '<div class="month-status-meta">In-person convening</div>' : ''}
                  </div>
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
        ${renderResourceGroups(s)}

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
        <div class="disc-wrap">
          <div class="disc-list" id="disc-list-${s.id}">
            <div class="disc-status">Loading discussion…</div>
          </div>
          <div class="disc-composer" id="disc-composer-${s.id}" style="display:none;">
            <textarea
              class="disc-input"
              id="disc-input-${s.id}"
              placeholder="Share a thought, question, or reaction… (Enter to post, Shift+Enter for new line)"
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

function gateRoleCopy() {
  if (gateRole === 'facilitator') {
    return {
      eyebrow: 'PSiX · Purpose Commons',
      title: 'Facilitator Dashboard',
      subtitle: 'Fellow progress, session coverage, and live activity',
    };
  }
  return {
    eyebrow: 'PSiX · Purpose Commons',
    title: "Fellow's Journey Companion",
    subtitle: 'Translational Fellowship in Purpose Science',
  };
}

function renderGate() {
  const overlay = document.getElementById('gate-overlay');
  if (!overlay) return;
  const copy = gateRoleCopy();
  const syncAvailable = supabaseReady();

  let stepHTML = '';
  if (gateStep === 'pass') {
    stepHTML = `
      <div class="gate-card">
        ${gateRole === 'facilitator' ? '<div style="text-align:center"><span class="gate-badge">🔒 Facilitator Only</span></div>' : ''}
        <div>
          <div class="gate-label">Access Code</div>
          <div class="gate-input-wrap">
            <input id="gate-pass-input" class="gate-input" type="password"
                   placeholder="Enter your ${gateRole === 'facilitator' ? 'facilitator' : 'cohort'} passcode"
                   autocomplete="off" onkeydown="if(event.key==='Enter')gateCheckPass()">
            <button class="gate-pass-toggle" type="button" onclick="togglePassVisibility()">Show</button>
          </div>
        </div>
        <div id="gate-pass-error" class="gate-error"></div>
        <button class="gate-btn" onclick="gateCheckPass()">Continue →</button>
      </div>
      <div class="gate-role-switch">
        ${gateRole === 'fellow'
          ? `<button onclick="showFacilitatorGate()">Facilitator? Enter the dashboard →</button>`
          : `<button onclick="showFellowGate()">← Back to fellow access</button>`}
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
    if (gateRole === 'facilitator') {
      stepHTML = `
        <div class="gate-card">
          <div class="gate-label" style="text-align:center; margin-bottom:0;">Sign in to load live fellow data</div>
          ${syncAvailable
            ? `<button class="gate-btn-google" onclick="handleGoogleSignIn()">
                 <svg width="16" height="16" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.85.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.96 10.71A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"/></svg>
                 Sign in with Google
               </button>`
            : `<div class="gate-error" style="color:rgba(255,255,255,0.5)">Supabase isn't configured yet, so live data can't load. Add your project details to src/config.js.</div>`}
          <div id="gate-sync-error" class="gate-error"></div>
        </div>
        <div class="gate-role-switch"><button onclick="showFellowGate()">← Back to fellow access</button></div>
      `;
    } else {
      stepHTML = `
        <div class="gate-card">
          <div class="gate-label" style="text-align:center; margin-bottom:0;">Sync your progress across devices</div>
          ${syncAvailable
            ? `<button class="gate-btn-google" onclick="handleGoogleSignIn()">
                 <svg width="16" height="16" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.85.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.96 10.71A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"/></svg>
                 Sign in with Google
               </button>
               <div class="gate-divider-or">or</div>`
            : ''}
          <button class="gate-skip" onclick="skipSync()">Continue without syncing</button>
          <div id="gate-sync-error" class="gate-error"></div>
        </div>
      `;
    }
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
  const expected = gateRole === 'facilitator' ? CONFIG.facilitatorAccessHash : CONFIG.fellowAccessHash;
  const hash = await sha256Hex(val);
  if (val && hash === expected) {
    gateStep = gateRole === 'facilitator' ? 'sync' : 'name';
    renderGate();
    if (gateStep === 'name') setTimeout(() => document.getElementById('gate-name-input')?.focus(), 50);
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
  gateStep = 'sync';
  renderGate();
}

function showFacilitatorGate() {
  gateRole = 'facilitator';
  gateStep = 'pass';
  renderGate();
}

function showFellowGate() {
  gateRole = 'fellow';
  gateStep = 'pass';
  renderGate();
}

function skipSync() {
  enterApp();
}

async function handleGoogleSignIn() {
  try {
    sessionStorage.setItem('psix_pending_role', gateRole);
    sessionStorage.setItem('psix_pending_name', fellowName);
    await signInWithGoogle();
  } catch (err) {
    const el = document.getElementById('gate-sync-error');
    if (el) el.textContent = 'Sign-in failed: ' + err.message;
  }
}

async function handleSignOut() {
  await signOut();
  currentUserId = null;
  currentUserEmail = null;
  updateAccountPanel();
}

function fadeOutGate() {
  const overlay = document.getElementById('gate-overlay');
  if (!overlay) return;
  overlay.classList.add('fade-out');
  setTimeout(() => { overlay.classList.add('hidden'); }, 500);
}

function enterApp() {
  fadeOutGate();
  if (gateRole === 'facilitator') {
    facilitatorUnlocked = true;
    setRoute('facilitator');
  } else {
    updateAccountPanel();
    if (!window.location.hash || window.location.hash === '#') {
      history.replaceState(null, '', '#dashboard');
    }
    routeFromHash({ behavior: 'auto' });
  }
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
      <div class="fac-section-hdr"><h2>Fellow Progress by Session</h2><div class="fac-section-hdr-line"></div></div>
      <div class="fac-grid-wrap"><table><thead id="facProgressHead"></thead><tbody id="facProgressBody"></tbody></table></div>
      <div class="fac-section-hdr"><h2>Recent Activity</h2><div class="fac-section-hdr-line"></div></div>
      <div class="fac-feed-wrap" id="facFeed"></div>
    </div>
  `;
  buildFacilitatorArc();
  buildFacilitatorTableSkeleton();
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
        <button class="disc-vote-btn${hasVoted ? ' voted' : ''}" id="vote-btn-${m.id}" onclick="toggleVote('${m.id}')">${voteInner}</button>
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
    } else {
      await addVote({ messageId, userId: currentUserId });
      btn.classList.add('voted');
      btn.innerHTML = `▲ <span class="disc-vote-count">${count + 1}</span>`;
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

function buildLibraryPanel() {
  const panel = document.getElementById('libraryPanel');
  if (!panel) return;
  const sessionOpts = SESSIONS.map(s =>
    `<option value="${escapeHTML(s.id)}">${escapeHTML(s.month)} — ${escapeHTML(s.title)}</option>`
  ).join('');

  panel.innerHTML = `
    <div class="session-header" style="padding-top:0;">
      <div class="session-eyebrow"><span class="session-month-label">Fellowship-Wide</span></div>
      <h1 class="session-title">Resource Library</h1>
      <p class="session-description" style="border-bottom:none;padding-bottom:0;margin-bottom:24px;">
        Share readings, slides, links, and files with the rest of the cohort. Search across every session, or filter down to what's relevant right now.
      </p>
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
    const addBtn = document.querySelector('#libraryPanel .lib-add-btn');
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
  document.querySelectorAll('#libraryPanel .lib-filter-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === type));
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
function buildSamplePortfolioPanel() {
  const panel = document.getElementById('samplePortfolioPanel');
  if (!panel) return;

  const artifactCards = SAMPLE_ARTIFACTS.map(sample => {
    const session = SESSIONS.find(s => s.id === sample.sessionId);
    const artifact = PORTFOLIO_ARTIFACTS.find(a => a.sessionId === sample.sessionId);
    if (!session || !artifact) return '';
    const domain = DOMAINS[session.domain];
    return `
      <div class="sample-card">
        <div class="sample-card-header">
          <span class="sample-card-month" style="color:${domain.color}">${escapeHTML(session.month)}</span>
          <span class="artifact-chip">${escapeHTML(artifact.component)}</span>
        </div>
        <div class="sample-card-title">${escapeHTML(artifact.label)}</div>
        <div class="sample-card-prompt"><em>Prompt:</em> ${escapeHTML(artifact.prompt)}</div>
        <div class="sample-card-content">${escapeHTML(sample.content)}</div>
      </div>
    `;
  }).join('');

  panel.innerHTML = `
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
// SHELL SCAFFOLDING
// ═══════════════════════════════════════════════════════
function renderShell() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div id="gate-overlay"></div>
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
          <button class="dashboard-btn" id="conceptMapNavBtn" onclick="showConceptMap()">
            <span class="dashboard-icon" style="background:var(--tea)"></span><span>How It Fits Together</span>
          </button>
          <button class="dashboard-btn" id="samplePortfolioNavBtn" onclick="showSamplePortfolio()">
            <span class="dashboard-icon" style="background:var(--tra)"></span><span>Sample Portfolio</span>
          </button>
        </div>
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
        <div class="content-wrap" id="contentWrap">
          <section class="dashboard-panel active" id="dashboardPanel" aria-label="Fellowship dashboard"></section>
          <section class="dashboard-panel" id="libraryPanel" aria-label="Resource library"></section>
          <section class="dashboard-panel" id="conceptMapPanel" aria-label="How your portfolio comes together"></section>
          <section class="dashboard-panel" id="samplePortfolioPanel" aria-label="Sample portfolio"></section>
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
async function resumePendingOAuth() {
  const pendingRole = sessionStorage.getItem('psix_pending_role');
  if (!pendingRole) return false;
  const session = await getSession();
  if (!session) return false;

  sessionStorage.removeItem('psix_pending_role');
  const pendingName = sessionStorage.getItem('psix_pending_name') || '';
  sessionStorage.removeItem('psix_pending_name');

  currentUserId = session.user.id;
  currentUserEmail = session.user.email;
  gateRole = pendingRole;

  if (pendingRole === 'facilitator') {
    const ok = await isFacilitatorEmail(currentUserEmail);
    if (!ok) {
      gateStep = 'pass';
      renderGate();
      document.getElementById('gate-pass-error') && (document.getElementById('gate-pass-error').textContent = '');
      setTimeout(() => {
        const err = document.getElementById('gate-sync-error');
        if (err) err.textContent = `${currentUserEmail} is not on the facilitator list.`;
      }, 0);
      return true;
    }
    enterApp();
    return true;
  }

  fellowName = pendingName || session.user.user_metadata?.full_name || fellowName;
  await pullRemoteProgress();
  enterApp();
  return true;
}

async function init() {
  renderShell();
  buildNav();
  buildSessions();
  buildDashboard();
  gateRole = 'fellow';
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
  });

  window.addEventListener('hashchange', () => routeFromHash({ behavior: 'smooth' }));

  const resumed = await resumePendingOAuth();
  if (!resumed) {
    // fresh load: gate stays up until the fellow/facilitator completes it
  }
}

// Expose handlers referenced by inline HTML (module scope isn't global).
Object.assign(window, {
  showDashboard, showSession, goToTask, switchTab, showLibrary,
  showConceptMap, showSamplePortfolio, toggleMapChip,
  toggleGoal, toggleReading, toggleTaskCheckbox,
  togglePassVisibility, gateCheckPass, gateCheckName,
  showFacilitatorGate, showFellowGate, skipSync,
  handleGoogleSignIn, handleSignOut, refreshFacilitatorData,
  postDiscussionMessage, toggleVote, editDiscMsg, cancelDiscEdit, saveDiscMsg, deleteDiscMsg,
  showLibAddForm, hideLibAddForm, setLibType, submitLibLink, submitLibFile,
  handleLibDrop, handleLibFileSelect, clearLibFile, handleDeleteResource,
  filterLibType, filterLibSession, debounceLibSearch,
});

init();
