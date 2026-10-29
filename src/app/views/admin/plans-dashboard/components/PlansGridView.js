import React from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  Col,
  Row,
} from 'components/ui/primitives';
import { formatNairaFromKobo } from '../utils/money';
import { getPlanSellingPriceClass } from '../utils/plans';

function PlansGridView({ plans = [], onViewDetails = () => {} }) {
  if (!plans.length) {
    return (
      <Card className="plans-dashboard-card">
        <CardBody className="text-center text-muted py-5">
          No plans match your filters.
        </CardBody>
      </Card>
    );
  }

  return (
    <Row>
      {plans.map((plan) => (
        <Col key={plan.id} md="6" xl="4" className="mb-3">
          <Card className="plans-dashboard-card h-100">
            <CardBody>
              <div className="plans-grid-title-row">
                <div className="plans-grid-title">{plan.name}</div>
                <div className="plans-status-badges">
                  {plan.isNew ? (
                    <Badge color="primary" pill>
                      New
                    </Badge>
                  ) : null}
                  {plan.exclude ? (
                    <Badge color="danger" pill>
                      Excluded
                    </Badge>
                  ) : null}
                  {plan.source && plan.source !== 'configured' ? (
                    <Badge
                      color={plan.source === 'directortech' ? 'warning' : 'success'}
                      pill
                    >
                      {plan.sourceLabel || plan.source}
                    </Badge>
                  ) : null}
                </div>
              </div>

              <div className="plans-grid-meta mb-3">
                <span>{plan.network}</span>
                <span>{plan.durationGroup || plan.duration_group || 'More'}</span>
                <span>{plan.category}</span>
                <span>{plan.id}</span>
              </div>

              <div className="plans-grid-kpis">
                <div>
                  <span>Original</span>
                  <strong>{formatNairaFromKobo(plan.originalPriceKobo)}</strong>
                </div>
                <div>
                  <span>Selling</span>
                  <strong className={getPlanSellingPriceClass(plan)}>
                    {formatNairaFromKobo(plan.sellingPriceKobo)}
                  </strong>
                </div>
                <div>
                  <span>Profit</span>
                  <strong className={plan.profitKobo >= 0 ? 'text-success' : 'text-danger'}>
                    {formatNairaFromKobo(plan.profitKobo)}
                  </strong>
                </div>
                <div>
                  <span>Commission</span>
                  <strong>{formatNairaFromKobo(plan.commissionKobo)}</strong>
                </div>
                <div>
                  <span>Provider Price</span>
                  <strong>
                    {formatNairaFromKobo(plan.packageOriginalAmountKobo)}
                  </strong>
                </div>
                <div>
                  <span>Popularity</span>
                  <strong>{Number(plan.popularity || 0).toLocaleString()}</strong>
                </div>
              </div>

              <div className="plans-grid-actions">
                <Button color="info" size="sm" onClick={() => onViewDetails(plan)}>
                  Edit
                </Button>
              </div>
            </CardBody>
          </Card>
        </Col>
      ))}
    </Row>
  );
}

export default PlansGridView;
