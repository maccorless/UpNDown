import { useEffect, useRef, type ReactNode } from 'react';

// 'any': Esc and a click outside close it. 'esc': Esc closes it (same as its Cancel button). 'none': only the app closes it.
export type ModalDismiss = 'any' | 'esc' | 'none';

interface ModalProps {
  className: string;
  dismiss: ModalDismiss;
  onClose: () => void;
  label?: string;
  labelledBy?: string;
  children: ReactNode;
}

// A native modal <dialog>: the browser provides the inert page, focus containment, top layer and focus return.
export function Modal({ className, dismiss, onClose, label, labelledBy, children }: ModalProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    if (!dialog.open) {
      // jsdom has no showModal; the fallback keeps component tests rendering the content.
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    // A confirmation should start on its safe action, not the first control in the DOM.
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();

    if (dismiss !== 'any' || 'closedBy' in HTMLDialogElement.prototype) return undefined;
    // shortcut: Safari has no closedby, so click-outside is handled here. Remove once Safari ships it.
    const outside = (e: PointerEvent): boolean => {
      const rect = dialog.getBoundingClientRect();
      return e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
    };
    let pressedOutside = false;
    const onDown = (e: PointerEvent): void => { pressedOutside = outside(e); };
    const onUp = (e: PointerEvent): void => { if (pressedOutside && outside(e)) onClose(); };
    dialog.addEventListener('pointerdown', onDown);
    dialog.addEventListener('pointerup', onUp);
    return () => {
      dialog.removeEventListener('pointerdown', onDown);
      dialog.removeEventListener('pointerup', onUp);
    };
  }, [dismiss, onClose]);

  return (
    <dialog
      ref={dialogRef}
      className={`modal-dialog ${className}`}
      aria-label={label}
      aria-labelledby={labelledBy}
      onCancel={dismiss === 'none' ? (e) => e.preventDefault() : undefined}
      onClose={() => {
        if (dismiss !== 'none') {
          onClose();
          return;
        }
        // Browsers may still close on a repeated Esc; these dialogs must stay until the app dismisses them.
        const dialog = dialogRef.current;
        if (dialog && !dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
      }}
      {...{ closedby: dismiss === 'any' ? 'any' : dismiss === 'none' ? 'none' : 'closerequest' }}
    >
      {children}
    </dialog>
  );
}
