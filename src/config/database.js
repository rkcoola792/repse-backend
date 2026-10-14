const mongoose = require("mongoose");
const connectDB = async () => {
  try {
    await mongoose.connect(
      process.env.MONGO_URI,
    );
    const users = mongoose.connection.collection("users");
    let indexes = [];
    try {
      indexes = await users.indexes();
    } catch (error) {
      if (error.code !== 26 && error.codeName !== "NamespaceNotFound") throw error;
    }
    const emailIndex = indexes.find((index) => index.key?.email === 1);
    if (emailIndex && (!emailIndex.unique || !emailIndex.sparse)) {
      await users.dropIndex(emailIndex.name);
    }
    await users.createIndex({ email: 1 }, { unique: true, sparse: true, name: "email_1" });
    // Created along with the commented phone OTP fields when SMS sign-in is enabled:
    // await users.createIndex({ phoneLogin: 1 }, { unique: true, sparse: true, name: "phoneLogin_1" });
    await users.createIndex({ googleId: 1 }, { unique: true, sparse: true, name: "googleId_1" });
    console.log("MongoDB Connected");
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
};

module.exports = connectDB;


