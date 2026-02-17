'use client';

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import {
  searchAddress,
  formatPhotonResult,
  getZoomForType,
  type PhotonFeature,
} from '@/lib/geocoding';
import { CRIME_CATEGORIES, WEAPON_LABELS, type CrimeCategory } from '@/lib/types/crime';
import { useTranslation, tNested } from '@/lib/i18n';

type PresetKey = 'all' | 'today' | 'yesterday' | 'week';
type ExpandedPanel = 'search' | 'time' | null;

interface BlaulichtPlaybackControlProps {
  totalEvents: number;
  currentIndex: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onIndexChange: (index: number) => void;
  currentTimestamp?: string;
  dateFilterFrom: string | null;
  dateFilterTo: string | null;
  onDateFilterChange: (from: string | null, to: string | null) => void;
  mapRef: React.RefObject<MapRef | null>;
  onSearchPinChange: (pin: { lng: number; lat: number } | null) => void;
  // Category filter props
  blaulichtStats?: {
    total: number;
    geocoded: number;
    byCategory: Partial<Record<CrimeCategory, number>>;
  };
  selectedCategory: CrimeCategory | null;
  onCategoryChange: (cat: CrimeCategory | null) => void;
  // Weapon filter props
  weaponCounts?: Record<string, number>;
  selectedWeaponType: string | null;
  onWeaponTypeChange: (wt: string | null) => void;
  className?: string;
}

function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(d);
}

function computePresetRange(key: PresetKey): { from: string | null; to: string | null } {
  if (key === 'all') return { from: null, to: null };
  const today = new Date();
  const todayStr = toLocalDateString(today);
  if (key === 'today') return { from: todayStr, to: todayStr };
  if (key === 'yesterday') {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return { from: toLocalDateString(yesterday), to: toLocalDateString(yesterday) };
  }
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);
  return { from: toLocalDateString(weekAgo), to: todayStr };
}

const PRESETS: { key: PresetKey; labelDe: string; labelEn: string }[] = [
  { key: 'all', labelDe: 'Alle', labelEn: 'All' },
  { key: 'today', labelDe: 'Live', labelEn: 'Live' },
  { key: 'yesterday', labelDe: 'Gestern', labelEn: 'Yesterday' },
  { key: 'week', labelDe: 'Woche', labelEn: 'Week' },
];

// Fixed severity order: most serious Deliktkategorien first, Tatmittel (knife/weapons) at end
const CATEGORY_SEVERITY_ORDER: CrimeCategory[] = [
  'murder', 'sexual', 'assault', 'robbery', 'arson', 'burglary',
  'drugs', 'fraud', 'vandalism', 'traffic', 'missing_person', 'other',
  'knife', 'weapons',
];

// Short labels for category pills (to keep them compact)
const CATEGORY_SHORT_LABELS: Partial<Record<CrimeCategory, { de: string; en: string }>> = {
  murder: { de: 'Tötung', en: 'Murder' },
  knife: { de: 'Messer', en: 'Knife' },
  weapons: { de: 'Waffen', en: 'Weapons' },
  sexual: { de: 'Sexual', en: 'Sexual' },
  assault: { de: 'Körperverl.', en: 'Assault' },
  robbery: { de: 'Raub', en: 'Robbery' },
  burglary: { de: 'Einbruch', en: 'Burglary' },
  arson: { de: 'Brand', en: 'Arson' },
  drugs: { de: 'Drogen', en: 'Drugs' },
  fraud: { de: 'Betrug', en: 'Fraud' },
  vandalism: { de: 'Sachbesch.', en: 'Vandal.' },
  traffic: { de: 'Verkehr', en: 'Traffic' },
  missing_person: { de: 'Vermisst', en: 'Missing' },
  other: { de: 'Sonstige', en: 'Other' },
};

const WEAPON_ORDER = ['knife', 'gun', 'explosive', 'blunt'];

