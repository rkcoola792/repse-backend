const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = "onboarding@resend.dev";

const sendTestEmail = async () => {
  const result = await resend.emails.send({
    from: FROM_EMAIL,
    to: [process.env.ORDER_NOTIFICATION_EMAIL],
    subject: "Repse - Test Email",
    html: `
      <h1>Email is working 🎉</h1>

      <p>
        This email was sent from your local Express server.
      </p>

      <p>
        Your Resend integration is working correctly.
      </p>
    `,
  });

  return result;
};

const sendOrderConfirmationEmail = async (order) => {
  try {
    const itemsHtml = order.items
      .map(
        (item) => `
          <tr>
            <td style="padding: 8px;">
              ${item.name}
            </td>

            <td style="padding: 8px;">
              ${item.quantity}
            </td>

            <td style="padding: 8px;">
              ₹${item.price}
            </td>
          </tr>
        `
      )
      .join("");

    await resend.emails.send({
      from: FROM_EMAIL,

      to: [order.customerEmail],

      subject: `Order #${order.orderNumber} confirmed`,

      html: `
        <div style="font-family: Arial, sans-serif;">

          <h2>Thank you for your order! 🎉</h2>

          <p>
            Hi ${order.customerName},
          </p>

          <p>
            Your order
            <strong>#${order.orderNumber}</strong>
            has been confirmed.
          </p>

          <h3>Order Details</h3>

          <table
            style="
              width: 100%;
              border-collapse: collapse;
            "
          >
            <thead>
              <tr>
                <th style="text-align:left;">
                  Product
                </th>

                <th style="text-align:left;">
                  Quantity
                </th>

                <th style="text-align:left;">
                  Price
                </th>
              </tr>
            </thead>

            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <hr />

          <h3>
            Total: ₹${order.totalAmount}
          </h3>

          <p>
            We'll notify you when your order is shipped.
          </p>

          <p>
            Thank you for shopping with Repse!
          </p>

        </div>
      `,
    });

  } catch (error) {
    console.error(
      "Customer email failed:",
      error
    );
  }
};

const sendAdminOrderNotification = async (order) => {
  try {
    const itemsHtml = order.items
      .map(
        (item) => `
          <li>
            ${item.name}
            × ${item.quantity}
            — ₹${item.price * item.quantity}
          </li>
        `
      )
      .join("");

    await resend.emails.send({
      from: FROM_EMAIL,

      to: [process.env.ORDER_NOTIFICATION_EMAIL],

      subject: `New Order #${order.orderNumber} - ₹${order.totalAmount}`,

      html: `
        <div style="font-family: Arial, sans-serif;">

          <h2>🛒 New Order Received</h2>

          <h3>
            Order #${order.orderNumber}
          </h3>

          <p>
            <strong>Customer:</strong>
            ${order.customerName}
          </p>

          <p>
            <strong>Email:</strong>
            ${order.customerEmail}
          </p>

          <p>
            <strong>Total:</strong>
            ₹${order.totalAmount}
          </p>

          <h3>Items</h3>

          <ul>
            ${itemsHtml}
          </ul>

          <p>
            Please open the admin panel to process the order.
          </p>

        </div>
      `,
    });

  } catch (error) {
    console.error(
      "Admin email failed:",
      error
    );
  }
};

module.exports = {
  sendTestEmail,
  sendOrderConfirmationEmail,
  sendAdminOrderNotification,
};
