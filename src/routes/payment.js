const express = require("express");
const paymentRouter = express.Router();
const razorpayInstance = require("../utils/razorpay");
const userAuth = require("../middlewares/auth");
const Order = require("../models/payment");
const validateWebhookSignature = require("razorpay/dist/utils/razorpay-utils");
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
    res.status(200).json({
      ...savedOrder.toJSON(),
      keyId: process.env.RAZORPAY_TEST_KEY_ID,
    });
  } catch (error) {
    res.status(500).json({ error: "Server error: " + error.message });
  }
});
paymentRouter.post("/payment/webhook", async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.get("X-Razorpay-Signature");
    const isWebhookValid = validateWebhookSignature(
      JSON.stringify(req.body),
      signature,
      webhookSecret
    );
    if (!isWebhookValid) {
      console.log("webhook not valid");
      return res.status(400).json({ error: "Invalid webhook signature" });
    }
    console.log("webhook valid");

    //update my payment details in database
    const paymentDetails = req.body.payload.payment.entity;
    console.log("payment details", paymentDetails);
    const paymentOrder = await Order.findOne({
      orderId: paymentDetails.order_id,
    });
    console.log("found payment order", paymentOrder);

    paymentOrder.status = paymentDetails.status;
    await paymentOrder.save();
    console.log("Payment order updated:", paymentOrder);

    //return scuccess response to razorpay
    res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).json({ error: "Server error: " + error.message });
  }
});
module.exports = paymentRouter;
