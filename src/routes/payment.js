const express = require("express");
const paymentRouter = express.Router();
const razorpayInstance = require("../utils/razorpay");
const userAuth = require("../middlewares/auth");
const Order = require("../models/payment");
const Product = require("../models/products");
const User = require("../models/user");
const adminAuth = require("../middlewares/adminAuth");
const crypto = require("crypto");
const razorpayCredentials = require("../config/razorpayCredentials");
const ORDER_CURRENCY = (process.env.ORDER_CURRENCY || "INR").toUpperCase();
const MAX_ORDER_ITEMS = Number(process.env.MAX_ORDER_ITEMS) || 50;
const MAX_ITEM_QUANTITY = Number(process.env.MAX_ITEM_QUANTITY) || 20;
const ORDER_DISCOUNT_PERCENT = Number(process.env.ORDER_DISCOUNT_PERCENT ?? 20);
const ORDER_DELIVERY_FEE = Number(process.env.ORDER_DELIVERY_FEE ?? 15);

// Constant-time comparison so signature checks can't be timed to leak
// bytes of the expected HMAC.
const safeCompare = (a, b) => {
  const bufA = Buffer.from(a || "", "utf8");
  const bufB = Buffer.from(b || "", "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};
const {
  sendOrderConfirmationEmail,
  sendAdminOrderNotification,
} = require("../utils/emailService");

// Fires order emails once payment is confirmed. Email failures are logged
// inside emailService and never throw, so this can't fail the request.
const notifyOrderConfirmed = async (order) => {
  const user = await User.findById(order.userId);
  const emailOrder = {
    orderNumber: order.receipt,
    customerName: order.notes?.first_name || user?.name || "Customer",
    customerEmail: order.notes?.email || user?.email,
    totalAmount: order.amount,
    items: order.items,
  };

  if (!emailOrder.customerEmail) return;

  await sendOrderConfirmationEmail(emailOrder);
  await sendAdminOrderNotification(emailOrder);
};

class StockUnavailableError extends Error {}

// Capture and decrement stock in one MongoDB transaction. If any line is short,
// the transaction rolls back every decrement so orders cannot partially consume stock.
const recordCapturedPayment = async (orderId, paymentId) => {
  const session = await Order.startSession();
  try {
    let result = { captured: false, stockIssue: false, alreadyCaptured: false };
    try {
      await session.withTransaction(async () => {
        const order = await Order.findById(orderId).session(session);
        if (!order) throw new Error("Order not found");
        if (order.status === "captured") {
          if (order.paymentId && order.paymentId !== paymentId) throw new Error("Order already paid with another payment");
          result = {
            captured: false,
            stockIssue: order.deliveryStatus === "stock_issue",
            alreadyCaptured: true,
          };
          return;
        }

        for (const item of order.items) {
          const changed = await Product.updateOne(
            {
              _id: item.productId,
              variants: { $elemMatch: { size: item.size, stock: { $gte: item.quantity } } },
            },
            { $inc: { "variants.$[variant].stock": -item.quantity } },
            { arrayFilters: [{ "variant.size": item.size }], session },
          );
          if (changed.matchedCount !== 1) throw new StockUnavailableError("Stock unavailable");
        }

        order.status = "captured";
        order.paymentId = paymentId;
        await order.save({ session });
        result.captured = true;
      });
    } catch (error) {
      if (!(error instanceof StockUnavailableError)) throw error;
      // Payment is already captured by Razorpay. Keep it recorded and flag the
      // order for manual refund/fulfillment resolution instead of claiming stock.
      const flagged = await Order.findOneAndUpdate(
        { _id: orderId, status: { $ne: "captured" } },
        { $set: { status: "captured", paymentId, deliveryStatus: "stock_issue" } },
        { new: true },
      );
      result = flagged
        ? { captured: true, stockIssue: true, alreadyCaptured: false }
        : { captured: false, stockIssue: false, alreadyCaptured: true };
    }
    return result;
  } finally {
    await session.endSession();
  }
};

const paymentMatchesOrder = (payment, order) =>
  payment?.order_id === order.orderId &&
  payment?.status === "captured" &&
  Number(payment.amount) === Math.round(order.amount * 100) &&
  String(payment.currency || "").toUpperCase() === order.currency;

const notifyStockIssue = async (order) => {
  const user = await User.findById(order.userId);
  await sendAdminOrderNotification({
    orderNumber: order.receipt,
    customerName: order.notes?.first_name || user?.name || "Customer",
    customerEmail: order.notes?.email || user?.email || "",
    totalAmount: order.amount,
    items: order.items,
  });
};

paymentRouter.post("/create-order", userAuth, async (req, res) => {
  try {
    const { notes, items } = req.body;
    if (ORDER_CURRENCY !== "INR" ||
      !Number.isFinite(ORDER_DISCOUNT_PERCENT) || ORDER_DISCOUNT_PERCENT < 0 || ORDER_DISCOUNT_PERCENT > 100 ||
      !Number.isFinite(ORDER_DELIVERY_FEE) || ORDER_DELIVERY_FEE < 0) {
      console.error("Invalid checkout configuration");
      return res.status(500).json({ error: "Checkout is temporarily unavailable" });
    }
    if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ORDER_ITEMS) {
      return res.status(400).json({ error: `Add between 1 and ${MAX_ORDER_ITEMS} items` });
    }
    const requestedQuantities = new Map();
    for (const item of items) {
      const quantity = Number(item?.quantity);
      if (typeof item?.productId !== "string" || !/^[a-f\d]{24}$/i.test(item.productId) ||
        !["S", "M", "L"].includes(item.size) || !Number.isSafeInteger(quantity) ||
        quantity < 1 || quantity > MAX_ITEM_QUANTITY) {
        return res.status(400).json({ error: "Each item needs a valid product, size, and quantity" });
      }
      const key = `${item.productId}:${item.size}`;
      const combinedQuantity = (requestedQuantities.get(key) || 0) + quantity;
      if (combinedQuantity > MAX_ITEM_QUANTITY) {
        return res.status(400).json({ error: "Combined quantity for an item exceeds the order limit" });
      }
      requestedQuantities.set(key, combinedQuantity);
    }
    const stockIssues = [];

    // Prices, names and images always come from the DB — never from the
    // client — so a tampered request can't buy items at an attacker-chosen
    // price or invent line items for products that don't exist.
    const populatedItems = await Promise.all(
      (items || []).map(async (item) => {
        const product = await Product.findById(item.productId);
        if (!product) {
          stockIssues.push("One or more items in your cart are no longer available");
          return null;
        }
        const quantity = Number(item.quantity);
        const variant = product.variants?.find((v) => v.size === item.size);
        const requestedTotal = requestedQuantities.get(`${item.productId}:${item.size}`);
        if (!variant || variant.stock < requestedTotal) {
          stockIssues.push(`"${product.name}" is out of stock in size ${item.size}`);
          return null;
        }
        return {
          productId: product._id,
          name: product.name,
          image: product.images?.[0],
          size: item.size,
          quantity,
          price: product.price,
        };
      }),
    );

    if (stockIssues.length > 0) {
      return res.status(400).json({ error: stockIssues.join(", ") });
    }

    const subtotal = populatedItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    const discount = subtotal * (ORDER_DISCOUNT_PERCENT / 100);
    const deliveryFee = subtotal > 0 ? ORDER_DELIVERY_FEE : 0;
    const amountInRupees = subtotal - discount + deliveryFee;

    const options = {
      amount: Math.round(amountInRupees * 100),
      currency: ORDER_CURRENCY,
      receipt: `${process.env.RECEIPT_PREFIX || "REP"}-${crypto.randomUUID()}`,
      payment_capture: 1,
      notes: {
        mobile: String(notes?.mobile || "").slice(0, 32),
        address: String(notes?.address || "").slice(0, 500),
        // first_name/email drive the order-confirmation email's recipient and
        // greeting, so they come from the authenticated user, not the
        // request body — otherwise a client could redirect the confirmation
        // email anywhere or inject arbitrary content into it.
        first_name: req.user.name,
        email: req.user.email,
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
      keyId: razorpayCredentials.key_id,
    });
  } catch (error) {
    console.error("Order creation failed:", error);
    res.status(500).json({ error: "Could not create the order" });
  }
});

paymentRouter.get("/my-orders", userAuth, async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.user._id }).sort({
      createdAt: -1,
    });
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
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
    res.status(500).json({ error: "Internal server error" });
  }
});

