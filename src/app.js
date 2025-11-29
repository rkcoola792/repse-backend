const express = require("express");
const app = express();
const port = 3000;
const db = require("./config/database.js");
const cookieParser = require("cookie-parser");
const cors = require("cors");
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());


db().then(() => {
  console.log("Database connection established");
  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
  });
});
