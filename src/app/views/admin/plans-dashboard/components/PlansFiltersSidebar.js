import React from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  FormGroup,
  Input,
  Label,
} from 'components/ui/primitives';
import { SORT_OPTIONS, VIEW_MODES } from '../constants';
import { fromKobo, toKobo } from '../utils/money';

function PlansFiltersSidebar({
  networks = [],
  categories = [],
  durationGroups = [],
  filters = {},
  rangeBounds = { minKobo: 0, maxKobo: 0 },
  totalCount = 0,
  visibleCount = 0,
  onFiltersChange,
  onReset,
}) {
  const handleChange = (field, value) => {
    onFiltersChange((previous) => ({
      ...previous,
      [field]: value,
    }));
  };
  const hasNumericValue = (value) =>
    value !== null &&
    value !== undefined &&
    String(value).trim() !== '' &&
    Number.isFinite(Number(value));

  const minPriceDisplay =
    hasNumericValue(filters.minPriceKobo)
      ? fromKobo(filters.minPriceKobo)
      : '';
  const maxPriceDisplay =
    hasNumericValue(filters.maxPriceKobo)
      ? fromKobo(filters.maxPriceKobo)
      : '';

  return (
    <Card className="plans-dashboard-card plans-filter-sidebar plans-filter-panel">
      <CardHeader className="plans-dashboard-card-header plans-filter-header d-flex flex-wrap justify-content-between align-items-start gap-3">
        <CardTitle tag="h4" className="mb-1">
          Plan Filters
        </CardTitle>
        <div className="text-muted small">
          {visibleCount} of {totalCount} plans
        </div>
      </CardHeader>
      <CardBody className="plans-filter-grid">
        <FormGroup className="plans-filter-field plans-filter-field-search">
          <Label>Search</Label>
          <Input
            type="text"
            value={filters.search || ''}
            placeholder="Name or package code"
            onChange={(event) => handleChange('search', event.target.value)}
          />
        </FormGroup>

        <FormGroup className="plans-filter-field plans-filter-field-network">
          <Label>Network</Label>
          <Input
            type="select"
            value={filters.network}
            onChange={(event) => handleChange('network', event.target.value)}
          >
            <option value="ALL">All Networks</option>
            {networks.map((network) => (
              <option key={network} value={network}>
                {network}
              </option>
            ))}
          </Input>
        </FormGroup>

        <FormGroup className="plans-filter-field plans-filter-field-source">
          <Label>Source</Label>
          <Input
            type="select"
            value={filters.source || 'ALL'}
            onChange={(event) => handleChange('source', event.target.value)}
          >
            <option value="ALL">All Sources</option>
            <option value="aidapay">Aidapay</option>
            <option value="directortech">Directortech</option>
            <option value="configured">Configured</option>
          </Input>
        </FormGroup>

        <FormGroup className="plans-filter-field plans-filter-field-duration">
          <Label>Duration</Label>
          <Input
            type="select"
            value={filters.durationGroup || 'ALL'}
            onChange={(event) =>
              handleChange('durationGroup', event.target.value)
            }
          >
            <option value="ALL">All Durations</option>
            {durationGroups.map((durationGroup) => (
              <option key={durationGroup} value={durationGroup}>
                {durationGroup}
              </option>
            ))}
          </Input>
        </FormGroup>

        <FormGroup className="plans-filter-field plans-filter-field-category">
          <Label>Category</Label>
          <Input
            type="select"
            value={filters.category}
            onChange={(event) => handleChange('category', event.target.value)}
          >
            <option value="ALL">All Categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Input>
        </FormGroup>

        <FormGroup className="plans-filter-field plans-filter-field-sort">
          <Label>Sort</Label>
          <Input
            type="select"
            value={filters.sortBy}
            onChange={(event) => handleChange('sortBy', event.target.value)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Input>
        </FormGroup>

        <FormGroup className="plans-filter-field plans-filter-field-price">
          <Label>Price Range (NGN)</Label>
          <div className="plans-price-range-grid">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={minPriceDisplay}
              placeholder={fromKobo(rangeBounds.minKobo)}
              onChange={(event) => {
                const rawValue = String(event.target.value || '').trim();
                handleChange(
                  'minPriceKobo',
                  rawValue ? toKobo(Number(rawValue)) : null
                );
              }}
            />
            <Input
              type="number"
              min={0}
              step="0.01"
              value={maxPriceDisplay}
              placeholder={fromKobo(rangeBounds.maxKobo)}
              onChange={(event) => {
                const rawValue = String(event.target.value || '').trim();
                handleChange(
                  'maxPriceKobo',
                  rawValue ? toKobo(Number(rawValue)) : null
                );
              }}
            />
          </div>
        </FormGroup>

        <FormGroup className="plans-filter-field plans-filter-field-visibility">
          <Label className="plans-inline-checkbox">
            <Input
              type="checkbox"
              checked={Boolean(filters.showExcluded)}
              onChange={(event) =>
                handleChange('showExcluded', Boolean(event.target.checked))
              }
            />
            <span>Show excluded plans</span>
          </Label>
        </FormGroup>

        <FormGroup className="plans-filter-field plans-filter-field-view">
          <Label>View</Label>
          <div className="plans-view-toggle">
            <Button
              color={filters.viewMode === VIEW_MODES.GRID ? 'info' : 'secondary'}
              size="sm"
              onClick={() => handleChange('viewMode', VIEW_MODES.GRID)}
            >
              Grid
            </Button>
            <Button
              color={filters.viewMode === VIEW_MODES.TABLE ? 'info' : 'secondary'}
              size="sm"
              onClick={() => handleChange('viewMode', VIEW_MODES.TABLE)}
            >
              Table
            </Button>
          </div>
        </FormGroup>

        <div className="plans-filter-actions">
          <Button color="secondary" outline size="sm" onClick={onReset}>
            Reset Filters
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export default PlansFiltersSidebar;
