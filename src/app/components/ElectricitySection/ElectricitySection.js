import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Alert, Spinner } from 'components/ui/primitives';

import { transformProviders, networkTimeout } from '../../../lib/helper';
import OtherServicesCard from 'components/ElectricityServicesCard/ElectricityServicesCard';

const ElectricitySection = ({ onActivateView }) => {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const config = {
          method: 'get',
          maxBodyLength: Infinity,
          url: '/api/purchase/catalog/service/meter-token',
          timeout: networkTimeout,
        };

        const response = await axios(config);
        setProviders(transformProviders(response.data.data));
        setError('');
        if (!Array.isArray(response?.data?.data) || response.data.data.length === 0) {
          console.warn(
            '[ElectricitySection] Electricity provider catalog returned no providers.'
          );
        }

        // console.log('Fetched electricity providers: ', response.data.data);
      } catch (error) {
        console.error('Failed to fetch electricity providers:', error);
        setError('Unable to load electricity providers right now.');
        setProviders([]);
      } finally {
        setLoading(false);
      }
    };

    fetchProviders();
  }, []);

  if (loading) {
    return (
      <div className="utilities-container">
        <div className="other-service-row">
          <p className="title">UTILITY BILLS</p>
          <p className="text-muted">
            Electricity payments (Prepaid/Postpaid) in Nigeria
          </p>
          <div className="text-center py-4">
            <Spinner color="primary"> </Spinner>
            <p className="mt-2 text-muted">Loading electricity providers...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="utilities-container">
        <div className="other-service-row">
          <p className="title">UTILITY BILLS</p>
          <p className="text-muted">
            Electricity payments (Prepaid/Postpaid) in Nigeria
          </p>
          <Alert color="danger" className="mb-0">
            {error}
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="utilities-container">
      <div className="other-service-row">
        <p className="title">UTILITY BILLS</p>
        <p className="text-muted">
          Electricity payments (Prepaid/Postpaid) in Nigeria
        </p>

        <div className="other-service-sub-row other-service-scroll-row kuku-scrollbar kuku-scrollbar-x">
          {providers.length > 0 ? (
            providers.map((sub, j) => (
              <OtherServicesCard
                key={sub.provider_code || sub.code || j}
                provider={sub}
                onActivateView={onActivateView}
              />
            ))
          ) : (
            <p className="text-muted mb-0">
              No electricity providers available at the moment.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ElectricitySection;
