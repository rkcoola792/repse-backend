const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = "onboarding@resend.dev";

// Order/product fields are interpolated straight into HTML email bodies —
// escape them so a crafted name/product title can't inject markup or links
// into an email sent to a customer or the store admin.
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);

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
              ${escapeHtml(item.name)}
            </td>

            <td style="padding: 8px;">
              ${escapeHtml(item.quantity)}
            </td>

            <td style="padding: 8px;">
              ₹${escapeHtml(item.price)}
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
            Hi ${escapeHtml(order.customerName)},
          </p>

          <p>
            Your order
            <strong>#${escapeHtml(order.orderNumber)}</strong>
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
            Total: ₹${escapeHtml(order.totalAmount)}
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
            ${escapeHtml(item.name)}
            × ${escapeHtml(item.quantity)}
            — ₹${escapeHtml(item.price * item.quantity)}
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
            Order #${escapeHtml(order.orderNumber)}
          </h3>

          <p>
            <strong>Customer:</strong>
            ${escapeHtml(order.customerName)}
          </p>

          <p>
            <strong>Email:</strong>
            ${escapeHtml(order.customerEmail)}
          </p>

          <p>
            <strong>Total:</strong>
            ₹${escapeHtml(order.totalAmount)}
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
