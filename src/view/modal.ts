/**
 * Keeps a dialog or drawer modal for the keyboard as well as the pointer. While it is locked, everything else in the
 * page it sits in (the toolbar, the matrix, the tray, the legend) is `inert`: it cannot be focused, tabbed to or clicked.
 * Unlocking gives back exactly what was locked.
 */
export interface ModalLock {
  lock(): void;
  unlock(): void;
}

export function createModalLock(modal: HTMLElement): ModalLock {
  let locked: Element[] = [];
  return {
    lock() {
      if (locked.length > 0 || !modal.parentElement) return;
      locked = [...modal.parentElement.children].filter(e => e !== modal && !(e as HTMLElement).inert);
      for (const e of locked) (e as HTMLElement).inert = true;
    },
    unlock() {
      for (const e of locked) (e as HTMLElement).inert = false;
      locked = [];
    },
  };
}
