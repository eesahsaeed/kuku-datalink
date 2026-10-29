const mongoose = require('mongoose');
const {
  getNormalizedUserRoleState,
  normalizeStoredRoles,
  ROLE_VALUES,
} = require('../utils/roles');
const {
  coerceStoredPhoneNumber,
  isValidNigerianPhoneNumber,
} = require('../utils/phoneNumber');

const UserSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
    },
    emailAddress: {
      type: String,
      required: [true, 'Email address is required'],
      unique: true, // Required fields don't need sparse
      lowercase: true,
      trim: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        'Please enter a valid email',
      ],
    },
    phoneNumber: {
      type: String,
      trim: true,
      set: coerceStoredPhoneNumber,
      validate: {
        validator(value) {
          if (value === null || value === undefined || value === '') {
            return true;
          }

          return isValidNigerianPhoneNumber(value);
        },
        message: 'Phone number must be a valid Nigerian mobile number',
      },
    },
    password: {
      type: String,
      select: false, // added to prevent accidental leakage
    },
    roles: {
      type: [
        {
          type: String,
          enum: ROLE_VALUES,
        },
      ],
      default: ['customer'],
      set: (value) => normalizeStoredRoles(value),
    },
    adminDashboardAccess: {
      type: Boolean,
      default: false,
    },
    createdAt: { type: Date, default: Date.now },
    lastUpdated: { type: Date, default: null },
    authType: { type: String, enum: ['email', 'google'], default: 'email' },
    emailVerified: {
      type: Boolean,
      default: false,
      index: true,
    },
    emailVerificationToken: {
      type: String,
      default: null,
      index: true,
    },
    emailVerificationCode: {
      type: String,
      default: null,
      index: true,
    },
    emailVerificationExpires: {
      type: Date,
      default: null,
    },
    blocked: { type: Boolean, default: false },
    resetPasswordToken: { type: String, default: null },
    resetPasswordExpires: { type: Date, default: null },
    transactionPinHash: {
      type: String,
      select: false,
      default: null,
    },
    transactionPinSetAt: {
      type: Date,
      default: null,
    },
    pinResetToken: {
      type: String,
      default: null,
      index: true,
    },
    pinResetExpires: {
      type: Date,
      default: null,
    },

    bvn: {
      type: String,
      unique: true,
      sparse: true, // Allows multiple null/missing BVNs
    },

    phoneNumberBeneficiaries: [
      {
        phoneNumber: {
          type: String,
          trim: true,
        },
        name: {
          type: String,
          trim: true,
        }
      },
    ],

    tvBeneficiaries: [
      {
        smartCardNumber: {
          type: String,
          trim: true,
        },
        name: {
          type: String,
          trim: true,
        },
        tvType: {
          type: String,
          trim: true,
        },
      },
    ],

    electricityBeneficiaries: [
      {
        meterNumber: { type: String, required: true, sparse: true }, // Added sparse index for optional beneficiaries
        name: { type: String, default: '' },
        disco: { type: String, lowercase: true }, // ikeja-electric, phcn, etc.
      },
    ],

    virtualAccount: {
      provider: { type: String, default: 'paystack' },
      account_name: String,
      bank_name: String,
      bank_slug: String,
      virtual_account_number: String,
      customer_code: String,
      customer_id: Number,
      dedicated_account_id: Number,
      assigned: Boolean,
      currency: { type: String, default: 'NGN' },
      created_at: String,
      updated_at: String,
    },

    isOnline: {
      type: Boolean,
      default: false,
      index: true,
    },
    lastSeen: {
      type: Date,
      default: null,
    },
    lastActive: {
      type: Date,
      default: null,
    },
    socketId: {
      type: String,
      default: null,
      sparse: true,
    },
    mobilePushTokens: [
      {
        token: {
          type: String,
          trim: true,
        },
        platform: {
          type: String,
          trim: true,
          default: 'unknown',
        },
        deviceName: {
          type: String,
          trim: true,
          default: null,
        },
        lastSeenAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    isTyping: {
      type: Boolean,
      default: false,
    },

    wallet: {
      balance: {
        type: mongoose.Schema.Types.Decimal128,
        default: 0.0,
        get: (v) => (v ? parseFloat(v.toString()) : 0),
      },
      currency: {
        type: String,
        default: 'NGN',
        uppercase: true,
        trim: true,
      },
      walletId: {
        type: String,
        unique: true,
        sparse: true, // Allows null/undefined while enforcing uniqueness on values
        // default function removed -> moved to pre-save hook
      },
      status: {
        type: String,
        enum: ['active', 'suspended', 'closed'],
        default: 'active',
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
      lastFundedAt: {
        type: Date,
        default: null,
      },
      lastWithdrawnAt: {
        type: Date,
        default: null,
      },
    },
    rewards: {
      points: {
        type: Number,
        default: 0,
      },
      totalEarned: {
        type: Number,
        default: 0,
      },
      lastVideoRewardAt: {
        type: Date,
        default: null,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Explicitly define sparse indexes for extra safety
UserSchema.index({ emailAddress: 1 });
UserSchema.index({ 'wallet.walletId': 1 }, { sparse: true, unique: true });
UserSchema.index({ bvn: 1 }, { sparse: true, unique: true });
UserSchema.index({ lastActive: 1 });
UserSchema.index(
  { _id: 1, 'electricityBeneficiaries.meterNumber': 1 },
  { sparse: true }
);

// Generate walletId if missing (prevents null/undefined duplicate errors)
UserSchema.pre('save', function () {
  const normalizedRoleState = getNormalizedUserRoleState(this);
  this.roles = normalizedRoleState.roles;

  if (this.wallet && !this.wallet.walletId) {
    this.wallet.walletId =
      'WAL-' + Math.random().toString(36).substr(2, 8).toUpperCase();
  }
});

UserSchema.set('toJSON', { getters: true });

UserSchema.methods.toProfileJSON = function () {
  const normalizedRoleState = getNormalizedUserRoleState(this);

  return {
    _id: this._id,
    fullName: this.fullName,
    emailAddress: this.emailAddress,
    phoneNumber: this.phoneNumber,
    authType: this.authType,
    roles: normalizedRoleState.roles,
    canAccessAdminDashboard: normalizedRoleState.hasAdminDashboardAccess,
    emailVerified: Boolean(this.emailVerified),
    hasTransactionPin: Boolean(this.transactionPinHash || this.transactionPinSetAt),
    isOnline: this.isOnline,
    lastSeen: this.lastSeen,
    virtualAccount: this.virtualAccount || null,
  };
};

const User = mongoose.models.User || mongoose.model('User', UserSchema);

module.exports = User;
