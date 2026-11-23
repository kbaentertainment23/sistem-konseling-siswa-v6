import { useEffect, useRef } from 'react';
import type React from 'react';
import {
  getTopmostModalEntry,
  shouldDismissOnBackdropClick,
  shouldDismissOnEscapeKey,
  type ModalDismissEntry,
} from './modalDismissLogic';

const modalStack: ModalDismissEntry[] = [];
let keyListenerAttached = false;

function handleGlobalKeyDown(event: KeyboardEvent) {
  const top = getTopmostModalEntry(modalStack);
  if (!top) return;
  if (
    shouldDismissOnEscapeKey({
      key: event.key,
      open: true,
      disabled: top.disabled,
      isTopmost: true,
    })
  ) {
    event.preventDefault();
    top.onClose();
  }
}

function syncGlobalKeyListener() {
  if (typeof document === 'undefined') return;
  if (modalStack.length > 0 && !keyListenerAttached) {
    document.addEventListener('keydown', handleGlobalKeyDown);
    keyListenerAttached = true;
  } else if (modalStack.length === 0 && keyListenerAttached) {
    document.removeEventListener('keydown', handleGlobalKeyDown);
    keyListenerAttached = false;
  }
}

export interface UseModalDismissOptions {
  open: boolean;
  onClose: () => void;
  disabled?: boolean;
}

export interface BackdropDismissProps {
  onMouseDown: (event: React.MouseEvent<HTMLElement>) => void;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
}

/**
 * Enables clicking outside a popup/modal (on the backdrop) or pressing Escape
 * to close the modal, while preventing accidental dismissal when dragging text
 * from inside the modal onto the backdrop.
 */
export function useModalDismiss({
  open,
  onClose,
  disabled = false,
}: UseModalDismissOptions): BackdropDismissProps {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const entryRef = useRef<ModalDismissEntry | null>(null);
  const pointerDownSeenRef = useRef(false);
  const pointerStartedOnBackdropRef = useRef(false);

  useEffect(() => {
    if (!open) {
      pointerDownSeenRef.current = false;
      pointerStartedOnBackdropRef.current = false;
      return;
    }

    const entry: ModalDismissEntry = {
      id: Symbol('modal'),
      disabled,
      onClose: () => onCloseRef.current(),
    };
    entryRef.current = entry;
    modalStack.push(entry);
    syncGlobalKeyListener();

    return () => {
      const idx = modalStack.indexOf(entry);
      if (idx !== -1) {
        modalStack.splice(idx, 1);
      }
      if (entryRef.current === entry) {
        entryRef.current = null;
      }
      syncGlobalKeyListener();
    };
  }, [open]);

  useEffect(() => {
    if (entryRef.current) {
      entryRef.current.disabled = disabled;
    }
  }, [disabled]);

  return {
    onMouseDown: (event: React.MouseEvent<HTMLElement>) => {
      pointerDownSeenRef.current = true;
      pointerStartedOnBackdropRef.current = event.target === event.currentTarget;
    },
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      const shouldClose = shouldDismissOnBackdropClick({
        isSameTarget: event.target === event.currentTarget,
        pointerDownSeen: pointerDownSeenRef.current,
        pointerStartedOnBackdrop: pointerStartedOnBackdropRef.current,
        disabled: disabledRef.current,
      });
      pointerDownSeenRef.current = false;
      pointerStartedOnBackdropRef.current = false;
      if (shouldClose) {
        onCloseRef.current();
      }
    },
  };
}
