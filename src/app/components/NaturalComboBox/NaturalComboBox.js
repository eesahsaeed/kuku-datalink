import React from 'react';
import {
  ComboBox,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Text,
} from 'react-aria-components';

function defaultSearchFields(item) {
  return Object.values(item || {}).filter(
    (value) => typeof value === 'string' || typeof value === 'number'
  );
}

export default function NaturalComboBox({
  id,
  label,
  placeholder,
  inputValue,
  onInputChange,
  items = [],
  onSelectionChange,
  getKey,
  getLabel,
  getDescription,
  getSearchFields = defaultSearchFields,
  maxLength,
  description,
  emptyState = 'No saved options found',
}) {
  const visibleItems = React.useMemo(() => {
    const query = String(inputValue || '')
      .trim()
      .toLowerCase();

    const filtered = !query
      ? items
      : items.filter((item) =>
          getSearchFields(item).some((field) =>
            String(field || '')
              .toLowerCase()
              .includes(query)
          )
        );

    return filtered.slice(0, 8);
  }, [getSearchFields, inputValue, items]);

  return (
    <ComboBox
      aria-label={label}
      className="kuku-combobox"
      inputValue={inputValue}
      onInputChange={onInputChange}
      items={visibleItems}
      allowsCustomValue
      menuTrigger="focus"
      onSelectionChange={(key) => {
        const selected = items.find(
          (item) => String(getKey(item)) === String(key)
        );
        if (selected) {
          onSelectionChange?.(selected);
        }
      }}
    >
      <Label className="kuku-combobox-label" htmlFor={id}>
        {label}
      </Label>
      <div className="kuku-combobox-field">
        <Input
          id={id}
          className="kuku-combobox-input"
          placeholder={placeholder}
          maxLength={maxLength}
        />
      </div>
      {description ? (
        <Text slot="description" className="kuku-combobox-help">
          {description}
        </Text>
      ) : null}
      <Popover className="kuku-combobox-popover" offset={8}>
        <ListBox
          className="kuku-combobox-list"
          renderEmptyState={() => (
            <div className="kuku-combobox-empty">{emptyState}</div>
          )}
        >
          {(item) => (
            <ListBoxItem
              id={String(getKey(item))}
              className="kuku-combobox-item"
              textValue={String(getLabel(item))}
            >
              <div className="kuku-combobox-item-copy">
                <strong>{getLabel(item)}</strong>
                {getDescription?.(item) ? (
                  <span>{getDescription(item)}</span>
                ) : null}
              </div>
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </ComboBox>
  );
}
