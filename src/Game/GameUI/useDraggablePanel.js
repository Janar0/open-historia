/*! Open Historia — persistent drag positioning for floating game panels © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { useCallback, useEffect, useRef, useState } from "react";

const EDGE_GAP = 8;

const readPosition = (storageKey) => {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey));
    return Number.isFinite(value?.x) && Number.isFinite(value?.y)
      ? { x: value.x, y: value.y }
      : null;
  } catch {
    return null;
  }
};

const clampPosition = (position, rect) => ({
  x: Math.round(Math.max(EDGE_GAP, Math.min(position.x, window.innerWidth - rect.width - EDGE_GAP))),
  y: Math.round(Math.max(EDGE_GAP, Math.min(position.y, window.innerHeight - rect.height - EDGE_GAP))),
});

export const useDraggablePanel = (storageKey) => {
  const panelRef = useRef(null);
  const [position, setPosition] = useState(() => readPosition(storageKey));
  const dragRef = useRef(null);

  const resetPosition = useCallback(() => {
    setPosition(null);
    try { localStorage.removeItem(storageKey); } catch { /* private mode */ }
  }, [storageKey]);

  const onPointerDown = useCallback((event) => {
    if (event.button !== 0 || event.target.closest("button, input, textarea, select, a")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panelX: rect.left,
      panelY: rect.top,
      rect,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    event.preventDefault();
  }, []);

  const onPointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition(clampPosition({
      x: drag.panelX + event.clientX - drag.startX,
      y: drag.panelY + event.clientY - drag.startY,
    }, drag.rect));
  }, []);

  const onPointerUp = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    setPosition((current) => {
      if (current) {
        try { localStorage.setItem(storageKey, JSON.stringify(current)); } catch { /* private mode */ }
      }
      return current;
    });
  }, [storageKey]);

  useEffect(() => {
    const keepVisible = () => {
      const panel = panelRef.current;
      if (!panel) return;
      setPosition((current) => current ? clampPosition(current, panel.getBoundingClientRect()) : current);
    };
    window.addEventListener("resize", keepVisible);
    return () => {
      window.removeEventListener("resize", keepVisible);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);

  return {
    panelRef,
    positionStyle: position ? { left: `${position.x}px`, right: "auto", top: `${position.y}px`, bottom: "auto" } : null,
    dragHandleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onDoubleClick: resetPosition,
      title: "Drag to move · double-click to reset",
      style: { cursor: "grab", touchAction: "none" },
    },
  };
};
