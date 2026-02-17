'use client';

import { createContext, useContext, useState, useRef, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import type { EnrichLogLine } from './EnrichLogViewer';

// ── Scrape types ─────────────────────────────────────────────

export interface ScrapeLogLine {
  state?: string;
  text: string;
  isError?: boolean;
  isDone?: boolean;
}

export interface ScrapeProcessState {
  isRunning: boolean;
  logs: ScrapeLogLine[];
  doneStates: Set<string>;
  allDone: boolean;
}

export interface ScrapeParams {
  bundeslaender: string[];
  startDate: string;
  endDate: string;
}

// ── Enrich types ─────────────────────────────────────────────

export interface EnrichProcessState {
  isRunning: boolean;
  logs: EnrichLogLine[];
  currentFileIndex: number;
  currentFileName: string;
  fileCount: number;
}

export interface EnrichParams {
  files: Array<{ path: string; absolutePath: string }>;
  model?: string;
  provider?: string;
  dateFrom?: string;
  dateTo?: string;
}

// ── Geocode types ────────────────────────────────────────────

export interface GeocodeProcessState {
  isRunning: boolean;
  logs: EnrichLogLine[];
  currentFileIndex: number;
  currentFileName: string;
  fileCount: number;
}

export interface GeocodeParams {
  files: Array<{ path: string }>;
  maxRps?: number;
  force?: boolean;
}

// ── Context ──────────────────────────────────────────────────

interface ScrapeActions {
  startScrape: (params: ScrapeParams) => void;
  stopScrape: () => void;
  clearScrapeLogs: () => void;
}

interface EnrichActions {
  startEnrich: (params: EnrichParams) => void;
  stopEnrich: () => void;
  clearEnrichLogs: () => void;
}

interface GeocodeActions {
  startGeocode: (params: GeocodeParams) => void;
  stopGeocode: () => void;
  clearGeocodeLogs: () => void;
}

const ScrapeStateContext = createContext<ScrapeProcessState | null>(null);
const ScrapeActionsContext = createContext<ScrapeActions | null>(null);
const EnrichStateContext = createContext<EnrichProcessState | null>(null);
const EnrichActionsContext = createContext<EnrichActions | null>(null);
const GeocodeStateContext = createContext<GeocodeProcessState | null>(null);
const GeocodeActionsContext = createContext<GeocodeActions | null>(null);
const ActiveProcessesContext = createContext({ scrapeRunning: false, enrichRunning: false, geocodeRunning: false });

const POLL_INTERVAL = 3000; // ms

// ── Provider ─────────────────────────────────────────────────

export function AdminProcessProvider({ children }: { children: ReactNode }) {
  // ── Scrape state ──
  const [scrapeRunning, setScrapeRunning] = useState(false);
  const [scrapeLogs, setScrapeLogs] = useState<ScrapeLogLine[]>([]);
  const [doneStates, setDoneStates] = useState<Set<string>>(new Set());
  const [allDone, setAllDone] = useState(false);
  const scrapeAbortRef = useRef<AbortController | null>(null);

  // ── Enrich state ──
  const [enrichRunning, setEnrichRunning] = useState(false);
  const [enrichLogs, setEnrichLogs] = useState<EnrichLogLine[]>([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [currentFileName, setCurrentFileName] = useState('');
  const [fileCount, setFileCount] = useState(0);
  const enrichAbortRef = useRef<AbortController | null>(null);

  // ── Geocode state ──
  const [geocodeRunning, setGeocodeRunning] = useState(false);
  const [geocodeLogs, setGeocodeLogs] = useState<EnrichLogLine[]>([]);
  const [geocodeCurrentFileIndex, setGeocodeCurrentFileIndex] = useState(0);
  const [geocodeCurrentFileName, setGeocodeCurrentFileName] = useState('');
  const [geocodeFileCount, setGeocodeFileCount] = useState(0);
  const geocodeAbortRef = useRef<AbortController | null>(null);

  // ── Polling ref for reconnection ──
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPollTsRef = useRef(0);
  const hasReconnectedRef = useRef(false);

  // ── Reconnect on mount: check server for running processes ──
  useEffect(() => {
    if (hasReconnectedRef.current) return;
    hasReconnectedRef.current = true;

    // Don't reconnect if we already have an active SSE connection
    if (scrapeAbortRef.current || enrichAbortRef.current || geocodeAbortRef.current) return;

    (async () => {
      try {
        const res = await fetch('/api/admin/process/status');
        if (!res.ok) return;

        const data = await res.json();

        // Hydrate scrape state
        if (data.scrape?.running && data.scrape.logs?.length > 0) {
          const logs: ScrapeLogLine[] = data.scrape.logs.map((l: { state?: string; text: string; isError?: boolean; isDone?: boolean }) => ({
            state: l.state,
            text: l.text,
            isError: l.isError,
            isDone: l.isDone,
          }));
          setScrapeLogs(logs);
          setScrapeRunning(true);
          if (data.scrape.doneStates) {
            setDoneStates(new Set(data.scrape.doneStates));
          }
          if (data.scrape.allDone) setAllDone(true);

          // Track the last timestamp for incremental polling
          const maxTs = Math.max(...data.scrape.logs.map((l: { ts: number }) => l.ts || 0));
          lastPollTsRef.current = Math.max(lastPollTsRef.current, maxTs);
        }

        // Hydrate enrich state
        if (data.enrich?.running && data.enrich.logs?.length > 0) {
          const logs: EnrichLogLine[] = data.enrich.logs.map((l: { fileIndex?: number; text: string; isError?: boolean; isDone?: boolean; isFileHeader?: boolean }) => ({
            fileIndex: l.fileIndex,
            text: l.text,
            isError: l.isError,
            isDone: l.isDone,
            isFileHeader: l.isFileHeader,
          }));
          setEnrichLogs(logs);
          setEnrichRunning(true);
          setCurrentFileIndex(data.enrich.currentFileIndex ?? 0);
          setCurrentFileName(data.enrich.currentFileName ?? '');
          setFileCount(data.enrich.fileCount ?? 0);

          const maxTs = Math.max(...data.enrich.logs.map((l: { ts: number }) => l.ts || 0));
          lastPollTsRef.current = Math.max(lastPollTsRef.current, maxTs);
        }

        // Hydrate geocode state
        if (data.geocode?.running && data.geocode.logs?.length > 0) {
          const logs: EnrichLogLine[] = data.geocode.logs.map((l: { fileIndex?: number; text: string; isError?: boolean; isDone?: boolean; isFileHeader?: boolean }) => ({
            fileIndex: l.fileIndex,
            text: l.text,
            isError: l.isError,
            isDone: l.isDone,
            isFileHeader: l.isFileHeader,
          }));
          setGeocodeLogs(logs);
          setGeocodeRunning(true);
          setGeocodeCurrentFileIndex(data.geocode.currentFileIndex ?? 0);
          setGeocodeCurrentFileName(data.geocode.currentFileName ?? '');
          setGeocodeFileCount(data.geocode.fileCount ?? 0);

          const maxTs = Math.max(...data.geocode.logs.map((l: { ts: number }) => l.ts || 0));
          lastPollTsRef.current = Math.max(lastPollTsRef.current, maxTs);
        }

        // Start polling if any process is running
        if (data.scrape?.running || data.enrich?.running || data.geocode?.running) {
          startPolling();
        }
      } catch {
        // Status endpoint not available — that's fine, no reconnection needed
      }
    })();

    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Polling functions ──

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(pollForUpdates, POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function pollForUpdates() {
    try {
      const res = await fetch(`/api/admin/process/status?since=${lastPollTsRef.current}`);
      if (!res.ok) return;

      const data = await res.json();

      // Update scrape
      if (data.scrape) {
        if (data.scrape.logs?.length > 0) {
          const newLogs: ScrapeLogLine[] = data.scrape.logs.map((l: { state?: string; text: string; isError?: boolean; isDone?: boolean }) => ({
            state: l.state,
            text: l.text,
            isError: l.isError,
            isDone: l.isDone,
          }));
          setScrapeLogs((prev) => [...prev, ...newLogs]);

          const maxTs = Math.max(...data.scrape.logs.map((l: { ts: number }) => l.ts || 0));
          lastPollTsRef.current = Math.max(lastPollTsRef.current, maxTs);
        }
        if (data.scrape.doneStates) {
          setDoneStates(new Set(data.scrape.doneStates));
        }
        if (!data.scrape.running) {
          setScrapeRunning(false);
          setAllDone(true);
        }
      }

      // Update enrich
      if (data.enrich) {
        if (data.enrich.logs?.length > 0) {
          const newLogs: EnrichLogLine[] = data.enrich.logs.map((l: { fileIndex?: number; text: string; isError?: boolean; isDone?: boolean; isFileHeader?: boolean }) => ({
            fileIndex: l.fileIndex,
            text: l.text,
            isError: l.isError,
            isDone: l.isDone,
            isFileHeader: l.isFileHeader,
          }));
          setEnrichLogs((prev) => [...prev, ...newLogs]);

          const maxTs = Math.max(...data.enrich.logs.map((l: { ts: number }) => l.ts || 0));
          lastPollTsRef.current = Math.max(lastPollTsRef.current, maxTs);
        }
        if (data.enrich.currentFileIndex !== undefined) {
          setCurrentFileIndex(data.enrich.currentFileIndex);
        }
        if (data.enrich.currentFileName !== undefined) {
          setCurrentFileName(data.enrich.currentFileName);
        }
        if (data.enrich.fileCount !== undefined) {
          setFileCount(data.enrich.fileCount);
        }
        if (!data.enrich.running) {
          setEnrichRunning(false);
        }
      }

      // Update geocode
      if (data.geocode) {
        if (data.geocode.logs?.length > 0) {
          const newLogs: EnrichLogLine[] = data.geocode.logs.map((l: { fileIndex?: number; text: string; isError?: boolean; isDone?: boolean; isFileHeader?: boolean }) => ({
            fileIndex: l.fileIndex,
            text: l.text,
            isError: l.isError,
            isDone: l.isDone,
            isFileHeader: l.isFileHeader,
          }));
          setGeocodeLogs((prev) => [...prev, ...newLogs]);

          const maxTs = Math.max(...data.geocode.logs.map((l: { ts: number }) => l.ts || 0));
          lastPollTsRef.current = Math.max(lastPollTsRef.current, maxTs);
        }
        if (data.geocode.currentFileIndex !== undefined) {
          setGeocodeCurrentFileIndex(data.geocode.currentFileIndex);
        }
        if (data.geocode.currentFileName !== undefined) {
          setGeocodeCurrentFileName(data.geocode.currentFileName);
        }
        if (data.geocode.fileCount !== undefined) {
          setGeocodeFileCount(data.geocode.fileCount);
        }
        if (!data.geocode.running) {
          setGeocodeRunning(false);
        }
      }

      // Stop polling when all done
      if (!data.scrape?.running && !data.enrich?.running && !data.geocode?.running) {
        stopPolling();
      }
    } catch {
      // Network error during poll — ignore, will retry
    }
  }

  // ── Scrape actions ──

  const startScrape = useCallback(async (params: ScrapeParams) => {
    if (scrapeAbortRef.current) return; // already running

    setScrapeRunning(true);
    setScrapeLogs([]);
    setDoneStates(new Set());
    setAllDone(false);

    const controller = new AbortController();
    scrapeAbortRef.current = controller;

    try {
      const res = await fetch('/api/admin/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bundeslaender: params.bundeslaender,
          startDate: params.startDate,
          endDate: params.endDate,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }));
        setScrapeLogs([{ text: errData.error || `HTTP ${res.status}`, isError: true }]);
        setScrapeRunning(false);
        scrapeAbortRef.current = null;
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));

            if (data.type === 'log') {
              setScrapeLogs((prev) => [
                ...prev,
                { state: data.state, text: data.text, isError: !!data.error },
              ]);
            } else if (data.type === 'state_done') {
              setDoneStates((prev) => new Set([...prev, data.state]));
              setScrapeLogs((prev) => [
                ...prev,
                { state: data.state, text: data.text, isDone: true, isError: data.exitCode !== 0 },
              ]);
            } else if (data.type === 'start') {
              setScrapeLogs((prev) => [
                ...prev,
                { text: `Scrape gestartet: ${data.states.length} Bundesländer, ${data.dateRange.start} → ${data.dateRange.end}` },
              ]);
            } else if (data.type === 'done') {
              setAllDone(true);
            }
          } catch {
            // skip malformed SSE
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setScrapeLogs((prev) => [
          ...prev,
          { text: `Connection error: ${err instanceof Error ? err.message : String(err)}`, isError: true },
        ]);
      }
    } finally {
      setScrapeRunning(false);
      scrapeAbortRef.current = null;
    }
  }, []);

  const stopScrape = useCallback(() => {
    scrapeAbortRef.current?.abort();
    scrapeAbortRef.current = null;
    setScrapeRunning(false);
    setScrapeLogs((prev) => [...prev, { text: 'Abgebrochen vom Benutzer.', isError: true }]);
  }, []);

  const clearScrapeLogs = useCallback(() => {
    setScrapeLogs([]);
    setDoneStates(new Set());
    setAllDone(false);
    // Also clear server-side store
    fetch('/api/admin/process/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear', process: 'scrape' }),
    }).catch(() => {});
  }, []);

  // ── Enrich actions ──

  const startEnrich = useCallback(async (params: EnrichParams) => {
    if (enrichAbortRef.current) return; // already running

    setEnrichRunning(true);
    setEnrichLogs([]);
    setCurrentFileIndex(0);
    setCurrentFileName('');
    setFileCount(params.files.length);

    const controller = new AbortController();
    enrichAbortRef.current = controller;

    try {
      const res = await fetch('/api/admin/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: params.files,
          model: params.model,
          provider: params.provider || undefined,
          dateFrom: params.dateFrom || undefined,
          dateTo: params.dateTo || undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }));
        setEnrichLogs([{ text: errData.error || `HTTP ${res.status}`, isError: true }]);
        setEnrichRunning(false);
        enrichAbortRef.current = null;
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));

            if (data.type === 'start') {
              setEnrichLogs((prev) => [
                ...prev,
                { text: `Enrichment started: ${data.fileCount} file(s), model: ${data.model}` },
              ]);
            } else if (data.type === 'file_start') {
              setCurrentFileIndex(data.fileIndex);
              setCurrentFileName(data.fileName);
              setEnrichLogs((prev) => [
                ...prev,
                { text: `── File ${data.fileIndex + 1}/${params.files.length}: ${data.fileName} ──`, isFileHeader: true },
              ]);
            } else if (data.type === 'log') {
              setEnrichLogs((prev) => [
                ...prev,
                { fileIndex: data.fileIndex, text: data.text, isError: !!data.error },
              ]);
            } else if (data.type === 'file_done') {
              setEnrichLogs((prev) => [
                ...prev,
                { fileIndex: data.fileIndex, text: data.text, isDone: true, isError: data.exitCode !== 0 },
              ]);
            } else if (data.type === 'done') {
              setEnrichLogs((prev) => [...prev, { text: 'All files processed.', isDone: true }]);
            }
          } catch {
            // skip malformed SSE
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setEnrichLogs((prev) => [
          ...prev,
          { text: `Connection error: ${err instanceof Error ? err.message : String(err)}`, isError: true },
        ]);
      }
    } finally {
      setEnrichRunning(false);
      enrichAbortRef.current = null;
    }
  }, []);

  const stopEnrich = useCallback(() => {
    enrichAbortRef.current?.abort();
    enrichAbortRef.current = null;
    setEnrichRunning(false);
    setEnrichLogs((prev) => [...prev, { text: 'Aborted by user.', isError: true }]);
  }, []);

  const clearEnrichLogs = useCallback(() => {
    setEnrichLogs([]);
    setCurrentFileIndex(0);
    setCurrentFileName('');
    setFileCount(0);
    // Also clear server-side store
    fetch('/api/admin/process/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear', process: 'enrich' }),
    }).catch(() => {});
  }, []);

  // ── Geocode actions ──

  const startGeocode = useCallback(async (params: GeocodeParams) => {
    if (geocodeAbortRef.current) return; // already running

    setGeocodeRunning(true);
    setGeocodeLogs([]);
    setGeocodeCurrentFileIndex(0);
    setGeocodeCurrentFileName('');
    setGeocodeFileCount(params.files.length);

    const controller = new AbortController();
    geocodeAbortRef.current = controller;

    try {
      const res = await fetch('/api/admin/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: params.files,
          maxRps: params.maxRps,
          force: params.force,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }));
        setGeocodeLogs([{ text: errData.error || `HTTP ${res.status}`, isError: true }]);
        setGeocodeRunning(false);
        geocodeAbortRef.current = null;
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));

            if (data.type === 'start') {
              setGeocodeLogs((prev) => [
                ...prev,
                { text: data.text || `Geocoding started: ${data.fileCount} file(s)` },
              ]);
            } else if (data.type === 'file_start') {
              setGeocodeCurrentFileIndex(data.fileIndex);
              setGeocodeCurrentFileName(data.fileName);
              setGeocodeLogs((prev) => [
                ...prev,
                { text: `── File ${data.fileIndex + 1}/${params.files.length}: ${data.fileName} ──`, isFileHeader: true },
              ]);
            } else if (data.type === 'log') {
              setGeocodeLogs((prev) => [
                ...prev,
                { fileIndex: data.fileIndex, text: data.text, isError: !!data.error },
              ]);
            } else if (data.type === 'file_done') {
              setGeocodeLogs((prev) => [
                ...prev,
                { fileIndex: data.fileIndex, text: data.text, isDone: true, isError: data.exitCode !== 0 },
              ]);
            } else if (data.type === 'done') {
              setGeocodeLogs((prev) => [...prev, { text: data.text || 'All files geocoded.', isDone: true }]);
            }
          } catch {
            // skip malformed SSE
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setGeocodeLogs((prev) => [
          ...prev,
          { text: `Connection error: ${err instanceof Error ? err.message : String(err)}`, isError: true },
        ]);
      }
    } finally {
      setGeocodeRunning(false);
      geocodeAbortRef.current = null;
    }
  }, []);

  const stopGeocode = useCallback(() => {
    geocodeAbortRef.current?.abort();
    geocodeAbortRef.current = null;
    setGeocodeRunning(false);
    setGeocodeLogs((prev) => [...prev, { text: 'Aborted by user.', isError: true }]);
  }, []);

  const clearGeocodeLogs = useCallback(() => {
    setGeocodeLogs([]);
    setGeocodeCurrentFileIndex(0);
    setGeocodeCurrentFileName('');
    setGeocodeFileCount(0);
    fetch('/api/admin/process/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear', process: 'geocode' }),
    }).catch(() => {});
  }, []);

  // ── Context values ──

  const scrapeState = useMemo<ScrapeProcessState>(() => ({
    isRunning: scrapeRunning,
    logs: scrapeLogs,
    doneStates,
    allDone,
  }), [scrapeRunning, scrapeLogs, doneStates, allDone]);

  const scrapeActions = useMemo<ScrapeActions>(() => ({
    startScrape,
    stopScrape,
    clearScrapeLogs,
  }), [startScrape, stopScrape, clearScrapeLogs]);

  const enrichState = useMemo<EnrichProcessState>(() => ({
    isRunning: enrichRunning,
    logs: enrichLogs,
    currentFileIndex,
    currentFileName,
    fileCount,
  }), [enrichRunning, enrichLogs, currentFileIndex, currentFileName, fileCount]);

  const enrichActions = useMemo<EnrichActions>(() => ({
    startEnrich,
    stopEnrich,
    clearEnrichLogs,
  }), [startEnrich, stopEnrich, clearEnrichLogs]);

  const geocodeState = useMemo<GeocodeProcessState>(() => ({
    isRunning: geocodeRunning,
    logs: geocodeLogs,
    currentFileIndex: geocodeCurrentFileIndex,
    currentFileName: geocodeCurrentFileName,
    fileCount: geocodeFileCount,
  }), [geocodeRunning, geocodeLogs, geocodeCurrentFileIndex, geocodeCurrentFileName, geocodeFileCount]);

  const geocodeActions = useMemo<GeocodeActions>(() => ({
    startGeocode,
    stopGeocode,
    clearGeocodeLogs,
  }), [startGeocode, stopGeocode, clearGeocodeLogs]);

  const activeProcesses = useMemo(
    () => ({ scrapeRunning, enrichRunning, geocodeRunning }),
    [scrapeRunning, enrichRunning, geocodeRunning],
  );

  return (
    <ActiveProcessesContext.Provider value={activeProcesses}>
      <ScrapeActionsContext.Provider value={scrapeActions}>
        <EnrichActionsContext.Provider value={enrichActions}>
          <GeocodeActionsContext.Provider value={geocodeActions}>
            <ScrapeStateContext.Provider value={scrapeState}>
              <EnrichStateContext.Provider value={enrichState}>
                <GeocodeStateContext.Provider value={geocodeState}>
                  {children}
                </GeocodeStateContext.Provider>
              </EnrichStateContext.Provider>
            </ScrapeStateContext.Provider>
          </GeocodeActionsContext.Provider>
        </EnrichActionsContext.Provider>
      </ScrapeActionsContext.Provider>
    </ActiveProcessesContext.Provider>
  );
}

