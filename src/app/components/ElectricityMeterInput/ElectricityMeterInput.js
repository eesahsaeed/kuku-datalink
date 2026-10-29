import React, { useEffect, useState } from 'react';
import { FormGroup } from 'components/ui/primitives';
import NaturalComboBox from 'components/NaturalComboBox/NaturalComboBox';

const ElectricityMeterInput = ({
  electricityBeneficiaries = [],
  value = '',
  onSelect,
  onChange,
  provider,
  verifyMeter,
}) => {
  const [inputValue, setInputValue] = useState(value);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleInputChange = (text) => {
    const nextValue = String(text || '').trimStart().replace(/\D/g, '');
    setInputValue(nextValue);
    onChange?.(nextValue);
  };

  const handleSelectionChange = (item) => {
    const meterNum = item.meterNumber || '';
    setInputValue(meterNum);
    onChange?.(meterNum);
    verifyMeter?.(meterNum);
    onSelect?.([{ ...item, meterNumber: meterNum }]);
  };

  return (
    <FormGroup className="mb-3 position-relative">
      <NaturalComboBox
        id="meterInput"
        label="Meter Number"
        placeholder="Enter your meter number"
        inputValue={inputValue}
        onInputChange={handleInputChange}
        items={electricityBeneficiaries}
        getKey={(item) => item.meterNumber}
        getLabel={(item) => item.meterNumber}
        getDescription={(item) => item.name || 'No name saved'}
        getSearchFields={(item) => [item.meterNumber, item.name]}
        onSelectionChange={handleSelectionChange}
        maxLength={13}
        description={`Enter meter number for ${provider?.provider_name || 'this provider'}.`}
        emptyState="No saved meters match this number"
      />
    </FormGroup>
  );
};

export default ElectricityMeterInput;
