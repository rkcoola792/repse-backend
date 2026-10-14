const User = require("../models/user");
const checkEmailExists = async (req, res, next) => {
  try {
    const userExists = await User.findOne({ email: req.body.email });

    if (userExists) {
      return res.status(400).json({ error: "Email already in use" });
    }
    next();
  } catch (error) {
    console.error("Email availability check failed:", error);
    return res.status(500).json({ error: "Could not validate email address" });
  }
};
module.exports = checkEmailExists;
