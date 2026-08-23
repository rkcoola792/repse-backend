const jwt = require("jsonwebtoken");
const User = require("../models/user");

const userAuth = async (req, res, next) => {
  const token = req.cookies.accessToken;
  try {
    if (!token) {
      return res.status(401).send({ error: "Unauthorized access" });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== "access") {
      return res.status(401).send({ error: "Unauthorized access" });
    }
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).send({ error: "Unauthorized access" });
    }
    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res
        .status(401)
        .send({ error: "Access token expired", code: "TOKEN_EXPIRED" });
    }
    res.status(401).send({ error: "Unauthorized access" });
  }
};
module.exports = userAuth;
