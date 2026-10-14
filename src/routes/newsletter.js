const express = require("express");
const rateLimit = require("express-rate-limit");
const NewsletterSubscriber = require("../models/newsletterSubscriber");

const newsletterRouter = express.Router();
const subscribeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many subscription attempts. Please try again later." },
});

newsletterRouter.post("/newsletter/subscribe", subscribeLimiter, async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }

  try {
    await NewsletterSubscriber.updateOne(
      { email },
      { $setOnInsert: { email } },
      { upsert: true },
    );
    return res.status(200).json({ message: "Subscription saved." });
  } catch (error) {
    console.error("Newsletter subscription failed:", error);
    return res.status(500).json({ error: "We couldn't save your subscription. Please try again." });
  }
});

module.exports = newsletterRouter;
