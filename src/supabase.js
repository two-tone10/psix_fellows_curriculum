import { CONFIG } from './config.js';

let client = null;
let clientChecked = false;

function getClient() {
  if (clientChecked) return client;
  clientChecked = true;
  const hasConfig = CONFIG.supabaseUrl && !CONFIG.supabaseUrl.includes('YOUR_PROJECT')
    && CONFIG.supabaseAnonKey && !CONFIG.supabaseAnonKey.includes('YOUR_PUBLIC');
  if (hasConfig && window.supabase && typeof window.supabase.createClient === 'function') {
    client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
  }
  return client;
}

export function supabaseReady() {
  return Boolean(getClient());
}

export async function getSession() {
  const sb = getClient();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session || null;
}

export function onAuthChange(callback) {
  const sb = getClient();
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithGoogle() {
  const sb = getClient();
  if (!sb) throw new Error('Supabase is not configured yet.');
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href },
  });
  if (error) throw error;
}

export async function signOut() {
  const sb = getClient();
  if (!sb) return;
  await sb.auth.signOut();
}

// Passwordless sign-in for fellows without a Google account — works with any
// email (e.g. a university address). Supabase emails a one-time link back to
// `emailRedirectTo`; clicking it establishes a session the same way Google
// sign-in does, so the rest of the app treats both identically.
export async function signInWithEmailOtp(email) {
  const sb = getClient();
  if (!sb) throw new Error('Supabase is not configured yet.');
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href },
  });
  if (error) throw error;
}

export async function isFacilitatorEmail(email) {
  if (!email) return false;
  if (CONFIG.facilitatorEmails.includes(email)) return true;
  const sb = getClient();
  if (!sb) return false;
  const { data, error } = await sb
    .from('psix_facilitators')
    .select('email')
    .eq('email', email)
    .maybeSingle();
  return Boolean(data) && !error;
}

export async function fetchMyProgress(userId) {
  const sb = getClient();
  if (!sb || !userId) return [];
  const { data, error } = await sb
    .from('psix_progress_events')
    .select('session_id, task_type, task_index, action')
    .eq('user_id', userId);
  if (error) {
    console.warn('Supabase: fetch progress failed', error.message);
    return [];
  }
  return data || [];
}

export async function syncProgressEvent(entry) {
  const sb = getClient();
  if (!sb || !entry.userId) return;
  const { error } = await sb.from('psix_progress_events').upsert({
    user_id: entry.userId,
    fellow_name: entry.fellowName,
    fellow_email: entry.fellowEmail,
    session_id: entry.sessionId,
    task_type: entry.taskType,
    task_index: entry.taskIndex,
    task_text: entry.taskText,
    action: entry.action,
  }, { onConflict: 'user_id,session_id,task_type,task_index' });
  if (error) console.warn('Supabase: sync progress failed', error.message);
}

export async function fetchMyArtifacts(userId) {
  const sb = getClient();
  if (!sb || !userId) return [];
  const { data, error } = await sb
    .from('psix_portfolio_artifacts')
    .select('session_id, artifact_label, response')
    .eq('user_id', userId);
  if (error) {
    console.warn('Supabase: fetch artifacts failed', error.message);
    return [];
  }
  return data || [];
}

