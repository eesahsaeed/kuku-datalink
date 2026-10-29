const express = require('express');
const mongoose = require('mongoose');

const Notification = require('../../schema/NotificationSchema.js');
const User = require('../../schema/UserSchema.js');
const { authMiddleware } = require('../../middleware/index.js');

const router = express.Router();

router.post('/register-device', authMiddleware, async (req, res) => {
  try {
    const { token, platform, deviceName } = req.body;

    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Push token is required',
      });
    }

    const userId = req.user.id || req.user._id; // or req.user._id depending on how authMiddleware sets it
    const cleanToken = token.trim();
    const cleanPlatform = (platform || 'unknown').toString().trim().toLowerCase();
    const cleanDeviceName = deviceName ? deviceName.toString().trim() : null;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    await User.updateMany(
      {
        _id: { $ne: user._id },
        'mobilePushTokens.token': cleanToken,
      },
      {
        $pull: { mobilePushTokens: { token: cleanToken } },
      }
    );

    // Ensure the array exists
    if (!Array.isArray(user.mobilePushTokens)) {
      user.mobilePushTokens = [];
    }

    const existingIndex = user.mobilePushTokens.findIndex(
      (t) => t.token === cleanToken
    );

    if (existingIndex !== -1) {
      // Update existing token entry
      user.mobilePushTokens[existingIndex].platform = cleanPlatform;
      user.mobilePushTokens[existingIndex].deviceName = cleanDeviceName;
      user.mobilePushTokens[existingIndex].lastSeenAt = new Date();
    } else {
      // Add new token
      user.mobilePushTokens.push({
        token: cleanToken,
        platform: cleanPlatform,
        deviceName: cleanDeviceName,
        lastSeenAt: new Date(),
      });
    }

    // Optional: keep the array from growing forever (e.g. max 10 devices)
    // user.mobilePushTokens = user.mobilePushTokens.slice(-10);

    await user.save();

    return res.status(200).json({
      success: true,
      message: existingIndex !== -1 ? 'Device token updated' : 'Device registered',
      data: {
        token: cleanToken,
        platform: cleanPlatform,
        deviceName: cleanDeviceName,
      },
    });
  } catch (err) {
    console.error('register-device error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to register device',
    });
  }
});

module.exports = router;
