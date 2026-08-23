const express = require("express");
const paymentRouter = express.Router();
const razorpayInstance = require("../utils/razorpay");
const userAuth = require("../middlewares/auth");
const Order = require("../models/payment");
const Product = require("../models/products");
const adminAuth = require("../middlewares/adminAuth");
const crypto = require("crypto");

// Atomically decrements variant stock for each item. The `stock: { $gte: quantity }`
// condition means a short-on-stock update simply won't match rather than going negative.
const decrementInventory = async (items) => {
  await Promise.all(
    (items || []).map(async (item) => {
      if (!item.productId || !item.size || !item.quantity) return;
      const result = await Product.updateOne(
        {
          _id: item.productId,
          variants: { $elemMatch: { size: item.size, stock: { $gte: item.quantity } } },
        },
        { $inc: { "variants.$[v].stock": -item.quantity } },
        { arrayFilters: [{ "v.size": item.size }] },
      );
      if (result.matchedCount === 0) {
        console.error(
          `Inventory decrement failed (insufficient stock or missing variant): product=${item.productId} size=${item.size} qty=${item.quantity}`,
        );
      }
    }),
  );
};

paymentRouter.post("/create-order", userAuth, async (req, res) => {
  console.log("create order body", req.body);
  try {
    const { amount, currency, receipt, notes, items } = req.body;
    const stockIssues = [];

    const populatedItems = await Promise.all(
      (items || []).map(async (item) => {
        const product = await Product.findById(item.productId);
        const variant = product?.variants?.find((v) => v.size === item.size);
        if (product && (!variant || variant.stock < item.quantity)) {
          stockIssues.push(`"${product.name}" is out of stock in size ${item.size}`);
        }
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

    if (stockIssues.length > 0) {
      return res.status(400).json({ error: stockIssues.join(", ") });
    }

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

    if (paymentOrder.status !== "captured" && paymentDetails.status === "captured") {
      await decrementInventory(paymentOrder.items);
    }

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

paymentRouter.post("/verify-payment", userAuth, async (req, res) => {
  try {
    const { paymentId, orderId, signature } = req.body;
    if (!paymentId || !orderId || !signature) {
      return res
        .status(400)
        .json({ success: false, error: "Missing payment verification details" });
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_TEST_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    if (expectedSignature !== signature) {
      return res.status(400).json({ success: false, error: "Invalid signature" });
    }

    const order = await Order.findOne({ orderId });
    if (!order) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }
    if (
      order.userId.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    if (order.status !== "captured") {
      await decrementInventory(order.items);
      order.status = "captured";
      order.paymentId = paymentId;
      await order.save();
    }

    res
      .status(200)
      .json({ success: true, message: "Payment verified successfully" });
  } catch (error) {
    console.error("Error verifying payment:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = paymentRouter;
