const jwt = require("jsonwebtoken");
const User = require("../models/user");

const userAuth = async (req, res, next) => {
  const token = req.cookies.token;
  try {
    if (!token) {
      return res.status(401).send({ error: "Unauthorized" });
    }
    const decoded = await jwt.verify(token, "Rajeev@12345");
    console.log(decoded);
    const user = await User.findById(decoded.id);
    req.user = user;
    next();
  } catch (error) {
    res.status(401).send({ error: error.message });
  }
};
module.exports = userAuth;
