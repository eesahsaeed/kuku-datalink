import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';

const PinBoxes = forwardRef(function PinBoxes(
  { value, onChange, disabled = false, length = 4, onComplete },
  ref
) {
  const refs = useRef([]);
  const normalizedValue = String(value || '')
    .replace(/\D/g, '')
    .slice(0, length);
  const lastCompletedValueRef = useRef(
    normalizedValue.length === length ? normalizedValue : ''
  );

  const digits = useMemo(
    () =>
      Array.from({ length }).map((_, index) => normalizedValue[index] || ''),
    [length, normalizedValue]
  );

  useImperativeHandle(
    ref,
    () => ({
      focus(index = 0) {
        refs.current[index]?.focus();
      },
    }),
    []
  );

  useEffect(() => {
    if (normalizedValue.length === length) {
      if (normalizedValue !== lastCompletedValueRef.current) {
        lastCompletedValueRef.current = normalizedValue;
        onComplete?.(normalizedValue);
      }
      return;
    }

    lastCompletedValueRef.current = '';
  }, [length, normalizedValue, onComplete]);

  const updateDigitsFromIndex = (index, nextValue) => {
    const incomingDigits = String(nextValue || '').replace(/\D/g, '');
    const updated = [...digits];

    if (!incomingDigits) {
      updated[index] = '';
      onChange(updated.join(''));
      return;
    }

    for (
      let offset = 0;
      offset < incomingDigits.length && index + offset < length;
      offset += 1
    ) {
      updated[index + offset] = incomingDigits[offset];
    }

    onChange(updated.join(''));

    const lastUpdatedIndex =
      Math.min(index + incomingDigits.length, length) - 1;
    if (lastUpdatedIndex < length - 1) {
      refs.current[lastUpdatedIndex + 1]?.focus();
    } else {
      refs.current[lastUpdatedIndex]?.focus();
    }
  };

  const handleChange = (index, nextValue) => {
    updateDigitsFromIndex(index, nextValue);
  };

  const handleKeyDown = (index, event) => {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      refs.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowRight' && index < length - 1) {
      refs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (index, event) => {
    const pastedDigits = String(
      event.clipboardData?.getData('text') || ''
    ).replace(/\D/g, '');

    if (!pastedDigits) {
      return;
    }

    event.preventDefault();
    updateDigitsFromIndex(index, pastedDigits);
  };

  return (
    <div className="d-flex gap-3 justify-content-center flex-wrap">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint={index === length - 1 ? 'done' : 'next'}
          maxLength={1}
          value={digit}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={(event) => handlePaste(index, event)}
          disabled={disabled}
          style={{
            width: '58px',
            height: '64px',
            textAlign: 'center',
            fontSize: '1.5rem',
            borderRadius: '14px',
            border: '1px solid #d0d7e2',
            backgroundColor: '#fff',
            marginRight: 5,
          }}
        />
      ))}
    </div>
  );
});

export default PinBoxes;
