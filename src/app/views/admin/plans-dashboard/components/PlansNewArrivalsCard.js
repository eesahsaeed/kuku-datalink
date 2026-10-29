import React from 'react';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
} from 'components/ui/primitives';
import { formatNairaFromKobo } from '../utils/money';
import { getPlanSellingPriceClass } from '../utils/plans';

function PlansNewArrivalsCard({ plans = [] }) {
  if (!plans.length) {
    return (
      <Card className="plans-dashboard-card mb-4">
        <CardHeader className="plans-dashboard-card-header">
          <CardTitle tag="h3" className="mb-1">
            New Live Plans
          </CardTitle>
          <div className="text-muted small">
            No uncatalogued live provider plans were found in the latest sync.
          </div>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="plans-dashboard-card mb-4">
      <CardHeader className="plans-dashboard-card-header">
        <div className="plans-new-arrivals-header">
          <div>
            <CardTitle tag="h3" className="mb-1">
              New Live Plans
            </CardTitle>
            <div className="text-muted small">
              These live provider plans are not yet saved in `dataDetails`.
            </div>
          </div>
          <Badge color="primary" pill>
            {plans.length} New
          </Badge>
        </div>
      </CardHeader>
      <CardBody className="plans-new-arrivals-body">
        {plans.map((plan) => (
          <div key={plan.id} className="plans-new-arrival-row">
            <div className="plans-new-arrival-copy">
              <div className="plans-new-arrival-title-row">
                <strong>{plan.name}</strong>
                <div className="plans-status-badges">
                  <Badge color="primary" pill>
                    New
                  </Badge>
                  {plan.source ? (
                    <Badge color="info" pill>
                      {String(plan.source).toUpperCase()}
                    </Badge>
                  ) : null}
                </div>
              </div>
              <div className="plans-new-arrival-meta">
                <span>{plan.network}</span>
                <span>{plan.durationGroup || plan.duration_group || 'More'}</span>
                <span>{plan.category}</span>
                <span>{plan.id}</span>
              </div>
            </div>
            <div className={`plans-new-arrival-price ${getPlanSellingPriceClass(plan)}`}>
              {formatNairaFromKobo(plan.sellingPriceKobo)}
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

export default PlansNewArrivalsCard;
