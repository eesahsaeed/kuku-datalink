
const express = require("express");
const router = express.Router();

// GET /api/check-number?phone=08012345678&provider=mtn-airtime
router.get("/check-number", async (req, res) => {
  try {
    const { phone, provider = "mtn-airtime" } = req.query;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "phone query parameter is required",
      });
    }

    const result = await checkPhoneNumber(phone, provider);

    // AidaPay returns something like:
    // { success: true, data: { success: true, verified: true, message: "Verified : ..." } }
    return res.json({
      success: true,
      phone,
      provider,
      data: result.data || result,
    });
  } catch (err) {
    console.error("AidaPay check-number error:", err.response?.data || err.message);

    return res.status(err.response?.status || 500).json({
      success: false,
      message: err.response?.data?.message || err.message || "Failed to check phone number",
    });
  }
});

module.exports = router;
