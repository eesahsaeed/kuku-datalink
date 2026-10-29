import React from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  Table,
} from 'components/ui/primitives';
import { formatNairaFromKobo } from '../utils/money';
import { getPlanSellingPriceClass } from '../utils/plans';

function PlansTableView({ plans = [], onViewDetails = () => {} }) {
  return (
    <Card className="plans-dashboard-card">
      <CardBody className="p-0">
        <div className="plans-table-wrapper">
          <Table responsive hover className="mb-0 plans-table-minimal">
            <thead>
              <tr>
                <th>Name</th>
                <th>Network</th>
                <th>Original</th>
                <th>Selling</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {plans.length === 0 ? (
                <tr>
                  <td className="text-center text-muted py-4" colSpan={6}>
                    No plans match your filters.
                  </td>
                </tr>
              ) : (
                plans.map((plan) => (
                  <tr
                    key={plan.id}
                    className="plans-table-row-clickable"
                    role="button"
                    tabIndex={0}
                    onClick={() => onViewDetails(plan)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onViewDetails(plan);
                      }
                    }}
                  >
                    <td>
                      <div className="plans-table-minimal-title">{plan.name}</div>
                      <div className="plans-table-minimal-meta">
                        <span className="text-muted small">{plan.id}</span>
                        {plan.isNew ? (
                          <Badge color="primary" pill>
                            New
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div>{plan.network}</div>
                      <div className="text-muted small">
                        {plan.durationGroup || plan.duration_group || 'More'} ·{' '}
                        {plan.category}
                      </div>
                    </td>
                    <td>{formatNairaFromKobo(plan.originalPriceKobo)}</td>
                    <td className={getPlanSellingPriceClass(plan)}>
                      {formatNairaFromKobo(plan.sellingPriceKobo)}
                    </td>
                    <td>
                      <div className="plans-status-badges">
                        {plan.exclude ? (
                          <Badge color="danger" pill>
                            Excluded
                          </Badge>
                        ) : null}
                        {plan.source && plan.source !== 'configured' ? (
                          <Badge
                            color={
                              plan.source === 'directortech'
                                ? 'warning'
                                : 'success'
                            }
                            pill
                          >
                            {plan.sourceLabel || plan.source}
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <Button
                        color="info"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          onViewDetails(plan);
                        }}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </div>
      </CardBody>
    </Card>
  );
}

export default PlansTableView;
