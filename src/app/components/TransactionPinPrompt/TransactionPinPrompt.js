import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from 'components/ui/primitives';
import PinBoxes from 'components/PinBoxes/PinBoxes';

const DEFAULT_PIN_LENGTH = 4;

export const TransactionPinFields = React.forwardRef(function TransactionPinFields(
  props,
  ref
) {
  const {
    pin,
    onPinChange,
    onConfirm,
    loading = false,
    subtitle = '',
    errorMessage = '',
    autoFocus = false,
    active = true,
    length = DEFAULT_PIN_LENGTH,
  } = props;

  const [error, setError] = useState('');
  const [showExternalError, setShowExternalError] = useState(false);
  const [internalPin, setInternalPin] = useState('');
  const pinBoxesRef = useRef(null);
  const pinLength = Number.isFinite(Number(length)) && Number(length) > 0
    ? Math.floor(Number(length))
    : DEFAULT_PIN_LENGTH;
  const isControlled =
    Object.prototype.hasOwnProperty.call(props, 'pin') &&
    typeof onPinChange === 'function';
  const resolvedPin = isControlled ? String(pin || '') : internalPin;
  const defaultSubtitle =
    subtitle ||
    `Enter your ${pinLength}-digit PIN to complete this purchase.`;

  useEffect(() => {
    if (!active) {
      setError('');
      setShowExternalError(false);
      if (!isControlled) {
        setInternalPin('');
      }
    }
  }, [active, isControlled]);

  useEffect(() => {
    if (String(errorMessage || '').trim()) {
      setShowExternalError(true);
      if (!isControlled) {
        setInternalPin('');
      }
    } else {
      setShowExternalError(false);
    }
  }, [errorMessage, isControlled]);

  useEffect(() => {
    if (!autoFocus) return undefined;

    const focusPinInput = () => {
      pinBoxesRef.current?.focus(0);
    };

    // Focus immediately when modal opens.
    const rafId = window.requestAnimationFrame(focusPinInput);
    const timeoutId = window.setTimeout(focusPinInput, 0);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
    };
  }, [autoFocus]);

  const clearPin = () => {
    if (isControlled) {
      onPinChange?.('');
      return;
    }

    setInternalPin('');
  };

  const handleConfirm = async (enteredPin = resolvedPin) => {
    const normalizedPin = String(enteredPin || resolvedPin || '')
      .replace(/\D/g, '')
      .slice(0, pinLength);

    if (normalizedPin.length !== pinLength) {
      setError(`Enter your ${pinLength}-digit PIN`);
      setShowExternalError(false);
      return false;
    }

    setError('');
    setShowExternalError(false);
    const submitResult = await onConfirm?.(normalizedPin);

    if (submitResult === false) {
      clearPin();
      return false;
    }

    return true;
  };

  React.useImperativeHandle(
    ref,
    () => ({
      focus(index = 0) {
        pinBoxesRef.current?.focus(index);
      },
      submit() {
        return handleConfirm();
      },
      reset() {
        setError('');
        setShowExternalError(false);
        clearPin();
      },
    }),
    [clearPin, handleConfirm]
  );

  const handlePinChange = (nextPin) => {
    if (error) {
      setError('');
    }

    if (showExternalError) {
      setShowExternalError(false);
    }

    if (isControlled) {
      onPinChange?.(nextPin);
    } else {
      setInternalPin(nextPin);
    }
  };

  return (
    <>
      <p className="text-muted mb-4">{defaultSubtitle}</p>
      <PinBoxes
        ref={pinBoxesRef}
        value={resolvedPin}
        onChange={handlePinChange}
        disabled={loading}
        length={pinLength}
        onComplete={handleConfirm}
      />
      {error || (showExternalError ? errorMessage : '') ? (
        <div className="text-danger small mt-3 text-center">
          {showExternalError ? errorMessage : error}
        </div>
      ) : null}
    </>
  );
});

function TransactionPinPrompt({
  isOpen,
  onClose,
  onConfirm,
  loading = false,
  title = 'Enter Transaction PIN',
  subtitle = '',
  errorMessage = '',
  confirmLabel = 'Continue',
  loadingLabel = 'Verifying...',
  length = DEFAULT_PIN_LENGTH,
}) {
  const promptRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      promptRef.current?.reset?.();
      return;
    }

    if (errorMessage) {
      promptRef.current?.reset?.();
    }
  }, [errorMessage, isOpen]);

  const handleClose = () => {
    if (loading) return;
    promptRef.current?.reset?.();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      toggle={handleClose}
      centered
      backdrop="static"
      fade={false}
      keyboard={!loading}
    >
      <ModalHeader toggle={handleClose}>{title}</ModalHeader>
      <ModalBody>
        <TransactionPinFields
          ref={promptRef}
          onConfirm={onConfirm}
          loading={loading}
          subtitle={subtitle}
          errorMessage={errorMessage}
          autoFocus={isOpen}
          active={isOpen}
          length={length}
        />
      </ModalBody>
      <ModalFooter>
        <Button
          color="primary"
          onClick={() => promptRef.current?.submit()}
          disabled={loading}
        >
          {loading ? loadingLabel : confirmLabel}
        </Button>
        <Button color="secondary" onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default TransactionPinPrompt;
