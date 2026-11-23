import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTopmostModalEntry,
  shouldDismissOnBackdropClick,
  shouldDismissOnEscapeKey,
  type ModalDismissEntry,
} from './modalDismissLogic';

test('shouldDismissOnBackdropClick closes when pointer started and clicked on backdrop', () => {
  assert.equal(
    shouldDismissOnBackdropClick({
      isSameTarget: true,
      pointerDownSeen: true,
      pointerStartedOnBackdrop: true,
      disabled: false,
    }),
    true
  );
});

test('shouldDismissOnBackdropClick ignores clicks inside dialog or drag-out releases', () => {
  assert.equal(
    shouldDismissOnBackdropClick({
      isSameTarget: false,
      pointerDownSeen: true,
      pointerStartedOnBackdrop: false,
    }),
    false
  );

  // Dragging text from inside modal and releasing outside onto backdrop
  assert.equal(
    shouldDismissOnBackdropClick({
      isSameTarget: true,
      pointerDownSeen: true,
      pointerStartedOnBackdrop: false,
    }),
    false
  );
});

test('shouldDismissOnBackdropClick handles synthetic clicks without pointerdown and respects disabled', () => {
  assert.equal(
    shouldDismissOnBackdropClick({
      isSameTarget: true,
      pointerDownSeen: false,
      pointerStartedOnBackdrop: false,
      disabled: false,
    }),
    true
  );

  assert.equal(
    shouldDismissOnBackdropClick({
      isSameTarget: true,
      pointerDownSeen: true,
      pointerStartedOnBackdrop: true,
      disabled: true,
    }),
    false
  );
});

test('shouldDismissOnEscapeKey only closes topmost enabled modal on Escape', () => {
  assert.equal(
    shouldDismissOnEscapeKey({ key: 'Escape', open: true, disabled: false, isTopmost: true }),
    true
  );
  assert.equal(
    shouldDismissOnEscapeKey({ key: 'Enter', open: true, disabled: false, isTopmost: true }),
    false
  );
  assert.equal(
    shouldDismissOnEscapeKey({ key: 'Escape', open: true, disabled: true, isTopmost: true }),
    false
  );
  assert.equal(
    shouldDismissOnEscapeKey({ key: 'Escape', open: true, disabled: false, isTopmost: false }),
    false
  );
});

test('getTopmostModalEntry returns last opened modal in stack', () => {
  const first: ModalDismissEntry = { id: Symbol('first'), disabled: false, onClose: () => {} };
  const second: ModalDismissEntry = { id: Symbol('second'), disabled: false, onClose: () => {} };

  assert.equal(getTopmostModalEntry([]), null);
  assert.equal(getTopmostModalEntry([first, second]), second);
});
