const adminAuth = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    res.status(401).send({ error: "Unauthorized" });
  }
};

module.exports = adminAuth;