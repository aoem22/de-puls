'use client';

import { useState, useEffect, useRef, useCallback, type TouchEvent } from 'react';

// Tri-state bottom sheet: peek (~45% visible) → expanded (full) → dismissed
// All transitions use transform only (GPU-accelerated, 60fps).
export type SheetState = 'peek' | 'expanded';
export const PEEK_Y_PERCENT = 55; // translateY(55%) → 45% of sheet visible
export const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

export function useDraggableSheet(onClose: () => void, threshold = 80) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sheetState, setSheetState] = useState<SheetState>('peek');
  const stateRef = useRef<SheetState>('peek');

  const dragStartY = useRef(0);
  const currentDeltaY = useRef(0);
  const isDragging = useRef(false);
  const dragDirection = useRef<'up' | 'down' | null>(null);
  const animationCleared = useRef(false);
  const lastTouchY = useRef(0);
  const lastTouchTime = useRef(0);
  const velocity = useRef(0);
  const [ready, setReady] = useState(false);

  useEffect(() => { stateRef.current = sheetState; }, [sheetState]);

  // Base Y in px for current state
  const getBaseY = useCallback(() => {
    const el = sheetRef.current;
    if (!el) return 0;
    return stateRef.current === 'peek' ? el.offsetHeight * PEEK_Y_PERCENT / 100 : 0;
  }, []);

  // Snap to a position with animated transition
  const snapTo = useCallback((el: HTMLDivElement, target: 'peek' | 'expanded' | 'dismissed', then?: () => void) => {
    el.style.transition = `transform 0.4s ${EASE}, opacity 0.35s ease, border-radius 0.3s ${EASE}`;

    if (target === 'dismissed') {
      el.style.transform = 'translateY(100%)';
      el.style.opacity = '0';
      if (then) setTimeout(then, 400);
    } else if (target === 'peek') {
      el.style.transform = `translateY(${PEEK_Y_PERCENT}%)`;
      el.style.opacity = '1';
      el.style.borderRadius = '1rem 1rem 0 0';
      setSheetState('peek');
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    } else {
      el.style.transform = 'translateY(0)';
      el.style.opacity = '1';
      el.style.borderRadius = '0';
      setSheetState('expanded');
    }
  }, []);

  // After entry animation completes, switch to inline transform positioning
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const onEnd = () => {
      if (!animationCleared.current) {
        animationCleared.current = true;
        el.classList.remove('animate-sheet-enter');
        el.style.transform = `translateY(${PEEK_Y_PERCENT}%)`;
        el.style.borderRadius = '1rem 1rem 0 0';
        setReady(true);
      }
    };
    el.addEventListener('animationend', onEnd);
    return () => el.removeEventListener('animationend', onEnd);
  }, []);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const target = e.target as HTMLElement;
    const inDragArea = !!target.closest('.sheet-drag-area');
    const scrollEl = scrollRef.current;
    const scrolledToTop = !scrollEl || scrollEl.scrollTop <= 0;

    if (!inDragArea && !scrolledToTop) return;

    isDragging.current = true;
    dragDirection.current = null;
    dragStartY.current = e.touches[0].clientY;
    lastTouchY.current = e.touches[0].clientY;
    lastTouchTime.current = Date.now();
    velocity.current = 0;
    currentDeltaY.current = 0;

    if (sheetRef.current) {
      sheetRef.current.style.transition = 'none';
    }
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isDragging.current || !sheetRef.current) return;

    const touchY = e.touches[0].clientY;
    const deltaY = touchY - dragStartY.current;
    const baseY = getBaseY();

    // Track velocity (px/ms)
    const now = Date.now();
    const dt = now - lastTouchTime.current;
    if (dt > 0) {
      velocity.current = (touchY - lastTouchY.current) / dt;
    }
    lastTouchY.current = touchY;
    lastTouchTime.current = now;

    if (dragDirection.current === null && Math.abs(deltaY) > 5) {
      dragDirection.current = deltaY > 0 ? 'down' : 'up';
    }

    if (deltaY > 0) {
      // ── Dragging DOWN ──
      e.preventDefault();
      currentDeltaY.current = deltaY;
      // Rubber-band damping
      const damped = deltaY < threshold
        ? deltaY
        : threshold + (deltaY - threshold) * 0.3;
      sheetRef.current.style.transform = `translateY(${baseY + damped}px)`;
      // Only fade opacity when dragging toward dismiss (from peek), not expanded→peek
      if (stateRef.current === 'peek') {
        sheetRef.current.style.opacity = `${Math.max(0.4, 1 - damped / (window.innerHeight * 0.6))}`;
      }
    } else if (stateRef.current === 'peek') {
      // ── Dragging UP from peek → expanding ──
      e.preventDefault();
      currentDeltaY.current = deltaY;
      // Smoothly interpolate between peek and expanded positions
      const progress = Math.min(Math.abs(deltaY) / baseY, 1);
      const eased = progress * progress * (3 - 2 * progress); // smoothstep
      const currentY = baseY * (1 - eased);
      sheetRef.current.style.transform = `translateY(${currentY}px)`;
      // Animate border-radius as you pull up
      const r = (1 - eased) * 16;
      sheetRef.current.style.borderRadius = `${r}px ${r}px 0 0`;
    } else {
      // ── Dragging UP while expanded → let content scroll ──
      isDragging.current = false;
      sheetRef.current.style.transform = 'translateY(0)';
      sheetRef.current.style.opacity = '1';
    }
  }, [threshold, getBaseY]);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current || !sheetRef.current) return;
    isDragging.current = false;
    const el = sheetRef.current;

    const delta = currentDeltaY.current;
    const vel = velocity.current;
    const state = stateRef.current;

    if (delta > 0) {
      // ── Released after dragging DOWN ──
      if (state === 'expanded') {
        if (vel > 1.2) {
          snapTo(el, 'dismissed', onClose);
        } else if (delta > threshold || vel > 0.4) {
          snapTo(el, 'peek');
        } else {
          snapTo(el, 'expanded');
        }
      } else {
        if (delta > threshold || vel > 0.5) {
          snapTo(el, 'dismissed', onClose);
        } else {
          snapTo(el, 'peek');
        }
      }
    } else if (delta < 0 && state === 'peek') {
      // ── Released after dragging UP from peek ──
      if (Math.abs(delta) > threshold / 2 || vel < -0.3) {
        snapTo(el, 'expanded');
      } else {
        snapTo(el, 'peek');
      }
    } else {
      snapTo(el, state);
    }

    currentDeltaY.current = 0;
    velocity.current = 0;
    dragDirection.current = null;
  }, [onClose, threshold, snapTo]);

  return {
    sheetRef,
    scrollRef,
    isExpanded: sheetState === 'expanded',
    ready,
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  };
}
