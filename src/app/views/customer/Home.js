import React, { useCallback, useEffect, useState } from 'react';
import classNames from 'classnames';
import {
  Alert,
  Button,
  ButtonGroup,
  Card,
  CardHeader,
  CardBody,
  CardTitle,
  Row,
  Col,
  Spinner,
} from 'components/ui/primitives';
import { toast } from 'sonner';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import {
  buildAuthNavigationTarget,
  filterProvidersByCode,
  clearPendingAuthRedirect,
  networkTimeout,
  removeDuplicatePackages,
  sortPlanGroupKeysByDuration,
  setPendingAuthRedirect,
  airtimeProviders,
} from '../../../lib/helper';
import TabbedPane from 'components/TabbedPane/TabbedPane';
import Loading from 'components/Loading/Loading';
import DataModal from 'components/DataModal/DataPurchaseModal';
import AirtimeModal from 'components/AirtimeModal/AirtimePurchaseModal';
import axios from 'axios';

import MTN from 'NetworkProviders/MTN/MTN';
import GLO from 'NetworkProviders/GLO/GLO';
import AIRTEL from 'NetworkProviders/AIRTEL/AIRTEL';
import NINEMOBILE from 'NetworkProviders/9MOBILE/9MOBILE';
import { loadNetworkPlans } from 'NetworkProviders/networkPlanLoader';

import ElectricitySection from 'components/ElectricitySection/ElectricitySection';
import TvSection from 'components/TvSection/TvSection';
import InternetSection from 'components/InternetSection/InternetSection';
import WebDevelopmentSection from 'components/WebDevelopmentSection/WebDevelopmentSection';
import {
  readDataPurchaseSelection,
  saveDataPurchaseSelection,
  getDataPlanCode,
} from '../../utils/dataPurchaseJourney';

const PURCHASE_QUERY_KEYS = [
  'purchaseView',
  'purchaseNetwork',
  'purchaseGroup',
  'purchasePlan',
  'purchaseModal',
  'dataPhone',
  'airtimePhone',
  'airtimeAmount',
];

const NETWORK_PARAM_TO_LABEL = {
  mtn: 'MTN',
  glo: 'GLO',
  airtel: 'AIRTEL',
  '9mobile': 'T2MOBILE',
  t2mobile: 'T2MOBILE',
};

const NETWORK_LABEL_TO_PARAM = {
  MTN: 'mtn',
  GLO: 'glo',
  AIRTEL: 'airtel',
  T2MOBILE: '9mobile',
};

const SUPPORTED_PURCHASE_VIEWS = new Set([
  'data',
  'airtime',
  'tv',
  'utilities',
  'internet',
  'development',
]);

const normalizePurchaseView = (value = '') => {
  const normalizedValue = String(value || '')
    .trim()
    .toLowerCase();

  if (SUPPORTED_PURCHASE_VIEWS.has(normalizedValue)) {
    return normalizedValue;
  }

  return 'data';
};

const getPrimaryPurchaseLabel = (purchaseView = 'data') =>
  normalizePurchaseView(purchaseView) === 'airtime' ? 'Airtime' : 'Data';

const isPrimaryPurchaseView = (purchaseView = 'data') => {
  const normalizedPurchaseView = normalizePurchaseView(purchaseView);
  return (
    normalizedPurchaseView === 'airtime' || normalizedPurchaseView === 'data'
  );
};

const sanitizeDigits = (value = '') => String(value || '').replace(/\D/g, '');

