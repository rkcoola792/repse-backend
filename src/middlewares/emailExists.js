const User = require("../models/user");
const checkEmailExists = async (req, res, next) => {
  try {
    const userExists = await User.findOne({ email: req.body.email });

    if (userExists) {
      return res.status(400).json({ error: "Email already in use" });
    }
    next();
  } catch (error) {
    return res.status(500).json({ error: "Server error" + error.message });
  }
};
module.exports = checkEmailExists;
