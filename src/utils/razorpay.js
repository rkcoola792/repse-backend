const Razorpay = require('razorpay');
const credentials = require("../config/razorpayCredentials");

const instance = new Razorpay({
    key_id: credentials.key_id,
    key_secret: credentials.key_secret,
});

module.exports = instance;
