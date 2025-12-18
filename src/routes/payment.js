const express = require("express");
const paymentRouter = express.Router();
const razorpayInstance = require("../utils/razorpay");
const userAuth = require("../middlewares/auth");
const Order = require("../models/payment");

paymentRouter.post("/create-order", userAuth, async (req, res) => {
  try {
    const { amount, currency, receipt, notes } = req.body;
    const options = {
      amount: amount * 100,
      currency,
      receipt,
      payment_capture: 1,
      notes: {
        // first_name: req.user.name,
        // email: req.user.email,
        ...notes,
      },
    };
    const order = await razorpayInstance.orders.create(options);
    console.log("order", order);
    //save order in database
    const newOrder = new Order({
      userId: req.user._id,
      amount: order.amount / 100,
      currency: order.currency,
      receipt: order.receipt,
      payment_capture: order.payment_capture,
      notes: order.notes,
      status: order.status,
      orderId: order.id,
    });

    const savedOrder = await newOrder.save();
    res
      .status(200)
      .json({
        ...savedOrder.toJSON(),
        keyId: process.env.RAZORPAY_TEST_KEY_ID,
      });
  } catch (error) {
    res.status(500).json({ error: "Server error: " + error.message });
  }
});
module.exports = paymentRouter;