// Weapon icons — emojis (centered) for most, Noto Emoji Oreo revolver for gun (🔫 = water gun on all platforms)
export function WeaponIcon({ type, className = 'text-[16px]' }: { type: string; className?: string }) {
  if (type === 'gun') {
    // Google Noto Emoji Oreo revolver (Apache 2.0 license)
    return (
      <span className="inline-flex items-center justify-center flex-shrink-0 w-[24px] h-[24px]">
        <svg className="w-full h-full" viewBox="0 0 128 128">
          <path fill="#424242" d="M64.36 60.75s-.53 5.61-4.81 10.06c-.71.73 0 1.92.98 1.62 3.34-1.02 8.31-3.53 12.49-9.69l-8.66-1.99z"/>
          <path fill="#424242" d="m65.18 61.96 6.15 1.41c-3.75 4.96-7.98 7.13-11 8.07 3.31-3.47 4.47-7.54 4.85-9.48m-.82-1.21s-.53 5.61-4.81 10.06c-.63.65-.13 1.67.67 1.67.1 0 .2-.01.3-.05 3.34-1.02 8.31-3.53 12.49-9.69l-8.65-1.99z" opacity=".2"/>
          <path fill="#424242" d="M98.98 27.92c-4.62 0-7.81 4.42-9.97 4.42-1.48 0-2.95-.97-3.73-1.58-.38-.3-.88-.39-1.35-.26l-1.89.5c1.69 2 4.11 4.57 7.09 6.89 2.07-1.43 5.33-3.31 9.15-4.13 3.15-.68 6.28.63 6.84-1.5.57-2.12-1.52-4.34-6.14-4.34z"/>
          <path fill="#424242" d="M98.98 28.92c2.29 0 4.06.59 4.85 1.62.35.46.46.96.33 1.47-.07.27-.15.55-1.77.55-.23 0-.48 0-.73-.01-.28-.01-.57-.01-.87-.01-.74 0-1.71.03-2.72.24-3.62.78-6.74 2.46-8.89 3.87-2.15-1.74-3.97-3.59-5.34-5.11l.36-.1c.05-.01.1-.02.15-.02.12 0 .23.04.32.11 1.04.82 2.64 1.8 4.35 1.8 1.19 0 2.37-.82 3.74-1.77 1.77-1.24 3.79-2.64 6.22-2.64m0-1c-4.62 0-7.81 4.42-9.97 4.42-1.48 0-2.95-.97-3.73-1.58-.27-.21-.6-.32-.93-.32-.14 0-.28.02-.41.05l-1.9.51c1.69 2 4.11 4.57 7.09 6.89 2.07-1.43 5.33-3.31 9.15-4.13.85-.18 1.71-.22 2.51-.22.57 0 1.1.02 1.6.02 1.39 0 2.43-.15 2.74-1.29.56-2.13-1.53-4.35-6.15-4.35z" opacity=".2"/>
          <path fill="#757575" d="M101.75 43.31c0-1.11-.85-2.01-1.96-2.15-8.92-1.14-15.94-9.72-18.21-12.81-.51-.7-1.33-1.11-2.19-1.11H23v-.13c0-1.46-.89-2.7-2.34-2.9l-7.22-1.01c-.8-.11-1.44.51-1.44 1.32v2.71H7.71C5.75 27.25 4 28.83 4 30.79v13.42C4 46.16 5.75 48 7.71 48h29.97v8.24c0 3.2 2.64 6 5.84 6-.29.79-.51 1.59-.64 2.36-1.69 10.44 5.91 16.69 16.34 18.43 1.71.29 3.39.43 5.01.43 8.26 0 14.98-3.82 16.44-12.55.19-1.15.26-2.24.25-3.29l.02.01.04-2.23c2.57 0 4.9 1.46 6.87 2.4l.53-1.59 13.42 4.52-.05-27.42zm-26.4 26.73c-.89 5.34-4.64 8.05-11.12 8.05-1.31 0-2.7-.12-4.12-.36-4.22-.7-7.67-2.26-9.74-4.39-1.99-2.05-2.7-4.62-2.17-7.87.17-1.08.65-2.2 1.34-3.22 6.46.01 16.41.45 25.29 1.99.73 1.62.9 3.53.52 5.8z"/>
          <path fill="#424242" d="m14 25.31 6.39.89c.57.08.61.72.61.91v.13c0 1.1.9 2 2 2h56.39c.23 0 .45.1.58.29 2.7 3.69 10.01 12.4 19.57 13.61.1.01.21.08.21.17l.03 24.64L89 64.32c-.21-.07-.42-.1-.64-.1-.31 0-.61.07-.89.21-.29.14-.53.35-.72.61-1.66-.81-3.62-1.63-5.78-1.63-1.09 0-1.98.87-2 1.97l-.03 1.96c-.02.11-.02.21-.02.32.01 1.01-.06 1.97-.22 2.93-1.58 9.46-9.74 10.88-14.46 10.88-1.5 0-3.07-.14-4.68-.41-3.95-.66-16.69-3.78-14.7-16.14.1-.64.28-1.31.54-1.99.23-.61.14-1.3-.23-1.84s-.99-.86-1.64-.86c-2.04 0-3.84-1.87-3.84-4V48c0-1.1-.9-2-2-2H7.71C6.88 46 6 45.08 6 44.21V30.79c0-.81.81-1.54 1.71-1.54H12c1.1 0 2-.9 2-2v-1.94m50.23 54.78c9.48 0 12.35-5.29 13.1-9.72.45-2.67.23-4.94-.67-6.95-.27-.61-.83-1.04-1.49-1.15-10.42-1.8-21.4-2.01-25.63-2.02-.67 0-1.29.33-1.66.89-.86 1.29-1.43 2.68-1.65 4.01-.62 3.86.29 7.08 2.71 9.58 2.36 2.43 6.21 4.2 10.84 4.97 1.53.26 3.03.39 4.45.39M13.26 23.2c-.71 0-1.26.59-1.26 1.33v2.71H7.71C5.75 27.25 4 28.83 4 30.79v13.42C4 46.16 5.75 48 7.71 48h29.97v8.24c0 3.2 2.64 6 5.84 6-.29.79-.51 1.59-.64 2.36-1.69 10.44 5.91 16.69 16.34 18.43 1.71.29 3.39.43 5.01.43 8.26 0 14.98-3.82 16.44-12.55.19-1.15.26-2.24.25-3.29l.02.01.04-2.23c2.55 0 4.9 1.47 6.87 2.41l.53-1.59 13.42 4.51-.03-27.43c0-1.11-.85-2.01-1.96-2.15-8.92-1.14-15.94-9.72-18.21-12.81-.51-.7-1.33-1.11-2.19-1.11H23v-.13c0-1.46-.89-2.7-2.34-2.9l-7.22-1.01c-.06.02-.12.01-.18.01zm50.97 54.89c-1.31 0-2.7-.12-4.12-.36-4.22-.7-7.67-2.26-9.74-4.39-1.99-2.05-2.7-4.62-2.17-7.87.17-1.08.65-2.2 1.34-3.22 6.46.01 16.41.45 25.29 1.99.73 1.63.9 3.54.52 5.8-.89 5.34-4.63 8.05-11.12 8.05z" opacity=".2"/>
          <linearGradient id="gun-grip" x1="87.0183" x2="120.555" y1="81.7013" y2="67.5836" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#6d4c41"/>
            <stop offset="1" stopColor="#4e342e"/>
          </linearGradient>
          <path fill="url(#gun-grip)" d="M80.96 65.42v-4.01s-.17-2.75 2.77-3.7c3.15-1.02 6.39-3.96 7.26-5.67.87-1.71 1.86-3.3 2.13-5.43 0 0 .23-2.77 3.63-2.77h5.01s2.61 6.19 4.59 9.43c1.98 3.24 17.66 21.8 17.66 38.47 0 0 .54 13.34-15.41 13.04-14.37-.27-13.82-2.31-13.7-3 0 0 .36-3.12-.06-4.68-.42-1.56-1.26-2.09-1.26-3.54s1.23-1.89 1.23-6.21-2.86-6.42-2.86-8.12c0-1.7.32-2.2.22-3.76-.01.03-.04-7.54-11.21-10.05z"/>
          <path fill="#424242" d="M99.78 46.85c.95 2.15 2.6 5.7 4 7.99.36.59.96 1.41 1.86 2.65 4.2 5.76 15.36 21.07 15.36 34.26v.12c0 .04.08 3.96-2.64 6.79-2 2.08-5.11 3.14-9.25 3.14h-.47c-6.5-.12-9.42-.61-10.66-.95.08-1.29.11-3.15-.26-4.51-.26-.98-.64-1.68-.91-2.19-.17-.33-.23-.44-.24-.5.03-.09.09-.23.14-.33.55-1.32 1.09-2.86 1.09-5.94 0-3.48-1.4-5.84-2.33-7.4-.18-.3-.42-.71-.52-.93.01-.47.05-.82.1-1.21.08-.65.18-1.38.11-2.49-.05-1.24-.8-8.9-11.19-12.21v-1.71c0-.12.01-.07 0-.14.04-.5.46-.63.69-.71 3.84-1.24 7.76-4.7 9.01-7.16l.39-.75c.82-1.56 1.74-3.32 2.04-5.65.01-.02.02-.05.02-.06.04-.03.23-.1.63-.1h3.03m1.97-3.01h-5.01c-3.4 0-3.63 2.77-3.63 2.77-.27 2.13-1.26 3.72-2.13 5.43-.87 1.71-4.11 4.65-7.26 5.67-2.94.95-2.77 3.7-2.77 3.7v4.01c11.16 2.5 11.19 10.07 11.19 10.07.1 1.56-.22 2.06-.22 3.76 0 1.7 2.86 3.8 2.86 8.12s-1.23 4.76-1.23 6.21c0 1.45.84 1.98 1.26 3.54.42 1.56.06 4.68.06 4.68-.12.69-.67 2.73 13.7 3h.52c15.41 0 14.89-13.05 14.89-13.05 0-16.67-15.68-35.23-17.66-38.47-1.96-3.25-4.57-9.44-4.57-9.44z" opacity=".2"/>
          <path fill="#565656" d="M70.55 32.24h-24.7c-1.18 0-2.14.96-2.14 2.14v20.65c0 1.18.96 2.14 2.14 2.14h24.3c5.42 0 8.9-5.87 8.9-12.63.01-6.77-3.69-12.3-8.5-12.3z"/>
          <path fill="#424242" d="M67.96 42.37H51.15c-.5 0-.9-.4-.9-.9v-4.33c0-.5.4-.9.9-.9h16.82c1.69 0 3.07 1.37 3.07 3.07-.01 1.69-1.38 3.06-3.08 3.06zm0 10.8H51.15c-.5 0-.9-.4-.9-.9v-4.33c0-.5.4-.9.9-.9h16.82c1.69 0 3.07 1.37 3.07 3.07-.01 1.68-1.38 3.06-3.08 3.06z"/>
        </svg>
      </span>
    );
  }
  const emoji: Record<string, string> = {
    knife: '🔪',
    blunt: '🔨',
    axe: '🪓',
    explosive: '💣',
  };
  return (
    <span className={`w-[24px] h-[24px] leading-none flex-shrink-0 inline-flex items-center justify-center ${className}`}>
      {emoji[type] ?? WEAPON_LABELS[type]?.icon ?? '?'}
    </span>
  );
}

