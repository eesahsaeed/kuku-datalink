import React, { useMemo } from 'react';
import { Bar, Line, Pie } from 'react-chartjs-2';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import { Card, CardBody, CardTitle, Col, Row } from 'components/ui/primitives';
import { fromKobo } from '../utils/money';

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend
);

const formatCompactNaira = (value = 0) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

function PlansCharts({ chartData }) {
  const topProfitData = useMemo(
    () => ({
      labels: chartData.topByProfit.map((plan) => plan.name),
      datasets: [
        {
          label: 'Profit',
          data: chartData.topByProfit.map((plan) => fromKobo(plan.profitKobo)),
          backgroundColor: 'rgba(16, 185, 129, 0.8)',
          borderColor: 'rgba(5, 150, 105, 1)',
          borderWidth: 1,
          borderRadius: 8,
        },
      ],
    }),
    [chartData.topByProfit]
  );

  const networkPieData = useMemo(() => {
    const labels = Object.keys(chartData.networkCounts);
    return {
      labels,
      datasets: [
        {
          label: 'Plans',
          data: labels.map((label) => chartData.networkCounts[label]),
          backgroundColor: [
            '#0ea5e9',
            '#22c55e',
            '#f97316',
            '#ec4899',
            '#64748b',
          ],
        },
      ],
    };
  }, [chartData.networkCounts]);

  const categoryBarData = useMemo(() => {
    const labels = Object.keys(chartData.categoryCounts);
    return {
      labels,
      datasets: [
        {
          label: 'Plans by Category',
          data: labels.map((label) => chartData.categoryCounts[label]),
          backgroundColor: 'rgba(14, 165, 233, 0.75)',
          borderColor: 'rgba(3, 105, 161, 1)',
          borderWidth: 1,
          borderRadius: 8,
        },
      ],
    };
  }, [chartData.categoryCounts]);

  const lineData = useMemo(
    () => ({
      labels: chartData.priceVsProfit.map((plan) =>
        formatCompactNaira(fromKobo(plan.sellingPriceKobo))
      ),
      datasets: [
        {
          label: 'Profit',
          data: chartData.priceVsProfit.map((plan) => fromKobo(plan.profitKobo)),
          borderColor: 'rgba(244, 63, 94, 1)',
          backgroundColor: 'rgba(244, 63, 94, 0.25)',
          pointRadius: 2,
          tension: 0.25,
          fill: false,
        },
      ],
    }),
    [chartData.priceVsProfit]
  );

  const sharedYAxisOptions = {
    beginAtZero: true,
    ticks: {
      callback: (value) => formatCompactNaira(value),
    },
  };

  return (
    <Row className="mt-4">
      <Col xl="8" className="mb-3">
        <Card className="plans-dashboard-card h-100">
          <CardBody>
            <CardTitle tag="h4" className="mb-3">
              Top 10 Plans by Profit
            </CardTitle>
            <div className="plans-chart-wrap">
              <Bar
                data={topProfitData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: { y: sharedYAxisOptions },
                }}
              />
            </div>
          </CardBody>
        </Card>
      </Col>

      <Col xl="4" className="mb-3">
        <Card className="plans-dashboard-card h-100">
          <CardBody>
            <CardTitle tag="h4" className="mb-3">
              Network Distribution
            </CardTitle>
            <div className="plans-chart-wrap">
              <Pie
                data={networkPieData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { position: 'bottom' } },
                }}
              />
            </div>
          </CardBody>
        </Card>
      </Col>

      <Col xl="6" className="mb-3">
        <Card className="plans-dashboard-card h-100">
          <CardBody>
            <CardTitle tag="h4" className="mb-3">
              Plans by Category
            </CardTitle>
            <div className="plans-chart-wrap">
              <Bar
                data={categoryBarData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    y: {
                      beginAtZero: true,
                      ticks: { precision: 0 },
                    },
                  },
                }}
              />
            </div>
          </CardBody>
        </Card>
      </Col>

      <Col xl="6" className="mb-3">
        <Card className="plans-dashboard-card h-100">
          <CardBody>
            <CardTitle tag="h4" className="mb-3">
              Price vs Profit
            </CardTitle>
            <div className="plans-chart-wrap">
              <Line
                data={lineData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: { y: sharedYAxisOptions },
                }}
              />
            </div>
          </CardBody>
        </Card>
      </Col>
    </Row>
  );
}

export default PlansCharts;
