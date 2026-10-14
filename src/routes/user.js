const express = require("express");
const User = require("../models/user");
const adminAuth = require("../middlewares/adminAuth");
const userAuth = require("../middlewares/auth");
const { escapeRegex } = require("../utils/escapeRegex");
const userRouter = express.Router();

const geocodeCache = new Map();
let geocodeQueue = Promise.resolve();
let lastGeocodeRequestAt = 0;
const REVERSE_GEOCODE_URL = process.env.REVERSE_GEOCODE_URL || "https://nominatim.openstreetmap.org/reverse";

userRouter.get("/reverse-geocode", userAuth, async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: "Valid latitude and longitude are required" });
  }

  const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return res.status(200).json(cached.value);

  const lookup = geocodeQueue.then(async () => {
    const waitMs = Math.max(0, 1100 - (Date.now() - lastGeocodeRequestAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastGeocodeRequestAt = Date.now();

    const endpoint = new URL(REVERSE_GEOCODE_URL);
    endpoint.searchParams.set("format", "jsonv2");
    endpoint.searchParams.set("lat", String(lat));
    endpoint.searchParams.set("lon", String(lon));
    endpoint.searchParams.set("addressdetails", "1");
    const response = await fetch(endpoint, {
      headers: { "User-Agent": "REPSE-Storefront/1.0 (reverse address lookup)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Reverse geocoder returned ${response.status}`);
    const result = await response.json();
    const value = { address: result.address || {} };
    geocodeCache.set(cacheKey, { value, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
    if (geocodeCache.size > 500) geocodeCache.delete(geocodeCache.keys().next().value);
    return value;
  });
  geocodeQueue = lookup.then(() => undefined, () => undefined);

  try {
    return res.status(200).json(await lookup);
  } catch (error) {
    console.error("Reverse geocoding failed:", error.message);
    return res.status(502).json({ error: "Could not resolve an address for this location" });
  }
});

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
    res.status(500).json({ error: "Internal server error" });
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

    if (!isAdmin && email && email.trim().toLowerCase() !== String(loggedInUser.email || "").toLowerCase()) {
      return res.status(400).json({ error: "Email changes require a separate verification flow" });
    }

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
    res.status(500).json({ error: "Internal server error" });
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
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = userRouter;
