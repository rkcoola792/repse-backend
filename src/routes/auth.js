const express = require("express");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const checkEmailExists = require("../middlewares/emailExists");
const User = require("../models/user");
const { isStrongPassword } = require("validator");
const userAuth = require("../middlewares/auth");
const authRouter = express.Router();

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Frontend and backend live on different domains (even in local dev, on
// different ports), so cookies must be SameSite=None to be sent back on
// cross-site requests. Browsers treat "localhost" as a secure context, so
// Secure cookies work there too — no need to branch on NODE_ENV.
const baseCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "none",
};
const ACCESS_TOKEN_MAX_AGE = 15 * 60 * 1000; // 15 minutes
const REFRESH_TOKEN_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

const setAuthCookies = async (res, user) => {
  const accessToken = user.getAccessToken();
  const refreshToken = user.getRefreshToken();
  res.cookie("accessToken", accessToken, {
    ...baseCookieOptions,
    maxAge: ACCESS_TOKEN_MAX_AGE,
  });
  res.cookie("refreshToken", refreshToken, {
    ...baseCookieOptions,
    maxAge: REFRESH_TOKEN_MAX_AGE,
  });
  await user.setRefreshToken(refreshToken);
};

const clearAuthCookies = (res) => {
  res.clearCookie("accessToken", baseCookieOptions);
  res.clearCookie("refreshToken", baseCookieOptions);
};

authRouter.post("/signup", checkEmailExists, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const strongPassword = await isStrongPassword(password);
    if (!strongPassword) {
      return res.status(400).json({ error: "Password is not strong enough" });
    }
    const trimmedName = name.trim();
    const newUser = new User({
      name: trimmedName,
      email,
      password,
      mobile: "",
      address: "",
      gender: "male",
      lastName: "",
    });

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
    await setAuthCookies(res, user);
    const { password: _password, refreshTokenHash, ...safeUser } =
      user.toObject();
    res
      .status(200)
      .json({ message: "User signed in successfully", user: safeUser });
  } catch (error) {
    res.status(500).json({ error: "Server error" + error.message });
  }
});

authRouter.post("/auth/google", async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: "Google credential is required" });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (error) {
      return res.status(401).json({ error: "Invalid Google credential" });
    }

    if (!payload?.email_verified) {
      return res
        .status(401)
        .json({ error: "Google account email is not verified" });
    }

    let user = await User.findOne({ email: payload.email });
    if (user) {
      if (!user.googleId) {
        user.googleId = payload.sub;
        await user.save();
      }
    } else {
      user = new User({
        name: payload.given_name || payload.name || "Google User",
        lastName: payload.family_name || "",
        email: payload.email,
        googleId: payload.sub,
      });
      await user.save();
    }

    await setAuthCookies(res, user);
    const { password: _password, refreshTokenHash, ...safeUser } =
      user.toObject();
    res.status(200).json({ message: "Signed in with Google", user: safeUser });
  } catch (error) {
    res.status(500).json({ error: "Server error: " + error.message });
  }
});

authRouter.post("/refresh-token", async (req, res) => {
  try {
    const token = req.cookies.refreshToken;
    if (!token) {
      return res.status(401).json({ error: "No refresh token provided" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      clearAuthCookies(res);
      return res.status(401).json({ error: "Invalid or expired refresh token" });
    }

    if (decoded.type !== "refresh") {
      clearAuthCookies(res);
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    const user = await User.findById(decoded.id).select("+refreshTokenHash");
    if (!user || !(await user.compareRefreshToken(token))) {
      clearAuthCookies(res);
      return res.status(401).json({ error: "Refresh token not recognized" });
    }

    await setAuthCookies(res, user);
    res.status(200).json({ message: "Token refreshed" });
  } catch (error) {
    res.status(500).json({ error: "Server error: " + error.message });
  }
});

authRouter.post("/signout", async (req, res) => {
  try {
    const token = req.cookies.accessToken || req.cookies.refreshToken;
    if (token) {
      try {
        const decoded = jwt.decode(token);
        if (decoded?.id) {
          const user = await User.findById(decoded.id);
          if (user) await user.setRefreshToken(null);
        }
      } catch (error) {
        // best-effort revocation only — always still clear cookies below
      }
    }
    clearAuthCookies(res);
    res.status(200).send("Signout successful");
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

authRouter.get("/me", userAuth, (req, res) => {
  const { password, ...safeUser } = req.user.toObject();
  res.status(200).json(safeUser);
});

authRouter.put("/change-password", userAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ error: "Current and new password are required" });
    }

    const isCurrentValid = await req.user.comparePassword(currentPassword);
    if (!isCurrentValid) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    if (!(await isStrongPassword(newPassword))) {
      return res
        .status(400)
        .json({ error: "New password is not strong enough" });
    }

    req.user.password = newPassword;
    req.user.refreshTokenHash = undefined;
    await req.user.save();
    clearAuthCookies(res);

    res.status(200).json({ message: "Password changed successfully" });
  } catch (error) {
    res.status(500).json({ error: "Server error: " + error.message });
  }
});

module.exports = authRouter;
