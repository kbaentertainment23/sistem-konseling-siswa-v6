export interface BackdropClickCheckParams {
  isSameTarget: boolean;
  pointerDownSeen: boolean;
  pointerStartedOnBackdrop: boolean;
  disabled?: boolean;
}

export interface EscapeKeyCheckParams {
  key: string;
  open: boolean;
  disabled?: boolean;
  isTopmost?: boolean;
}

export interface ModalDismissEntry {
  id: symbol;
  disabled: boolean;
  onClose: () => void;
}

/**
 * Determines whether a click event on a modal backdrop should dismiss the modal.
 * Prevents accidental dismissal when a user selects text inside the modal and releases the mouse outside.
 */
export function shouldDismissOnBackdropClick(params: BackdropClickCheckParams): boolean {
  const { isSameTarget, pointerDownSeen, pointerStartedOnBackdrop, disabled = false } = params;
  if (disabled) return false;
  if (!isSameTarget) return false;
  if (pointerDownSeen) {
    return pointerStartedOnBackdrop;
  }
  return true;
}

/**
 * Determines whether a keydown event should dismiss a modal via Escape.
 */
export function shouldDismissOnEscapeKey(params: EscapeKeyCheckParams): boolean {
  const { key, open, disabled = false, isTopmost = true } = params;
  if (!open || disabled || !isTopmost) return false;
  return key === 'Escape';
}

/**
 * Returns the topmost open modal entry from a LIFO modal stack.
 */
export function getTopmostModalEntry(stack: readonly ModalDismissEntry[]): ModalDismissEntry | null {
  if (stack.length === 0) return null;
  return stack[stack.length - 1];
}
