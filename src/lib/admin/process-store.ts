/**
 * Server-side process store — persists logs and PIDs to disk so the UI
 * can reconnect to running processes after a page refresh or navigation.
 *
 * Files: .tmp/process_scrape.json, .tmp/process_enrich.json, .tmp/process_geocode.json
 */
import fs from 'fs';
import path from 'path';

const STORE_DIR = path.join(process.cwd(), '.tmp');

export interface ProcessLogEntry {
  ts: number; // Date.now()
  text: string;
  state?: string;
  fileIndex?: number;
  isError?: boolean;
  isDone?: boolean;
  isFileHeader?: boolean;
  exitCode?: number;
  type?: string; // 'start' | 'log' | 'state_done' | 'file_start' | 'file_done' | 'done'
}

export interface ProcessState {
  running: boolean;
  pids: number[];
  logs: ProcessLogEntry[];
  startedAt: string | null;
  params: Record<string, unknown>;
  // enrich-specific
  currentFileIndex?: number;
  currentFileName?: string;
  fileCount?: number;
  // scrape-specific
  doneStates?: string[];
  allDone?: boolean;
}

const EMPTY_STATE: ProcessState = {
  running: false,
  pids: [],
  logs: [],
  startedAt: null,
  params: {},
};

export type ProcessName = 'scrape' | 'enrich' | 'geocode';

function storeFile(process: ProcessName): string {
  return path.join(STORE_DIR, `process_${process}.json`);
}

/** Read the current state from disk */
export function readProcessState(proc: ProcessName): ProcessState {
  const file = storeFile(proc);
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as ProcessState;
    }
  } catch { /* corrupt file — return empty */ }
  return { ...EMPTY_STATE };
}

/** Write the full state to disk */
function writeProcessState(proc: ProcessName, state: ProcessState): void {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(storeFile(proc), JSON.stringify(state), 'utf-8');
}

/** Mark a process as started with PIDs and params */
export function markStarted(
  proc: ProcessName,
  params: Record<string, unknown>,
  extra?: Partial<ProcessState>,
): void {
  const state: ProcessState = {
    running: true,
    pids: [],
    logs: [],
    startedAt: new Date().toISOString(),
    params,
    ...extra,
  };
  writeProcessState(proc, state);
}

/** Register a child process PID */
export function addPid(proc: ProcessName, pid: number): void {
  const state = readProcessState(proc);
  if (!state.pids.includes(pid)) {
    state.pids.push(pid);
  }
  writeProcessState(proc, state);
}

/** Append a log entry (capped at 5000 entries to avoid giant files) */
export function appendLog(proc: ProcessName, entry: ProcessLogEntry): void {
  const state = readProcessState(proc);
  state.logs.push(entry);
  // Cap at 5000 log lines — drop oldest
  if (state.logs.length > 5000) {
    state.logs = state.logs.slice(-5000);
  }
  writeProcessState(proc, state);
}

/** Update extra fields (currentFileIndex, doneStates, etc.) */
export function updateProcessFields(proc: ProcessName, fields: Partial<ProcessState>): void {
  const state = readProcessState(proc);
  Object.assign(state, fields);
  writeProcessState(proc, state);
}

/** Mark a process as finished */
export function markDone(proc: ProcessName): void {
  const state = readProcessState(proc);
  state.running = false;
  state.pids = [];
  writeProcessState(proc, state);
}

/** Clear all stored state */
export function clearState(proc: ProcessName): void {
  writeProcessState(proc, { ...EMPTY_STATE });
}

/** Check if stored PIDs are still alive */
export function checkPidsAlive(proc: ProcessName): boolean {
  const state = readProcessState(proc);
  if (!state.running || state.pids.length === 0) return false;

  for (const pid of state.pids) {
    try {
      process.kill(pid, 0); // signal 0 = check existence
      return true; // at least one is alive
    } catch {
      // PID not found — dead
    }
  }

  // All PIDs dead but state says running — auto-correct
  state.running = false;
  state.pids = [];
  writeProcessState(proc, state);
  return false;
}
