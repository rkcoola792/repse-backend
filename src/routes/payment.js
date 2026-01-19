const express = require("express");
const paymentRouter = express.Router();
const razorpayInstance = require("../utils/razorpay");
const userAuth = require("../middlewares/auth");
const Order = require("../models/payment");
const crypto = require("crypto");
paymentRouter.post("/create-order", userAuth, async (req, res) => {
  console.log("create order body", req.body);
  try {
    const { amount, currency, receipt, notes, items } = req.body;
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
      items: items || [],
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

    // Create the expected signature using crypto
    const body = JSON.stringify(req.body);
    console.log("body", body);
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(body)
      .digest("hex");

    // Validate signature
    const isWebhookValid = expectedSignature === signature;

    if (!isWebhookValid) {
      console.log("webhook not valid");
      return res.status(400).json({ error: "Invalid webhook signature" });
    }

    console.log("webhook valid");

    // Update payment details in database
    const paymentDetails = req.body.payload.payment.entity;
    console.log("payment details", paymentDetails);

    const paymentOrder = await Order.findOne({
      orderId: paymentDetails.order_id,
    });

    if (!paymentOrder) {
      console.log("Payment order not found");
      return res.status(404).json({ error: "Order not found" });
    }

    console.log("found payment order", paymentOrder);

    paymentOrder.status = paymentDetails.status;
    await paymentOrder.save();
    console.log("Payment order updated:", paymentOrder);

    // Return success response to razorpay
    res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).json({ error: "Server error: " + error.message });
  }
});

// paymentRouter.post("/verify-payment", userAuth, async (req, res) => {
//   try {
//     const { paymentId, orderId, signature } = req.body;

//     // Create the expected signature
//     const text = `${orderId}|${paymentId}`;
//     const expectedSignature = crypto
//       .createHmac("sha256", process.env.RAZORPAY_TEST_KEY_SECRET)
//       .update(text)
//       .digest("hex");

//     // Verify signature
//     if (expectedSignature === signature) {
//       // Update order status in database
//       const order = await Order.findOne({ orderId });
//       if (order) {
//         order.status = "captured";
//         order.paymentId = paymentId;
//         await order.save();
//       }

//       res
//         .status(200)
//         .json({ success: true, message: "Payment verified successfully" });
//     } else {
//       res.status(400).json({ success: false, message: "Invalid signature" });
//     }
//   } catch (error) {
//     console.error("Error verifying payment:", error);
//     res.status(500).json({ success: false, error: error.message });
//   }
// });
module.exports = paymentRouter;
