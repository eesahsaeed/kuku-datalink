export const dataTransactionResponse = {
  success: true,
  message: 'success',
  data: {
    success: true,
    message:
      'Transaction Sent For Processing . N230 MTN AWUF Beneficiary : 09167077964',
    transaction_data: {
      transaction_hash: `DATA-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)
        .toUpperCase()}`,
      status: 'Processing',
      amount: 230,
      recipient: '09167077964',
      amount_paid: 230,
      commission: 0,
      special_message: '',
      discount: 0,
    },
  },
};

export const airtimeTransactionResponse = {
  success: true,
  message: 'success',
  data: {
    success: true,
    message:
      'Transaction Sent For Processing . N50 MTN Beneficiary : 08069068183',
    transaction_data: {
      transaction_hash: `AIR-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)
        .toUpperCase()}`,
      status: 'Processing',
      amount: 50,
      recipient: '08069068183',
      amount_paid: 50,
      commission: 1.05,
      special_message: '',
      discount: 0,
    },
  },
};

export const tvTransactionResponse = {
  success: true,
  message: 'success',
  data: {
    success: true,
    message:
      'Transaction Sent For Processing . ₦11,400.00 GOtv Supa Beneficiary : 01467197046',
    transaction_data: {
      transaction_hash: 'GT-789021456X-99',
      status: 'processing',
      amount: 400,
      commission: 100,
      recipient: '01467197046',
      amount_paid: 500,
      discount: 0,
    },
  },
};

// export const tvTransactionResponse = {
//   success: true,
//   message: 'success',
//   data: {
//     success: true,
//     message:
//       'Transaction Sent For Processing . ₦11,400.00 GOtv Supa Beneficiary : 02027761971',
//     transaction_data: {
//       transaction_hash: 'GT-789021456X-99',
//       status: 'processing',
//       amount: 400,
//       commission: 100,
//       recipient: '02027761971',
//       amount_paid: 500,
//       discount: 0,
//     },
//   },
// };

// NVIDIA NIN PASS: ~S3@94GN)C)8swZ
// AKEY: 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

export const electricityTransactionResponse = {
  success: true,
  message: 'success',
  data: {
    success: true,
    message: 'Electricity token generated successfully',
    transaction_data: {
      transaction_hash: `ELEC-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)
        .toUpperCase()}`,
      status: 'successful',
      amount: 2500,
      recipient: '12345678901',
      amount_paid: 2500,
      commission: 150,
      token: '12345678901234567890',
      token_units: 93.6,
      special_message:
        'Token: 12345678901234567890 | Units: 93.6kWh | Store this token safely.',
      discount: 0,
    },
  },
};

// fix the socket new-transaction event. the returned data is below
//
// {
// amount: 1495
// package: "PK-MTN-HDPX"
// pricing: {commission: 10.34, fee: 5, gain: 4, originalPrice: 1495, package_amount: 1477}
// profit: 4
// provider: "mtn-sme"
// recipient: "08069068183"
// reference: "DATA-1774717791676-812AJ3"
// status: "success"
// timestamp: "2026-03-28T17:09:51.868Z"
// transactionId: "69c80b5f9417fe0ea6868e4c"
// type: "data"
// userId: "69c7daa66b1ff6d66b8e9c8b"
// }

// replication:
//   replSetName: "rs0"
