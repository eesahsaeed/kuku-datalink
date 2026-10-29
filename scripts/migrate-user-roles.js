require('dotenv').config();

const mongoose = require('mongoose');
const {
  normalizeRoleName,
  normalizeStoredRoles,
} = require('../src/lib/utils/roles');

const flattenRoleValues = (value) => {
  if (Array.isArray(value)) return value.flatMap(flattenRoleValues);
  if (typeof value !== 'string') return [];

  const trimmedValue = value.trim();
  if (!trimmedValue) return [];

  if (trimmedValue.startsWith('[') && trimmedValue.endsWith(']')) {
    try {
      return flattenRoleValues(JSON.parse(trimmedValue));
    } catch (_error) {
      // Continue with comma-separated parsing for malformed legacy values.
    }
  }

  return trimmedValue.split(',').map(normalizeRoleName).filter(Boolean);
};

async function migrateUserRoles() {
  const mongoUri = String(
    process.env.MONGO_URI ||
      (process.env.NODE_ENV === 'development'
        ? 'mongodb://127.0.0.1:27017/kukudata'
        : '')
  ).trim();

  if (!mongoUri) {
    throw new Error('MONGO_URI must be configured before migrating user roles');
  }

  await mongoose.connect(mongoUri);
  const users = mongoose.connection.collection('users');
  const cursor = users.find({
    $or: [{ role: { $exists: true } }, { roles: { $exists: false } }],
  });
  let operations = [];
  let migratedCount = 0;

  for await (const user of cursor) {
    const legacyRoleValues = flattenRoleValues([user.roles, user.role]);
    const roles = normalizeStoredRoles([user.roles, user.role], {
      emailAddress: user.emailAddress,
    });
    const adminDashboardAccess =
      user.adminDashboardAccess === true ||
      legacyRoleValues.includes('admin-dashboard') ||
      (!Array.isArray(user.role) && normalizeRoleName(user.role) === 'admin');

    operations.push({
      updateOne: {
        filter: { _id: user._id },
        update: {
          $set: { roles, adminDashboardAccess },
          $unset: { role: '' },
        },
      },
    });

    if (operations.length === 500) {
      const result = await users.bulkWrite(operations, { ordered: false });
      migratedCount += result.modifiedCount;
      operations = [];
    }
  }

  if (operations.length) {
    const result = await users.bulkWrite(operations, { ordered: false });
    migratedCount += result.modifiedCount;
  }

  console.log(`Migrated ${migratedCount} user document(s) to roles.`);
}

migrateUserRoles()
  .catch((error) => {
    console.error('User role migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
