require('dotenv').config(); 
const express = require("express");
const app = express();
const port = 3000;
const db = require("./config/database.js");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const authRouter = require('./routes/auth.js');
app.use(
  cors({
    origin: process.env.BASE_URL,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

app.use("/", authRouter);


db().then(() => {
  console.log("Database connection established");
  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
  });
});
