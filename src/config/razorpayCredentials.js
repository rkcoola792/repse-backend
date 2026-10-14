const production = process.env.NODE_ENV === "production";

module.exports = {
  key_id:
    process.env.RAZORPAY_KEY_ID ||
    (production ? process.env.RAZORPAY_LIVE_API_KEY_ID : "") ||
    process.env.RAZORPAY_TEST_KEY_ID,
  key_secret:
    process.env.RAZORPAY_KEY_SECRET ||
    (production ? process.env.RAZORPAY_LIVE_SECRET_KEY : "") ||
    process.env.RAZORPAY_TEST_KEY_SECRET,
};
