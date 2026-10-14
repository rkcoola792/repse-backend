const mongoose = require("mongoose");
const { createHash, compareHash } = require("../utils/createHash");
const jwt = require("jsonwebtoken");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    lastName: {
      type: String,
    },
    address: {
      type: String,
    },
    mobile: {
      type: String,
    },
    gender: {
      type: String,
      enum: ["male", "female", "other"],
    },
    email: {
      type: String,
      required: true,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    emailVerifiedAt: { type: Date },
    /* Phone OTP fields are paused until SMS verification is enabled:
    phoneVerifiedAt: { type: Date },
    phoneLogin: { type: String, unique: true, sparse: true, select: false },
    phoneOtpHash: { type: String, select: false },
    phoneOtpExpiresAt: { type: Date, select: false },
    phoneOtpSentAt: { type: Date, select: false },
    phoneOtpAttempts: { type: Number, default: 0, select: false },
    */
    loginOtpHash: { type: String, select: false },
    loginOtpExpiresAt: { type: Date, select: false },
    loginOtpSentAt: { type: Date, select: false },
    loginOtpAttempts: { type: Number, default: 0, select: false },
    password: {
      type: String,
      // Not required for accounts created via Google Sign-In (no password to store).
      required: function () {
        return !this.googleId && !this.emailVerifiedAt && !this.loginOtpHash;
      },
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    refreshTokenHash: {
      type: String,
      select: false,
    },
  },
  { timestamps: true }
);

// User login indexes are installed by config/database.js so the existing
// email unique index can be migrated safely to sparse for phone-only users.
userSchema.set("autoIndex", false);

userSchema.pre("save", async function (next) {
  const user = this;
  // Only hash if password is modified or new
  if (!user.isModified("password") || !user.password) {
    return next();
  }
  try {
    user.password = await createHash(user.password);
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return await compareHash(candidatePassword, this.password);
};

userSchema.methods.getAccessToken = function () {
  return jwt.sign({ id: this._id, type: "access" }, process.env.JWT_SECRET, {
    expiresIn: "15m",
  });
};

userSchema.methods.getRefreshToken = function () {
  return jwt.sign({ id: this._id, type: "refresh" }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
};

userSchema.methods.setRefreshToken = async function (refreshToken) {
  this.refreshTokenHash = refreshToken ? await createHash(refreshToken) : undefined;
  await this.save();
};

userSchema.methods.compareRefreshToken = async function (candidateToken) {
  if (!this.refreshTokenHash) return false;
  return await compareHash(candidateToken, this.refreshTokenHash);
};

module.exports = mongoose.model("User", userSchema);