export async function syncArtifact(entry) {
  const sb = getClient();
  if (!sb || !entry.userId) return;
  const { error } = await sb.from('psix_portfolio_artifacts').upsert({
    user_id: entry.userId,
    fellow_name: entry.fellowName,
    fellow_email: entry.fellowEmail,
    session_id: entry.sessionId,
    artifact_label: entry.artifactLabel,
    response: entry.response,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,session_id' });
  if (error) console.warn('Supabase: sync artifact failed', error.message);
}

export async function fetchAllProgressForFacilitators() {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('psix_progress_events')
    .select('fellow_name, fellow_email, session_id, task_type, task_text, action, created_at')
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('Supabase: facilitator fetch failed', error.message);
    return [];
  }
  return data || [];
}

// ── DISCUSSION BOARD ──────────────────────────────────────────────

export async function fetchMessages(sessionId) {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('psix_messages')
    .select('id, created_at, session_id, user_id, user_name, body, psix_message_votes(user_id)')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(300);
  if (error) {
    console.warn('Supabase: fetch messages failed', error.message);
    throw error;
  }
  return data || [];
}

export async function postMessage({ sessionId, userId, userName, body }) {
  const sb = getClient();
  if (!sb) throw new Error('Supabase is not configured.');
  const { error } = await sb.from('psix_messages').insert({
    session_id: sessionId, user_id: userId, user_name: userName, body,
  });
  if (error) throw error;
}

export async function updateMessage({ id, userId, body }) {
  const sb = getClient();
  if (!sb) throw new Error('Supabase is not configured.');
  const { error } = await sb.from('psix_messages').update({ body }).eq('id', id).eq('user_id', userId);
  if (error) throw error;
}

export async function deleteMessage({ id, userId }) {
  const sb = getClient();
  if (!sb) throw new Error('Supabase is not configured.');
  const { error } = await sb.from('psix_messages').delete().eq('id', id).eq('user_id', userId);
  if (error) throw error;
}

export async function addVote({ messageId, userId }) {
  const sb = getClient();
  if (!sb) throw new Error('Supabase is not configured.');
  const { error } = await sb.from('psix_message_votes').insert({ message_id: messageId, user_id: userId });
  if (error) throw error;
}

export async function removeVote({ messageId, userId }) {
  const sb = getClient();
  if (!sb) throw new Error('Supabase is not configured.');
  const { error } = await sb.from('psix_message_votes').delete()
    .eq('message_id', messageId).eq('user_id', userId);
  if (error) throw error;
}

// ── RESOURCE LIBRARY ──────────────────────────────────────────────

export async function fetchResources({ search, sessionId } = {}) {
  const sb = getClient();
  if (!sb) return [];
  let q = sb.from('psix_resources').select('*').order('created_at', { ascending: false }).limit(300);
  if (sessionId) q = q.eq('session_id', sessionId);
  if (search && search.trim()) {
    const term = search.trim().replace(/[%,()]/g, ' ').trim();
    if (term) q = q.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
  }
  const { data, error } = await q;
  if (error) {
    console.warn('Supabase: fetch resources failed', error.message);
    throw error;
  }
  return data || [];
}

export async function addLinkResource(entry) {
  const sb = getClient();
  if (!sb) throw new Error('Supabase is not configured.');
  const { error } = await sb.from('psix_resources').insert({
    user_id: entry.userId,
    user_name: entry.userName,
    type: 'link',
    title: entry.title,
    description: entry.description || null,
    url: entry.url,
    session_id: entry.sessionId || null,
  });
  if (error) throw error;
}

export async function uploadFileResource(entry) {
  const sb = getClient();
  if (!sb) throw new Error('Supabase is not configured.');
  const filePath = `${entry.userId}/${Date.now()}-${entry.file.name}`;
  const { error: upErr } = await sb.storage
    .from('psix-resources')
    .upload(filePath, entry.file, { cacheControl: '3600', upsert: false });
  if (upErr) throw upErr;

  const { data } = sb.storage.from('psix-resources').getPublicUrl(filePath);

  const { error: dbErr } = await sb.from('psix_resources').insert({
    user_id: entry.userId,
    user_name: entry.userName,
    type: 'file',
    title: entry.title,
    description: entry.description || null,
    url: data.publicUrl,
    file_name: entry.file.name,
    file_size: entry.file.size,
    session_id: entry.sessionId || null,
  });
  if (dbErr) throw dbErr;
}

export async function deleteResource({ id, userId, url, type }) {
  const sb = getClient();
  if (!sb) throw new Error('Supabase is not configured.');
  if (type === 'file' && url) {
    const base = `${CONFIG.supabaseUrl}/storage/v1/object/public/psix-resources/`;
    if (url.startsWith(base)) {
      await sb.storage.from('psix-resources').remove([url.slice(base.length)]);
    }
  }
  const { error } = await sb.from('psix_resources').delete().eq('id', id).eq('user_id', userId);
  if (error) throw error;
}

// ── SESSION MATERIALS (facilitator-managed, fills "Pending" slots) ──────

export async function fetchSessionMaterials() {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.from('psix_session_materials').select('*');
  if (error) {
    console.warn('Supabase: fetch session materials failed', error.message);
    return [];
  }
  return data || [];
}

export async function upsertLinkMaterial(entry) {
  const sb = getClient();
  if (!sb) throw new Error('Supabase is not configured.');
  const { error } = await sb.from('psix_session_materials').upsert({
    session_id: entry.sessionId,
    slot_key: entry.slotKey,
    type: 'link',
    title: entry.title,
    url: entry.url,
    file_name: null,
    file_size: null,
    uploaded_by_email: entry.email || null,
    uploaded_by_name: entry.name || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'session_id,slot_key' });
  if (error) throw error;
}

export async function uploadFileMaterial(entry) {
  const sb = getClient();
  if (!sb) throw new Error('Supabase is not configured.');
  const filePath = `session-materials/${entry.sessionId}/${entry.slotKey}-${Date.now()}-${entry.file.name}`;
  const { error: upErr } = await sb.storage
    .from('psix-resources')
    .upload(filePath, entry.file, { cacheControl: '3600', upsert: true });
  if (upErr) throw upErr;

  const { data } = sb.storage.from('psix-resources').getPublicUrl(filePath);

  const { error: dbErr } = await sb.from('psix_session_materials').upsert({
    session_id: entry.sessionId,
    slot_key: entry.slotKey,
    type: 'file',
    title: entry.title,
    url: data.publicUrl,
    file_name: entry.file.name,
    file_size: entry.file.size,
    uploaded_by_email: entry.email || null,
    uploaded_by_name: entry.name || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'session_id,slot_key' });
  if (dbErr) throw dbErr;
}

export async function deleteSessionMaterial({ sessionId, slotKey, url, type }) {
  const sb = getClient();
  if (!sb) throw new Error('Supabase is not configured.');
  if (type === 'file' && url) {
    const base = `${CONFIG.supabaseUrl}/storage/v1/object/public/psix-resources/`;
    if (url.startsWith(base)) {
      await sb.storage.from('psix-resources').remove([url.slice(base.length)]);
    }
  }
  const { error } = await sb.from('psix_session_materials').delete()
    .eq('session_id', sessionId).eq('slot_key', slotKey);
  if (error) throw error;
}