function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const initialPurchaseState = React.useMemo(() => {
    const storedSelection = readDataPurchaseSelection();
    const purchaseNetworkParam = String(
      searchParams.get('purchaseNetwork') || storedSelection.network || ''
    ).toLowerCase();
    const purchaseView = normalizePurchaseView(
      searchParams.get('purchaseView')
    );

    return {
      purchaseView,
      primaryPurchaseView: getPrimaryPurchaseLabel(purchaseView),
      purchaseNetwork: NETWORK_PARAM_TO_LABEL[purchaseNetworkParam] || '',
      purchaseGroup:
        String(searchParams.get('purchaseGroup') || '') ||
        String(storedSelection.duration || ''),
      purchasePlan:
        String(searchParams.get('purchasePlan') || '') ||
        String(storedSelection.planCode || ''),
      purchaseModal: String(searchParams.get('purchaseModal') || ''),
      dataPhone: sanitizeDigits(searchParams.get('dataPhone') || ''),
      airtimePhone: sanitizeDigits(searchParams.get('airtimePhone') || ''),
      airtimeAmount: sanitizeDigits(searchParams.get('airtimeAmount') || ''),
    };
  }, []);

  // UI states
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [activePurchaseView, setActivePurchaseView] = useState(
    initialPurchaseState.purchaseView
  );
  const [airtimeOrdata, setAirtimeOrData] = useState(
    initialPurchaseState.primaryPurchaseView
  );
  const [selectedNetwork, setSelectedNetwork] = useState(
    NETWORK_LABEL_TO_PARAM[initialPurchaseState.purchaseNetwork] || 'mtn'
  );
  const [selectedAirtimeNetwork, setSelectedAirtimeNetwork] = useState('MTN');
  const [selectedPlanGroup, setSelectedPlanGroup] = useState(
    initialPurchaseState.purchaseGroup
  );
  const [selectedPlanCode, setSelectedPlanCode] = useState(
    initialPurchaseState.purchasePlan
  );
  const [selectedDataPlan, setSelectedDataPlan] = useState(null);
  const [isDataPurchaseOpen, setIsDataPurchaseOpen] = useState(false);
  const [isAirtimePurchaseOpen, setIsAirtimePurchaseOpen] = useState(false);
  const [airtimeDraft, setAirtimeDraft] = useState({
    phoneNumber: '',
    amount: '',
  });
  const [dataPlans, setDataPlans] = useState({
    mtn: [],
    glo: [],
    airtel: [],
    '9mobile': [],
  });

  const notifySuccess = (message) => toast.success(message);
  const purchaseSearch = searchParams.toString();

  const persistDataSelection = useCallback(
    (selection = {}) => {
      saveDataPurchaseSelection(selection);

      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('purchaseView', 'data');

      ['purchaseNetwork', 'purchaseGroup', 'purchasePlan'].forEach((key) => {
        const value = selection[
          key === 'purchaseNetwork'
            ? 'network'
            : key === 'purchaseGroup'
            ? 'duration'
            : 'planCode'
        ];
        if (value) {
          nextParams.set(key, value);
        } else {
          nextParams.delete(key);
        }
      });

      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  useEffect(() => {
    const network = String(searchParams.get('purchaseNetwork') || '').trim();
    const duration = String(searchParams.get('purchaseGroup') || '').trim();
    const planCode = String(searchParams.get('purchasePlan') || '').trim();

    if (!network && !duration && !planCode) return;

    if (network) {
      setSelectedNetwork(
        NETWORK_LABEL_TO_PARAM[NETWORK_PARAM_TO_LABEL[network.toLowerCase()]] ||
          'mtn'
      );
    }
    if (duration) setSelectedPlanGroup(duration);
    if (planCode) setSelectedPlanCode(planCode);
  }, [purchaseSearch]);

  const handleNetworkSelect = useCallback(
    (network) => {
      setSelectedNetwork(network);
      setSelectedPlanGroup('');
      setSelectedPlanCode('');
      persistDataSelection({ network, duration: '', planCode: '' });
    },
    [persistDataSelection]
  );

  const handleDurationSelect = useCallback(
    (duration) => {
      setSelectedPlanGroup(duration);
      setSelectedPlanCode('');
      persistDataSelection({
        network: selectedNetwork,
        duration,
        planCode: '',
      });
    },
    [persistDataSelection, selectedNetwork]
  );

  const handlePlanSelect = useCallback(
    (plan, duration) => {
      const planCode = getDataPlanCode(plan);
      setSelectedPlanGroup(duration);
      setSelectedPlanCode(planCode);
      setSelectedDataPlan(plan);
      setIsDataPurchaseOpen(true);
      persistDataSelection({
        network: selectedNetwork,
        duration,
        planCode,
      });
    },
    [persistDataSelection, selectedNetwork]
  );

  const closeDataPurchase = useCallback(() => {
    setIsDataPurchaseOpen(false);
  }, []);

  const openAirtimePurchase = useCallback(() => {
    setIsAirtimePurchaseOpen(true);
  }, []);

  const closeAirtimePurchase = useCallback(() => {
    setIsAirtimePurchaseOpen(false);
  }, []);

  useEffect(() => {
    axios.get("/api/plan/plans")
    .then(res => {
      const plansData = res.data || {};

      console.log(plansData)

      if (plansData.success && plansData.plans) {
        setDataPlans(plansData.plans);
      } else {
        setCatalogError('Unable to load data plans. Please try again later.');
      }
    })
    .catch(err => {
      console.log(err)
      setCatalogError('Unable to load data plans. Please try again later.');
    })
    .finally(() => {
      setLoading(false);
    })
  }, []);

  // Welcome message for new users
  useEffect(() => {
    const newUser = searchParams.get('newUser');
    if (newUser === 'true') {
      setTimeout(() => {
        notifySuccess('Welcome! Your account has been created successfully.');
      }, 1000);

      const newParams = new URLSearchParams(searchParams);
      newParams.delete('newUser');
      setTimeout(() => {
        navigate({ search: newParams.toString() }, { replace: true });
      }, 5000);
    }
  }, []);

  return (
    <>
      <div className="content">
        <div style={{ position: 'relative' }}>
          <Row>
            <Col xs="12">
              <Card className="card-chart">
                <CardHeader>
                  <Row className="align-items-center home-service-toggle-row">
                    <Col
                      sm="6"
                      className="d-flex justify-content-start mb-2 mb-sm-0"
                    >
                      <ButtonGroup
                        className="btn-group-toggle service-toggle-group"
                        data-toggle="buttons"
                      >
                        <Button
                          color="info"
                          size="sm"
                          className={classNames(
                            'btn-simple service-toggle-pill',
                            {
                              active: airtimeOrdata === 'Data',
                            }
                          )}
                          onClick={() => {
                            setAirtimeOrData('Data');
                          }}
                        >
                          Data
                        </Button>
                        <Button
                          color="info"
                          size="sm"
                          className={classNames(
                            'btn-simple service-toggle-pill',
                            {
                              active: airtimeOrdata === 'Airtime',
                            }
                          )}
                          onClick={() => {
                            setAirtimeOrData('Airtime');
                          }}
                        >
                          Airtime
                        </Button>
                      </ButtonGroup>
                    </Col>
                    <Col sm="6" className="text-left text-sm-right">
                      <CardTitle tag="h2" className="home-service-toggle-label">
                        {String(airtimeOrdata || '').toUpperCase()}
                      </CardTitle>
                    </Col>
                  </Row>
                </CardHeader>

                <CardBody>
                  {catalogError ? (
                    <Alert color="danger" className="mb-0">
                      {catalogError}
                    </Alert>
                  ) : loading ? (
                    <div className="text-center py-5">
                      <Loading />
                      <p className="text-muted mt-3 mb-0">
                        Loading data providers...
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="network-area">
                        <MTN
                          network={
                            airtimeOrdata === 'Data'
                              ? selectedNetwork
                              : selectedAirtimeNetwork.toLowerCase()
                          }
                          handleNetworkChange={() =>
                            airtimeOrdata === 'Data'
                              ? handleNetworkSelect('mtn')
                              : setSelectedAirtimeNetwork('MTN')
                          }
                          isLoading={loading && airtimeOrdata === 'Data' && selectedNetwork === 'mtn'}
                        />
                        <GLO
                          network={
                            airtimeOrdata === 'Data'
                              ? selectedNetwork
                              : selectedAirtimeNetwork.toLowerCase()
                          }
                          handleNetworkChange={() =>
                            airtimeOrdata === 'Data'
                              ? handleNetworkSelect('glo')
                              : setSelectedAirtimeNetwork('GLO')
                          }
                          isLoading={loading && airtimeOrdata === 'Data' && selectedNetwork === 'glo'}
                        />
                        <AIRTEL
                          network={
                            airtimeOrdata === 'Data'
                              ? selectedNetwork
                              : selectedAirtimeNetwork.toLowerCase()
                          }
                          handleNetworkChange={() =>
                            airtimeOrdata === 'Data'
                              ? handleNetworkSelect('airtel')
                              : setSelectedAirtimeNetwork('AIRTEL')
                          }
                          isLoading={loading && airtimeOrdata === 'Data' && selectedNetwork === 'airtel'}
                        />
                        <NINEMOBILE
                          network={
                            airtimeOrdata === 'Data'
                              ? selectedNetwork
                              : selectedAirtimeNetwork === 'T2MOBILE'
                              ? '9mobile'
                              : selectedAirtimeNetwork.toLowerCase()
                          }
                          handleNetworkChange={() =>
                            airtimeOrdata === 'Data'
                              ? handleNetworkSelect('9mobile')
                              : setSelectedAirtimeNetwork('T2MOBILE')
                          }
                          isLoading={loading && airtimeOrdata === 'Data' && selectedNetwork === '9mobile'}
                        />
                      </div>
                      {airtimeOrdata === 'Data' ? (
                        <TabbedPane
                          selectedNetwork={selectedNetwork}
                          dataPlans={dataPlans}
                          airtimeOrdata={airtimeOrdata}
                          selectedTabKey={selectedPlanGroup}
                          selectedPlanCode={selectedPlanCode}
                          onSelectedTabChange={handleDurationSelect}
                          onPlanSelect={handlePlanSelect}
                        />
                      ) : (
                        <div className="airtime-home-filter-panel">
                          <h3>{airtimeProviders[selectedAirtimeNetwork]?.provider_name} airtime</h3>
                          <p>
                            Choose a provider, then continue to enter the phone number and amount.
                          </p>
                          <Button color="primary" onClick={openAirtimePurchase}>
                            Continue with Airtime
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </CardBody>
              </Card>
              {selectedDataPlan ? (
                <DataModal
                  dataPlan={selectedDataPlan}
                  isOpen={isDataPurchaseOpen}
                  toggleModal={closeDataPurchase}
                  onRequireAuth={(target) => navigate(target)}
                />
              ) : null}
              <AirtimeModal
                networkProvider={selectedAirtimeNetwork}
                isOpen={isAirtimePurchaseOpen}
                toggleModal={closeAirtimePurchase}
                draftState={airtimeDraft}
                onDraftChange={setAirtimeDraft}
                onRequireAuth={(target) => navigate(target)}
              />
            </Col>
          </Row>

          {/* Other Services */}
          <Row>
            <Col md="12">
              <Card>
                <CardHeader>
                  <CardTitle tag="h2">Other Services</CardTitle>
                </CardHeader>
                <CardBody className="services-container">
                  <TvSection />
                  <InternetSection />
                  <ElectricitySection />
                  <WebDevelopmentSection />
                </CardBody>
              </Card>
            </Col>
          </Row>
        </div>
      </div>
    </>
  );
}

export default Home;
