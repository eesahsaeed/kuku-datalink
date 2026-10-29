const axios = require('axios');
const FormData = require('form-data');
const express = require('express');
const router = express.Router();

const {
  aidapayAccessToken,
  quickGetBankCode,
  networkTimeout,
} = require('../../helper');
const { authMiddleware } = require('../../middleware/index');
// const authMiddleware = require('../middleware/auth'); // ← import your middleware

router.get('/wallet-balance', authMiddleware, async (req, res) => {
  try {
    const formData = new FormData();

    const response = await axios({
      method: 'get',
      url: 'https://aidapay.ng/api/v1/my_account',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${aidapayAccessToken}`,
        ...formData.getHeaders(),
      },
      data: formData,
      timeout: networkTimeout,
    });

    const balanceStr = response?.data?.data?.balance ?? null;

    if (balanceStr === null) {
      return res
        .status(500)
        .json({ success: false, message: 'Balance not found in response' });
    }

    const balance = Number(balanceStr);
    if (isNaN(balance)) {
      return res
        .status(500)
        .json({ success: false, message: 'Invalid balance format' });
    }

    return res.json({
      success: true,
      balance,
      currency: 'NGN',
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Wallet balance fetch failed:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve AidaPay wallet balance',
    });
  }
});

router.post('/fund-wallet', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;

    // Validate requested amount
    const requestedAmount = Number(amount);
    if (!amount || isNaN(requestedAmount) || requestedAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid positive amount',
      });
    }

    // Prepare minimal FormData (even for GET, if AidaPay requires it)
    const data = new FormData();

    const config = {
      method: 'get',
      maxBodyLength: Infinity,
      url: 'https://aidapay.ng/api/v1/my_account',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${aidapayAccessToken}`,
        ...data.getHeaders(),
      },
      data: data,
      timeout: networkTimeout,
    };

    const response = await axios(config);

    //console.log(response.data)

    // Extract balance from the confirmed response structure
    const balanceStr = response?.data?.data?.balance;

    if (typeof balanceStr === 'undefined' || balanceStr === null) {
      return res.status(500).json({
        success: false,
        message: 'Wallet balance not found in API response',
      });
    }

    const walletBalance = Number(balanceStr);

    if (isNaN(walletBalance)) {
      return res.status(500).json({
        success: false,
        message: 'Invalid balance format received from AidaPay',
      });
    }

    // Compare
    if (walletBalance < requestedAmount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient wallet balance',
        availableBalance: walletBalance,
        requestedAmount: requestedAmount,
        currency: 'NGN', // assuming Naira – adjust if needed
        account: {
          bank_code: quickGetBankCode('access bank'),
          account_number: '1962721837',
        },
      });
    }

    // Balance is sufficient → proceed with funding logic here
    // e.g. call another AidaPay endpoint to debit wallet / process funding

    return res.status(200).json({
      success: true,
      message: 'Sufficient balance available – ready to process funding',
      availableBalance: walletBalance,
      requestedAmount: requestedAmount,
      currency: 'NGN',
      // Add next steps, transaction ref, etc. when you implement the funding
    });
  } catch (error) {
    console.error('AidaPay wallet check failed:', error.message);

    let errorMessage = 'Failed to verify wallet balance';
    if (error.response) {
      errorMessage =
        error.response.data?.message ||
        error.response.statusText ||
        errorMessage;
    }

    return res.status(500).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

module.exports = router;
