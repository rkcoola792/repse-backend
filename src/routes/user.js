const express = require("express");
const User = require("../models/user");
const adminAuth = require("../middlewares/adminAuth");
const userAuth = require("../middlewares/auth");
const { escapeRegex } = require("../utils/escapeRegex");
const userRouter = express.Router();

userRouter.get("/get-users", userAuth, adminAuth, async (req, res) => {
  try {
    const filter = {};
    if (req.query.search) {
      const searchRegex = { $regex: escapeRegex(req.query.search), $options: "i" };
      filter.$or = [
        { name: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
      ];
    }
    const users = await User.find(filter).select("-password");
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ error: "Server error: " + error.message });
  }
});

userRouter.put("/update-user", userAuth, async (req, res) => {
  try {
    const { name, lastName, email, mobile, address, role, id } = req.body;

    // Get the logged-in user from the auth middleware
    const loggedInUser = req.user; // Assuming your userAuth middleware sets req.user

    // Check if user is trying to update their own profile or if they're an admin
    const isOwnProfile = loggedInUser._id.toString() === id;
    const isAdmin = loggedInUser.role === "admin";

    // If not own profile and not admin, deny access
    if (!isOwnProfile && !isAdmin) {
      return res.status(403).json({
        error: "You don't have permission to update this user",
      });
    }

    // Prepare update data
    const updateData = {
      name,
      lastName,
      email,
      mobile,
      address,
    };

    // Only admin can change user roles
    if (role) {
      if (!isAdmin) {
        return res.status(403).json({
          error: "Only admins can change user roles",
        });
      }
      updateData.role = role;
    }

    // Find and update the user
    const updatedUser = await User.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).select("-password"); // Exclude password from response

    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json({
      message: "User updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    res.status(500).json({ error: "Server error: " + error.message });
  }
});

userRouter.delete("/user/:id", userAuth, adminAuth, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res
        .status(400)
        .json({ error: "You cannot delete your own account" });
    }

    const deletedUser = await User.findByIdAndDelete(req.params.id);
    if (!deletedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Server error: " + error.message });
  }
});

module.exports = userRouter;
