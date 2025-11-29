const express = require("express");
const checkEmailExists = require("../middlewares/emailExists");
const User = require("../models/user");
const { isStrongPassword } = require("validator");

const authRouter = express.Router();

authRouter.post("/signup", checkEmailExists, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    console.log(name, email, password);
    const strongPassword = await isStrongPassword(password);
    if (!strongPassword) {
      return res.status(400).json({ error: "Password is not strong enough" });
    }
    const trimmedName = name.trim();
    const newUser = new User({ name: trimmedName, email, password });

    await newUser.save();
    res
      .status(200)
      .json({ message: "User registered successfully", user: newUser });
  } catch (error) {
    res.status(500).json({ error: "Server error" + error.message });
  }
});

module.exports = authRouter;
