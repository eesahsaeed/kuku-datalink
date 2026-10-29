import React from 'react';
import { Card, CardBody, Col, Row } from 'components/ui/primitives';
import {
  formatNairaFromKobo,
  formatPercentFromBasisPoints,
} from '../utils/money';

function PlansAnalyticsCards({ analytics }) {
  return (
    <Row className="mb-4">
      <Col md="6" xl="3" className="mb-3">
        <Card className="plans-dashboard-card h-100">
          <CardBody>
            <div className="plans-metric-label">Total Plans</div>
            <div className="plans-metric-value">
              {Number(analytics.totalPlans || 0).toLocaleString()}
            </div>
          </CardBody>
        </Card>
      </Col>

      <Col md="6" xl="3" className="mb-3">
        <Card className="plans-dashboard-card h-100">
          <CardBody>
            <div className="plans-metric-label">Total Potential Profit</div>
            <div className="plans-metric-value">
              {formatNairaFromKobo(analytics.totalPotentialProfitKobo)}
            </div>
          </CardBody>
        </Card>
      </Col>

      <Col md="6" xl="3" className="mb-3">
        <Card className="plans-dashboard-card h-100">
          <CardBody>
            <div className="plans-metric-label">Most Profitable Network</div>
            <div className="plans-metric-value">
              {analytics.mostProfitableNetwork || 'N/A'}
            </div>
          </CardBody>
        </Card>
      </Col>

      <Col md="6" xl="3" className="mb-3">
        <Card className="plans-dashboard-card h-100">
          <CardBody>
            <div className="plans-metric-label">Average Profit Margin</div>
            <div className="plans-metric-value">
              {formatPercentFromBasisPoints(
                analytics.averageProfitMarginBasisPoints
              )}
            </div>
          </CardBody>
        </Card>
      </Col>
    </Row>
  );
}

export default PlansAnalyticsCards;
