
const express = require('express');
const planRouter = express.Router();
const axios = require('axios');

const {
  fetchAidapayDataPlans, 
  fetchDDSDataPlans, 
  mergePlans, 
  readPlanOverrides,
  getCustomerPlans
} = require('../../libs.js');
const { authMiddleware } = require('../../middleware/index.js');

const {demoPlans} = require("./demoPlans.js");

const localEnv = process.env.NODE_ENV || 'development';

planRouter.get('/plans', async (req, res) => {
  try {
    if (localEnv === 'development') {
      return res.json(demoPlans);
    } else {
      const aidapayPlans = await fetchAidapayDataPlans();
      const ddsPlans = await fetchDDSDataPlans();

      const plans = mergePlans({ aidapayPlans, ddsPlans });

      const dbPlans = await readPlanOverrides();

      const latestPlans = getCustomerPlans(plans, dbPlans);

      return res.json({
        success: true,
        plans: latestPlans
      });
    }
  } catch (error) {
    console.error('Error retrieving plans:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while retrieving plans',
      error: error.message,
    });
  }
});

planRouter.post("/plan/purchase", authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const plan = req.body.plan;

    if (!plan) {
      return res.status(400).json({
        success: false,
        message: "Plan details are required for purchase.",
      });
    } else {
      return res.status(200).json({
        success: true,
        message: "Plan purchase processed successfully.",
        planPurchased: plan,
      });
    }
  } catch (error) {
    console.error('Error processing plan purchase:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while processing the plan purchase',
      error: error.message,
    });
  }
});

module.exports = planRouter;
