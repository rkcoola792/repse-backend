/* Twilio SMS delivery is paused until the service is affordable/configured.
const sendLoginOtpSms = async (to, code) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || (!messagingServiceSid && !from)) {
    const error = new Error("Twilio SMS is not configured");
    error.code = "TWILIO_NOT_CONFIGURED";
    throw error;
  }

  const form = new URLSearchParams({
    To: to,
    Body: `Your REPSE sign-in code is ${code}. It expires in 10 minutes. If you did not request it, ignore this message.`,
    ...(messagingServiceSid
      ? { MessagingServiceSid: messagingServiceSid }
      : { From: from }),
  });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    },
  );

  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    console.error("Twilio SMS request failed:", response.status, details.code || "unknown error");
    const error = new Error("Could not send the sign-in SMS");
    error.code = "TWILIO_SEND_FAILED";
    throw error;
  }
};

module.exports = { sendLoginOtpSms };
*/