paymentRouter.get("/get-orders", userAuth, adminAuth, async (req, res) => {
  try {
    const orders = await Order.find({}).sort({
      createdAt: -1,
    });
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

paymentRouter.put(
  "/update-delivery-status",
  userAuth,
  adminAuth,
  async (req, res) => {
    try {
      const { deliveryStatus, orderId } = req.body;

      const validStatuses = ["processing", "intransit", "delivered", "cancelled", "stock_issue"];
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
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

paymentRouter.post("/payment/webhook", async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.get("X-Razorpay-Signature");
    if (!webhookSecret || !Buffer.isBuffer(req.body) || !signature) {
      return res.status(400).json({ error: "Invalid webhook configuration or request" });
    }
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(req.body)
      .digest("hex");

    // Validate signature
    const isWebhookValid = safeCompare(expectedSignature, signature);

    if (!isWebhookValid) {
      return res.status(400).json({ error: "Invalid webhook signature" });
    }

    let event;
    try {
      event = JSON.parse(req.body.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Invalid webhook payload" });
    }
    if (event.event !== "payment.captured") {
      return res.status(200).json({ status: "ignored" });
    }
    const paymentDetails = event.payload?.payment?.entity;
    if (!paymentDetails?.id || paymentDetails.status !== "captured" || !paymentDetails.order_id) {
      return res.status(400).json({ error: "Invalid captured payment payload" });
    }

    const paymentOrder = await Order.findOne({
      orderId: paymentDetails.order_id,
    });

    if (!paymentOrder) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (!paymentMatchesOrder(paymentDetails, paymentOrder)) {
      console.error("Razorpay webhook does not match order", paymentOrder._id);
      return res.status(400).json({ error: "Payment does not match the order" });
    }
    const outcome = await recordCapturedPayment(paymentOrder._id, paymentDetails.id);
    const updatedOrder = await Order.findById(paymentOrder._id);
    if (outcome.stockIssue && !outcome.alreadyCaptured) await notifyStockIssue(updatedOrder);
    else if (outcome.captured) await notifyOrderConfirmed(updatedOrder);

    // Return success response to razorpay
    res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("Error processing webhook:", error);
    console.error("Error processing webhook:", error);
    res.status(500).json({ error: "Could not process payment webhook" });
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

    const secret = razorpayCredentials.key_secret;
    if (!secret) return res.status(503).json({ success: false, error: "Payment verification is not configured" });
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    if (!safeCompare(expectedSignature, signature)) {
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

    const payment = await razorpayInstance.payments.fetch(paymentId);
    if (!paymentMatchesOrder(payment, order)) {
      return res.status(400).json({ success: false, error: "Payment is not captured or does not match this order" });
    }

    const outcome = await recordCapturedPayment(order._id, paymentId);
    const updatedOrder = await Order.findById(order._id);
    if (outcome.stockIssue && !outcome.alreadyCaptured) await notifyStockIssue(updatedOrder);
    else if (outcome.captured) await notifyOrderConfirmed(updatedOrder);

    if (outcome.stockIssue) {
      return res.status(409).json({ success: false, error: "Payment was captured, but stock needs manual resolution" });
    }

    res
      .status(200)
      .json({ success: true, message: "Payment verified successfully" });
  } catch (error) {
    console.error("Error verifying payment:", error);
    console.error("Error verifying payment:", error);
    res.status(500).json({ success: false, error: "Could not verify payment" });
  }
});

module.exports = paymentRouter;
