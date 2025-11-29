require('dotenv').config(); 
const express = require("express");
const app = express();
const port = 3000;
const db = require("./config/database.js");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const authRouter = require('./routes/auth.js');
const productRouter = require('./routes/product.js');
app.use(
  cors({
    origin: process.env.BASE_URL,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }))

app.use("/", authRouter);
app.use("/", productRouter);


db().then(() => {
  console.log("Database connection established");
  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
  });
});
