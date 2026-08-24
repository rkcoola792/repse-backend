require('dotenv').config();
const express = require("express");
const app = express();
app.set("trust proxy", 1);
const port = 3000;
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

app.use(helmet());
// Reflecting any Origin back while allowing credentials lets any website
// make authenticated requests using a logged-in user's cookies. Only
// origins explicitly listed here (or in ALLOWED_ORIGINS) are trusted.
const allowedOrigins = [
  process.env.BASE_URL,
  "http://localhost:5173",
  "http://localhost:5174",
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }))
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
app.use(["/signin", "/signup", "/refresh-token", "/auth/google"], authLimiter);

app.use("/", authRouter);
app.use("/", productRouter);
app.use("/", paymentRouter);
app.use("/", userRouter);
app.use("/", adminRouter);

// Sends real emails and isn't authenticated — dev-only diagnostics, never mounted in production.
if (process.env.NODE_ENV !== "production") {
  app.use("/api/test", require("./routes/testRoutes.js"));
}


db().then(() => {
  console.log("Database connection established");
  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
  });
});
