const mongoose = require("mongoose");

const variantSchema = new mongoose.Schema({
  size: {
    type: String,
    required: true,
    enum: ["S", "M", "L"], 
  },
  sku: {
    type: String,
    required: true,
  },
  stock: {
    type: Number,
    required: true,
    default: 0,
  },
});

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      required: true,
    },
    images: {
      type: [String],
      required: true,
    },
    variants: [variantSchema],  // Simplified - removed validation
    topSelling: {
      type: Boolean,
      default: false,
    },
    newArrival: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Speeds up category filtering on /admin/products.
productSchema.index({ category: 1 });

module.exports = mongoose.model("Product", productSchema);