export function BlaulichtPlaybackControl({
  totalEvents,
  dateFilterFrom,
  dateFilterTo,
  onDateFilterChange,
  mapRef,
  onSearchPinChange,
  blaulichtStats,
  selectedCategory,
  onCategoryChange,
  weaponCounts,
  selectedWeaponType,
  onWeaponTypeChange,
  className = '',
}: BlaulichtPlaybackControlProps) {
  const { lang } = useTranslation();
  const hasData = totalEvents > 0;
  const [expandedPanel, setExpandedPanel] = useState<ExpandedPanel>(null);
  const [periodOpen, setPeriodOpen] = useState(false);

  // ── Address search state ──
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PhotonFeature[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searchLocationName, setSearchLocationName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSearchInput = useCallback((value: string) => {
    setQuery(value);
    setActiveIndex(-1);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setResults([]);
      setIsSearchOpen(false);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      const features = await searchAddress(value);
      setResults(features);
      setIsSearchOpen(features.length > 0);
    }, 350);
  }, []);

  const selectResult = useCallback((feature: PhotonFeature) => {
    const [lng, lat] = feature.geometry.coordinates;
    const zoom = getZoomForType(feature.properties.type);
    mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 1200 });
    onSearchPinChange({ lng, lat });
    const name = formatPhotonResult(feature);
    setQuery(name);
    setSearchLocationName(feature.properties.name || feature.properties.city || name.split(',')[0]);
    setIsSearchOpen(false);
    setResults([]);
    inputRef.current?.blur();
  }, [mapRef, onSearchPinChange]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isSearchOpen || results.length === 0) {
      if (e.key === 'Escape') {
        setIsSearchOpen(false);
        inputRef.current?.blur();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < results.length) selectResult(results[activeIndex]);
        break;
      case 'Escape':
        setIsSearchOpen(false);
        inputRef.current?.blur();
        break;
    }
  }, [isSearchOpen, results, activeIndex, selectResult]);

  const handleSearchClear = useCallback(() => {
    setQuery('');
    setResults([]);
    setIsSearchOpen(false);
    setActiveIndex(-1);
    setSearchLocationName(null);
    onSearchPinChange(null);
  }, [onSearchPinChange]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Focus search input when search panel opens
  useEffect(() => {
    if (expandedPanel === 'search') {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [expandedPanel]);

  // ── Date filter logic ──
  const activePreset = useMemo<PresetKey | null>(() => {
    for (const preset of PRESETS) {
      const range = computePresetRange(preset.key);
      if (range.from === dateFilterFrom && range.to === dateFilterTo) return preset.key;
    }
    return null;
  }, [dateFilterFrom, dateFilterTo]);

  const handlePresetClick = useCallback((key: PresetKey) => {
    const range = computePresetRange(key);
    onDateFilterChange(range.from, range.to);
    setPeriodOpen(false);
  }, [onDateFilterChange]);

  const isCustomRange = activePreset === null && (dateFilterFrom || dateFilterTo);

  // ── Toggle helpers ──
  const togglePanel = useCallback((panel: ExpandedPanel) => {
    setExpandedPanel((prev) => (prev === panel ? null : panel));
    if (panel === 'time') setPeriodOpen(false);
  }, []);

  // Time button label
  const timeLabel = useMemo(() => {
    if (activePreset === 'all' || (!dateFilterFrom && !dateFilterTo)) return lang === 'de' ? 'Alle' : 'All';
    if (activePreset) {
      const preset = PRESETS.find((p) => p.key === activePreset);
      return preset ? (lang === 'de' ? preset.labelDe : preset.labelEn) : '';
    }
    const from = dateFilterFrom ? formatShortDate(dateFilterFrom) : '...';
    const to = dateFilterTo ? formatShortDate(dateFilterTo) : '...';
    return `${from}–${to}`;
  }, [activePreset, dateFilterFrom, dateFilterTo, lang]);

  // Search button label
  const searchLabel = useMemo(() => {
    if (searchLocationName) return searchLocationName;
    return lang === 'de' ? 'Ort' : 'Place';
  }, [searchLocationName, lang]);

  // ── Sorted categories with counts ──
  const sortedCategories = useMemo(() => {
    if (!blaulichtStats) return [];
    return CRIME_CATEGORIES
      .filter((cat) => (blaulichtStats.byCategory[cat.key] || 0) > 0)
      .sort((a, b) => {
        const ai = CATEGORY_SEVERITY_ORDER.indexOf(a.key as CrimeCategory);
        const bi = CATEGORY_SEVERITY_ORDER.indexOf(b.key as CrimeCategory);
        return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
      });
  }, [blaulichtStats]);

  // ── Sorted weapons with counts (vehicle hidden) ──
  const sortedWeapons = useMemo(() => {
    if (!weaponCounts) return [];
    return Object.entries(weaponCounts)
      .filter(([wt, count]) => count > 0 && wt !== 'vehicle' && WEAPON_LABELS[wt])
      .sort(([a], [b]) => {
        const ai = WEAPON_ORDER.indexOf(a);
        const bi = WEAPON_ORDER.indexOf(b);
        return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
      });
  }, [weaponCounts]);

  const hasTimeFilter = activePreset !== null && activePreset !== 'all' || isCustomRange;

  return (
    <div
      ref={containerRef}
      className={`absolute left-1/2 -translate-x-1/2 z-[1000] transition-all duration-200 ease-out ${hasData ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-6 opacity-0 pointer-events-none'} ${className}`}
      role="group"
      aria-label={lang === 'de' ? 'Blaulicht-Filter' : 'Blaulicht filters'}
    >
      {/* Autocomplete dropdown — renders ABOVE the bar */}
      {isSearchOpen && results.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1.5 bg-[var(--card-elevated)]/95 backdrop-blur-sm border border-[var(--border)] rounded-xl overflow-hidden shadow-lg max-h-[240px] overflow-y-auto">
          {results.map((feature, index) => (
            <button
              key={`${feature.properties.osm_id}-${index}`}
              className={`w-full text-left px-3 py-2.5 text-sm transition-colors border-b border-[var(--card-border)] last:border-b-0 ${
                index === activeIndex
                  ? 'bg-white/10 text-[var(--foreground)]'
                  : 'text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--foreground)]'
              }`}
              onClick={() => selectResult(feature)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <div className="truncate">{formatPhotonResult(feature)}</div>
              {feature.properties.type && (
                <div className="text-[10px] text-[var(--text-faint)] mt-0.5 capitalize">
                  {feature.properties.type}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="w-[calc(100vw-1.5rem)] max-w-[520px] rounded-xl border px-2 py-1.5 glass-panel glass-panel-soft">
        {/* Row 1: Scrollable category pills */}
        <div className="overflow-x-auto scrollbar-hide -mx-2 px-2 mb-1 pb-1 border-b border-[var(--border-subtle)]/70">
          <div className="flex gap-1 w-max">
            {/* "Alle" reset pill */}
            <button
              type="button"
              onClick={() => onCategoryChange(null)}
              className={`glass-button flex items-center gap-1 text-[11px] h-[26px] px-2 rounded-full border font-medium whitespace-nowrap transition-colors duration-150 ${
                selectedCategory === null
                  ? 'border-white/60 text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)]'
              }`}
              style={selectedCategory === null ? { backgroundColor: '#3b82f620', borderColor: '#3b82f699' } : undefined}
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: '#3b82f6' }}
              />
              {lang === 'de' ? 'Alle' : 'All'}
              {blaulichtStats && (
                <span className="text-[10px] text-[var(--text-muted)] tabular-nums">{blaulichtStats.total}</span>
              )}
            </button>

            {/* Individual category pills */}
            {sortedCategories.map((cat) => {
              const count = blaulichtStats?.byCategory[cat.key] || 0;
              const isSelected = selectedCategory === cat.key;
              const shortLabel = CATEGORY_SHORT_LABELS[cat.key];
              const label = shortLabel
                ? (lang === 'de' ? shortLabel.de : shortLabel.en)
                : tNested('crimeCategories', cat.key, lang);
              return (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => onCategoryChange(isSelected ? null : cat.key)}
                  className={`glass-button flex items-center gap-1 text-[11px] h-[26px] px-2 rounded-full border font-medium whitespace-nowrap transition-colors duration-150 ${
                    isSelected
                      ? 'border-white/60 text-[var(--text-primary)]'
                      : 'text-[var(--text-tertiary)]'
                  }`}
                  style={isSelected ? { backgroundColor: `${cat.color}20`, borderColor: `${cat.color}99` } : undefined}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: cat.color }}
                  />
                  {label}
                  <span className="text-[10px] text-[var(--text-muted)] tabular-nums">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 2: Weapon chips (left) + search/time toggles (right) */}
        <div className="flex items-center gap-1">
          {/* Weapon chips — icon only by default, expand to show label+count on tap */}
          {sortedWeapons.map(([wt, count]) => {
            const label = WEAPON_LABELS[wt];
            if (!label) return null;
            const isSelected = selectedWeaponType === wt;
            return (
              <button
                key={wt}
                type="button"
                onClick={() => onWeaponTypeChange(isSelected ? null : wt)}
                className={`glass-button flex items-center justify-center gap-1 text-[11px] h-8 min-w-[2.25rem] px-1.5 rounded-lg border font-medium transition-all duration-200 ease-out ${
                  isSelected
                    ? 'bg-blue-500/20 border-blue-500/60 text-[var(--text-primary)]'
                    : 'text-[var(--text-tertiary)]'
                }`}
              >
                <span
                  className={`inline-flex items-center justify-center transition-all duration-200 ease-out ${
                    isSelected ? 'max-w-0 overflow-hidden opacity-0' : 'max-w-[24px] opacity-100'
                  }`}
                >
                  <WeaponIcon type={wt} className="text-[18px]" />
                </span>
                <span
                  className={`overflow-hidden whitespace-nowrap transition-all duration-200 ease-out text-[11px] ${
                    isSelected ? 'max-w-[10rem] opacity-100' : 'max-w-0 opacity-0'
                  }`}
                >
                  {lang === 'de' ? label.de : label.en}
                  <span className="text-[10px] text-[var(--text-muted)] ml-0.5 tabular-nums">{count}</span>
                </span>
              </button>
            );
          })}

          {/* Spacer pushing search/time to the right */}
          <div className="ml-auto" />

          {/* Search toggle button — label hidden on small screens */}
          <button
            type="button"
            onClick={() => togglePanel('search')}
            className={`glass-button flex items-center gap-1 text-[11px] h-8 px-1.5 sm:px-2 rounded-lg border font-medium transition-colors duration-150 ${
              expandedPanel === 'search' || searchLocationName
                ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-300'
                : 'text-[var(--text-tertiary)]'
            }`}
          >
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="hidden min-[400px]:inline max-w-[60px] truncate">{searchLabel}</span>
          </button>

          {/* Time toggle button — label hidden on small screens */}
          <button
            type="button"
            onClick={() => togglePanel('time')}
            className={`glass-button flex items-center gap-1 text-[11px] h-8 px-1.5 sm:px-2 rounded-lg border font-medium transition-colors duration-150 ${
              activePreset === 'today'
                ? 'bg-red-500/20 border-red-500/60 text-red-300'
                : expandedPanel === 'time' || hasTimeFilter
                  ? 'bg-blue-500/20 border-blue-500/60 text-blue-300'
                  : 'text-[var(--text-tertiary)]'
            }`}
          >
            {activePreset === 'today' ? (
              <span className="relative flex h-2 w-2 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              </span>
            ) : (
              <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            )}
            <span className="hidden min-[400px]:inline whitespace-nowrap">{timeLabel}</span>
          </button>
        </div>

        {/* Expandable: Search input */}
        {expandedPanel === 'search' && (
          <div className="border-t border-[var(--border-subtle)]/70 mt-2 pt-2">
            <div className="flex items-center bg-[var(--background)]/70 border border-[var(--border)] rounded-lg overflow-hidden">
              <svg className="w-3.5 h-3.5 ml-2.5 text-[var(--text-muted)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => handleSearchInput(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => results.length > 0 && setIsSearchOpen(true)}
                placeholder={lang === 'de' ? 'Adresse suchen...' : 'Search address...'}
                className="w-full px-2 py-1.5 bg-transparent text-[var(--foreground)] text-[12px] placeholder-[var(--text-muted)] outline-none"
                autoComplete="off"
              />
              {(query || searchLocationName) && (
                <button
                  onClick={handleSearchClear}
                  className="px-2 py-1.5 text-[var(--text-muted)] hover:text-[var(--foreground)] transition-colors"
                  aria-label={lang === 'de' ? 'Suche leeren' : 'Clear search'}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Expandable: Time filter */}
        {expandedPanel === 'time' && (
          <div className="border-t border-[var(--border-subtle)]/70 mt-2 pt-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              {PRESETS.map((preset) => {
                const isActive = activePreset === preset.key;
                const isLive = preset.key === 'today';
                return (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => handlePresetClick(preset.key)}
                    className={`glass-button flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg border font-medium transition-colors duration-150 ${
                      isActive
                        ? isLive
                          ? 'bg-red-500/25 border-red-500 text-red-300'
                          : 'bg-blue-500/25 border-blue-500 text-blue-300'
                        : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {isLive && (
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                      </span>
                    )}
                    {lang === 'de' ? preset.labelDe : preset.labelEn}
                  </button>
                );
              })}

              {/* Period selector toggle */}
              <button
                type="button"
                onClick={() => setPeriodOpen((v) => !v)}
                className={`glass-button ml-auto flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border font-medium transition-colors duration-150 ${
                  periodOpen || isCustomRange
                    ? 'bg-blue-500/25 border-blue-500 text-blue-300'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <span className="whitespace-nowrap">{lang === 'de' ? 'Zeitraum' : 'Period'}</span>
              </button>
            </div>

            {/* Collapsible date range inputs */}
            {periodOpen && (
              <div className="mt-2 pt-2 border-t border-[var(--border-subtle)]/70 flex items-center gap-2">
                <input
                  type="date"
                  value={dateFilterFrom ?? ''}
                  onChange={(e) => onDateFilterChange(e.target.value || null, dateFilterTo)}
                  className="date-filter-input flex-1 min-w-0 h-7 text-[11px] text-[var(--text-primary)] bg-[var(--background)]/70 border border-[var(--border)] rounded-lg px-2 focus:border-blue-500/60 focus:outline-none"
                  aria-label={lang === 'de' ? 'Datum von' : 'Date from'}
                />
                <span className="text-[11px] text-[var(--text-muted)]">&ndash;</span>
                <input
                  type="date"
                  value={dateFilterTo ?? ''}
                  onChange={(e) => onDateFilterChange(dateFilterFrom, e.target.value || null)}
                  className="date-filter-input flex-1 min-w-0 h-7 text-[11px] text-[var(--text-primary)] bg-[var(--background)]/70 border border-[var(--border)] rounded-lg px-2 focus:border-blue-500/60 focus:outline-none"
                  aria-label={lang === 'de' ? 'Datum bis' : 'Date to'}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
