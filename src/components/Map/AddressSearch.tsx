'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import {
  searchAddress,
  formatPhotonResult,
  getZoomForType,
  type PhotonFeature,
} from '@/lib/geocoding';

interface AddressSearchProps {
  mapRef: React.RefObject<MapRef | null>;
}

export function AddressSearch({ mapRef }: AddressSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PhotonFeature[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [selectedPin, setSelectedPin] = useState<{ lng: number; lat: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);

  // Debounced search
  const handleInputChange = useCallback((value: string) => {
    setQuery(value);
    setActiveIndex(-1);

    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    if (value.trim().length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    debounceRef.current = window.setTimeout(async () => {
      const features = await searchAddress(value);
      setResults(features);
      setIsOpen(features.length > 0);
    }, 350);
  }, []);

  // Handle result selection
  const selectResult = useCallback((feature: PhotonFeature) => {
    const [lng, lat] = feature.geometry.coordinates;
    const zoom = getZoomForType(feature.properties.type);

    mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 1200 });
    setSelectedPin({ lng, lat });
    setQuery(formatPhotonResult(feature));
    setIsOpen(false);
    setResults([]);
    inputRef.current?.blur();
  }, [mapRef]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) {
      if (e.key === 'Escape') {
        setIsOpen(false);
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
        if (activeIndex >= 0 && activeIndex < results.length) {
          selectResult(results[activeIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        inputRef.current?.blur();
        break;
    }
  }, [isOpen, results, activeIndex, selectResult]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.address-search-container')) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleClear = useCallback(() => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    setSelectedPin(null);
    setActiveIndex(-1);
  }, []);

  return (
    <>
      {/* Search overlay - positioned outside map */}
      <div className="address-search-container absolute z-[1000] top-4 left-1/2 -translate-x-1/2 w-[320px] max-md:top-16 max-md:left-3 max-md:right-3 max-md:w-auto max-md:translate-x-0">
        <div className="relative">
          {/* Search input */}
          <div className="flex items-center bg-[#1a1a1a]/95 backdrop-blur-sm border border-[#333] rounded-lg overflow-hidden shadow-lg">
            <svg
              className="w-4 h-4 ml-3 text-zinc-500 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => results.length > 0 && setIsOpen(true)}
              placeholder="Adresse suchen..."
              className="w-full px-3 py-2.5 bg-transparent text-white text-sm placeholder-zinc-500 outline-none"
              autoComplete="off"
            />
            {query && (
              <button
                onClick={handleClear}
                className="px-3 py-2 text-zinc-500 hover:text-white transition-colors"
                aria-label="Suche leeren"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Autocomplete dropdown */}
          {isOpen && results.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-[#1a1a1a]/95 backdrop-blur-sm border border-[#333] rounded-lg overflow-hidden shadow-lg max-h-[240px] overflow-y-auto">
              {results.map((feature, index) => (
                <button
                  key={`${feature.properties.osm_id}-${index}`}
                  className={`w-full text-left px-3 py-2.5 text-sm transition-colors border-b border-[#262626] last:border-b-0 ${
                    index === activeIndex
                      ? 'bg-white/10 text-white'
                      : 'text-zinc-300 hover:bg-white/5 hover:text-white'
                  }`}
                  onClick={() => selectResult(feature)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <div className="truncate">{formatPhotonResult(feature)}</div>
                  {feature.properties.type && (
                    <div className="text-[10px] text-zinc-600 mt-0.5 capitalize">
                      {feature.properties.type}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cyan pin marker on the map */}
      {selectedPin && (
        <Marker longitude={selectedPin.lng} latitude={selectedPin.lat} anchor="bottom">
          <svg width="24" height="36" viewBox="0 0 24 36" fill="none">
            <path
              d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24s12-15 12-24C24 5.373 18.627 0 12 0z"
              fill="#22d3ee"
            />
            <circle cx="12" cy="12" r="5" fill="#0a0a0a" />
          </svg>
        </Marker>
      )}
    </>
  );
}
