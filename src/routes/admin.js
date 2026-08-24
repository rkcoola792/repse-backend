const express = require("express");
const adminRouter = express.Router();
const Order = require("../models/payment");
const Product = require("../models/products");
const User = require("../models/user");
const userAuth = require("../middlewares/auth");
const adminAuth = require("../middlewares/adminAuth");
const { upload } = require("../middlewares/upload");
const { escapeRegex } = require("../utils/escapeRegex");
const cloudinary = require("../config/cloudinary");

const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);

const percentChange = (current, previous) => {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Number((((current - previous) / previous) * 100).toFixed(1));
};

adminRouter.get("/admin/dashboard-stats", userAuth, adminAuth, async (req, res) => {
  try {
    const now = new Date();
    const thisMonthStart = startOfMonth(now);
    const lastMonthStart = new Date(thisMonthStart);
    lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);

    const [
      totalRevenueAgg,
      thisMonthRevenueAgg,
      lastMonthRevenueAgg,
      totalOrders,
      thisMonthOrders,
      lastMonthOrders,
      totalCustomers,
      thisMonthCustomers,
      lastMonthCustomers,
      totalProducts,
      recentOrders,
      topProductsAgg,
      lowStockProducts,
    ] = await Promise.all([
      Order.aggregate([
        { $match: { status: "captured" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Order.aggregate([
        { $match: { status: "captured", createdAt: { $gte: thisMonthStart } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Order.aggregate([
        {
          $match: {
            status: "captured",
            createdAt: { $gte: lastMonthStart, $lt: thisMonthStart },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Order.countDocuments({}),
      Order.countDocuments({ createdAt: { $gte: thisMonthStart } }),
      Order.countDocuments({ createdAt: { $gte: lastMonthStart, $lt: thisMonthStart } }),
      User.countDocuments({ role: "user" }),
      User.countDocuments({ role: "user", createdAt: { $gte: thisMonthStart } }),
      User.countDocuments({
        role: "user",
        createdAt: { $gte: lastMonthStart, $lt: thisMonthStart },
      }),
      Product.countDocuments({}),
      Order.find({}).sort({ createdAt: -1 }).limit(5),
      Order.aggregate([
        { $match: { status: "captured" } },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.productId",
            name: { $first: "$items.name" },
            sales: { $sum: "$items.quantity" },
            revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 5 },
      ]),
      Product.find({ "variants.stock": { $lt: 5 } }).limit(10),
    ]);

    const totalRevenue = totalRevenueAgg[0]?.total || 0;
    const thisMonthRevenue = thisMonthRevenueAgg[0]?.total || 0;
    const lastMonthRevenue = lastMonthRevenueAgg[0]?.total || 0;

    res.status(200).json({
      totalRevenue,
      totalOrders,
      totalCustomers,
      totalProducts,
      revenueChangePct: percentChange(thisMonthRevenue, lastMonthRevenue),
      ordersChangePct: percentChange(thisMonthOrders, lastMonthOrders),
      customersChangePct: percentChange(thisMonthCustomers, lastMonthCustomers),
      recentOrders,
      topProducts: topProductsAgg,
      lowStockProducts: lowStockProducts.map((p) => ({
        _id: p._id,
        name: p.name,
        images: p.images,
        totalStock: p.variants.reduce((sum, v) => sum + v.stock, 0),
        variants: p.variants,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: "Server error: " + error.message });
  }
});

adminRouter.get("/admin/analytics", userAuth, adminAuth, async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const [
      revenueByDayAgg,
      ordersByStatusAgg,
      salesByCategoryAgg,
      capturedOrdersAgg,
      customerOrderCountsAgg,
    ] = await Promise.all([
      Order.aggregate([
        { $match: { status: "captured", createdAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            revenue: { $sum: "$amount" },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate([
        { $group: { _id: "$deliveryStatus", count: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: { status: "captured" } },
        { $unwind: "$items" },
        {
          $lookup: {
            from: "products",
            localField: "items.productId",
            foreignField: "_id",
            as: "product",
          },
        },
        { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { $ifNull: ["$product.category", "Uncategorized"] },
            revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          },
        },
        { $sort: { revenue: -1 } },
      ]),
      Order.aggregate([
        { $match: { status: "captured" } },
        { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $group: { _id: "$userId", orderCount: { $sum: 1 } } },
      ]),
    ]);

    const totalCapturedRevenue = capturedOrdersAgg[0]?.total || 0;
    const totalCapturedCount = capturedOrdersAgg[0]?.count || 0;
    const avgOrderValue = totalCapturedCount
      ? Number((totalCapturedRevenue / totalCapturedCount).toFixed(2))
      : 0;

    const customersWithOrders = customerOrderCountsAgg.length;
    const repeatCustomers = customerOrderCountsAgg.filter((c) => c.orderCount > 1).length;
    const repeatCustomerRate = customersWithOrders
      ? Number(((repeatCustomers / customersWithOrders) * 100).toFixed(1))
      : 0;

    res.status(200).json({
      revenueByDay: revenueByDayAgg.map((d) => ({ date: d._id, revenue: d.revenue })),
      ordersByStatus: ordersByStatusAgg.map((d) => ({
        status: d._id || "processing",
        count: d.count,
      })),
      salesByCategory: salesByCategoryAgg.map((d) => ({
        category: d._id,
        revenue: d.revenue,
      })),
      avgOrderValue,
      repeatCustomerRate,
    });
  } catch (error) {
    res.status(500).json({ error: "Server error: " + error.message });
  }
});

adminRouter.get("/admin/products", userAuth, adminAuth, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.search) {
      filter.name = { $regex: escapeRegex(req.query.search), $options: "i" };
    }
    if (req.query.category) {
      filter.category = req.query.category;
    }

    const [products, total] = await Promise.all([
      Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Product.countDocuments(filter),
    ]);

    res.status(200).json({
      products,
      total,
      page,
      pages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (error) {
    res.status(500).json({ error: "Server error: " + error.message });
  }
});

const uploadBufferToCloudinary = (buffer) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "repse/products" },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    stream.end(buffer);
  });

adminRouter.post("/admin/upload-images", userAuth, adminAuth, (req, res) => {
  upload.array("images", 8)(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No images uploaded" });
    }
    try {
      const results = await Promise.all(
        req.files.map((file) => uploadBufferToCloudinary(file.buffer)),
      );
      res.status(200).json({ urls: results.map((r) => r.secure_url) });
    } catch (error) {
      res.status(500).json({ error: "Image upload failed: " + error.message });
    }
  });
});

module.exports = adminRouter;
