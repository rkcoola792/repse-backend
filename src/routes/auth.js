const express = require("express");
const checkEmailExists = require("../middlewares/emailExists");
const User = require("../models/user");
const { isStrongPassword } = require("validator");
const userAuth = require("../middlewares/auth");

const authRouter = express.Router();

authRouter.post("/signup", checkEmailExists, async (req, res) => {
  console.log(req.body);
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

authRouter.post("/signin", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: "Invalid password" });
    }
    const token = await user.getJWT();
    res.cookie("token", token);
    res.status(200).json({ message: "User signed in successfully", user });
  } catch (error) {
    res.status(500).json({ error: "Server error" + error.message });
  }
});

authRouter.post("/signout", (req, res) => {
  try {
    res.clearCookie("token");
    res.status(200).send("Signout successful");
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

module.exports = authRouter;
