const Razorpay = require('razorpay');


const instance = new Razorpay({
    key_id: process.env.RAZORPAY_LIVE_API_KEY_ID,
    key_secret: process.env.RAZORPAY_LIVE_SECRET_KEY,
});

module.exports = instance;