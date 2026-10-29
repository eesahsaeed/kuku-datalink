import React, { useEffect, useState } from 'react';
import { FormGroup } from 'components/ui/primitives';
import NaturalComboBox from 'components/NaturalComboBox/NaturalComboBox';

const providerLength = {
  dstv: 10,
  gotv: 10,
  startimes: 11,
};

const SmartCardInput = ({
  tvBeneficiaries = [],
  value = '',
  onSelect,
  onChange,
  provider,
  verifySmartCard,
}) => {
  const [inputValue, setInputValue] = useState(value);

  const providerCode = provider?.toLowerCase();
  const expectedLength = providerLength[providerCode] || 11;

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleInputChange = (text) => {
    const nextValue = String(text || '').trimStart().replace(/\D/g, '');
    setInputValue(nextValue);
    onChange?.(nextValue);

    if (nextValue.length === expectedLength) {
      verifySmartCard?.(nextValue);
    }
  };

  const handleSelectionChange = (item) => {
    const number = item.smartCardNumber || '';
    setInputValue(number);
    onChange?.(number);
    verifySmartCard?.(number);
    onSelect?.([{ ...item, smartCardNumber: number }]);
  };

  return (
    <FormGroup className="mb-3 position-relative">
      <NaturalComboBox
        id="smartCardInput"
        label="Smart Card / IUC Number"
        placeholder={`Enter ${expectedLength} digit IUC number`}
        inputValue={inputValue}
        onInputChange={handleInputChange}
        items={tvBeneficiaries}
        getKey={(item) => item.smartCardNumber}
        getLabel={(item) => item.smartCardNumber}
        getDescription={(item) => item.name || 'No name saved'}
        getSearchFields={(item) => [item.smartCardNumber, item.name]}
        onSelectionChange={handleSelectionChange}
        maxLength={expectedLength}
        description={`Enter exactly ${expectedLength} digits for ${provider || 'this provider'}.`}
        emptyState="No saved beneficiaries match this smart card number"
      />
    </FormGroup>
  );
};

export default SmartCardInput;
