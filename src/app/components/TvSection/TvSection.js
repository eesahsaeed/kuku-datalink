import React, { useEffect, useState } from 'react';
import axios from 'axios';
import TvServicesCard from 'components/TvServicesCard/TvServicesCard';
import { Alert, Spinner } from 'components/ui/primitives';

import { transformProviders, networkTimeout } from '../../../lib/helper';

const TvSection = ({ onActivateView }) => {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    const fetchProviders = async () => {
      try {
        const response = await axios({
          method: 'get',
          maxBodyLength: Infinity,
          url: '/api/purchase/catalog/service/cable-tv-subscription',
          timeout: networkTimeout,
          signal: controller.signal,
        });

        setProviders(transformProviders(response?.data?.data || []));
        setError('');
        if (!Array.isArray(response?.data?.data) || response.data.data.length === 0) {
          console.warn('[TvSection] TV provider catalog returned no providers.');
        }
      } catch (error) {
        if (error?.code !== 'ERR_CANCELED') {
          console.error('Failed to fetch TV providers:', error);
          setError('Unable to load TV providers right now.');
        }
        setProviders([]);
      } finally {
        setLoading(false);
      }
    };

    fetchProviders();

    return () => controller.abort();
  }, []);

  if (loading) {
    return (
      <div className="tv-bundles-container">
        <div className="other-service-row">
          <p className="title">TV SUBSCRIPTIONS</p>
          <p className="text-muted">
            Pay for DSTV, GOTV, Startimes and other TV bundles
          </p>
          <div className="text-center py-4">
            <Spinner color="primary"> </Spinner>
            <p className="mt-2 text-muted">Loading TV providers...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tv-bundles-container">
        <div className="other-service-row">
          <p className="title">TV SUBSCRIPTIONS</p>
          <p className="text-muted">
            Pay for DSTV, GOTV, Startimes and other TV bundles
          </p>
          <Alert color="danger" className="mb-0">
            {error}
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="tv-bundles-container">
      <div className="other-service-row">
        <p className="title">TV SUBSCRIPTIONS</p>
        <p className="text-muted">
          Pay for DSTV, GOTV, Startimes and other TV bundles
        </p>

        <div className="other-service-sub-row other-service-scroll-row kuku-scrollbar kuku-scrollbar-x">
          {providers.length > 0 ? (
            providers.map((provider, index) => (
              <TvServicesCard
                key={provider.provider_code || index}
                provider={provider}
                onActivateView={onActivateView}
              />
            ))
          ) : (
            <p className="text-muted mb-0">
              No TV providers available at the moment.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default TvSection;
