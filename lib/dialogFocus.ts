"use client";

import { useEffect, useRef } from "react";

/** Controls a keyboard user can reach inside a modal. Disabled and hidden controls are excluded. */
export const TABBABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Where Tab or Shift+Tab should go inside a modal.
 * `null` means the browser can move to the next control still inside the dialog.
 * A number is the index to wrap to when focus would otherwise leave.
 */
export function focusTrapTarget(count: number, activeIndex: number, shiftKey: boolean): number | null {
  if (count <= 0) return null;
  const outside = activeIndex < 0 || activeIndex >= count;
  if (shiftKey) {
    if (outside || activeIndex === 0) return count - 1;
    return null;
  }
  if (outside || activeIndex === count - 1) return 0;
  return null;
}

const openDialogs: HTMLElement[] = [];

function tabbableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter((element) => {
    if (element.tabIndex < 0 || element.hasAttribute("disabled")) return false;
    if (element.closest("[hidden], [inert], [aria-hidden='true']")) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

function bindModalDialog(node: HTMLElement, onEscape: () => void): () => void {
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  openDialogs.push(node);

  const items = tabbableElements(node);
  const initial = items[0] ?? node;
  initial.focus({ preventScroll: true });

  const onKey = (event: KeyboardEvent) => {
    if (openDialogs[openDialogs.length - 1] !== node) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
      return;
    }
    if (event.key !== "Tab") return;
    const current = tabbableElements(node);
    const activeIndex = document.activeElement instanceof HTMLElement ? current.indexOf(document.activeElement) : -1;
    const nextIndex = focusTrapTarget(current.length, activeIndex, event.shiftKey);
    if (nextIndex === null) return;
    event.preventDefault();
    (current[nextIndex] ?? node).focus({ preventScroll: true });
  };

  document.addEventListener("keydown", onKey);
  return () => {
    document.removeEventListener("keydown", onKey);
    const index = openDialogs.lastIndexOf(node);
    if (index >= 0) openDialogs.splice(index, 1);
    if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
  };
}

/** Moves focus into a dialog, keeps Tab inside it, closes on Escape, and restores the opener. */
export function useModalDialog(onEscape: () => void) {
  const nodeRef = useRef<HTMLElement>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    return bindModalDialog(node, () => onEscapeRef.current());
  }, []);

  return nodeRef;
}
