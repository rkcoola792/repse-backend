const mongoose = require("mongoose");
const { createHash, compareHash } = require("../utils/createHash");
const jwt = require("jsonwebtoken");

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ["user", "admin"],
    default: "user",
  },
}, { timestamps: true });

userSchema.pre("save", async function (next) {
  const user = this;
  // Only hash if password is modified or new
  if (!user.isModified("password")) {
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
  return await compareHash(candidatePassword, this.password);
};

userSchema.methods.getJWT = async function () {
  const user = this; //this will give the current looged in user
  const token = await jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });
  return token;
};

module.exports = mongoose.model("User", userSchema);