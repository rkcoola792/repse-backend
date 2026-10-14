require('dotenv').config();
const express = require("express");
const app = express();
app.set("trust proxy", process.env.TRUST_PROXY_HOPS ? Number(process.env.TRUST_PROXY_HOPS) : 1);
const port = Number(process.env.PORT) || 3000;
const path = require("path");
const db = require("./config/database.js");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const authRouter = require('./routes/auth.js');
const productRouter = require('./routes/product.js');
const paymentRouter = require('./routes/payment.js');
const userRouter = require('./routes/user.js');
const adminRouter = require('./routes/admin.js');
const newsletterRouter = require('./routes/newsletter.js');

app.use(helmet());
// Reflecting any Origin back while allowing credentials lets any website
// make authenticated requests using a logged-in user's cookies. Only
// origins explicitly listed here (or in ALLOWED_ORIGINS) are trusted.
const allowedOrigins = [
  process.env.BASE_URL,
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()) : []),
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(cookieParser());
// Razorpay signs the exact bytes it sends; keep the webhook body untouched until verification.
app.use("/payment/webhook", express.raw({ type: "application/json", limit: "1mb" }));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));
app.use(express.urlencoded({ extended: true, limit: process.env.FORM_BODY_LIMIT || "100kb" }));
// Helmet's default same-origin resource policy blocks the frontend (a
// different origin) from loading product images served here — product
// images are meant to be publicly embeddable, so relax it just for this path.
app.use(
  "/uploads",
  helmet.crossOriginResourcePolicy({ policy: "cross-origin" }),
  express.static(path.join(__dirname, "../uploads")),
);

// Brute-force guard on auth endpoints only — everything else stays unlimited.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
});
app.use(["/signin", "/signup", "/refresh-token", "/auth/google", "/request-login-otp", "/verify-login-otp"], authLimiter);
// Add these again when re-enabling the commented Twilio routes:
// app.use(["/request-phone-otp", "/verify-phone-otp"], authLimiter);

app.use("/", authRouter);
app.use("/", productRouter);
app.use("/", paymentRouter);
app.use("/", userRouter);
app.use("/", adminRouter);
app.use("/", newsletterRouter);

// Sends real emails and isn't authenticated — dev-only diagnostics, never mounted in production.
if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
  app.use("/api/test", require("./routes/testRoutes.js"));
}


db().then(() => {
  console.log("Database connection established");
  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
  });
});
