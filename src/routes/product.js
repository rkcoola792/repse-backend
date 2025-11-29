const express = require("express");
const productRouter = express.Router();
const Product = require("../models/products");
const userAuth = require("../middlewares/auth");
const adminAuth = require("../middlewares/adminAuth");

productRouter.get("/products", userAuth, async (req, res) => {
  try {
    const products = await Product.find();
    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ error: "Server error: " + error.message });
  }
});

productRouter.post("/product", userAuth, adminAuth, async (req, res) => {
  try {
    const { name, price, description, category, image } = req.body;
    const newProduct = new Product({
      name,
      price,
      description,
      category,
      image,
    });
    await newProduct.save();
    res.status(200).json({ 
      message: "Product added successfully", 
      product: newProduct 
    });
  } catch (error) {
    res.status(500).json({ error: "Server error: " + error.message });
  }
});

productRouter.get("/product/:id", userAuth, adminAuth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.status(200).json(product);
  } catch (error) {
    res.status(500).json({ error: "Server error: " + error.message });
  }
});

productRouter.patch("/product/:id", userAuth, adminAuth, async (req, res) => {
  try {
    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!updatedProduct) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.status(200).json({
      message: "Product updated successfully",
      product: updatedProduct,
    });
  } catch (error) {
    res.status(500).json({ error: "Server error: " + error.message });
  }
});

productRouter.delete("/product/:id", userAuth, adminAuth, async (req, res) => {
  try {
    const deletedProduct = await Product.findByIdAndDelete(req.params.id);
    if (!deletedProduct) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.status(200).json({
      message: "Product deleted successfully",
      product: deletedProduct,
    });
  } catch (error) {
    res.status(500).json({ error: "Server error: " + error.message });
  }
});

module.exports = productRouter;