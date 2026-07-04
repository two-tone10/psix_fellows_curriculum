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