// ── Hooks ────────────────────────────────────────────────────

export function useScrapeProcess() {
  const state = useContext(ScrapeStateContext);
  const actions = useContext(ScrapeActionsContext);
  if (!state || !actions) throw new Error('useScrapeProcess must be used within AdminProcessProvider');
  return {
    ...state,
    start: actions.startScrape,
    stop: actions.stopScrape,
    clearLogs: actions.clearScrapeLogs,
  };
}

export function useEnrichProcess() {
  const state = useContext(EnrichStateContext);
  const actions = useContext(EnrichActionsContext);
  if (!state || !actions) throw new Error('useEnrichProcess must be used within AdminProcessProvider');
  return {
    ...state,
    start: actions.startEnrich,
    stop: actions.stopEnrich,
    clearLogs: actions.clearEnrichLogs,
  };
}

export function useGeocodeProcess() {
  const state = useContext(GeocodeStateContext);
  const actions = useContext(GeocodeActionsContext);
  if (!state || !actions) throw new Error('useGeocodeProcess must be used within AdminProcessProvider');
  return {
    ...state,
    start: actions.startGeocode,
    stop: actions.stopGeocode,
    clearLogs: actions.clearGeocodeLogs,
  };
}

export function useActiveProcesses() {
  return useContext(ActiveProcessesContext);
}
