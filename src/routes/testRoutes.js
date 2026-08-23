const express = require("express");

const {
  sendTestEmail,
  sendOrderConfirmationEmail,
  sendAdminOrderNotification,
} = require("../utils/emailService");

const router = express.Router();

router.get("/test-email", async (req, res) => {
  try {
    const result = await sendTestEmail();

    return res.status(200).json({
      success: true,
      message: "Test email sent successfully",
      result,
    });

  } catch (error) {
    console.error("Email error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to send test email",
      error: error.message,
    });
  }
});

router.post("/test-order-email", async (req, res) => {
  try {

    const fakeOrder = {
      orderNumber: "REP-TEST-001",

      customerName: "Raj",

      customerEmail:
        process.env.ORDER_NOTIFICATION_EMAIL,

      totalAmount: 2499,

      items: [
        {
          name: "Test T-Shirt",
          price: 1499,
          quantity: 1,
        },
        {
          name: "Test Shorts",
          price: 1000,
          quantity: 1,
        },
      ],
    };

    await sendOrderConfirmationEmail(
      fakeOrder
    );

    await sendAdminOrderNotification(
      fakeOrder
    );

    res.json({
      success: true,
      message: "Both emails sent",
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
