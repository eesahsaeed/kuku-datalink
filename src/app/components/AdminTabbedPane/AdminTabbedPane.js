import React from 'react';
import { Tab, TabList, TabPanel, Tabs } from 'react-aria-components';

import {
  formatToNaira,
  cleanAndCapitalize,
  getDataPlanPricingMeta,
  sortPlanGroupKeysByDuration,
} from '../../../lib/helper';
import {
  Badge,
  CardBody,
} from 'components/ui/primitives';

export default function AdminTabbedPane({
  selectedDataPlans,
  selectedPlanData,
  setSelectedPlanData,
}) {
  const planKeys = sortPlanGroupKeysByDuration(
    Object.keys(selectedDataPlans || {})
  );

  if (planKeys.length === 0) {
    return <div />;
  }

  return (
    <Tabs
      className="kuku-tabs kuku-tabs-admin"
      aria-label="Available admin data plans"
      defaultSelectedKey={planKeys[0]}
    >
      <TabList className="kuku-tab-list">
        {planKeys.map((key) => (
          <Tab className="kuku-tab" id={key} key={key}>
            {cleanAndCapitalize(key)}
          </Tab>
        ))}
      </TabList>

      {planKeys.map((key) => (
        <TabPanel className="kuku-tab-panel" id={key} key={key}>
          <CardBody>
            <div className="data-plan-collection">
              {selectedDataPlans[key].map((plan, index) => {
                const pricingMeta = getDataPlanPricingMeta(
                  plan.package_api_code
                );
                const backendSellingPrice = Number(
                  plan?.sellingPrice ??
                    plan?.price ??
                    pricingMeta?.sellingPrice ??
                    pricingMeta?.price ??
                    plan?.package_amount ??
                    plan?.package_original_amount ??
                    pricingMeta?.package_original_amount ??
                    pricingMeta?.originalPrice ??
                    0
                );
                const aidaPayOriginalAmount = Number(
                  plan.package_original_amount ||
                    pricingMeta?.package_original_amount ||
                    0
                );
                const hasValidDataDetailsPrice = Number.isFinite(
                  backendSellingPrice
                );
                const isPricingHealthy =
                  hasValidDataDetailsPrice &&
                  backendSellingPrice > aidaPayOriginalAmount;
                const displayPrice = hasValidDataDetailsPrice
                  ? backendSellingPrice
                  : aidaPayOriginalAmount;
                const isSelected =
                  plan.package_api_code === selectedPlanData.package_api_code;

                return (
                  <button
                    type="button"
                    className={`data-plan-card${isSelected ? ' data-plan-card-selected' : ''}`}
                    key={`${key}-${plan.package_api_code}-${index}`}
                    onClick={() => {
                      setSelectedPlanData(plan);
                    }}
                  >
                    <div className="data-plan-card-main">
                      <span className="data-plan-selection-indicator" aria-hidden="true">
                        <span className="data-plan-selection-dot" />
                      </span>
                      <div className="data-plan-copy">
                        <strong>{plan.package_name}</strong>
                        <span>{cleanAndCapitalize(key)}</span>
                      </div>
                    </div>
                    <div className="data-plan-meta">
                      <div className="data-plan-badges">
                        {pricingMeta?.exclude ? (
                          <Badge color="danger" className="mr-0">
                            Excluded
                          </Badge>
                        ) : null}
                        {!pricingMeta ? (
                          <Badge color="primary" className="mr-0">
                            New
                          </Badge>
                        ) : null}
                        {!isPricingHealthy ? (
                          <Badge color="danger" className="mr-0">
                            Mismatch
                          </Badge>
                        ) : null}
                      </div>
                      <div
                        className={`data-plan-price${
                          isPricingHealthy
                            ? ' data-plan-price-success'
                            : ' data-plan-price-danger'
                        }`}
                      >
                        {formatToNaira(displayPrice)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardBody>
        </TabPanel>
      ))}
    </Tabs>
  );
}
