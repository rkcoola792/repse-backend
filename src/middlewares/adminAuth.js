const adminAuth = (req, res, next) => {
  console.log("Admin Auth Middleware User:", req.user);
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    res.status(401).send({ error: "Unauthorized access" });
  }
};

module.exports = adminAuth;