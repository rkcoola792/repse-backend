require('dotenv').config(); 
const express = require("express");
const app = express();
const port = 3000;
const db = require("./config/database.js");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const authRouter = require('./routes/auth.js');
const productRouter = require('./routes/product.js');
const paymentRouter = require('./routes/payment.js');
const userRouter = require('./routes/user.js');
app.use(
  cors({
    origin: "*",
    credentials: false,
  })
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }))

app.use("/", authRouter);
app.use("/", productRouter);
app.use("/", paymentRouter);
app.use("/", userRouter);


db().then(() => {
  console.log("Database connection established");
  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
  });
});
