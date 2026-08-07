const express = require("express");
const paymentRouter = express.Router();
const razorpayInstance = require("../utils/razorpay");
const userAuth = require("../middlewares/auth");
const Order = require("../models/payment");
const Product = require("../models/products");
const adminAuth = require("../middlewares/adminAuth");
const crypto = require("crypto");
paymentRouter.post("/create-order", userAuth, async (req, res) => {
  console.log("create order body", req.body);
  try {
    const { amount, currency, receipt, notes, items } = req.body;

    const populatedItems = await Promise.all(
      (items || []).map(async (item) => {
        const product = await Product.findById(item.productId);
        return {
          productId: item.productId,
          name: product ? product.name : item.name,
          image: product ? product.images?.[0] : item.image,
          size: item.size,
          quantity: item.quantity,
          price: product ? product.price : item.price,
        };
      }),
    );

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
      items: populatedItems,
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

paymentRouter.get("/my-orders", userAuth, async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.user._id }).sort({
      createdAt: -1,
    });
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ error: "Server error: " + error.message });
  }
});

paymentRouter.get("/order/:id", userAuth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }
    if (
      order.userId.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.status(200).json(order);
  } catch (error) {
    res.status(500).json({ error: "Server error: " + error.message });
  }
});

paymentRouter.get("/get-orders", userAuth, adminAuth, async (req, res) => {
  try {
    const orders = await Order.find({}).sort({
      createdAt: -1,
    });
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ error: "Server error: " + error.message });
  }
});

paymentRouter.put(
  "/update-delivery-status",
  userAuth,
  adminAuth,
  async (req, res) => {
    console.log("update delivery status body", req.body);
    try {
      const { deliveryStatus, orderId } = req.body;

      const validStatuses = ["processing", "intransit", "delivered", "cancelled"];
      if (!validStatuses.includes(deliveryStatus)) {
        return res.status(400).json({ error: "Invalid delivery status" });
      }

      const updatedOrder = await Order.findByIdAndUpdate(
        orderId,
        { deliveryStatus },
        { new: true },
      );

      if (!updatedOrder) {
        return res.status(404).json({ error: "Order not found" });
      }

      res.status(200).json(updatedOrder);
    } catch (error) {
      res.status(500).json({ error: "Server error: " + error.message });
    }
  },
);

paymentRouter.post("/payment/webhook", async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.get("X-Razorpay-Signature");

    // Create the expected signature using crypto
    const body = JSON.stringify(req.body);
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
