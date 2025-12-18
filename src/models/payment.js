const mongoose = require("mongoose");

const paymentOrderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      default: "INR",
      enum: ["INR", "USD", "EUR", "GBP", "AUD", "CAD"], // Add more currencies as needed
    },
    receipt: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    payment_capture: {
      type: Number,
      required: true,
      enum: [0, 1], // 0 = manual capture, 1 = automatic capture
      default: 1,
    },
    notes: {
      first_name: {
        type: String,
        trim: true,
      },
      email: {
        type: String,
        trim: true,
        lowercase: true,
        match: [
          /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
          "Please provide a valid email",
        ],
      },
    },
    status: {
      type: String,
      enum: ["created", "authorized", "captured", "refunded", "failed"],
      default: "created",
    },
    orderId: {
      type: String,
      sparse: true, // Razorpay order ID after creation
    },
    paymentId: {
      type: String,
      sparse: true, // Razorpay payment ID after payment
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

// Index for faster queries
paymentOrderSchema.index({ receipt: 1 });
paymentOrderSchema.index({ "notes.email": 1 });

const PaymentOrder = mongoose.model("PaymentOrder", paymentOrderSchema);

module.exports = PaymentOrder;
